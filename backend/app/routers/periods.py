"""Закрытые месяцы: список и контрольные проверки перед закрытием.

Само закрытие/открытие месяца (POST/DELETE) здесь намеренно НЕ реализовано —
это модуль «Закрытие месяца», который добавляется отдельно. Здесь готова вся
обвязка, на которую он опирается:

    · таблица `period_closes` (models.PeriodClose) — что считается закрытым;
    · `periods.assert_open` — уже подключена ко всем эндпоинтам первички,
      так что достаточно добавить строку в таблицу, и месяц станет закрытым;
    · `/api/periods/checks` — готовность месяца к закрытию;
    · права `closing:view | closing:create | closing:delete`.

Закрытие сводится к:

    db.add(PeriodClose(period=period, closed_by=user.id,
                       closed_by_name=user.full_name, note=note,
                       snapshot=await period_snapshot(db, year, month)))

а открытие — к удалению этой строки (обе операции стоит писать в AuditLog).
"""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..events import record
from ..models import ExchangeRate, PayrollEntry, PeriodClose, Transaction, User
from ..periods import (
    closed_periods,
    first_data_period,
    next_period,
    period_bounds,
    period_to_close,
    valid_period,
)
from ..security import require
from ..stock import negative_stock_at
from .reports import _balance_at, _balance_derived, pnl

router = APIRouter(prefix="/api/periods", tags=["periods"])


@router.get("")
async def list_periods(
    _: User = Depends(require("closing:view")), db: AsyncSession = Depends(get_db)
):
    """Закрытые месяцы, свежие сверху."""
    rows = (
        await db.execute(select(PeriodClose).order_by(PeriodClose.period.desc()))
    ).scalars().all()
    return [
        {
            "period": r.period,
            "closed_at": r.closed_at,
            "closed_by": r.closed_by,
            "closed_by_name": r.closed_by_name,
            "note": r.note,
            "snapshot": r.snapshot or {},
        }
        for r in rows
    ]


@router.get("/overview")
async def overview(
    _: User = Depends(require("closing:view")), db: AsyncSession = Depends(get_db)
):
    """Все месяцы от первого месяца с данными до текущего — для экрана закрытия.

    Статусы: `closed` — закрыт, `next` — очередной на закрытие,
    `waiting` — ждёт своей очереди.
    """
    first = await first_data_period(db)
    today = date.today()
    now = f"{today.year}-{today.month:02d}"
    if not first:
        return {"months": [], "next": None, "first_data_period": None}

    closed = {
        r.period: r
        for r in (await db.execute(select(PeriodClose))).scalars().all()
    }
    expected = await period_to_close(db)

    months, cur = [], first
    while cur <= now:
        row = closed.get(cur)
        _s, end = period_bounds(cur)
        months.append({
            "period": cur,
            "status": "closed" if row else ("next" if cur == expected else "waiting"),
            "closed_at": row.closed_at if row else None,
            "closed_by_name": row.closed_by_name if row else "",
            "note": row.note if row else "",
            "snapshot": (row.snapshot or {}) if row else {},
            "ended": end < today,
        })
        cur = next_period(cur)

    last_closed = max(closed) if closed else None
    return {
        "months": list(reversed(months)),
        "next": expected,
        "last_closed": last_closed,
        "first_data_period": first,
    }


def _money(v: float) -> str:
    """1234567.89 -> «1 234 567.89» (запятую как разделитель тысяч не берём:
    в остальной системе она десятичная)."""
    return f"{v:,.2f}".replace(",", " ")


def _check(code: str, ok: bool, title: str, detail: str = "", level: str = "error") -> dict:
    return {"code": code, "ok": ok, "level": "ok" if ok else level, "title": title,
            "detail": "" if ok else detail}


