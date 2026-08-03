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
from datetime import date, timedelta

from fastapi import Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .database import get_db
from .models import PeriodClose, PeriodSetting, Setting
from .security import get_current_user

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


def next_period(period: str) -> str:
    """«2026-12» -> «2027-01»."""
    y, m = (int(x) for x in period.split("-")[:2])
    return f"{y + 1}-01" if m == 12 else f"{y}-{m + 1:02d}"


async def first_data_period(db: AsyncSession) -> str | None:
    """Самый ранний месяц, в котором вообще есть данные.

    С него начинается очередь закрытия: закрывать можно только подряд, иначе
    «закрытый» месяц опирался бы на незакрытую базу и менялся бы задним числом.
    """
    from .models import (  # локально, чтобы не тянуть модели в шапку
        BankAccount, CashRegister, Loan, LoanEntry, MaterialIssue, MaterialReceipt,
        Organization, PayrollEntry, Production, Sale, Service, Transaction,
    )

    dates: list[date] = []
    for model in (Transaction, MaterialReceipt, MaterialIssue, Production, Sale,
                  Service, LoanEntry):
        d = await db.scalar(select(func.min(model.doc_date)))
        if d:
            dates.append(d)
    for model in (Organization, BankAccount, CashRegister, Loan):
        d = await db.scalar(select(func.min(model.opening_date)))
        if d:
            dates.append(d)

    periods = [period_of(d) for d in dates]
    payroll = await db.scalar(select(func.min(PayrollEntry.period)))
    if payroll:
        periods.append(str(payroll))
    return min(periods) if periods else None


async def period_to_close(db: AsyncSession) -> str | None:
    """Какой месяц закрывается следующим (None — закрывать нечего)."""
    closed = await closed_periods(db)
    if closed:
        return next_period(max(closed))
    return await first_data_period(db)


async def is_closed(db: AsyncSession, d: date | None) -> bool:
    if d is None:
        return False
    return period_of(d) in await closed_periods(db)


async def _blocked_by(db: AsyncSession, period: str | None) -> str | None:
    """Какой закрытый месяц запрещает запись в этот период (или None).

    Запрещён не только САМ закрытый месяц, но и всё, что раньше него. Причина:
    остатки и себестоимость выводятся полным реплеем движений с начала учёта
    (см. `routers/inventory.py`), поэтому документ, датированный до закрытого
    месяца, меняет среднюю цену списаний ВНУТРИ него — а значит и его ОФР.
    Без этого правила закрытие июля обходилось бы вводом документа в июнь.
    """
    if not period:
        return None
    closed = await closed_periods(db)
    if not closed:
        return None
    last = max(closed)
    return last if period <= last else None


async def assert_open(db: AsyncSession, *dates: date | None, what: str = "документ") -> None:
    """Разрешить запись, только если все даты позже последнего закрытого месяца.

    Даты `None` игнорируются: у документа без даты периода нет.
    """
    for d in sorted({period_of(x) for x in dates if x}):
        blocker = await _blocked_by(db, d)
        if blocker:
            await _raise_closed(db, blocker, d, what)


async def _raise_closed(db: AsyncSession, blocker: str, period: str, what: str) -> None:
    row = await db.get(PeriodClose, blocker)
    who = f" (закрыл: {row.closed_by_name})" if row and row.closed_by_name else ""
    same = period == blocker
    reason = (
        "за закрытый период" if same
        else f"за {period}: более ранняя дата пересчитала бы закрытый месяц"
    )
    raise HTTPException(
        409,
        detail=(
            f"Месяц {blocker} закрыт{who}. Изменить {what} {reason} нельзя — "
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
    blocker = await _blocked_by(db, str(period))
    if blocker:
        await _raise_closed(db, blocker, str(period), what)


HISTORY_PERM = "closing:history"


async def visible_from(db: AsyncSession, user) -> date | None:
    """С какой даты пользователю разрешено ВИДЕТЬ документы (None — всё).

    Закрытый месяц можно закрыть и от чужих глаз: данные видит только тот, у
    кого есть право «closing:history». Правка всё равно запрещена всем — за это
    отвечает assert_open, и эти два механизма независимы.
    """
    from .security import has_permission

    if has_permission(user, HISTORY_PERM):
        return None
    closed = await closed_periods(db)
    if not closed:
        return None
    _start, end = period_bounds(max(closed))
    return end + timedelta(days=1)


async def assert_history_allowed(db: AsyncSession, user, year, month) -> None:
    """Запретить отчёт за период, который целиком лежит в закрытых месяцах."""
    if not year:
        return
    limit = await visible_from(db, user)
    if limit is None:
        return
    end = date(year, 12, 31) if not month else period_bounds(f"{year}-{int(month):02d}")[1]
    if end < limit:
        raise HTTPException(
            403,
            detail=(
                f"Данные закрытых месяцев (по {period_of(limit - timedelta(days=1))} "
                "включительно) доступны только с правом «Закрытие месяца → Видеть закрытые»."
            ),
        )


async def history_guard(
    year: int | None = None,
    month: int | None = None,
    current=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Зависимость уровня роутера: закрывает отчёты за закрытые месяцы.

    Вешается на весь роутер (`APIRouter(dependencies=[Depends(history_guard)])`),
    поэтому сигнатуры эндпоинтов не меняются — а это важно: отчёты вызывают друг
    друга напрямую (`pnl` дёргает `gp_turnover` и `fx_difference`), и переименуй
    мы у них параметры, эти вызовы бы сломались. Прямой вызов функции проверку
    не проходит — и правильно: внутренние расчёты должны видеть всё.
    """
    await assert_history_allowed(db, current, year, month)


async def accounting_start(db: AsyncSession) -> date | None:
    """«Дата начала учёта» из настроек — с неё существуют входящие остатки.

    У входящего остатка склада своей даты нет (в отличие от контрагентов, счетов
    и займов), поэтому до этой правки он подставлялся в баланс на ЛЮБУЮ дату —
    даже за месяцы до начала работы компании.
    """
    raw = await db.scalar(select(Setting.value).where(Setting.key == "period_start"))
    try:
        return date.fromisoformat(str(raw).strip()) if raw else None
    except (ValueError, AttributeError):
        return None


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
