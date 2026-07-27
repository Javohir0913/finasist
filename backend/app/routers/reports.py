"""Финансовые отчёты: Cash Flow (ДДС), расходы по кодам, Дт-Кт ведомости,
ОФР (Форма №2), Баланс (Форма №1), обороты склада и ГП."""
from fastapi import APIRouter, Depends
from sqlalchemy import extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..rates import get_rates
from ..models import (
    CashflowCode,
    Employee,
    ExchangeRate,
    ExpenseCode,
    Loan,
    Material,
    MaterialIssue,
    MaterialReceipt,
    Organization,
    PayrollEntry,
    Product,
    Production,
    Sale,
    Service,
    Tax,
    Transaction,
    User,
)
from ..security import require

router = APIRouter(prefix="/api/reports", tags=["reports"])


def _period(stmt, year: int | None, month: int | None, col=None):
    """Filter by year/month on the given date column (default: Transaction.doc_date)."""
    col = col if col is not None else Transaction.doc_date
    if year:
        stmt = stmt.where(extract("year", col) == year)
    if month:
        stmt = stmt.where(extract("month", col) == month)
    return stmt


@router.get("/cashflow")
async def cashflow(
    year: int | None = None,
    month: int | None = None,
    _: User = Depends(require("reports:view")),
    db: AsyncSession = Depends(get_db),
):
    # totals by account (USD)
    async def total(account: str, direction: str) -> float:
        stmt = select(func.coalesce(func.sum(Transaction.amount_uzs), 0)).where(
            Transaction.account == account, Transaction.direction == direction
        )
        return float(await db.scalar(_period(stmt, year, month)) or 0)

    b_in = await total("bank", "income")
    b_out = await total("bank", "expense")
    k_in = await total("kassa", "income")
    k_out = await total("kassa", "expense")

    # breakdown by Cash Flow code
    stmt = (
        select(
            Transaction.cashflow_code,
            Transaction.direction,
            func.coalesce(func.sum(Transaction.amount_uzs), 0),
        )
        .group_by(Transaction.cashflow_code, Transaction.direction)
    )
    rows = (await db.execute(_period(stmt, year, month))).all()

    names = {c.code: c.name for c in (await db.execute(select(CashflowCode))).scalars().all()}
    by_code: dict[str, dict] = {}
    for code, direction, total_v in rows:
        key = code or "—"
        by_code.setdefault(key, {"code": key, "name": names.get(key, "—"), "in": 0.0, "out": 0.0})
        by_code[key]["in" if direction == "income" else "out"] += float(total_v or 0)

    return {
        "bank": {"in": b_in, "out": b_out, "end": b_in - b_out},
        "kassa": {"in": k_in, "out": k_out, "end": k_in - k_out},
        "total": {
            "in": b_in + k_in,
            "out": b_out + k_out,
            "end": (b_in + k_in) - (b_out + k_out),
        },
        "by_code": sorted(by_code.values(), key=lambda x: x["code"]),
    }


