from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..events import record
from ..models import Material, User
from ..schemas import MaterialCreate, MaterialOut, MaterialUpdate
from ..security import require

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
    db.add(m)
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
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(m, k, v)
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
    name = m.name
    await db.delete(m)
    await db.commit()
    await record(db, current, "delete", "material", name)
