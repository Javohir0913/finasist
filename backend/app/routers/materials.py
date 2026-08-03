from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..events import record
from ..models import Material, MaterialIssue, MaterialReceipt, MaterialStock, User
from ..periods import assert_no_closed
from ..schemas import MaterialCreate, MaterialOut, MaterialUpdate
from ..security import require
from .inventory import recompute_material

router = APIRouter(prefix="/api/materials", tags=["materials"])


@router.get("", response_model=list[MaterialOut])
async def list_materials(
    kind: str | None = None,
    _: User = Depends(require("materials:view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Material).order_by(Material.name)
    if kind:
        stmt = stmt.where(Material.kind == kind)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("", response_model=MaterialOut, status_code=201)
async def create_material(
    body: MaterialCreate,
    current: User = Depends(require("materials:create")),
    db: AsyncSession = Depends(get_db),
):
    m = Material(**body.model_dump())
    if float(m.opening_qty or 0) or float(m.opening_cost or 0):
        await assert_no_closed(db, what="входящий остаток сырья")
    db.add(m)
    await db.flush()
    await recompute_material(db, m.id)
    await db.commit()
    await db.refresh(m)
    await record(db, current, "create", "material", m.name, {"id": m.id})
    return m


@router.put("/{mid}", response_model=MaterialOut)
async def update_material(
    mid: int,
    body: MaterialUpdate,
    current: User = Depends(require("materials:edit")),
    db: AsyncSession = Depends(get_db),
):
    m = await db.get(Material, mid)
    if not m:
        raise HTTPException(status_code=404, detail="Материал не найден")
    data = body.model_dump(exclude_unset=True)
    # входящий остаток даты не имеет и переписывает всю историю — см. assert_no_closed
    if any(float(data[k] or 0) != float(getattr(m, k) or 0)
           for k in ("opening_qty", "opening_cost") if k in data):
        await assert_no_closed(db, what="входящий остаток сырья")
    for k, v in data.items():
        setattr(m, k, v)
    await db.flush()
    # входящий остаток мог измениться -> полный пересчёт склада и средней цены
    await recompute_material(db, m.id)
    await db.commit()
    await db.refresh(m)
    await record(db, current, "edit", "material", m.name, {"id": m.id})
    return m


@router.delete("/{mid}", status_code=204)
async def delete_material(
    mid: int,
    current: User = Depends(require("materials:delete")),
    db: AsyncSession = Depends(get_db),
):
    m = await db.get(Material, mid)
    if not m:
        raise HTTPException(status_code=404, detail="Материал не найден")
    recv = await db.scalar(
        select(func.count(MaterialReceipt.id)).where(MaterialReceipt.material_id == mid)
    )
    iss = await db.scalar(
        select(func.count(MaterialIssue.id)).where(MaterialIssue.material_id == mid)
    )
    if recv or iss:
        raise HTTPException(
            400,
            detail=f"Нельзя удалить — есть движения (приход: {recv or 0}, расход: {iss or 0}).",
        )
    name = m.name
    # карточки остатков по объектам — производные данные, уходят вместе с номенклатурой
    await db.execute(delete(MaterialStock).where(MaterialStock.material_id == mid))
    await db.delete(m)
    await db.commit()
    await record(db, current, "delete", "material", name)