@router.get("/expenses")
async def expenses_by_code(
    year: int | None = None,
    month: int | None = None,
    division: str | None = None,
    _: User = Depends(require("reports:view")),
    db: AsyncSession = Depends(get_db),
):
    """Расходы по статьям, сгруппированные по группам (произв./сбыт/адм./прочие)."""
    stmt = (
        select(Transaction.expense_code, func.coalesce(func.sum(Transaction.amount_uzs), 0))
        .where(Transaction.direction == "expense")
    )
    if division:
        stmt = stmt.where(Transaction.division == division)
    stmt = stmt.group_by(Transaction.expense_code)
    rows = (await db.execute(_period(stmt, year, month))).all()
    names = {c.code: c.name for c in (await db.execute(select(ExpenseCode))).scalars().all()}

    groups = {"prod": 0.0, "sell": 0.0, "admin": 0.0, "other": 0.0}
    items = []
    for code, total_v in rows:
        v = float(total_v or 0)
        c = code or ""
        groups[_group_of(c)] += v
        if v:
            items.append({"code": c or "—", "name": names.get(c, "—"), "amount": v})

    # accrued payroll (salary + ЕСП) grouped by employee expense code
    pstmt = select(PayrollEntry.gross, PayrollEntry.esp, Employee.expense_code, Employee.full_name).join(
        Employee, Employee.id == PayrollEntry.employee_id
    )
    if year and month:
        pstmt = pstmt.where(PayrollEntry.period == f"{year}-{int(month):02d}")
    if division:
        pstmt = pstmt.where(Employee.division == division)
    pay_by_group = {"prod": 0.0, "sell": 0.0, "admin": 0.0, "other": 0.0}
    for gross, esp, code, _fn in (await db.execute(pstmt)).all():
        cost = float(gross or 0) + float(esp or 0)
        pay_by_group[_group_of(code)] += cost
    grp_name = {"prod": "Зарплата произв. персонала", "sell": "Зарплата отдела продаж",
                "admin": "Зарплата администрации", "other": "Зарплата (прочие)"}
    for grp, amt in pay_by_group.items():
        groups[grp] += amt
        if amt:
            items.append({"code": "ЗП", "name": grp_name[grp], "amount": round(amt, 2)})

    groups["period"] = groups["sell"] + groups["admin"] + groups["other"]
    groups["total"] = groups["prod"] + groups["period"]
    return {"groups": groups, "items": sorted(items, key=lambda x: -x["amount"])}


def _group_of(code: str) -> str:
    """Map an expense code to its P&L group. Salary without a code -> admin."""
    c = code or ""
    if c.startswith("20"):
        return "prod"
    if c.startswith("941"):
        return "sell"
    if c.startswith("942"):
        return "admin"
    if c.startswith("943"):
        return "other"
    return "admin"  # прочая зарплата/расход без кода -> административные


async def _payroll_groups(db: AsyncSession, year, month, division=None) -> dict:
    """Начисленная зарплата (gross + ЕСП) по группам, из модуля «Зарплата»."""
    g = {"prod": 0.0, "sell": 0.0, "admin": 0.0, "other": 0.0}
    stmt = select(PayrollEntry.gross, PayrollEntry.esp, Employee.expense_code).join(
        Employee, Employee.id == PayrollEntry.employee_id
    )
    if year and month:
        stmt = stmt.where(PayrollEntry.period == f"{year}-{int(month):02d}")
    if division:
        stmt = stmt.where(Employee.division == division)
    for gross, esp, code in (await db.execute(stmt)).all():
        g[_group_of(code)] += float(gross or 0) + float(esp or 0)
    return g


async def _expense_groups_uzs(db: AsyncSession, year, month, division=None) -> dict:
    stmt = (
        select(Transaction.expense_code, func.coalesce(func.sum(Transaction.amount_uzs), 0))
        .where(Transaction.direction == "expense")
    )
    if division:
        stmt = stmt.where(Transaction.division == division)
    stmt = stmt.group_by(Transaction.expense_code)
    rows = (await db.execute(_period(stmt, year, month))).all()
    g = {"prod": 0.0, "sell": 0.0, "admin": 0.0, "other": 0.0}
    for code, v in rows:
        g[_group_of(code)] += float(v or 0)
    # add accrued payroll (salary + ЕСП) so it reflects in the P&L
    pg = await _payroll_groups(db, year, month, division)
    for k in ("prod", "sell", "admin", "other"):
        g[k] += pg[k]
    g["period"] = g["sell"] + g["admin"] + g["other"]
    return g


