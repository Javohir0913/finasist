"""Единый расчёт Дт-Кт по контрагентам (как ведомости Excel).

Баланс контрагента НЕ накапливается инкрементально (это источник ошибок при
правке/удалении документов), а полностью выводится из первичных документов:

    сальдо = входящее сальдо (opening) + Σ дебет − Σ кредит

Дебет (нам должны / наш аванс):
  · расход денег (мы заплатили контрагенту)   — Transaction.direction = expense
  · отгрузка ГП покупателю                    — Sale (сумма с НДС)
  · оказанные услуги                          — Service.direction = provided
  · выдача займа                              — LoanEntry.kind = debit

Кредит (мы должны):
  · приход денег (контрагент заплатил нам)    — Transaction.direction = income
  · приход сырья/запчастей от поставщика      — MaterialReceipt (сумма с НДС)
  · полученные услуги                         — Service.direction = received
  · погашение займа                           — LoanEntry.kind = credit
  · начисленная зарплата                      — PayrollEntry -> «Ойлик(ОБЪЕКТ)»

Зарплата ведётся как в книге (лист «Дт Кт З.п»): на каждое подразделение свой
«контрагент» — Ойлик(МАХСТОН), Ойлик(ТУРК), Ойлик(ЖБИ) с ИНН = названию объекта.
Начисление садится в КРЕДИТ, а выплата — это обычная операция КАССА/БАНК,
у которой выбран этот контрагент; она садится в ДЕБЕТ. Разница = долг по зарплате.
"""
import calendar
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import (
    Employee,
    ExchangeRate,
    MaterialReceipt,
    Organization,
    PayrollEntry,
    Sale,
    Service,
    Transaction,
)
from .rates import get_rates

# ведомости Дт-Кт (листы Excel)
LEDGERS = [
    ("suppliers", "Поставщики и подрядчики"),
    ("customers", "Покупатели и заказчики"),
    ("safe", "СЕЙФ (ЯККАСАРОЙ)"),
    ("services", "Организации, оказывающие услуги"),
    ("salary", "Заработная плата"),
    ("rbp", "Расходы будущих периодов (РБП)"),
    ("office", "Офис"),
    ("loans", "Займы выданные и полученные"),
    ("other", "Прочие"),
]
LEDGER_KEYS = {k for k, _ in LEDGERS}


async def _rate_map(db: AsyncSession) -> tuple[dict[date, float], float]:
    """Курсы по датам + последний известный курс (fallback)."""
    rows = (await db.execute(select(ExchangeRate.rate_date, ExchangeRate.rate))).all()
    m = {d: float(r) for d, r in rows}
    last = float(m[max(m)]) if m else 1.0
    return m, last


def rate_on(rates: dict[date, float], d: date, fallback: float = 1.0) -> float:
    """Курс на дату. Excel использует VLOOKUP с точным совпадением; здесь —
    последний известный курс НЕ ПОЗЖЕ даты (иначе первый известный)."""
    if d in rates:
        return rates[d] or fallback
    earlier = [x for x in rates if x <= d]
    if earlier:
        return rates[max(earlier)] or fallback
    return (rates[min(rates)] if rates else fallback) or fallback


def fx_of(uzs: float, usd: float, rate: float) -> float:
    """Курсовая разница по одной статье, в долларах (методика Excel):

        сумма в сумах / курс на конец периода − накопленная сумма в валюте

    Положительная — доход, отрицательная — убыток. Знак именно такой:
    при росте курса сумовая дебиторка «худеет» в долларах, то есть даёт убыток.
    """
    if not rate:
        return 0.0
    return round(uzs / rate - usd, 2)


class OrgMovements:
    """Обороты по контрагентам, разложенные на «до периода» и «в периоде»."""

    def __init__(self):
        self.before: dict[int, float] = {}   # нетто (дебет − кредит) до начала периода, UZS
        self.debit: dict[int, float] = {}    # дебетовый оборот периода, UZS
        self.credit: dict[int, float] = {}   # кредитовый оборот периода, UZS
        self.debit_usd: dict[int, float] = {}
        self.credit_usd: dict[int, float] = {}
        self.before_usd: dict[int, float] = {}

    def add(self, oid, d: date, uzs: float, usd: float, side: str,
            start: date | None, end: date | None):
        if not oid or (not uzs and not usd):
            return
        sign = 1.0 if side == "debit" else -1.0
        if (start and d < start) or (end and d > end):
            if end and d > end:
                return  # события после периода в ведомость не входят
            self.before[oid] = self.before.get(oid, 0.0) + sign * uzs
            self.before_usd[oid] = self.before_usd.get(oid, 0.0) + sign * usd
            return
        tgt = self.debit if side == "debit" else self.credit
        tgt[oid] = tgt.get(oid, 0.0) + uzs
        tgt_u = self.debit_usd if side == "debit" else self.credit_usd
        tgt_u[oid] = tgt_u.get(oid, 0.0) + usd


