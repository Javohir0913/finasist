"""Загрузка настраиваемых ставок из таблицы settings (с безопасными значениями по умолчанию)."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Setting

DEFAULTS = {
    "nds_rate": 0.12,
    "ndfl_rate": 0.12,
    "inps_rate": 0.0,
    "esp_rate": 0.12,
    "profit_tax_rate": 0.15,
}


async def get_rates(db: AsyncSession) -> dict:
    rows = (await db.execute(select(Setting))).scalars().all()
    vals = {r.key: r.value for r in rows}
    out = {}
    for k, dflt in DEFAULTS.items():
        try:
            out[k] = float(vals.get(k, dflt))
        except (TypeError, ValueError):
            out[k] = dflt
    return out
