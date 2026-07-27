from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models import User
from ..schemas import MeOut, Token, UserOut
from ..security import (
    create_access_token,
    get_current_user,
    user_permissions,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=Token)
async def login(
    form: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)
):
    # OAuth2PasswordRequestForm uses "username" — we treat it as email
    result = await db.execute(
        select(User).options(selectinload(User.role)).where(User.email == form.username)
    )
    user = result.scalar_one_or_none()
    if not user or not verify_password(form.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Неверный email или пароль")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Учётная запись отключена")
    return Token(access_token=create_access_token(str(user.id)))


@router.get("/me", response_model=MeOut)
async def me(current: User = Depends(get_current_user)):
    perms = sorted(user_permissions(current))
    data = UserOut.model_validate(current).model_dump()
    data["permissions"] = perms
    return data
