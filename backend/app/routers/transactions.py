from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..events import record
from ..ledger import recompute_org_balances
from ..models import ExchangeRate, Transaction, User
from ..production import recompute_production
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


async def _sync_orgs(db: AsyncSession, *org_ids: int | None):
    """Пересчитать Дт-Кт сальдо затронутых контрагентов из первичных документов."""
    ids = [i for i in org_ids if i]
    if ids:
        await recompute_org_balances(db, ids)


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
    await db.flush()
    await _sync_orgs(db, tx.organization_id)
    await recompute_production(db, tx.division, tx.doc_date)
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
    old_org, old_div, old_date = tx.organization_id, tx.division, tx.doc_date
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(tx, k, v)
    tx.rate = await _resolve_rate(db, tx.currency, tx.doc_date)
    tx.amount_usd = _usd(tx.currency, float(tx.amount), float(tx.rate))
    tx.amount_uzs = _uzs(tx.currency, float(tx.amount), float(tx.rate))
    await db.flush()
    await _sync_orgs(db, old_org, tx.organization_id)
    await recompute_production(db, old_div, old_date)
    await recompute_production(db, tx.division, tx.doc_date)
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
    org_id, div, when = tx.organization_id, tx.division, tx.doc_date
    await db.delete(tx)
    await db.flush()
    await _sync_orgs(db, org_id)
    await recompute_production(db, div, when)
    await db.commit()
    await record(db, current, "delete", "transaction", f"#{tx_id}", {"id": tx_id})
