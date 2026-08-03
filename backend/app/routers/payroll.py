"""Зарплата: сотрудники + расчёт (НДФЛ 12%, ЕСП 12%, касса/карта)."""
import calendar
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..events import record
from ..ledger import recompute_org_balances, salary_org_by_division
from ..models import Employee, PayrollEntry, User
from ..periods import assert_period_open
from ..production import recompute_production
from ..rates import get_rates
from ..schemas import (
    EmployeeBase,
    EmployeeOut,
    EmployeeUpdate,
    PayrollBase,
    PayrollOut,
    PayrollUpdate,
)
from ..security import require

router = APIRouter(prefix="/api", tags=["payroll"])


async def _sync_salary_ledger(db: AsyncSession, *divisions: str | None):
    """Пересчитать сальдо «Ойлик(ОБЪЕКТ)» — начисление садится в кредит."""
    by_div = await salary_org_by_division(db)
    ids = {by_div[d.strip()] for d in divisions if d and d.strip() in by_div}
    if ids:
        await recompute_org_balances(db, list(ids))


async def _sync_production(db: AsyncSession, division: str | None, period: str | None):
    """Зарплата производственного персонала входит в себестоимость выпуска."""
    if not period:
        return
    try:
        y, m = (int(x) for x in str(period).split("-")[:2])
        last = calendar.monthrange(y, m)[1]
    except (ValueError, TypeError, calendar.IllegalMonthError):
        return
    await recompute_production(db, division, date(y, m, last))


PAY_MODES = ("cash", "card")


def _parts(e: PayrollEntry) -> tuple[float, float]:
    """Наличная и безналичная части выплаты.

    Каждая выплата облагается САМА ПО СЕБЕ: аванс идёт в ту часть, которую
    выбрали в «Чем выдан аванс», касса — в наличную, карта — в безналичную.
    """
    def f(name: str) -> float:
        return float(getattr(e, name) or 0)

    avans = f("avans")
    cash = f("paid_cash") + (avans if e.avans_type == "cash" else 0.0)
    card = f("paid_card") + (avans if e.avans_type == "card" else 0.0)
    return cash, card


def _on_hand(e: PayrollEntry) -> tuple[float, float]:
    """(начислено «на руки», ручные удержания)."""
    def f(name: str) -> float:
        return float(getattr(e, name) or 0)

    norm = f("norm_days")
    days = f("worked_days") + f("overtime_days")
    okl = (f("oklad") * days / norm) if norm else f("oklad")
    on_hand = okl + f("nadbavka") + f("pitanie") + f("bonus") + f("benzin") + f("other_accrued")
    holds = f("hold_pitanie") + f("hold_alimony") + f("hold_other") + f("fine")
    return on_hand, holds


def _calc(e: PayrollEntry, emp: Employee | None,
          ndfl_rate: float, inps_rate: float, esp_rate: float):
    """Налог считается ОТДЕЛЬНО по каждой части выплаты.

    Суммы в полях «Оклад», «Надбавка» и т.д. — это то, что сотрудник получает
    НА РУКИ. Дальше выплата разбивается на две части, и налог берётся только
    с безналичной:

        наличные (касса + аванс наличными)   — налогов нет
        карта    (карта  + аванс на карту)   — НДФЛ и ИНПС СВЕРХУ:
                 начислено_карта = карта / (1 − НДФЛ% − ИНПС%)
                 ЕСП = начислено_карта × ЕСП%  (за счёт предприятия)

    Пример: на руки 6 500 000 = аванс 500 000 наличными + касса 3 000 000
    + карта 3 000 000 → налог платится только с 3 000 000. Если тот же аванс
    выдан перечислением — налоговая база станет 3 500 000.

    Что ещё не выплачено, считается по каналу из карточки сотрудника.
    """
    on_hand, holds = _on_hand(e)
    cash, card = _parts(e)

    rest = round(on_hand - holds - cash - card, 2)
    if rest > 0:
        if (emp and (emp.payment_type or "") == "Наличные"):
            cash += rest
        else:
            card += rest

    keep = 1 - ndfl_rate - inps_rate
    card_gross = card / keep if keep > 0 else card
    e.ndfl = round(card_gross * ndfl_rate, 2)
    e.inps = round(card_gross * inps_rate, 2)
    e.esp = round(card_gross * esp_rate, 2)

    e.gross = round(cash + card_gross + holds, 2)
    # «к выдаче» — это ровно то, что человек получает; считаем его напрямую,
    # иначе округление НДФЛ и ИНПС даёт расхождение в копейку
    e.net = round(cash + card, 2)
    e.withheld = round(float(e.gross) - float(e.net), 2)
    e.paid = round(
        float(e.avans or 0) + float(e.paid_cash or 0) + float(e.paid_card or 0), 2
    )
    e.balance = round(float(e.debt_start or 0) + float(e.net) - float(e.paid), 2)
    e.total_cost = round(float(e.gross) + float(e.esp), 2)
    # для значка в ведомости: были ли официальные (безналичные) деньги
    e.pay_mode = "card" if card > 0 else "cash"