# ================= Дт-Кт ведомости (counterparties) =================
@router.get("/counterparties")
async def counterparties(
    category: str | None = None,
    _: User = Depends(require("reports:view")),
    db: AsyncSession = Depends(get_db),
):
    """Ведомость Дт-Кт: начало / оборот / конец по каждому контрагенту (USD)."""
    orgs = (await db.execute(select(Organization).order_by(Organization.name))).scalars().all()
    # turnover from transactions (expense=debit, income=credit)
    stmt = select(
        Transaction.organization_id,
        Transaction.direction,
        func.coalesce(func.sum(Transaction.amount_uzs), 0),
    ).where(Transaction.organization_id.isnot(None)).group_by(
        Transaction.organization_id, Transaction.direction
    )
    turn: dict[int, dict] = {}
    for oid, direction, total in (await db.execute(stmt)).all():
        turn.setdefault(oid, {"debit": 0.0, "credit": 0.0})
        turn[oid]["debit" if direction == "expense" else "credit"] += float(total or 0)

    rows = []
    tot = {"debit_open": 0.0, "credit_open": 0.0, "debit_turn": 0.0, "credit_turn": 0.0, "debit_end": 0.0, "credit_end": 0.0}
    for o in orgs:
        if category and o.category != category:
            continue
        t = turn.get(o.id, {"debit": 0.0, "credit": 0.0})
        closing = float(o.balance_uzs or 0)
        net_turn = t["debit"] - t["credit"]
        opening = closing - net_turn
        d = {
            "id": o.id, "name": o.name, "inn": o.inn, "category": o.category,
            "open_debit": max(opening, 0), "open_credit": max(-opening, 0),
            "turn_debit": t["debit"], "turn_credit": t["credit"],
            "end_debit": max(closing, 0), "end_credit": max(-closing, 0),
        }
        if any([d["open_debit"], d["open_credit"], d["turn_debit"], d["turn_credit"], d["end_debit"], d["end_credit"]]):
            rows.append(d)
            tot["debit_open"] += d["open_debit"]; tot["credit_open"] += d["open_credit"]
            tot["debit_turn"] += d["turn_debit"]; tot["credit_turn"] += d["turn_credit"]
            tot["debit_end"] += d["end_debit"]; tot["credit_end"] += d["end_credit"]
    return {"rows": rows, "totals": tot}


# ================= ОФР (Форма №2) =================
@router.get("/pnl")
async def pnl(
    year: int | None = None,
    month: int | None = None,
    division: str | None = None,
    _: User = Depends(require("reports:view")),
    db: AsyncSession = Depends(get_db),
):
    """Отчёт о финансовых результатах (в сумах). division -> ОФР по подразделению."""
    sstmt = select(
        func.coalesce(func.sum(Sale.revenue_net), 0),
        func.coalesce(func.sum(Sale.cogs_uzs), 0),
        func.coalesce(func.sum(Sale.vat_amount), 0),
    )
    if division:
        sstmt = sstmt.where(Sale.division == division)
    revenue, cogs, vat = (await db.execute(_period(sstmt, year, month, Sale.doc_date))).one()
    revenue, cogs, vat = float(revenue), float(cogs), float(vat)
    g = await _expense_groups_uzs(db, year, month, division)
    gross = revenue - cogs                       # стр.030 = 010 − 020
    op_profit = gross - g["period"]              # стр.100 = 030 − 040
    # Налог на прибыль (стр.250):
    #  - если в модуле «Налоги» вручную задан налог на прибыль (начислено) — берём его;
    #  - иначе автоматически 15% от положительной прибыли до налога.
    manual_tax = float(
        await db.scalar(
            select(func.coalesce(func.sum(Tax.accrued), 0)).where(Tax.name.ilike("%прибыль%"))
        )
        or 0
    )
    prate = (await get_rates(db))["profit_tax_rate"]
    auto_tax = round(op_profit * prate, 2) if op_profit > 0 else 0.0
    tax = manual_tax if manual_tax > 0 else auto_tax
    net = op_profit - tax                        # стр.270
    return {
        "revenue": round(revenue, 2), "vat": round(vat, 2),
        "cogs": round(cogs, 2), "gross": round(gross, 2),
        "prod_expenses": round(g["prod"], 2),
        "sell": round(g["sell"], 2), "admin": round(g["admin"], 2), "other": round(g["other"], 2),
        "period": round(g["period"], 2),
        "op_profit": round(op_profit, 2), "tax": round(tax, 2), "net": round(net, 2),
        "gross_margin": round(gross / revenue * 100, 1) if revenue else 0,
        "net_margin": round(net / revenue * 100, 1) if revenue else 0,
    }