async def org_movements(
    db: AsyncSession, start: date | None = None, end: date | None = None
) -> OrgMovements:
    """Собрать обороты по всем контрагентам из всех первичных документов."""
    rates, last_rate = await _rate_map(db)
    nds = (await get_rates(db))["nds_rate"]
    mv = OrgMovements()

    def usd_of(d: date, uzs: float) -> float:
        r = rates.get(d, last_rate) or 1.0
        return uzs / r

    # --- деньги ---
    for oid, d, direction, uzs, usd in (
        await db.execute(
            select(
                Transaction.organization_id,
                Transaction.doc_date,
                Transaction.direction,
                Transaction.amount_uzs,
                Transaction.amount_usd,
            ).where(Transaction.organization_id.isnot(None))
        )
    ).all():
        side = "debit" if direction == "expense" else "credit"
        mv.add(oid, d, float(uzs or 0), float(usd or 0), side, start, end)

    # --- приход сырья/запчастей (кредиторка перед поставщиком, сумма с НДС) ---
    for oid, d, qty, price, vat in (
        await db.execute(
            select(
                MaterialReceipt.organization_id,
                MaterialReceipt.doc_date,
                MaterialReceipt.qty,
                MaterialReceipt.price_uzs,
                MaterialReceipt.vat,
            ).where(MaterialReceipt.organization_id.isnot(None))
        )
    ).all():
        gross = float(qty or 0) * float(price or 0) * ((1 + nds) if vat else 1)
        mv.add(oid, d, gross, usd_of(d, gross), "credit", start, end)

    # --- отгрузка ГП покупателю (дебиторка, сумма с НДС) ---
    for oid, d, qty, price in (
        await db.execute(
            select(Sale.organization_id, Sale.doc_date, Sale.qty, Sale.price_uzs).where(
                Sale.organization_id.isnot(None)
            )
        )
    ).all():
        gross = float(qty or 0) * float(price or 0)
        mv.add(oid, d, gross, usd_of(d, gross), "debit", start, end)

    # --- услуги ---
    for oid, d, direction, amount in (
        await db.execute(
            select(
                Service.organization_id, Service.doc_date, Service.direction, Service.amount
            ).where(Service.organization_id.isnot(None))
        )
    ).all():
        amt = float(amount or 0)
        side = "debit" if direction == "provided" else "credit"
        mv.add(oid, d, amt, usd_of(d, amt), side, start, end)

    # --- начисленная зарплата -> кредит «Ойлик(ОБЪЕКТ)» ---
    for oid, d, amount in await _payroll_accruals(db):
        mv.add(oid, d, amount, usd_of(d, amount), "credit", start, end)

    return mv


async def salary_org_by_division(db: AsyncSession) -> dict[str, int]:
    """Подразделение -> «контрагент» зарплаты (лист «Дт Кт З.п»).

    В книге ключ — колонка B со названием объекта; у нас это ИНН организации
    с ведомостью `salary` (Ойлик(МАХСТОН) имеет ИНН «Махстон»). Если ИНН не
    заполнен, пробуем «принадлежит компании».
    """
    rows = (
        await db.execute(select(Organization).where(Organization.ledger == "salary"))
    ).scalars().all()
    out: dict[str, int] = {}
    for o in rows:
        for key in ((o.inn or "").strip(), (o.belongs_to or "").strip()):
            if key and key not in out:
                out[key] = o.id
    return out


async def _payroll_accruals(db: AsyncSession) -> list[tuple[int, date, float]]:
    """Начисленная зарплата по объектам: (org_id, дата, сумма к выдаче).

    Кредитуется «к выдаче» — именно её предприятие должно работникам. НДФЛ и
    ЕСП идут не работнику, а в бюджет, и попадают в отчёт «Налоги».
    """
    by_div = await salary_org_by_division(db)
    if not by_div:
        return []
    rows = (
        await db.execute(
            select(PayrollEntry.period, PayrollEntry.net, Employee.division)
            .join(Employee, Employee.id == PayrollEntry.employee_id)
        )
    ).all()
    out = []
    for period, net, division in rows:
        oid = by_div.get((division or "").strip())
        amount = float(net or 0)
        if not oid or not amount:
            continue
        # начисление относим на последний день месяца расчёта
        try:
            y, m = (int(x) for x in str(period).split("-")[:2])
            last = calendar.monthrange(y, m)[1]
            d = date(y, m, last)
        except (ValueError, TypeError):
            continue
        out.append((oid, d, amount))
    return out


