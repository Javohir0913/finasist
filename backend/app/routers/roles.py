from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..events import record
from ..models import Role, User
from ..permissions import ALL_PERMISSIONS, permission_catalog
from ..schemas import RoleCreate, RoleOut, RoleUpdate
from ..security import require

router = APIRouter(prefix="/api/roles", tags=["roles"])


@router.get("/permissions/catalog")
async def catalog(_: User = Depends(require("roles:view"))):
    return permission_catalog()


@router.get("", response_model=list[RoleOut])
async def list_roles(_: User = Depends(require("roles:view")), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Role).order_by(Role.id))
    return result.scalars().all()


def _validate_perms(perms: list[str]):
    bad = [p for p in perms if p not in ALL_PERMISSIONS]
    if bad:
        raise HTTPException(status_code=400, detail=f"Неизвестные права: {', '.join(bad)}")


@router.post("", response_model=RoleOut, status_code=201)
async def create_role(
    body: RoleCreate,
    current: User = Depends(require("roles:create")),
    db: AsyncSession = Depends(get_db),
):
    _validate_perms(body.permissions)
    exists = await db.execute(select(Role).where(Role.name == body.name))
    if exists.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Роль с таким названием уже существует")
    role = Role(name=body.name, description=body.description, permissions=body.permissions)
    db.add(role)
    await db.commit()
    await db.refresh(role)
    await record(db, current, "create", "role", role.name)
    return role


@router.put("/{role_id}", response_model=RoleOut)
async def update_role(
    role_id: int,
    body: RoleUpdate,
    current: User = Depends(require("roles:edit")),
    db: AsyncSession = Depends(get_db),
):
    role = await db.get(Role, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="Роль не найдена")
    if role.is_system and body.permissions is not None:
        raise HTTPException(status_code=400, detail="Системную роль нельзя изменять")
    if body.permissions is not None:
        _validate_perms(body.permissions)
        role.permissions = body.permissions
    if body.name is not None:
        role.name = body.name
    if body.description is not None:
        role.description = body.description
    await db.commit()
    await db.refresh(role)
    await record(db, current, "edit", "role", role.name)
    return role


@router.delete("/{role_id}", status_code=204)
async def delete_role(
    role_id: int,
    current: User = Depends(require("roles:delete")),
    db: AsyncSession = Depends(get_db),
):
    role = await db.get(Role, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="Роль не найдена")
    if role.is_system:
        raise HTTPException(status_code=400, detail="Системную роль нельзя удалить")
    name = role.name
    await db.delete(role)
    await db.commit()
    await record(db, current, "delete", "role", name)
