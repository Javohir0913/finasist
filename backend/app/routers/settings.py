"""Настройки: ставки налогов и др. — просмотр по праву, изменение только супер-админ."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..events import record
from ..models import Setting, User
from ..security import get_current_superadmin, require

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SettingOut(BaseModel):
    key: str
    value: str
    label: str
    group: str
    kind: str

    class Config:
        from_attributes = True


class SettingUpdate(BaseModel):
    value: str


@router.get("", response_model=list[SettingOut])
async def list_settings(
    _: User = Depends(require("settings:view")), db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(Setting).order_by(Setting.group, Setting.key))
    return res.scalars().all()


@router.put("/{key}", response_model=SettingOut)
async def update_setting(
    key: str,
    body: SettingUpdate,
    current: User = Depends(get_current_superadmin),
    db: AsyncSession = Depends(get_db),
):
    s = await db.get(Setting, key)
    if not s:
        raise HTTPException(404, detail="Параметр не найден")
    # validate numeric for percent/number
    if s.kind in ("percent", "number"):
        try:
            float(body.value)
        except ValueError:
            raise HTTPException(400, detail="Значение должно быть числом")
    s.value = body.value
    await db.commit()
    await db.refresh(s)
    await record(db, current, "edit", "setting", f"{key}={s.value}")
    return s
