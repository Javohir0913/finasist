"""Полученные / Оказанные услуги."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..events import record
from ..ledger import recompute_org_balances
from ..models import Service, User
from ..production import recompute_production
from ..rates import get_rates
from ..schemas import ServiceBase, ServiceOut
from ..security import require

router = APIRouter(prefix="/api/services", tags=["services"])


async def _sync_orgs(db: AsyncSession, *org_ids):
    ids = [i for i in org_ids if i]
    if ids:
        await recompute_org_balances(db, ids)


async def _apply(db: AsyncSession, s: Service) -> None:
    """Разложить сумму услуги на нетто и НДС по действующей ставке."""
    nds = (await get_rates(db))["nds_rate"]
    amount = float(s.amount or 0)
    s.net = round(amount / (1 + nds), 2) if s.vat else round(amount, 2)
    s.vat_amount = round(amount - s.net, 2)


@router.get("", response_model=list[ServiceOut])
async def list_services(
    direction: str | None = None,
    _: User = Depends(require("services:view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Service).options(selectinload(Service.organization)).order_by(Service.doc_date.desc(), Service.id.desc())
    if direction:
        stmt = stmt.where(Service.direction == direction)
    res = await db.execute(stmt)
    return res.scalars().all()


@router.post("", response_model=ServiceOut, status_code=201)
async def create_service(
    body: ServiceBase,
    current: User = Depends(require("services:create")),
    db: AsyncSession = Depends(get_db),
):
    if body.direction not in ("received", "provided"):
        raise HTTPException(400, detail="direction: received | provided")
    s = Service(**body.model_dump(), created_by=current.id)
    await _apply(db, s)
    db.add(s)
    await db.flush()
    await _sync_orgs(db, s.organization_id)
    await recompute_production(db, s.division, s.doc_date)
    await db.commit()
    await db.refresh(s, ["organization"])
    await record(db, current, "create", "service", f"{s.direction} {s.amount}", {"id": s.id})
    return s


@router.put("/{sid}", response_model=ServiceOut)
async def update_service(
    sid: int,
    body: ServiceBase,
    current: User = Depends(require("services:edit")),
    db: AsyncSession = Depends(get_db),
):
    s = await db.get(Service, sid)
    if not s:
        raise HTTPException(404, detail="Услуга не найдена")
    if body.direction not in ("received", "provided"):
        raise HTTPException(400, detail="direction: received | provided")
    old_org, old_div, old_date = s.organization_id, s.division, s.doc_date
    for k, v in body.model_dump().items():
        setattr(s, k, v)
    await _apply(db, s)
    await db.flush()
    await _sync_orgs(db, old_org, s.organization_id)
    await recompute_production(db, old_div, old_date)
    await recompute_production(db, s.division, s.doc_date)
    await db.commit()
    await db.refresh(s, ["organization"])
    await record(db, current, "edit", "service", f"#{sid}", {"id": s.id})
    return s


@router.delete("/{sid}", status_code=204)
async def delete_service(
    sid: int, current: User = Depends(require("services:delete")), db: AsyncSession = Depends(get_db)
):
    s = await db.get(Service, sid)
    if not s:
        raise HTTPException(404, detail="Услуга не найдена")
    org_id, div, when = s.organization_id, s.division, s.doc_date
    await db.delete(s)
    await db.flush()
    await _sync_orgs(db, org_id)
    await recompute_production(db, div, when)
    await db.commit()
    await record(db, current, "delete", "service", f"#{sid}")