async def recompute_org_balances(db: AsyncSession, org_ids: list[int] | None = None) -> None:
    """Пересчитать кэш `balance_uzs` / `balance_usd` из документов + opening.

    Считается агрегатами в БД, поэтому дёшево вызывать после каждого документа.
    """
    ids = sorted({i for i in (org_ids or []) if i})
    if org_ids is not None and not ids:
        return
    _, last_rate = await _rate_map(db)
    nds = (await get_rates(db))["nds_rate"]
    rate = last_rate or 1.0

    net: dict[int, float] = {}
    net_usd: dict[int, float] = {}

    def acc(oid, uzs, usd):
        if not oid:
            return
        net[oid] = net.get(oid, 0.0) + float(uzs or 0)
        net_usd[oid] = net_usd.get(oid, 0.0) + float(usd or 0)

    def scope(stmt, col):
        return stmt.where(col.in_(ids)) if ids else stmt.where(col.isnot(None))

    # деньги: expense = дебет (+), income = кредит (−)
    stmt = scope(
        select(
            Transaction.organization_id,
            Transaction.direction,
            func.coalesce(func.sum(Transaction.amount_uzs), 0),
            func.coalesce(func.sum(Transaction.amount_usd), 0),
        ),
        Transaction.organization_id,
    ).group_by(Transaction.organization_id, Transaction.direction)
    for oid, direction, uzs, usd in (await db.execute(stmt)).all():
        sign = 1 if direction == "expense" else -1
        acc(oid, sign * float(uzs or 0), sign * float(usd or 0))

    # приход ТМЦ: кредит (−), сумма с НДС
    stmt = scope(
        select(
            MaterialReceipt.organization_id,
            MaterialReceipt.vat,
            func.coalesce(func.sum(MaterialReceipt.qty * MaterialReceipt.price_uzs), 0),
        ),
        MaterialReceipt.organization_id,
    ).group_by(MaterialReceipt.organization_id, MaterialReceipt.vat)
    for oid, vat, uzs in (await db.execute(stmt)).all():
        gross = float(uzs or 0) * ((1 + nds) if vat else 1)
        acc(oid, -gross, -gross / rate)

    # продажа ГП: дебет (+), сумма с НДС
    stmt = scope(
        select(
            Sale.organization_id,
            func.coalesce(func.sum(Sale.qty * Sale.price_uzs), 0),
        ),
        Sale.organization_id,
    ).group_by(Sale.organization_id)
    for oid, uzs in (await db.execute(stmt)).all():
        acc(oid, float(uzs or 0), float(uzs or 0) / rate)

    # услуги: provided = дебет (+), received = кредит (−)
    stmt = scope(
        select(
            Service.organization_id,
            Service.direction,
            func.coalesce(func.sum(Service.amount), 0),
        ),
        Service.organization_id,
    ).group_by(Service.organization_id, Service.direction)
    for oid, direction, uzs in (await db.execute(stmt)).all():
        sign = 1 if direction == "provided" else -1
        acc(oid, sign * float(uzs or 0), sign * float(uzs or 0) / rate)

    # начисленная зарплата: кредит (−) на «Ойлик(ОБЪЕКТ)»
    for oid, _d, amount in await _payroll_accruals(db):
        if ids and oid not in ids:
            continue
        acc(oid, -amount, -amount / rate)

    ostmt = select(Organization)
    if ids:
        ostmt = ostmt.where(Organization.id.in_(ids))
    for o in (await db.execute(ostmt)).scalars().all():
        o.balance_uzs = round(float(o.opening_uzs or 0) + net.get(o.id, 0.0), 2)
        o.balance_usd = round(float(o.opening_usd or 0) + net_usd.get(o.id, 0.0), 2)


