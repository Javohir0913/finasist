from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import (
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

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("")
async def dashboard(
    _: User = Depends(require("dashboard:view")), db: AsyncSession = Depends(get_db)
):
    # --- totals in USD ---
    inc = await db.scalar(
        select(func.coalesce(func.sum(Transaction.amount_usd), 0)).where(
            Transaction.direction == "income"
        )
    )
    exp = await db.scalar(
        select(func.coalesce(func.sum(Transaction.amount_usd), 0)).where(
            Transaction.direction == "expense"
        )
    )
    income = float(inc or 0)
    expense = float(exp or 0)

    # --- receivables / payables from org balances (положительный = нам должны, отрицательный = мы должны) ---
    recv = await db.scalar(
        select(func.coalesce(func.sum(Organization.balance_usd), 0)).where(
            Organization.balance_usd > 0
        )
    )
    pay = await db.scalar(
        select(func.coalesce(func.sum(-Organization.balance_usd), 0)).where(
            Organization.balance_usd < 0
        )
    )

    # --- counts ---
    org_count = await db.scalar(select(func.count(Organization.id)))
    prod_count = await db.scalar(select(func.count(Product.id)))
    mat_count = await db.scalar(select(func.count(Material.id)))
    tx_count = await db.scalar(select(func.count(Transaction.id)))

    # --- monthly cash flow series ---
    month = func.to_char(Transaction.doc_date, "YYYY-MM")
    series_stmt = select(
        month.label("m"),
        Transaction.direction,
        func.sum(Transaction.amount_usd),
    ).group_by(month, Transaction.direction).order_by(month)
    series_rows = (await db.execute(series_stmt)).all()
    series: dict[str, dict] = {}
    for m, direction, total in series_rows:
        series.setdefault(m, {"month": m, "income": 0.0, "expense": 0.0})
        series[m][direction] = float(total or 0)
    flow = list(series.values())

    # --- expense breakdown by category (top 6) ---
    cat_stmt = (
        select(Transaction.category, func.sum(Transaction.amount_usd))
        .where(Transaction.direction == "expense")
        .group_by(Transaction.category)
        .order_by(func.sum(Transaction.amount_usd).desc())
        .limit(6)
    )
    cat_rows = (await db.execute(cat_stmt)).all()
    breakdown = [
        {"name": (c or "Прочее"), "value": float(v or 0)} for c, v in cat_rows
    ]

    # --- production & warehouse summary (UZS) ---
    async def recv_by_kind(kind: str) -> float:
        return float(await db.scalar(
            select(func.coalesce(func.sum(MaterialReceipt.amount_uzs), 0))
            .select_from(MaterialReceipt)
            .join(Material, Material.id == MaterialReceipt.material_id)
            .where(Material.kind == kind)
        ) or 0)

    async def issue_by_kind(kind: str) -> float:
        return float(await db.scalar(
            select(func.coalesce(func.sum(MaterialIssue.cost_uzs), 0))
            .select_from(MaterialIssue)
            .join(Material, Material.id == MaterialIssue.material_id)
            .where(Material.kind == kind)
        ) or 0)

    raw_receipt = await recv_by_kind("raw")
    spare_receipt = await recv_by_kind("spare")
    raw_issue = await issue_by_kind("raw")
    prod_val = float(await db.scalar(select(func.coalesce(func.sum(Production.amount_uzs), 0))) or 0)
    prod_qty = float(await db.scalar(select(func.coalesce(func.sum(Production.qty), 0))) or 0)

    mats = (await db.execute(select(Material))).scalars().all()
    raw_stock = sum(float(m.stock_qty or 0) * float(m.avg_cost or 0) for m in mats if m.kind == "raw")
    spare_stock = sum(float(m.stock_qty or 0) * float(m.avg_cost or 0) for m in mats if m.kind == "spare")
    prods = (await db.execute(select(Product))).scalars().all()
    gp_stock = sum(float(p.stock_qty or 0) * float(p.avg_cost or 0) for p in prods)

    return {
        "production": {
            "raw_receipt": round(raw_receipt, 2),
            "spare_receipt": round(spare_receipt, 2),
            "raw_issue": round(raw_issue, 2),
            "production_value": round(prod_val, 2),
            "production_qty": round(prod_qty, 3),
            "raw_stock": round(raw_stock, 2),
            "spare_stock": round(spare_stock, 2),
            "gp_stock": round(gp_stock, 2),
        },
        "kpi": {
            "income_usd": round(income, 2),
            "expense_usd": round(expense, 2),
            "profit_usd": round(income - expense, 2),
            "receivable_usd": round(float(recv or 0), 2),
            "payable_usd": round(float(pay or 0), 2),
            "margin": round((income - expense) / income * 100, 1) if income else 0,
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
