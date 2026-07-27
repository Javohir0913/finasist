"""Полученные / Оказанные услуги."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..events import record
from ..models import Service, User
from ..rates import get_rates
from ..schemas import ServiceBase, ServiceOut
from ..security import require

router = APIRouter(prefix="/api/services", tags=["services"])


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
    nds = (await get_rates(db))["nds_rate"]
    amount = float(s.amount or 0)
    s.net = round(amount / (1 + nds), 2) if s.vat else round(amount, 2)
    s.vat_amount = round(amount - s.net, 2)
    db.add(s)
    await db.commit()
    await db.refresh(s, ["organization"])
    await record(db, current, "create", "service", f"{s.direction} {amount}", {"id": s.id})
    return s


@router.delete("/{sid}", status_code=204)
async def delete_service(
    sid: int, current: User = Depends(require("services:delete")), db: AsyncSession = Depends(get_db)
):
    s = await db.get(Service, sid)
    if not s:
        raise HTTPException(404, detail="Услуга не найдена")
    await db.delete(s)
    await db.commit()
    await record(db, current, "delete", "service", f"#{sid}")