# ================= Налоги (авто-расчёт, как в Excel) =================
NDS_RATE = 0.12
# коды оплаты по видам налогов (для «оплачено» из операций)
TAX_PAY_CODES = {
    "НДС": ["94321"],
    "Налог на прибыль": ["94319"],
    "НДФЛ": ["2013", "94103", "94203"],
    "ЕСП": ["2014", "94104", "94204"],
    "ИНПС": ["2015", "94105", "94205"],
    "Земельный налог": ["94322"],
    "Прочие налоги": ["94323"],
}


@router.get("/taxes")
async def taxes_report(
    year: int | None = None,
    month: int | None = None,
    _: User = Depends(require("taxes:view")),
    db: AsyncSession = Depends(get_db),
):
    return await _taxes_core(db, year, month)


async def _taxes_core(db: AsyncSession, year, month):
    """Авто-расчёт налогов: начислено — из операций (как формулы Excel), долг = нач + начислено − оплачено."""
    rates = await get_rates(db)
    async def s(stmt, col):
        return float(await db.scalar(_period(stmt, year, month, col)) or 0)

    # --- НДС = выходной НДС − входной НДС ---
    out_vat = await s(select(func.coalesce(func.sum(Sale.vat_amount), 0)), Sale.doc_date)
    out_vat += await s(select(func.coalesce(func.sum(Service.vat_amount), 0)).where(Service.direction == "provided"), Service.doc_date)
    in_vat = await s(select(func.coalesce(func.sum(Service.vat_amount), 0)).where(Service.direction == "received"), Service.doc_date)
    recv_net = await s(select(func.coalesce(func.sum(MaterialReceipt.amount_uzs), 0)).where(MaterialReceipt.vat.is_(True)), MaterialReceipt.doc_date)
    in_vat += round(recv_net * rates["nds_rate"], 2)
    nds_accrued = round(out_vat - in_vat, 2)

    # --- зарплатные налоги ---
    pstmt = select(
        func.coalesce(func.sum(PayrollEntry.ndfl), 0),
        func.coalesce(func.sum(PayrollEntry.inps), 0),
        func.coalesce(func.sum(PayrollEntry.esp), 0),
    )
    if year and month:
        pstmt = pstmt.where(PayrollEntry.period == f"{year}-{int(month):02d}")
    ndfl_a, inps_a, esp_a = (await db.execute(pstmt)).one()
    ndfl_a, inps_a, esp_a = float(ndfl_a), float(inps_a), float(esp_a)

    # --- налог на прибыль = 15% операционной прибыли ---
    rev = await s(select(func.coalesce(func.sum(Sale.revenue_net), 0)), Sale.doc_date)
    cogs = await s(select(func.coalesce(func.sum(Sale.cogs_uzs), 0)), Sale.doc_date)
    g = await _expense_groups_uzs(db, year, month)
    op_profit = rev - cogs - g["period"]
    profit_accrued = round(op_profit * rates["profit_tax_rate"], 2) if op_profit > 0 else 0.0

    accrued_map = {
        "НДС": nds_accrued,
        "Налог на прибыль": profit_accrued,
        "НДФЛ": ndfl_a,
        "ЕСП": esp_a,
        "ИНПС": inps_a,
    }

    # оплачено — из операций по кодам оплаты
    async def paid_of(name: str) -> float:
        codes = TAX_PAY_CODES.get(name, [])
        if not codes:
            return 0.0
        stmt = select(func.coalesce(func.sum(Transaction.amount_uzs), 0)).where(
            Transaction.direction == "expense", Transaction.expense_code.in_(codes)
        )
        return await s(stmt, Transaction.doc_date)

    taxes = (await db.execute(select(Tax).order_by(Tax.id))).scalars().all()
    rows = []
    tot = {"start": 0.0, "accrued": 0.0, "paid": 0.0, "end": 0.0}
    for t in taxes:
        # начислено: авто, если известен вид; иначе ручное значение
        acc_auto = None
        for key, val in accrued_map.items():
            if key.lower() in t.name.lower():
                acc_auto = val
                break
        accrued = acc_auto if acc_auto is not None else float(t.accrued or 0)
        paid = await paid_of(t.name)
        if paid == 0:
            paid = float(t.paid or 0)  # запасной вариант — ручное
        start = float(t.debt_start or 0)
        end = round(start + accrued - paid, 2)
        rows.append({
            "id": t.id, "name": t.name, "debt_start": start,
            "accrued": round(accrued, 2), "auto": acc_auto is not None,
            "paid": round(paid, 2), "debt_end": max(end, 0), "overpay": max(-end, 0),
        })
        tot["start"] += start; tot["accrued"] += accrued; tot["paid"] += paid; tot["end"] += max(end, 0)
    return {"rows": rows, "totals": {k: round(v, 2) for k, v in tot.items()}}