async def ledger_rows(
    db: AsyncSession,
    ledger: str | None = None,
    start: date | None = None,
    end: date | None = None,
) -> dict:
    """Ведомость Дт-Кт: начало / оборот / конец (как листы «Дт Кт ...» в Excel).

    Колонки «Переоценка» и «Курсовая разница» считаются по каждой строке
    отдельно (как формулы M/N/P/Q/R/S в книге), а не по итогу — иначе прибыль
    по одному контрагенту гасила бы убыток по другому.
    """
    mv = await org_movements(db, start, end)
    rates, last_rate = await _rate_map(db)
    rate_end = rate_on(rates, end, last_rate) if end else last_rate

    stmt = select(Organization).order_by(Organization.name)
    if ledger:
        stmt = stmt.where(Organization.ledger == ledger)
    orgs = (await db.execute(stmt)).scalars().all()

    rows = []
    tot = {k: 0.0 for k in (
        "open_debit", "open_credit", "turn_debit", "turn_credit", "end_debit", "end_credit",
        "open_debit_usd", "open_credit_usd", "turn_debit_usd", "turn_credit_usd",
        "end_debit_usd", "end_credit_usd", "revalued_usd", "fx_income", "fx_loss",
    )}
    for o in orgs:
        opening = float(o.opening_uzs or 0) + mv.before.get(o.id, 0.0)
        opening_usd = float(o.opening_usd or 0) + mv.before_usd.get(o.id, 0.0)
        td, tc = mv.debit.get(o.id, 0.0), mv.credit.get(o.id, 0.0)
        td_u, tc_u = mv.debit_usd.get(o.id, 0.0), mv.credit_usd.get(o.id, 0.0)
        closing = opening + td - tc
        closing_usd = opening_usd + td_u - tc_u
        # переоценка сальдо на конец периода по курсу на конец
        fx = fx_of(closing, closing_usd, rate_end)
        d = {
            "id": o.id, "name": o.name, "inn": o.inn,
            "ledger": o.ledger, "category": o.category, "expense_code": o.expense_code,
            "revalued_usd": round(closing / rate_end, 2) if rate_end else 0.0,
            "fx_income": round(max(fx, 0), 2), "fx_loss": round(abs(min(fx, 0)), 2),
            "open_debit": round(max(opening, 0), 2), "open_credit": round(abs(min(opening, 0)), 2),
            "turn_debit": round(td, 2), "turn_credit": round(tc, 2),
            "end_debit": round(max(closing, 0), 2), "end_credit": round(abs(min(closing, 0)), 2),
            "open_debit_usd": round(max(opening_usd, 0), 2),
            "open_credit_usd": round(abs(min(opening_usd, 0)), 2),
            "turn_debit_usd": round(td_u, 2), "turn_credit_usd": round(tc_u, 2),
            "end_debit_usd": round(max(closing_usd, 0), 2),
            "end_credit_usd": round(abs(min(closing_usd, 0)), 2),
        }
        if any(d[k] for k in ("open_debit", "open_credit", "turn_debit", "turn_credit",
                              "end_debit", "end_credit")):
            rows.append(d)
            for k in tot:
                tot[k] += d[k]
    return {
        "rows": rows,
        "totals": {k: round(v, 2) for k, v in tot.items()},
        "rate": rate_end,
    }


async def cash_opening(
    db: AsyncSession, before: date | None = None, division: str | None = None
) -> dict:
    """Остаток денежных средств на начало: opening счетов/касс + движения до даты.

    С `division` считается денежная позиция подразделения: входящие остатки
    берутся только у КАСС этого объекта (банковские счета к подразделениям не
    привязаны — они общефирменные), а движения — только помеченные объектом.
    """
    from .models import BankAccount, CashRegister  # локально, чтобы избежать циклов

    if division:
        bank_uzs = bank_usd = 0.0
        tills = (
            await db.execute(select(CashRegister).where(CashRegister.division == division))
        ).scalars().all()
    else:
        banks = (await db.execute(select(BankAccount))).scalars().all()
        bank_uzs = sum(float(b.opening_uzs or 0) for b in banks)
        bank_usd = sum(float(b.opening_usd or 0) for b in banks)
        tills = (await db.execute(select(CashRegister))).scalars().all()
    kassa_uzs = sum(float(c.opening_uzs or 0) for c in tills)
    kassa_usd = sum(float(c.opening_usd or 0) for c in tills)

    if before:
        stmt = select(
            Transaction.account,
            Transaction.direction,
            func.coalesce(func.sum(Transaction.amount_uzs), 0),
            func.coalesce(func.sum(Transaction.amount_usd), 0),
        ).where(Transaction.doc_date < before)
        if division:
            stmt = stmt.where(Transaction.division == division)
        stmt = stmt.group_by(Transaction.account, Transaction.direction)
        for account, direction, uzs, usd in (await db.execute(stmt)).all():
            sign = 1 if direction == "income" else -1
            if account == "bank":
                bank_uzs += sign * float(uzs or 0)
                bank_usd += sign * float(usd or 0)
            else:
                kassa_uzs += sign * float(uzs or 0)
                kassa_usd += sign * float(usd or 0)

    return {
        "bank_uzs": round(bank_uzs, 2), "bank_usd": round(bank_usd, 2),
        "kassa_uzs": round(kassa_uzs, 2), "kassa_usd": round(kassa_usd, 2),
        "total_uzs": round(bank_uzs + kassa_uzs, 2),
        "total_usd": round(bank_usd + kassa_usd, 2),
        "division": division or None,
    }