async def period_snapshot(db: AsyncSession, year: int, month: int) -> dict:
    """Слепок месяца: баланс на конец, итоги ОФР, курс. Кладётся в PeriodClose."""
    _start, end = period_bounds(f"{year}-{month:02d}")
    closing = _balance_derived(await _balance_at(db, end))
    report = await pnl(year=year, month=month, division=None, _=None, db=db)
    rate = await db.scalar(
        select(ExchangeRate.rate).where(ExchangeRate.rate_date <= end)
        .order_by(ExchangeRate.rate_date.desc()).limit(1)
    )
    return {
        "assets": round(closing["_assets"], 2),
        "passive": round(closing["_passive"], 2),
        "retained": round(closing["_retained"], 2),
        "equity": round(closing["_equity"], 2),
        "revenue": report["revenue"],
        "net_profit": report["net"],
        "rate": float(rate) if rate is not None else None,
    }


@router.get("/checks")
async def period_checks(
    year: int,
    month: int,
    _: User = Depends(require("closing:view")),
    db: AsyncSession = Depends(get_db),
):
    """Готов ли месяц к закрытию.

    Проверки специально разделены на «error» (закрывать нельзя — цифры
    недостоверны) и «warn» (закрыть можно, но стоит посмотреть).
    """
    period = valid_period(f"{year}-{month:02d}")
    start, end = period_bounds(period)
    checks: list[dict] = []

    # 1. месяц ещё не закрыт
    already = await db.get(PeriodClose, period)
    checks.append(_check(
        "not_closed", already is None, "Месяц ещё не закрыт",
        f"Месяц {period} уже закрыт" + (f" ({already.closed_by_name})" if already and already.closed_by_name else ""),
    ))

    # 2. очередь: месяцы закрываются строго подряд, начиная с первого месяца
    # с данными. Иначе закрытый месяц опирался бы на незакрытую базу.
    expected = await period_to_close(db)
    checks.append(_check(
        "sequence", expected == period, "Очередь соблюдена",
        (f"Сначала нужно закрыть {expected}: месяцы закрываются подряд, "
         f"начиная с первого месяца с данными"
         if expected else "Закрывать нечего — в системе нет данных"),
    ))

    # 3. месяц закончился — пока он идёт, документы за него ещё поступают
    checks.append(_check(
        "month_ended", end < date.today(), "Месяц закончился",
        f"Месяц {period} ещё не закончился ({end.strftime('%d.%m.%Y')})",
    ))

    # 3. курс на конец месяца — по нему считается вся переоценка
    rate_end = await db.scalar(select(ExchangeRate.rate).where(ExchangeRate.rate_date == end))
    checks.append(_check(
        "rate_month_end", rate_end is not None, "Курс на конец месяца введён",
        f"Курс доллара на {end.strftime('%d.%m.%Y')} не введён — переоценка "
        "посчитается по более раннему курсу и изменится, как только курс внесут",
    ))

    # 4. склад не в минусе
    negatives = await negative_stock_at(db, end)
    checks.append(_check(
        "no_negative_stock", not negatives, "Нет отрицательных остатков",
        "Списано больше, чем было: "
        + "; ".join(f"{n['name']} ({n['division']}) {n['qty']:g}" for n in negatives[:5])
        + (f" и ещё {len(negatives) - 5}" if len(negatives) > 5 else ""),
    ))

    # 5. баланс сходится
    closing = _balance_derived(await _balance_at(db, end))
    diff = round(closing["_assets"] - closing["_passive"], 2)
    checks.append(_check(
        "balance_matches", abs(diff) < 1, "Актив = Пассив",
        f"Расхождение {_money(diff)} сум",
    ))

    # 6. СПРАВОЧНО: прибыль ОФР и прирост нераспределённой прибыли.
    #
    # Это НЕ равенство, и требовать его нельзя. Курсовая разница в ОФР считается
    # по методике книги (лист «Курсовая разница»): это переоценка ВСЕГО
    # накопленного сальдо на конец месяца, а не движение за месяц — поэтому она
    # не складывается по месяцам. Баланс же ведётся в сумах и переоценки не
    # содержит вовсе. Проверить видно на пустом месяце: оборотов нет, прирост
    # нераспределённой прибыли ноль, а ОФР показывает всю накопленную переоценку.
    #
    # Строка остаётся как ориентир: если убрать курсовую разницу и числа всё
    # равно расходятся на порядок, стоит посмотреть, что не попало в отчёт.
    opening = _balance_derived(await _balance_at(db, start - timedelta(days=1)))
    report = await pnl(year=year, month=month, division=None, _=None, db=db)
    delta = round(closing["_retained"] - opening["_retained"], 2)
    fx_net = round(report["fx_income"] - report["fx_loss"], 2)
    checks.append({
        "code": "profit_reference", "ok": True, "level": "info",
        "title": "Прибыль ОФР и прирост нераспределённой прибыли",
        "detail": (
            f"ОФР: {_money(report['net'])} сум (в т.ч. курсовая разница "
            f"{_money(fx_net)}); баланс: {_money(delta)} сум. "
            "Величины не обязаны совпадать: переоценка в баланс не входит."
        ),
    })

    # 7. зарплата за месяц рассчитана
    payroll_cnt = await db.scalar(
        select(func.count(PayrollEntry.id)).where(PayrollEntry.period == period)
    )
    checks.append(_check(
        "payroll_done", bool(payroll_cnt), "Зарплата за месяц рассчитана",
        "За этот месяц нет ни одного расчёта зарплаты", level="warn",
    ))

    # 8. у всех операций есть код ДДС (старые записи могли попасть без него)
    no_code = await db.scalar(
        select(func.count(Transaction.id)).where(
            Transaction.doc_date.between(start, end),
            (Transaction.cashflow_code == "") | (Transaction.cashflow_code.is_(None)),
        )
    )
    checks.append(_check(
        "cashflow_codes", not no_code, "У операций есть код ДДС",
        f"Операций без кода Cash Flow: {no_code} — они не попадут в отчёт ДДС",
        level="warn",
    ))

    blocking = [c for c in checks if not c["ok"] and c["level"] == "error"]
    return {
        "period": period,
        "can_close": not blocking,
        "checks": checks,
        "snapshot": await period_snapshot(db, year, month),
    }