# ================= Курсовая разница (переоценка по последнему курсу) =================
@router.get("/fx-difference")
async def fx_difference(
    _: User = Depends(require("reports:view")),
    db: AsyncSession = Depends(get_db),
):
    """Курсовая разница = (баланс в USD × последний курс) − баланс в сумах. >0 доход, <0 убыток."""
    rate = float(await db.scalar(select(ExchangeRate.rate).order_by(ExchangeRate.rate_date.desc()).limit(1)) or 1)

    orgs = (await db.execute(select(Organization))).scalars().all()
    org_usd = sum(float(o.balance_usd or 0) for o in orgs)
    org_uzs = sum(float(o.balance_uzs or 0) for o in orgs)
    org_fx = round(org_usd * rate - org_uzs, 2)

    inc_usd = float(await db.scalar(select(func.coalesce(func.sum(Transaction.amount_usd), 0)).where(Transaction.direction == "income")) or 0)
    exp_usd = float(await db.scalar(select(func.coalesce(func.sum(Transaction.amount_usd), 0)).where(Transaction.direction == "expense")) or 0)
    inc_uzs = float(await db.scalar(select(func.coalesce(func.sum(Transaction.amount_uzs), 0)).where(Transaction.direction == "income")) or 0)
    exp_uzs = float(await db.scalar(select(func.coalesce(func.sum(Transaction.amount_uzs), 0)).where(Transaction.direction == "expense")) or 0)
    cash_fx = round((inc_usd - exp_usd) * rate - (inc_uzs - exp_uzs), 2)

    def row(name, fx):
        return {"name": name, "income": round(max(fx, 0), 2), "loss": round(max(-fx, 0), 2)}

    rows = [
        row("Дебиторская и кредиторская задолженность", org_fx),
        row("Денежные средства (банк и касса)", cash_fx),
    ]
    return {
        "rate": rate,
        "rows": rows,
        "total_income": round(sum(r["income"] for r in rows), 2),
        "total_loss": round(sum(r["loss"] for r in rows), 2),
    }