def _validate(e: PayrollEntry):
    # аванс — это уже выданные деньги, поэтому канал обязателен: без него
    # не понять, из кассы они ушли или с расчётного счёта
    if float(e.avans or 0) > 0 and (e.avans_type or "") not in PAY_MODES:
        raise HTTPException(
            400,
            detail="Указан аванс — выберите, чем он выдан: наличными или перечислением",
        )
    if float(e.avans or 0) <= 0:
        e.avans_type = ""

    # Разбивка по каналам определяет налог, поэтому она должна покрывать всю
    # сумму на руки. Ничего не выплачено — это просто начисление, разрешаем.
    on_hand, holds = _on_hand(e)
    to_pay = round(on_hand - holds, 2)
    paid = round(
        float(e.avans or 0) + float(e.paid_cash or 0) + float(e.paid_card or 0), 2
    )
    if paid > 0 and abs(paid - to_pay) > 0.01:
        money = lambda v: f"{v:,.2f}".replace(",", " ")
        raise HTTPException(
            400,
            detail=(
                f"Выплаты должны совпадать с суммой на руки: начислено {money(to_pay)}, "
                f"а в аванс + касса + карта вписано {money(paid)}. "
                f"Не хватает {money(to_pay - paid)}."
            ),
        )


# ================= EMPLOYEES =================
@router.get("/employees", response_model=list[EmployeeOut])
async def list_employees(_: User = Depends(require("payroll:view")), db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Employee).order_by(Employee.full_name))
    return res.scalars().all()


@router.post("/employees", response_model=EmployeeOut, status_code=201)
async def create_employee(body: EmployeeBase, current: User = Depends(require("payroll:create")), db: AsyncSession = Depends(get_db)):
    e = Employee(**body.model_dump())
    db.add(e)
    await db.commit()
    await db.refresh(e)
    await record(db, current, "create", "employee", e.full_name, {"id": e.id})
    return e


@router.put("/employees/{eid}", response_model=EmployeeOut)
async def update_employee(eid: int, body: EmployeeUpdate, current: User = Depends(require("payroll:edit")), db: AsyncSession = Depends(get_db)):
    e = await db.get(Employee, eid)
    if not e:
        raise HTTPException(404, detail="Сотрудник не найден")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(e, k, v)
    await db.commit()
    await db.refresh(e)
    await record(db, current, "edit", "employee", e.full_name, {"id": e.id})
    return e


@router.delete("/employees/{eid}", status_code=204)
async def delete_employee(eid: int, current: User = Depends(require("payroll:delete")), db: AsyncSession = Depends(get_db)):
    e = await db.get(Employee, eid)
    if not e:
        raise HTTPException(404, detail="Сотрудник не найден")
    cnt = await db.scalar(select(PayrollEntry).where(PayrollEntry.employee_id == eid).limit(1))
    if cnt:
        raise HTTPException(400, detail="Нельзя удалить: есть расчёты зарплаты. Сначала удалите их.")
    name = e.full_name
    await db.delete(e)
    await db.commit()
    await record(db, current, "delete", "employee", name)


# ================= PAYROLL ENTRIES =================
@router.get("/payroll", response_model=list[PayrollOut])
async def list_payroll(period: str | None = None, _: User = Depends(require("payroll:view")), db: AsyncSession = Depends(get_db)):
    stmt = select(PayrollEntry).options(selectinload(PayrollEntry.employee)).order_by(PayrollEntry.id.desc())
    if period:
        stmt = stmt.where(PayrollEntry.period == period)
    res = await db.execute(stmt)
    return res.scalars().all()


