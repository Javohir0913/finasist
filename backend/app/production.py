"""Себестоимость выпуска — ПРОИЗВОДНАЯ величина, её никто не вводит руками.

Лист «С-сть ГП» считает одну себестоимость единицы на подразделение за месяц:

    K = (расход сырья + производственные расходы) / ВЫПУСК за месяц

Ключевое следствие: себестоимость нельзя «зафиксировать» в момент ввода
документа. Выпустили 1000 м³ при расходах 29 010 000 — вышло 29 010 за куб.
Выпустили ещё 1000 м³, расходы те же — стало 14 505 за куб, и ПЕРВЫЙ документ
тоже должен стать 14 505: расходы месяца делятся на весь выпуск месяца.

Поэтому после любого изменения (выпуск, списание со склада, приход сырья,
денежный расход, зарплата, услуга) себестоимость всех документов выпуска
этого подразделения за этот месяц пересчитывается заново.
"""
import calendar
from datetime import date

from sqlalchemy import extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import (
    Employee,
    ExpenseCode,
    MaterialIssue,
    PayrollEntry,
    Production,
    Service,
    Transaction,
)

# 2010 — итоговая строка книги (сама сумма подстатей, складывать с ними нельзя).
# 2011 «Стоимость приобретённых ТМЗ» книга явно ИСКЛЮЧАЕТ из строки 2010 (лист
# «РАСХОДЫ <объект>»: 2010 = SUM(2012..2035), без 2011 — сверено на всех трёх
# объектах, сходится до сума). Стоимость сырья уже сидит в средней цене склада
# и попадает в себестоимость через списание МАТЕРИАЛОВ на выпуск, а не через
# эту строку — иначе она посчиталась бы дважды.


def month_bounds(d: date) -> tuple[date, date]:
    return d.replace(day=1), d.replace(day=calendar.monthrange(d.year, d.month)[1])


async def _prod_codes(db: AsyncSession) -> tuple[set[str], dict[str, str]]:
    rows = (await db.execute(select(ExpenseCode.code, ExpenseCode.pnl_group))).all()
    mapping = {c: (g or "admin") for c, g in rows}
    return {c for c, g in mapping.items() if g == "prod"}, mapping


async def cost_parts(
    db: AsyncSession,
    division: str,
    year: int | None,
    month: int | None,
    exclude_id: int | None = None,
    add_qty: float = 0.0,
) -> dict:
    """Слагаемые себестоимости подразделения за период (см. лист «С-сть ГП»)."""
    prod_codes, mapping = await _prod_codes(db)

    def period(stmt, col):
        if year:
            stmt = stmt.where(extract("year", col) == year)
        if month:
            stmt = stmt.where(extract("month", col) == month)
        return stmt

    def by_div(stmt, col):
        return stmt.where(col == division) if division else stmt

    # 1) списание со склада: без кода — прямой расход сырья; производственные
    #    коды — «общие расходы» (колонка H листа); код 2011/«asset» и любой
    #    другой явно не производственный код в себестоимость не идёт вовсе
    istmt = by_div(
        select(MaterialIssue.expense_code, func.coalesce(func.sum(MaterialIssue.cost_uzs), 0))
        .group_by(MaterialIssue.expense_code),
        MaterialIssue.division,
    )
    materials = stock_prod = 0.0
    for code, uzs in (await db.execute(period(istmt, MaterialIssue.doc_date))).all():
        v = float(uzs or 0)
        if code and code in prod_codes:
            stock_prod += v
        elif not code:
            materials += v

    # 2) производственные расходы деньгами
    tstmt = by_div(
        select(func.coalesce(func.sum(Transaction.amount_uzs), 0)).where(
            Transaction.direction == "expense",
            Transaction.expense_code.in_(prod_codes) if prod_codes else False,
        ),
        Transaction.division,
    )
    money = float(await db.scalar(period(tstmt, Transaction.doc_date)) or 0)

    # 3) полученные услуги с производственным кодом
    svc = by_div(
        select(func.coalesce(func.sum(Service.net), 0)).where(
            Service.direction == "received",
            Service.expense_code.in_(prod_codes) if prod_codes else False,
        ),
        Service.division,
    )
    services = float(await db.scalar(period(svc, Service.doc_date)) or 0)

    # 4) начисленная зарплата производственного персонала (оклад + ЕСП)
    pay = select(func.coalesce(func.sum(PayrollEntry.gross + PayrollEntry.esp), 0)).join(
        Employee, Employee.id == PayrollEntry.employee_id
    ).where(Employee.expense_code.in_(prod_codes) if prod_codes else False)
    if division:
        # АУП — административный персонал завода «Махстон» (в ведомости
        # «Дт Кт З.п» у него своя строка «Ойлик(АУП)», но в себестоимость
        # начисление входит кодом «2012_М» — сверено с «РАСХОДЫ Махстон»
        # построчно), поэтому в затраты Махстона считаем и его сотрудников
        divs = [division, "АУП"] if division == "Махстон" else [division]
        pay = pay.where(Employee.division.in_(divs))
    if year and month:
        pay = pay.where(PayrollEntry.period == f"{year}-{int(month):02d}")
    payroll = float(await db.scalar(pay) or 0)

    # выпуск подразделения за период — делитель (E3 = SUM(E4:E8) на листе)
    qstmt = by_div(select(func.coalesce(func.sum(Production.qty), 0)), Production.division)
    if exclude_id:
        qstmt = qstmt.where(Production.id != exclude_id)
    saved_qty = float(await db.scalar(period(qstmt, Production.doc_date)) or 0)
    qty = saved_qty + float(add_qty or 0)

    total = materials + stock_prod + money + services + payroll
    return {
        "materials_cost": round(materials, 2),
        "prod_expenses": round(stock_prod + money + services + payroll, 2),
        "stock_prod": round(stock_prod, 2),
        "money_prod": round(money, 2),
        "service_prod": round(services, 2),
        "payroll_prod": round(payroll, 2),
        "total_cost": round(total, 2),
        "saved_qty": round(saved_qty, 3),
        "add_qty": round(float(add_qty or 0), 3),
        "produced_qty": round(qty, 3),
        "unit_cost": round(total / qty, 2) if qty else 0.0,
    }


async def recompute_production(db: AsyncSession, division: str | None, when: date | None) -> None:
    """Переписать себестоимость всех документов выпуска подразделения за месяц.

    Вызывается после ЛЮБОГО изменения, влияющего на себестоимость. Документы
    выпуска хранят только количество; цена и сумма — расчётные.
    """
    if when is None:
        return
    div = (division or "").strip()
    parts = await cost_parts(db, div, when.year, when.month)
    unit = parts["unit_cost"]

    stmt = select(Production).where(
        extract("year", Production.doc_date) == when.year,
        extract("month", Production.doc_date) == when.month,
    )
    stmt = stmt.where(Production.division == div) if div else stmt.where(
        (Production.division == "") | (Production.division.is_(None))
    )
    rows = (await db.execute(stmt)).scalars().all()
    if not rows:
        return

    touched: set[int] = set()
    for r in rows:
        qty = float(r.qty or 0)
        new_amount = round(qty * unit, 2)
        if float(r.unit_cost or 0) != unit or float(r.amount_uzs or 0) != new_amount:
            r.unit_cost = unit
            r.amount_uzs = new_amount
            touched.add(r.product_id)
    if not touched:
        return
    await db.flush()

    from .routers.inventory import recompute_product  # локально: избегаем цикла

    for pid in touched:
        await recompute_product(db, pid)