class CloseBody(BaseModel):
    note: str = ""


@router.post("/{period}", status_code=201)
async def close_period(
    period: str,
    body: CloseBody,
    current: User = Depends(require("closing:create")),
    db: AsyncSession = Depends(get_db),
):
    """Закрыть месяц. Проверки те же, что показывает экран, — обойти их нельзя.

    Проверяем ещё раз на сервере, а не доверяем кнопке: между открытием экрана
    и нажатием кто-то мог провести документ и сломать сходимость.
    """
    period = valid_period(period)
    year, month = (int(x) for x in period.split("-"))
    result = await period_checks(year=year, month=month, _=current, db=db)
    if not result["can_close"]:
        # в сообщении именно причина, а не название проверки: названия
        # сформулированы утвердительно («Очередь соблюдена») и в тексте отказа
        # читались бы наоборот
        failed = [
            c["detail"] or c["title"]
            for c in result["checks"] if not c["ok"] and c["level"] == "error"
        ]
        raise HTTPException(400, detail="Месяц не готов к закрытию. " + " ".join(failed))
    db.add(PeriodClose(
        period=period,
        closed_by=current.id,
        closed_by_name=current.full_name,
        note=(body.note or "").strip()[:255],
        snapshot=result["snapshot"],
    ))
    await db.flush()
    await record(db, current, "create", "period_close", f"закрыт месяц {period}")
    return {"period": period, "snapshot": result["snapshot"]}


@router.delete("/{period}", status_code=204)
async def reopen_period(
    period: str,
    current: User = Depends(require("closing:delete")),
    db: AsyncSession = Depends(get_db),
):
    """Открыть месяц обратно — только последний закрытый.

    Блокировка идёт по МАКСИМАЛЬНОМУ закрытому месяцу, поэтому открытие месяца
    из середины ничего бы не разблокировало и только запутало.
    """
    period = valid_period(period)
    row = await db.get(PeriodClose, period)
    if not row:
        raise HTTPException(404, detail=f"Месяц {period} не закрыт")
    last = max(await closed_periods(db))
    if period != last:
        raise HTTPException(
            400,
            detail=f"Открывать можно только последний закрытый месяц — {last}.",
        )
    await db.delete(row)
    await db.flush()
    await record(db, current, "delete", "period_close", f"открыт месяц {period}")
