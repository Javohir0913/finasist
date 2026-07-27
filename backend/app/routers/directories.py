"""Справочники: коды расходов, коды Cash Flow, подразделения."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..events import record
from ..models import CashflowCode, Division, ExpenseCode, User
from ..schemas import CodeBase, CodeOut, CodeUpdate, DivisionBase, DivisionOut
from ..security import require

router = APIRouter(prefix="/api", tags=["directories"])


# ---------- Expense codes ----------
@router.get("/expense-codes", response_model=list[CodeOut])
async def list_expense_codes(
    _: User = Depends(require("articles:view")), db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(ExpenseCode).order_by(ExpenseCode.code))
    return res.scalars().all()


@router.post("/expense-codes", response_model=CodeOut, status_code=201)
async def create_expense_code(
    body: CodeBase,
    current: User = Depends(require("articles:create")),
    db: AsyncSession = Depends(get_db),
):
    if await db.scalar(select(ExpenseCode).where(ExpenseCode.code == body.code)):
        raise HTTPException(400, detail="Такой код уже существует")
    row = ExpenseCode(**body.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    await record(db, current, "create", "expense_code", f"{row.code} {row.name}")
    return row


@router.put("/expense-codes/{cid}", response_model=CodeOut)
async def update_expense_code(
    cid: int,
    body: CodeUpdate,
    current: User = Depends(require("articles:edit")),
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(ExpenseCode, cid)
    if not row:
        raise HTTPException(404, detail="Код не найден")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    await db.commit()
    await db.refresh(row)
    await record(db, current, "edit", "expense_code", row.code)
    return row


@router.delete("/expense-codes/{cid}", status_code=204)
async def delete_expense_code(
    cid: int,
    current: User = Depends(require("articles:delete")),
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(ExpenseCode, cid)
    if not row:
        raise HTTPException(404, detail="Код не найден")
    code = row.code
    await db.delete(row)
    await db.commit()
    await record(db, current, "delete", "expense_code", code)


# ---------- Cash Flow codes ----------
@router.get("/cashflow-codes", response_model=list[CodeOut])
async def list_cf_codes(
    _: User = Depends(require("articles:view")), db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(CashflowCode).order_by(CashflowCode.code))
    return res.scalars().all()


@router.post("/cashflow-codes", response_model=CodeOut, status_code=201)
async def create_cf_code(
    body: CodeBase,
    current: User = Depends(require("articles:create")),
    db: AsyncSession = Depends(get_db),
):
    if await db.scalar(select(CashflowCode).where(CashflowCode.code == body.code)):
        raise HTTPException(400, detail="Такой код уже существует")
    row = CashflowCode(**body.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    await record(db, current, "create", "cashflow_code", f"{row.code} {row.name}")
    return row


@router.put("/cashflow-codes/{cid}", response_model=CodeOut)
async def update_cf_code(
    cid: int,
    body: CodeUpdate,
    current: User = Depends(require("articles:edit")),
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(CashflowCode, cid)
    if not row:
        raise HTTPException(404, detail="Код не найден")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    await db.commit()
    await db.refresh(row)
    await record(db, current, "edit", "cashflow_code", row.code)
    return row


@router.delete("/cashflow-codes/{cid}", status_code=204)
async def delete_cf_code(
    cid: int,
    current: User = Depends(require("articles:delete")),
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(CashflowCode, cid)
    if not row:
        raise HTTPException(404, detail="Код не найден")
    code = row.code
    await db.delete(row)
    await db.commit()
    await record(db, current, "delete", "cashflow_code", code)


# ---------- Divisions ----------
@router.get("/divisions", response_model=list[DivisionOut])
async def list_divisions(
    _: User = Depends(require("articles:view")), db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(Division).order_by(Division.id))
    return res.scalars().all()


@router.post("/divisions", response_model=DivisionOut, status_code=201)
async def create_division(
    body: DivisionBase,
    current: User = Depends(require("articles:create")),
    db: AsyncSession = Depends(get_db),
):
    if await db.scalar(select(Division).where(Division.name == body.name)):
        raise HTTPException(400, detail="Подразделение уже существует")
    row = Division(**body.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    await record(db, current, "create", "division", row.name)
    return row


@router.delete("/divisions/{did}", status_code=204)
async def delete_division(
    did: int,
    current: User = Depends(require("articles:delete")),
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(Division, did)
    if not row:
        raise HTTPException(404, detail="Подразделение не найдено")
    name = row.name
    await db.delete(row)
    await db.commit()
    await record(db, current, "delete", "division", name)
