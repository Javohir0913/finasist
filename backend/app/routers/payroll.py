"""Зарплата: сотрудники + расчёт (НДФЛ 12%, ЕСП 12%, касса/карта)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..events import record
from ..models import Employee, PayrollEntry, User
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


def _calc(e: PayrollEntry, ndfl_rate: float, inps_rate: float, esp_rate: float):
    norm = float(e.norm_days or 0)
    worked = float(e.worked_days or 0)
    base = (float(e.oklad or 0) * worked / norm) if norm else float(e.oklad or 0)
    gross = round(base + float(e.bonus or 0) + float(e.nadbavka or 0) + float(e.pitanie or 0) + float(e.other_accrued or 0), 2)
    e.gross = gross
    e.ndfl = round(gross * ndfl_rate, 2)
    e.inps = round(gross * inps_rate, 2)
    e.esp = round(gross * esp_rate, 2)
    e.net = round(gross - e.ndfl - e.inps, 2)
    # выплачено = аванс + зарплата (paid); долг = к выдаче − выплачено
    e.balance = round(e.net - float(e.avans or 0) - float(e.paid or 0), 2)


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
    e = PayrollEntry(**body.model_dump())
    if not e.oklad:
        e.oklad = float(emp.salary or 0)
    r = await get_rates(db)
    _calc(e, r["ndfl_rate"], r["inps_rate"], r["esp_rate"])
    db.add(e)
    await db.commit()
    await db.refresh(e, ["employee"])
    await record(db, current, "create", "payroll", f"{emp.full_name} {body.period}", {"id": e.id})
    return e


@router.put("/payroll/{pid}", response_model=PayrollOut)
async def update_payroll(pid: int, body: PayrollUpdate, current: User = Depends(require("payroll:edit")), db: AsyncSession = Depends(get_db)):
    e = await db.get(PayrollEntry, pid)
    if not e:
        raise HTTPException(404, detail="Расчёт не найден")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(e, k, v)
    r = await get_rates(db)
    _calc(e, r["ndfl_rate"], r["inps_rate"], r["esp_rate"])
    await db.commit()
    await db.refresh(e, ["employee"])
    await record(db, current, "edit", "payroll", f"#{e.id}", {"id": e.id})
    return e


@router.delete("/payroll/{pid}", status_code=204)
async def delete_payroll(pid: int, current: User = Depends(require("payroll:delete")), db: AsyncSession = Depends(get_db)):
    e = await db.get(PayrollEntry, pid)
    if not e:
        raise HTTPException(404, detail="Расчёт не найден")
    await db.delete(e)
    await db.commit()
    await record(db, current, "delete", "payroll", f"#{pid}")
