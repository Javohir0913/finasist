"""Exchange rates, taxes, loans, audit log — lighter modules."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..events import record
from ..models import AuditLog, ExchangeRate, Loan, Tax, User
from ..schemas import (
    AuditOut,
    LoanBase,
    LoanOut,
    LoanUpdate,
    RateBase,
    RateOut,
    TaxBase,
    TaxOut,
    TaxUpdate,
)
from ..security import get_current_user, require

router = APIRouter(prefix="/api", tags=["misc"])


# ---------- Exchange ----------
@router.get("/exchange", response_model=list[RateOut])
async def list_rates(
    _: User = Depends(require("exchange:view")), db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(ExchangeRate).order_by(ExchangeRate.rate_date.desc()))
    return result.scalars().all()


@router.get("/exchange/by-date/{d}")
async def rate_by_date(
    d: date,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Whether an official USD rate exists for a date (used to gate transactions)."""
    r = await db.scalar(select(ExchangeRate.rate).where(ExchangeRate.rate_date == d))
    return {"date": d, "exists": r is not None, "rate": float(r) if r is not None else None}


@router.post("/exchange", response_model=RateOut, status_code=201)
async def create_rate(
    body: RateBase,
    current: User = Depends(require("exchange:create")),
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(
        select(ExchangeRate).where(ExchangeRate.rate_date == body.rate_date)
    )
    row = existing.scalar_one_or_none()
    if row:
        row.rate = body.rate
    else:
        row = ExchangeRate(**body.model_dump())
        db.add(row)
    await db.commit()
    await db.refresh(row)
    await record(db, current, "create", "exchange", f"{row.rate_date}: {row.rate}")
    return row


# ---------- Taxes ----------
@router.get("/taxes", response_model=list[TaxOut])
async def list_taxes(_: User = Depends(require("taxes:view")), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Tax).order_by(Tax.id))
    return result.scalars().all()


@router.post("/taxes", response_model=TaxOut, status_code=201)
async def create_tax(
    body: TaxBase,
    current: User = Depends(require("taxes:create")),
    db: AsyncSession = Depends(get_db),
):
    t = Tax(**body.model_dump())
    t.debt_end = round(float(t.debt_start or 0) + float(t.accrued or 0) - float(t.paid or 0), 2)
    db.add(t)
    await db.commit()
    await db.refresh(t)
    await record(db, current, "create", "tax", t.name)
    return t


@router.put("/taxes/{tid}", response_model=TaxOut)
async def update_tax(
    tid: int,
    body: TaxUpdate,
    current: User = Depends(require("taxes:edit")),
    db: AsyncSession = Depends(get_db),
):
    t = await db.get(Tax, tid)
    if not t:
        raise HTTPException(status_code=404, detail="Налог не найден")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(t, k, v)
    t.debt_end = round(float(t.debt_start or 0) + float(t.accrued or 0) - float(t.paid or 0), 2)
    await db.commit()
    await db.refresh(t)
    await record(db, current, "edit", "tax", t.name)
    return t


@router.delete("/taxes/{tid}", status_code=204)
async def delete_tax(
    tid: int, current: User = Depends(require("taxes:delete")), db: AsyncSession = Depends(get_db)
):
    t = await db.get(Tax, tid)
    if not t:
        raise HTTPException(status_code=404, detail="Налог не найден")
    name = t.name
    await db.delete(t)
    await db.commit()
    await record(db, current, "delete", "tax", name)


# ---------- Loans ----------
@router.get("/loans", response_model=list[LoanOut])
async def list_loans(_: User = Depends(require("loans:view")), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Loan).order_by(Loan.id))
    return result.scalars().all()


@router.post("/loans", response_model=LoanOut, status_code=201)
async def create_loan(
    body: LoanBase,
    current: User = Depends(require("loans:create")),
    db: AsyncSession = Depends(get_db),
):
    ln = Loan(**body.model_dump())
    db.add(ln)
    await db.commit()
    await db.refresh(ln)
    await record(db, current, "create", "loan", ln.counterparty)
    return ln


@router.put("/loans/{lid}", response_model=LoanOut)
async def update_loan(
    lid: int,
    body: LoanUpdate,
    current: User = Depends(require("loans:edit")),
    db: AsyncSession = Depends(get_db),
):
    ln = await db.get(Loan, lid)
    if not ln:
        raise HTTPException(status_code=404, detail="Займ не найден")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(ln, k, v)
    await db.commit()
    await db.refresh(ln)
    await record(db, current, "edit", "loan", ln.counterparty)
    return ln


@router.delete("/loans/{lid}", status_code=204)
async def delete_loan(
    lid: int, current: User = Depends(require("loans:delete")), db: AsyncSession = Depends(get_db)
):
    ln = await db.get(Loan, lid)
    if not ln:
        raise HTTPException(status_code=404, detail="Займ не найден")
    name = ln.counterparty
    await db.delete(ln)
    await db.commit()
    await record(db, current, "delete", "loan", name)


# ---------- Audit log (superadmin-ish, gated by users:view) ----------
@router.get("/audit", response_model=list[AuditOut])
async def audit(
    _: User = Depends(require("users:view")), db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(AuditLog).order_by(AuditLog.id.desc()).limit(100))
    return result.scalars().all()
