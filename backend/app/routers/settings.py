"""Настройки: ставки налогов и др. — просмотр по праву, изменение только супер-админ."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..events import record
from ..models import PeriodSetting, Setting, User
from ..periods import PERIOD_SCOPED_SETTINGS, assert_period_open, valid_period
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


# ---------- значения по месяцам (ОС, износ, капитал) ----------
# Эти показатели меняются каждый месяц, а `Setting` хранит одно текущее
# значение. Пока значение месяца не задано, баланс берёт ближайшее более
# раннее, а затем текущее — см. periods.setting_value.
@router.get("/periods/{period}")
async def list_period_settings(
    period: str,
    _: User = Depends(require("settings:view")),
    db: AsyncSession = Depends(get_db),
):
    """Значения помесячных показателей за конкретный месяц («ГГГГ-ММ»)."""
    period = valid_period(period)
    rows = dict(
        (
            await db.execute(
                select(PeriodSetting.key, PeriodSetting.value).where(
                    PeriodSetting.period == period
                )
            )
        ).all()
    )
    labels = dict(
        (await db.execute(select(Setting.key, Setting.label).where(
            Setting.key.in_(PERIOD_SCOPED_SETTINGS)
        ))).all()
    )
    return [
        {"key": k, "label": labels.get(k, k), "value": rows.get(k), "period": period}
        for k in PERIOD_SCOPED_SETTINGS
    ]


@router.put("/periods/{period}/{key}")
async def set_period_setting(
    period: str,
    key: str,
    body: SettingUpdate,
    current: User = Depends(get_current_superadmin),
    db: AsyncSession = Depends(get_db),
):
    """Задать значение показателя на месяц (закрытый месяц править нельзя)."""
    period = valid_period(period)
    if key not in PERIOD_SCOPED_SETTINGS:
        raise HTTPException(400, detail="Этот параметр не ведётся по месяцам")
    try:
        float(body.value)
    except ValueError:
        raise HTTPException(400, detail="Значение должно быть числом")
    await assert_period_open(db, period, what="показатель баланса")
    row = await db.scalar(
        select(PeriodSetting).where(PeriodSetting.period == period, PeriodSetting.key == key)
    )
    if row is None:
        row = PeriodSetting(period=period, key=key)
        db.add(row)
    row.value = body.value
    await db.commit()
    await record(db, current, "edit", "period_setting", f"{period} {key}={row.value}")
    return {"period": period, "key": key, "value": row.value}


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
