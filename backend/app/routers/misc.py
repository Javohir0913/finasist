"""Exchange rates, taxes, loans, audit log — lighter modules."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..events import record
from ..models import AuditLog, ExchangeRate, Loan, LoanEntry, Tax, User
from ..schemas import (
    AuditOut,
    LoanBase,
    LoanEntryBase,
    LoanEntryOut,
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
    # Курс 1 или 0 обрушивает всю валютную часть отчётности: переоценка делит
    # сумовые сальдо на курс, и опечатка выдаёт «доход» размером с сам долг.
    if float(body.rate) < 100:
        raise HTTPException(
            400,
            detail="Курс доллара указан неверно: ожидается цена 1 USD в сумах "
                   "(порядка 12 000), а не коэффициент.",
        )
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
async def _recompute_loan(db: AsyncSession, loan_id: int) -> None:
    """Сальдо займа = входящее + Σ(выдача) − Σ(погашение)."""
    ln = await db.get(Loan, loan_id)
    if not ln:
        return
    stmt = select(
        LoanEntry.kind, func.coalesce(func.sum(LoanEntry.amount_uzs), 0)
    ).where(LoanEntry.loan_id == loan_id).group_by(LoanEntry.kind)
    net = float(ln.opening_uzs or 0)
    for kind, amount in (await db.execute(stmt)).all():
        net += (1 if kind == "debit" else -1) * float(amount or 0)
    ln.balance = round(net, 2)


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
    await db.flush()
    await _recompute_loan(db, ln.id)
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
    await db.flush()
    await _recompute_loan(db, lid)
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
    n = await db.scalar(select(func.count(LoanEntry.id)).where(LoanEntry.loan_id == lid))
    if n:
        raise HTTPException(400, detail=f"Нельзя удалить — есть движения ({n}).")
    name = ln.counterparty
    await db.delete(ln)
    await db.commit()
    await record(db, current, "delete", "loan", name)


# ---------- Loan movements (выдача / погашение) ----------
@router.get("/loan-entries", response_model=list[LoanEntryOut])
async def list_loan_entries(
    loan_id: int | None = None,
    _: User = Depends(require("loans:view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(LoanEntry).order_by(LoanEntry.doc_date.desc(), LoanEntry.id.desc())
    if loan_id:
        stmt = stmt.where(LoanEntry.loan_id == loan_id)
    return (await db.execute(stmt)).scalars().all()


@router.post("/loan-entries", response_model=LoanEntryOut, status_code=201)
async def create_loan_entry(
    body: LoanEntryBase,
    current: User = Depends(require("loans:create")),
    db: AsyncSession = Depends(get_db),
):
    if body.kind not in ("debit", "credit"):
        raise HTTPException(400, detail="kind: debit (выдача) | credit (погашение)")
    if not await db.get(Loan, body.loan_id):
        raise HTTPException(404, detail="Займ не найден")
    row = LoanEntry(**body.model_dump())
    db.add(row)
    await db.flush()
    await _recompute_loan(db, row.loan_id)
    await db.commit()
    await db.refresh(row)
    await record(db, current, "create", "loan_entry", f"{row.kind} {row.amount_uzs}")
    return row


@router.put("/loan-entries/{eid}", response_model=LoanEntryOut)
async def update_loan_entry(
    eid: int,
    body: LoanEntryBase,
    current: User = Depends(require("loans:edit")),
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(LoanEntry, eid)
    if not row:
        raise HTTPException(404, detail="Движение не найдено")
    old_loan = row.loan_id
    for k, v in body.model_dump().items():
        setattr(row, k, v)
    await db.flush()
    await _recompute_loan(db, old_loan)
    if row.loan_id != old_loan:
        await _recompute_loan(db, row.loan_id)
    await db.commit()
    await db.refresh(row)
    await record(db, current, "edit", "loan_entry", f"#{eid}")
    return row


@router.delete("/loan-entries/{eid}", status_code=204)
async def delete_loan_entry(
    eid: int, current: User = Depends(require("loans:delete")), db: AsyncSession = Depends(get_db)
):
    row = await db.get(LoanEntry, eid)
    if not row:
        raise HTTPException(404, detail="Движение не найдено")
    lid = row.loan_id
    await db.delete(row)
    await db.flush()
    await _recompute_loan(db, lid)
    await db.commit()
    await record(db, current, "delete", "loan_entry", f"#{eid}")


# ---------- Audit log (superadmin-ish, gated by users:view) ----------
@router.get("/audit", response_model=list[AuditOut])
async def audit(
    _: User = Depends(require("users:view")), db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(AuditLog).order_by(AuditLog.id.desc()).limit(100))
    return result.scalars().all()