# ================= Баланс (Форма №1) =================
@router.get("/balance")
async def balance(
    _: User = Depends(require("reports:view")),
    db: AsyncSession = Depends(get_db),
):
    """Упрощённый баланс (в сумах)."""
    cash_in = float(await db.scalar(select(func.coalesce(func.sum(Transaction.amount_uzs), 0)).where(Transaction.direction == "income")) or 0)
    cash_out = float(await db.scalar(select(func.coalesce(func.sum(Transaction.amount_uzs), 0)).where(Transaction.direction == "expense")) or 0)
    cash = cash_in - cash_out

    mats = (await db.execute(select(Material))).scalars().all()
    mat_val = sum(float(m.stock_qty or 0) * float(m.avg_cost or 0) for m in mats)
    prods = (await db.execute(select(Product))).scalars().all()
    prod_val = sum(float(p.stock_qty or 0) * float(p.avg_cost or 0) for p in prods)

    orgs = (await db.execute(select(Organization))).scalars().all()
    receivable = sum(float(o.balance_uzs or 0) for o in orgs if float(o.balance_uzs or 0) > 0)
    payable = sum(-float(o.balance_uzs or 0) for o in orgs if float(o.balance_uzs or 0) < 0)

    # задолженность по налогам — из авто-расчёта (как в отчёте «Налоги»)
    tax_data = await _taxes_core(db, None, None)
    tax_debt = float(tax_data["totals"]["end"])

    # займы полученные — обязательство
    loans = (await db.execute(select(Loan).where(Loan.direction == "received"))).scalars().all()
    loan_debt = sum(float(l.balance or 0) for l in loans)

    assets = cash + mat_val + prod_val + receivable
    liabilities = payable + tax_debt + loan_debt
    equity = assets - liabilities
    return {
        "assets": {
            "cash": round(cash, 2), "materials": round(mat_val, 2),
            "products": round(prod_val, 2), "receivable": round(receivable, 2),
            "total": round(assets, 2),
        },
        "liabilities": {
            "payable": round(payable, 2), "taxes": round(tax_debt, 2),
            "loans": round(loan_debt, 2), "total": round(liabilities, 2),
        },
        "equity": round(equity, 2),
    }


