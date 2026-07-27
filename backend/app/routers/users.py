from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..events import record
from ..models import AuditLog, Transaction, User
from ..schemas import UserCreate, UserOut, UserUpdate
from ..security import hash_password, require

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("", response_model=list[UserOut])
async def list_users(_: User = Depends(require("users:view")), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).options(selectinload(User.role)).order_by(User.id))
    return result.scalars().all()


@router.post("", response_model=UserOut, status_code=201)
async def create_user(
    body: UserCreate,
    current: User = Depends(require("users:create")),
    db: AsyncSession = Depends(get_db),
):
    exists = await db.execute(select(User).where(User.email == body.email))
    if exists.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Пользователь с таким email уже существует")
    user = User(
        email=body.email,
        full_name=body.full_name,
        hashed_password=hash_password(body.password),
        is_active=body.is_active,
        role_id=body.role_id,
        organization_id=body.organization_id,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user, ["role"])
    await record(db, current, "create", "user", user.email)
    return user


@router.put("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: int,
    body: UserUpdate,
    current: User = Depends(require("users:edit")),
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    if user.is_superadmin and current.id != user.id:
        raise HTTPException(status_code=400, detail="Супер-администратора нельзя изменять")
    if body.full_name is not None:
        user.full_name = body.full_name
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.role_id is not None:
        user.role_id = body.role_id
    if body.organization_id is not None:
        user.organization_id = body.organization_id
    if body.password:
        user.hashed_password = hash_password(body.password)
    await db.commit()
    await db.refresh(user, ["role"])
    await record(db, current, "edit", "user", user.email)
    return user


@router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: int,
    current: User = Depends(require("users:delete")),
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    if user.is_superadmin:
        raise HTTPException(status_code=400, detail="Супер-администратора нельзя удалить")
    if user.id == current.id:
        raise HTTPException(status_code=400, detail="Нельзя удалить собственную учётную запись")
    email = user.email
    # keep historical records, drop the author link to avoid FK violations
    await db.execute(
        update(Transaction).where(Transaction.created_by == user.id).values(created_by=None)
    )
    await db.execute(
        update(AuditLog).where(AuditLog.user_id == user.id).values(user_id=None)
    )
    await db.delete(user)
    await db.commit()
    await record(db, current, "delete", "user", email)