@router.post("/payroll", response_model=PayrollOut, status_code=201)
async def create_payroll(body: PayrollBase, current: User = Depends(require("payroll:create")), db: AsyncSession = Depends(get_db)):
    emp = await db.get(Employee, body.employee_id)
    if not emp:
        raise HTTPException(404, detail="Сотрудник не найден")
    dup = await db.scalar(
        select(PayrollEntry).where(PayrollEntry.employee_id == body.employee_id, PayrollEntry.period == body.period)
    )
    if dup:
        raise HTTPException(400, detail="Расчёт за этот период по сотруднику уже есть")
    await assert_period_open(db, body.period, what="расчёт зарплаты")
    e = PayrollEntry(**body.model_dump())
    if not e.oklad:
        e.oklad = float(emp.salary or 0)
    if not body.currency:
        e.currency = emp.currency or "UZS"
    _validate(e)
    r = await get_rates(db)
    _calc(e, emp, r["ndfl_rate"], r["inps_rate"], r["esp_rate"])
    db.add(e)
    await db.flush()
    await _sync_salary_ledger(db, emp.division)
    await _sync_production(db, emp.division, e.period)
    await db.commit()
    await db.refresh(e, ["employee"])
    await record(db, current, "create", "payroll", f"{emp.full_name} {body.period}", {"id": e.id})
    return e


@router.put("/payroll/{pid}", response_model=PayrollOut)
async def update_payroll(pid: int, body: PayrollUpdate, current: User = Depends(require("payroll:edit")), db: AsyncSession = Depends(get_db)):
    e = await db.get(PayrollEntry, pid)
    if not e:
        raise HTTPException(404, detail="Расчёт не найден")
    old_period = e.period
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(e, k, v)
    # старый период тоже: иначе расчёт можно было бы «перенести» из закрытого месяца
    await assert_period_open(db, old_period, what="расчёт зарплаты")
    await assert_period_open(db, e.period, what="расчёт зарплаты")
    _validate(e)
    emp = await db.get(Employee, e.employee_id)
    r = await get_rates(db)
    _calc(e, emp, r["ndfl_rate"], r["inps_rate"], r["esp_rate"])
    await db.flush()
    await _sync_salary_ledger(db, emp.division if emp else None)
    await _sync_production(db, emp.division if emp else None, e.period)
    await db.commit()
    await db.refresh(e, ["employee"])
    await record(db, current, "edit", "payroll", f"#{e.id}", {"id": e.id})
    return e


@router.delete("/payroll/{pid}", status_code=204)
async def delete_payroll(pid: int, current: User = Depends(require("payroll:delete")), db: AsyncSession = Depends(get_db)):
    e = await db.get(PayrollEntry, pid)
    if not e:
        raise HTTPException(404, detail="Расчёт не найден")
    emp = await db.get(Employee, e.employee_id)
    division, period = (emp.division if emp else None), e.period
    await assert_period_open(db, period, what="расчёт зарплаты")
    await db.delete(e)
    await db.flush()
    await _sync_salary_ledger(db, division)
    await _sync_production(db, division, period)
    await db.commit()
    await record(db, current, "delete", "payroll", f"#{pid}")


# ================= Сводка по объектам (лист «Зарплата  ») =================
@router.get("/payroll/summary")
async def payroll_summary(
    period: str | None = None,
    _: User = Depends(require("payroll:view")),
    db: AsyncSession = Depends(get_db),
):
    """Свод начислений и выплат по подразделениям и кодам расхода."""
    stmt = select(
        Employee.division,
        Employee.expense_code,
        func.count(PayrollEntry.id),
        func.coalesce(func.sum(PayrollEntry.gross), 0),
        func.coalesce(func.sum(PayrollEntry.ndfl), 0),
        func.coalesce(func.sum(PayrollEntry.inps), 0),
        func.coalesce(func.sum(PayrollEntry.esp), 0),
        func.coalesce(func.sum(PayrollEntry.net), 0),
        func.coalesce(func.sum(PayrollEntry.paid_cash), 0),
        func.coalesce(func.sum(PayrollEntry.paid_card), 0),
        func.coalesce(func.sum(PayrollEntry.avans), 0),
        func.coalesce(func.sum(PayrollEntry.balance), 0),
        func.coalesce(func.sum(PayrollEntry.total_cost), 0),
    ).join(Employee, Employee.id == PayrollEntry.employee_id).group_by(
        Employee.division, Employee.expense_code
    ).order_by(Employee.division)
    if period:
        stmt = stmt.where(PayrollEntry.period == period)

    keys = ("headcount", "gross", "ndfl", "inps", "esp", "net",
            "paid_cash", "paid_card", "avans", "balance", "total_cost")
    rows, totals = [], {k: 0.0 for k in keys}
    for division, code, *values in (await db.execute(stmt)).all():
        row = {"division": division or "—", "expense_code": code or "—"}
        for k, v in zip(keys, values):
            row[k] = round(float(v or 0), 2)
            totals[k] += row[k]
        rows.append(row)
    return {"rows": rows, "totals": {k: round(v, 2) for k, v in totals.items()}}
