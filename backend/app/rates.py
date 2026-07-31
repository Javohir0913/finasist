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

# Налоги, начисление которых считается САМО — из первичных документов, и
# поэтому уже попадает в тот период, где лежит документ:
#   НДС  — из продаж, услуг и прихода ТМЦ (по дате документа);
#   НДФЛ / ЕСП / ИНПС — из ведомости зарплаты (по её периоду).
# Остальные налоги вводятся руками, и для них дата обязательна — иначе
# начисление считалось бы в каждом периоде.
AUTO_TAX_KEYS = ("НДС", "НДФЛ", "ЕСП", "ИНПС")

TAX_DATE_REQUIRED = (
    "Укажите дату начисления — этот налог считается вручную, и без даты "
    "он попадал бы в каждый период отчёта."
)


def is_auto_tax(name: str) -> bool:
    """Начисление берётся из документов, а не из карточки налога."""
    low = (name or "").lower()
    return any(k.lower() in low for k in AUTO_TAX_KEYS)


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