# ================= Обороты склада (сырьё / запчасти) =================
@router.get("/materials")
async def materials_report(
    kind: str | None = None,
    _: User = Depends(require("materials:view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Material).order_by(Material.code)
    if kind:
        stmt = stmt.where(Material.kind == kind)
    mats = (await db.execute(stmt)).scalars().all()
    rows = [{
        "code": m.code, "name": m.name, "unit": m.unit, "kind": m.kind,
        "stock_qty": float(m.stock_qty or 0), "avg_cost": float(m.avg_cost or 0),
        "value": round(float(m.stock_qty or 0) * float(m.avg_cost or 0), 2),
    } for m in mats]
    return {"rows": rows, "total_value": round(sum(r["value"] for r in rows), 2)}


# ================= Авто-себестоимость производства (из расхода сырья) =================
@router.get("/production-cost")
async def production_cost(
    division: str = "",
    year: int | None = None,
    month: int | None = None,
    _: User = Depends(require("production:view")),
    db: AsyncSession = Depends(get_db),
):
    """Себестоимость ед. (как в Excel «С-сть ГП»):
    (расход сырья + производственные расходы 20xx + зарплата произв. персонала) / выпуск,
    всё по выбранному подразделению за период."""
    # 1) расход сырья
    mstmt = select(func.coalesce(func.sum(MaterialIssue.cost_uzs), 0))
    if division:
        mstmt = mstmt.where(MaterialIssue.division == division)
    mat_cost = float(await db.scalar(_period(mstmt, year, month, MaterialIssue.doc_date)) or 0)

    # 2) производственные расходы (коды 20xx) из операций
    tstmt = select(func.coalesce(func.sum(Transaction.amount_uzs), 0)).where(
        Transaction.direction == "expense", Transaction.expense_code.like("20%")
    )
    if division:
        tstmt = tstmt.where(Transaction.division == division)
    prod_exp = float(await db.scalar(_period(tstmt, year, month, Transaction.doc_date)) or 0)

    # 3) зарплата производственного персонала (коды 20xx)
    pay_stmt = select(func.coalesce(func.sum(PayrollEntry.gross + PayrollEntry.esp), 0)).join(
        Employee, Employee.id == PayrollEntry.employee_id
    ).where(Employee.expense_code.like("20%"))
    if division:
        pay_stmt = pay_stmt.where(Employee.division == division)
    if year and month:
        pay_stmt = pay_stmt.where(PayrollEntry.period == f"{year}-{int(month):02d}")
    payroll_exp = float(await db.scalar(pay_stmt) or 0)

    # выпуск
    qstmt = select(func.coalesce(func.sum(Production.qty), 0))
    if division:
        qstmt = qstmt.where(Production.division == division)
    qty = float(await db.scalar(_period(qstmt, year, month, Production.doc_date)) or 0)

    total = mat_cost + prod_exp + payroll_exp
    return {
        "materials_cost": round(mat_cost, 2),
        "prod_expenses": round(prod_exp + payroll_exp, 2),
        "total_cost": round(total, 2),
        "produced_qty": qty,
        "unit_cost": round(total / qty, 2) if qty else 0,
    }


# ================= Оборот склада сырья/запчастей (Остаток нач + Приход − Расход = кон) =================
@router.get("/materials-turnover")
async def materials_turnover(
    kind: str | None = None,
    year: int | None = None,
    month: int | None = None,
    _: User = Depends(require("materials:view")),
    db: AsyncSession = Depends(get_db),
):
    mstmt = select(Material).order_by(Material.code)
    if kind:
        mstmt = mstmt.where(Material.kind == kind)
    mats = (await db.execute(mstmt)).scalars().all()

    async def agg(model, qty_col, val_col, mid):
        stmt = select(func.coalesce(func.sum(qty_col), 0), func.coalesce(func.sum(val_col), 0)).where(model.material_id == mid)
        q, v = (await db.execute(_period(stmt, year, month, model.doc_date))).one()
        return float(q or 0), float(v or 0)

    rows = []
    for m in mats:
        recv_q, recv_v = await agg(MaterialReceipt, MaterialReceipt.qty, MaterialReceipt.amount_uzs, m.id)
        iss_q, iss_v = await agg(MaterialIssue, MaterialIssue.qty, MaterialIssue.cost_uzs, m.id)
        close_q = float(m.stock_qty or 0)
        close_v = round(close_q * float(m.avg_cost or 0), 2)
        open_q = round(close_q - recv_q + iss_q, 3)
        open_v = round(close_v - recv_v + iss_v, 2)
        if any([open_q, recv_q, iss_q, close_q]):
            rows.append({
                "code": m.code, "name": m.name, "unit": m.unit,
                "open_qty": open_q, "open_val": open_v,
                "recv_qty": recv_q, "recv_val": round(recv_v, 2),
                "iss_qty": iss_q, "iss_val": round(iss_v, 2),
                "close_qty": close_q, "close_val": close_v,
            })
    return {"rows": rows}


# ================= Себестоимость ГП (С-сть) =================
@router.get("/cost")
async def cost_report(
    year: int | None = None,
    month: int | None = None,
    division: str | None = None,
    _: User = Depends(require("products:view")),
    db: AsyncSession = Depends(get_db),
):
    products = (await db.execute(select(Product).order_by(Product.code))).scalars().all()

    async def agg(model, cols, pid, div_col=None):
        stmt = select(*[func.coalesce(func.sum(c), 0) for c in cols]).where(model.product_id == pid)
        if division and div_col is not None:
            stmt = stmt.where(div_col == division)
        return (await db.execute(_period(stmt, year, month, model.doc_date))).one()

    rows = []
    for p in products:
        pq, pv = await agg(Production, [Production.qty, Production.amount_uzs], p.id, Production.division)
        pq, pv = float(pq), float(pv)
        sq, rev, cogs = await agg(Sale, [Sale.qty, Sale.revenue_net, Sale.cogs_uzs], p.id, Sale.division)
        sq, rev, cogs = float(sq), float(rev), float(cogs)
        unit_cost = round(pv / pq, 2) if pq else 0
        avg_price = round(rev / sq, 2) if sq else 0
        profit = round(rev - cogs, 2)
        if pq or sq:
            rows.append({
                "code": p.code, "name": p.name, "unit": p.unit,
                "produced": pq, "unit_cost": unit_cost, "total_cost": round(pv, 2),
                "sold": sq, "revenue": round(rev, 2), "cogs": round(cogs, 2),
                "avg_price": avg_price, "profit": profit,
                "margin": round(profit / rev * 100, 1) if rev else 0,
            })
    return {"rows": rows}


# ================= ГП оборот (Остаток нач + Произведено − Реализовано = Остаток кон) =================
@router.get("/gp-turnover")
async def gp_turnover(
    year: int | None = None,
    month: int | None = None,
    _: User = Depends(require("products:view")),
    db: AsyncSession = Depends(get_db),
):
    products = (await db.execute(select(Product).order_by(Product.code))).scalars().all()

    async def agg(model, qty_col, val_col, pid):
        stmt = select(
            func.coalesce(func.sum(qty_col), 0), func.coalesce(func.sum(val_col), 0)
        ).where(model.product_id == pid)
        q, v = (await db.execute(_period(stmt, year, month, model.doc_date))).one()
        return float(q or 0), float(v or 0)

    rows = []
    for p in products:
        prod_q, prod_v = await agg(Production, Production.qty, Production.amount_uzs, p.id)
        sold_q, sold_v = await agg(Sale, Sale.qty, Sale.cogs_uzs, p.id)
        close_q = float(p.stock_qty or 0)
        close_v = round(close_q * float(p.avg_cost or 0), 2)
        open_q = round(close_q - prod_q + sold_q, 3)
        open_v = round(close_v - prod_v + sold_v, 2)
        if any([open_q, prod_q, sold_q, close_q]):
            rows.append({
                "code": p.code, "name": p.name, "unit": p.unit,
                "open_qty": open_q, "open_val": open_v,
                "prod_qty": prod_q, "prod_val": round(prod_v, 2),
                "sold_qty": sold_q, "sold_val": round(sold_v, 2),
                "close_qty": close_q, "close_val": close_v,
            })
    return {"rows": rows}


# ================= Ежедневные остатки денежных средств =================
@router.get("/daily-balance")
async def daily_balance(
    year: int | None = None,
    month: int | None = None,
    _: User = Depends(require("reports:view")),
    db: AsyncSession = Depends(get_db),
):
    """Остаток денежных средств по дням (bank+kassa, USD): начало/приход/расход/конец."""
    stmt = select(
        Transaction.doc_date,
        Transaction.direction,
        func.coalesce(func.sum(Transaction.amount_uzs), 0),
    ).group_by(Transaction.doc_date, Transaction.direction).order_by(Transaction.doc_date)
    rows = (await db.execute(_period(stmt, year, month))).all()
    by_day: dict = {}
    for d, direction, total in rows:
        key = d.isoformat()
        by_day.setdefault(key, {"date": key, "income": 0.0, "expense": 0.0})
        by_day[key]["income" if direction == "income" else "expense"] += float(total or 0)

    out = []
    running = 0.0
    for day in sorted(by_day):
        r = by_day[day]
        opening = running
        closing = opening + r["income"] - r["expense"]
        running = closing
        out.append({"date": day, "opening": round(opening, 2), "income": round(r["income"], 2), "expense": round(r["expense"], 2), "closing": round(closing, 2)})
    return {"rows": out, "final": round(running, 2)}


# ================= ГП оборот / остаток / себестоимость =================
@router.get("/products")
async def products_report(
    _: User = Depends(require("products:view")),
    db: AsyncSession = Depends(get_db),
):
    prods = (await db.execute(select(Product).order_by(Product.code))).scalars().all()
    rows = [{
        "code": p.code, "name": p.name, "unit": p.unit,
        "stock_qty": float(p.stock_qty or 0), "avg_cost": float(p.avg_cost or 0),
        "value": round(float(p.stock_qty or 0) * float(p.avg_cost or 0), 2),
        "sale_price": float(p.sale_price or 0),
    } for p in prods]
    return {"rows": rows, "total_value": round(sum(r["value"] for r in rows), 2)}
