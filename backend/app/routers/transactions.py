from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..events import record
from ..models import ExchangeRate, Organization, Transaction, User
from ..schemas import TxCreate, TxOut, TxUpdate
from ..security import get_current_user, require

router = APIRouter(prefix="/api/transactions", tags=["transactions"])


def _usd(currency: str, amount: float, rate: float) -> float:
    if currency == "USD":
        return round(amount, 2)
    return round(amount / rate, 2) if rate else 0.0


def _uzs(currency: str, amount: float, rate: float) -> float:
    if currency == "UZS":
        return round(amount, 2)
    return round(amount * rate, 2)


async def _official_rate(db: AsyncSession, d: date) -> float | None:
    """Return the entered USD rate for a date, or None if it is missing."""
    r = await db.scalar(select(ExchangeRate.rate).where(ExchangeRate.rate_date == d))
    return float(r) if r is not None else None


async def _resolve_rate(db: AsyncSession, currency: str, doc_date: date) -> float:
    """USD needs no rate; UZS requires the official rate for that date."""
    if currency == "USD":
        return 1.0
    rate = await _official_rate(db, doc_date)
    if rate is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Курс доллара на {doc_date.strftime('%d.%m.%Y')} не введён. "
                "Сначала внесите курс за эту дату в разделе «Курс доллара»."
            ),
        )
    return rate


async def _post_org(db: AsyncSession, org_id: int | None, direction: str, amount_usd: float, amount_uzs: float = 0.0):
    """Post a cash movement to a counterparty's Дт-Кт balance (USD and UZS).

    expense (we pay them) -> balance += amount (they owe us more / we owe less)
    income  (they pay us) -> balance -= amount (they owe us less)
    Pass negative amounts to reverse a previous posting.
    """
    if not org_id or (not amount_usd and not amount_uzs):
        return
    org = await db.get(Organization, org_id)
    if not org:
        return
    sign = 1 if direction == "expense" else -1
    org.balance_usd = float(org.balance_usd or 0) + sign * amount_usd
    org.balance_uzs = float(org.balance_uzs or 0) + sign * amount_uzs


@router.get("", response_model=list[TxOut])
async def list_tx(
    direction: str | None = None,
    account: str | None = None,
    organization_id: int | None = None,
    limit: int = Query(200, le=1000),
    current: User = Depends(require("transactions:view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(Transaction)
        .options(selectinload(Transaction.organization))
        .order_by(Transaction.doc_date.desc(), Transaction.id.desc())
        .limit(limit)
    )
    if direction:
        stmt = stmt.where(Transaction.direction == direction)
    if account:
        stmt = stmt.where(Transaction.account == account)
    if organization_id:
        stmt = stmt.where(Transaction.organization_id == organization_id)
    # scope: supplier/customer users see only their own organization
    if current.organization_id and not current.is_superadmin:
        stmt = stmt.where(Transaction.organization_id == current.organization_id)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("", response_model=TxOut, status_code=201)
async def create_tx(
    body: TxCreate,
    current: User = Depends(require("transactions:create")),
    db: AsyncSession = Depends(get_db),
):
    if body.direction not in ("income", "expense"):
        raise HTTPException(status_code=400, detail="direction: income | expense")
    rate = await _resolve_rate(db, body.currency, body.doc_date)
    tx = Transaction(**body.model_dump())
    tx.rate = rate
    tx.amount_usd = _usd(body.currency, body.amount, rate)
    tx.amount_uzs = _uzs(body.currency, body.amount, rate)
    tx.created_by = current.id
    db.add(tx)
    await _post_org(db, tx.organization_id, tx.direction, float(tx.amount_usd), float(tx.amount_uzs))
    await db.commit()
    await db.refresh(tx, ["organization"])
    await record(
        db,
        current,
        "create",
        "transaction",
        f"{tx.direction} {tx.amount} {tx.currency}",
        {"id": tx.id, "direction": tx.direction, "amount_usd": float(tx.amount_usd)},
    )
    return tx


@router.put("/{tx_id}", response_model=TxOut)
async def update_tx(
    tx_id: int,
    body: TxUpdate,
    current: User = Depends(require("transactions:edit")),
    db: AsyncSession = Depends(get_db),
):
    tx = await db.get(Transaction, tx_id)
    if not tx:
        raise HTTPException(status_code=404, detail="Операция не найдена")
    # reverse the old posting before applying changes
    await _post_org(db, tx.organization_id, tx.direction, -float(tx.amount_usd or 0), -float(tx.amount_uzs or 0))
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(tx, k, v)
    tx.rate = await _resolve_rate(db, tx.currency, tx.doc_date)
    tx.amount_usd = _usd(tx.currency, float(tx.amount), float(tx.rate))
    tx.amount_uzs = _uzs(tx.currency, float(tx.amount), float(tx.rate))
    await _post_org(db, tx.organization_id, tx.direction, float(tx.amount_usd), float(tx.amount_uzs))
    await db.commit()
    await db.refresh(tx, ["organization"])
    await record(db, current, "edit", "transaction", f"#{tx.id}", {"id": tx.id})
    return tx


@router.delete("/{tx_id}", status_code=204)
async def delete_tx(
    tx_id: int,
    current: User = Depends(require("transactions:delete")),
    db: AsyncSession = Depends(get_db),
):
    tx = await db.get(Transaction, tx_id)
    if not tx:
        raise HTTPException(status_code=404, detail="Операция не найдена")
    # reverse its posting on the counterparty balance
    await _post_org(db, tx.organization_id, tx.direction, -float(tx.amount_usd or 0), -float(tx.amount_uzs or 0))
    await db.delete(tx)
    await db.commit()
    await record(db, current, "delete", "transaction", f"#{tx_id}", {"id": tx_id})
