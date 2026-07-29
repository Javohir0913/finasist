"""Финансовый дашборд.

Каждая денежная величина отдаётся сразу в двух валютах — `*_uzs` и `*_usd`,
чтобы фронт переключал отображение без повторного запроса. Суммы в сумах
считаются напрямую из операций, долларовые — из `amount_usd` (курс сделки),
а складские показатели пересчитываются по курсу на конец периода.
"""
from fastapi import APIRouter, Depends
from sqlalchemy import extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..ledger import _rate_map, rate_on
from ..models import (
    ExpenseCode,
    Material,
    MaterialIssue,
    MaterialReceipt,
    Organization,
    Product,
    Production,
    Transaction,
    User,
)
from ..security import require
from .reports import _period_bounds

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("")
async def dashboard(
    year: int | None = None,
    month: int | None = None,
    _: User = Depends(require("dashboard:view")),
    db: AsyncSession = Depends(get_db),
):
    _start, end = _period_bounds(year, month)
    rates, last_rate = await _rate_map(db)
    rate = rate_on(rates, end, last_rate) if end else last_rate
    rate = rate or 1.0

    def period(stmt, col):
        if year:
            stmt = stmt.where(extract("year", col) == year)
        if month:
            stmt = stmt.where(extract("month", col) == month)
        return stmt

    def to_usd(uzs: float) -> float:
        return round(uzs / rate, 2) if rate else 0.0

    # --- деньги: обе валюты берём из самих операций ---
    async def money(direction: str) -> tuple[float, float]:
        stmt = select(
            func.coalesce(func.sum(Transaction.amount_uzs), 0),
            func.coalesce(func.sum(Transaction.amount_usd), 0),
        ).where(Transaction.direction == direction)
        uzs, usd = (await db.execute(period(stmt, Transaction.doc_date))).one()
        return float(uzs or 0), float(usd or 0)

    income_uzs, income_usd = await money("income")
    expense_uzs, expense_usd = await money("expense")

    # --- дебиторка / кредиторка из сальдо контрагентов ---
    async def side(positive: bool) -> tuple[float, float]:
        cond = Organization.balance_uzs > 0 if positive else Organization.balance_uzs < 0
        sign = 1 if positive else -1
        uzs, usd = (
            await db.execute(
                select(
                    func.coalesce(func.sum(sign * Organization.balance_uzs), 0),
                    func.coalesce(func.sum(sign * Organization.balance_usd), 0),
                ).where(cond)
            )
        ).one()
        return float(uzs or 0), float(usd or 0)

    recv_uzs, recv_usd = await side(True)
    pay_uzs, pay_usd = await side(False)

    # --- счётчики справочников ---
    org_count = await db.scalar(select(func.count(Organization.id)))
    prod_count = await db.scalar(select(func.count(Product.id)))
    mat_count = await db.scalar(select(func.count(Material.id)))
    tx_count = await db.scalar(select(func.count(Transaction.id)))

    # --- помесячный денежный поток ---
    m_col = func.to_char(Transaction.doc_date, "YYYY-MM")
    series_stmt = select(
        m_col.label("m"),
        Transaction.direction,
        func.sum(Transaction.amount_uzs),
        func.sum(Transaction.amount_usd),
    ).group_by(m_col, Transaction.direction).order_by(m_col)
    series: dict[str, dict] = {}
    for m, direction, uzs, usd in (await db.execute(period(series_stmt, Transaction.doc_date))).all():
        row = series.setdefault(m, {"month": m, "income_uzs": 0.0, "expense_uzs": 0.0,
                                    "income_usd": 0.0, "expense_usd": 0.0})
        row[f"{direction}_uzs"] = float(uzs or 0)
        row[f"{direction}_usd"] = float(usd or 0)
    flow = list(series.values())

    # --- структура расходов: по статьям справочника, топ-6 ---
    names = {
        c.code: c.name
        for c in (await db.execute(select(ExpenseCode))).scalars().all()
    }
    cat_stmt = (
        select(
            Transaction.expense_code,
            Transaction.category,
            func.sum(Transaction.amount_uzs),
            func.sum(Transaction.amount_usd),
        )
        .where(Transaction.direction == "expense")
        .group_by(Transaction.expense_code, Transaction.category)
    )
    grouped: dict[str, dict] = {}
    for code, cat, uzs, usd in (await db.execute(period(cat_stmt, Transaction.doc_date))).all():
        label = names.get(code or "") or cat or "Прочее"
        row = grouped.setdefault(label, {"name": label, "uzs": 0.0, "usd": 0.0})
        row["uzs"] += float(uzs or 0)
        row["usd"] += float(usd or 0)
    breakdown = sorted(grouped.values(), key=lambda r: -r["uzs"])[:6]
    for r in breakdown:
        r["uzs"] = round(r["uzs"], 2)
        r["usd"] = round(r["usd"], 2)

    # --- производство и склад (ведутся в сумах) ---
    async def by_kind(model, col, kind: str) -> float:
        stmt = (
            select(func.coalesce(func.sum(col), 0))
            .select_from(model)
            .join(Material, Material.id == model.material_id)
            .where(Material.kind == kind)
        )
        return float(await db.scalar(period(stmt, model.doc_date)) or 0)

    raw_receipt = await by_kind(MaterialReceipt, MaterialReceipt.amount_uzs, "raw")
    spare_receipt = await by_kind(MaterialReceipt, MaterialReceipt.amount_uzs, "spare")
    raw_issue = await by_kind(MaterialIssue, MaterialIssue.cost_uzs, "raw")
    prod_val = float(await db.scalar(
        period(select(func.coalesce(func.sum(Production.amount_uzs), 0)), Production.doc_date)
    ) or 0)
    prod_qty = float(await db.scalar(
        period(select(func.coalesce(func.sum(Production.qty), 0)), Production.doc_date)
    ) or 0)

    mats = (await db.execute(select(Material))).scalars().all()
    raw_stock = sum(float(m.stock_qty or 0) * float(m.avg_cost or 0) for m in mats if m.kind == "raw")
    spare_stock = sum(float(m.stock_qty or 0) * float(m.avg_cost or 0) for m in mats if m.kind != "raw")
    prods = (await db.execute(select(Product))).scalars().all()
    gp_stock = sum(float(p.stock_qty or 0) * float(p.avg_cost or 0) for p in prods)

    def pair(uzs: float) -> dict:
        return {"uzs": round(uzs, 2), "usd": to_usd(uzs)}

    profit_uzs = income_uzs - expense_uzs
    profit_usd = income_usd - expense_usd
    return {
        "rate": rate,
        "period": {"year": year, "month": month},
        "production": {
            "raw_receipt": pair(raw_receipt),
            "spare_receipt": pair(spare_receipt),
            "raw_issue": pair(raw_issue),
            "production_value": pair(prod_val),
            "production_qty": round(prod_qty, 3),
            "raw_stock": pair(raw_stock),
            "spare_stock": pair(spare_stock),
            "gp_stock": pair(gp_stock),
            "total_stock": pair(raw_stock + spare_stock + gp_stock),
        },
        "kpi": {
            "income_uzs": round(income_uzs, 2), "income_usd": round(income_usd, 2),
            "expense_uzs": round(expense_uzs, 2), "expense_usd": round(expense_usd, 2),
            "profit_uzs": round(profit_uzs, 2), "profit_usd": round(profit_usd, 2),
            "receivable_uzs": round(recv_uzs, 2), "receivable_usd": round(recv_usd, 2),
            "payable_uzs": round(pay_uzs, 2), "payable_usd": round(pay_usd, 2),
            "margin": round(profit_uzs / income_uzs * 100, 1) if income_uzs else 0,
        },
        "counts": {
            "organizations": org_count or 0,
            "products": prod_count or 0,
            "materials": mat_count or 0,
            "transactions": tx_count or 0,
        },
        "cashflow": flow,
        "expense_breakdown": breakdown,
    }
