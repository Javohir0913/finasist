"""Закрытые периоды: запрет правки первички за закрытый месяц + контроль перед закрытием.

Идея простая: месяц закрыт — документы этого месяца неприкосновенны. Иначе
«закрытие» ничего не значит: любая задним числом внесённая операция молча
переписала бы уже сданные отчёты (все показатели выводятся из первички,
см. `ledger.py`).

Проверка `assert_open` подключена ко ВСЕМ эндпоинтам, которые пишут документы.
Пока ни один месяц не закрыт, она не запрещает ничего — поведение системы
не меняется.

Что именно проверяется:
  · дата создаваемого документа;
  · СТАРАЯ дата при правке и удалении — иначе документ можно было бы просто
    «вынести» из закрытого месяца, изменив дату;
  · дата входящего сальдо (контрагенты, счета, кассы, займы) и дата курса —
    они меняют закрытый месяц не менее сильно, чем сам документ.
"""
import calendar
from datetime import date

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import PeriodClose, PeriodSetting, Setting

# Настройки, которые имеют смысл только «на месяц»: ОС, износ, капитал.
# Их значения баланс берёт из `PeriodSetting`, а не из текущего `Setting`.
PERIOD_SCOPED_SETTINGS = (
    "fa_cost",
    "fa_depreciation",
    "ia_cost",
    "ia_depreciation",
    "equipment_install",
    "capital_charter",
    "capital_added",
    "capital_reserve",
)


def period_of(d: date | None) -> str | None:
    """Дата -> «YYYY-MM»."""
    return f"{d.year}-{d.month:02d}" if d else None


def period_bounds(period: str) -> tuple[date, date]:
    """«YYYY-MM» -> (первое число, последнее число)."""
    y, m = (int(x) for x in period.split("-")[:2])
    return date(y, m, 1), date(y, m, calendar.monthrange(y, m)[1])


def valid_period(period: str) -> str:
    """Проверить формат периода и вернуть его нормализованным."""
    try:
        y, m = (int(x) for x in str(period).split("-")[:2])
        if not (1 <= m <= 12 and 2000 <= y <= 2999):
            raise ValueError
    except (ValueError, TypeError):
        raise HTTPException(400, detail="Период указывается как «ГГГГ-ММ», например 2026-01")
    return f"{y}-{m:02d}"


async def closed_periods(db: AsyncSession) -> set[str]:
    return set((await db.execute(select(PeriodClose.period))).scalars().all())


async def is_closed(db: AsyncSession, d: date | None) -> bool:
    if d is None:
        return False
    return period_of(d) in await closed_periods(db)


async def assert_open(db: AsyncSession, *dates: date | None, what: str = "документ") -> None:
    """Разрешить запись, только если ни одна из дат не попадает в закрытый месяц.

    Даты `None` игнорируются: у документа без даты периода нет.
    """
    wanted = {period_of(d) for d in dates if d}
    if not wanted:
        return
    closed = wanted & await closed_periods(db)
    if not closed:
        return
    period = sorted(closed)[0]
    row = await db.get(PeriodClose, period)
    who = f" (закрыл: {row.closed_by_name})" if row and row.closed_by_name else ""
    raise HTTPException(
        409,
        detail=(
            f"Месяц {period} закрыт{who}. Изменить {what} за закрытый период нельзя — "
            "сначала откройте месяц в разделе «Закрытие месяца»."
        ),
    )


async def assert_no_closed(db: AsyncSession, what: str = "показатель") -> None:
    """Для правок БЕЗ даты, которые задевают всю историю сразу.

    Входящий остаток склада даты не имеет: он стоит в самом начале учёта, и его
    изменение переписывает КАЖДЫЙ месяц, включая закрытые. Поэтому при наличии
    хотя бы одного закрытого месяца такие правки запрещены.
    """
    closed = await closed_periods(db)
    if closed:
        raise HTTPException(
            409,
            detail=(
                f"Изменить {what} нельзя: он влияет на всю историю, а месяц "
                f"{min(closed)} уже закрыт. Сначала откройте закрытые месяцы."
            ),
        )


async def assert_period_open(db: AsyncSession, period: str | None, what: str = "расчёт") -> None:
    """То же, но период задан строкой «YYYY-MM» (зарплата ведётся так)."""
    if not period:
        return
    if str(period) in await closed_periods(db):
        row = await db.get(PeriodClose, str(period))
        who = f" (закрыл: {row.closed_by_name})" if row and row.closed_by_name else ""
        raise HTTPException(
            409,
            detail=(
                f"Месяц {period} закрыт{who}. Изменить {what} за закрытый период нельзя — "
                "сначала откройте месяц в разделе «Закрытие месяца»."
            ),
        )


# ---------------------------------------------------------------- настройки
async def setting_value(db: AsyncSession, key: str, on: date | None = None) -> float:
    """Числовое значение настройки, действующее на дату.

    Порядок: значение месяца этой даты -> ближайший более ранний месяц ->
    текущее значение из `Setting`. Так баланс за март не «поедет» после того,
    как в апреле обновят износ.
    """
    if on is not None and key in PERIOD_SCOPED_SETTINGS:
        rows = (
            await db.execute(
                select(PeriodSetting.period, PeriodSetting.value)
                .where(PeriodSetting.key == key, PeriodSetting.period <= period_of(on))
                .order_by(PeriodSetting.period.desc())
                .limit(1)
            )
        ).first()
        if rows:
            return _num(rows[1])
    return _num(await db.scalar(select(Setting.value).where(Setting.key == key)))


def _num(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0
