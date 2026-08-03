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

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import ExchangeRate, PayrollEntry, PeriodClose, Transaction, User
from ..periods import period_bounds, period_of, valid_period
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
    closing = _balance_derived(await _balance_at(db, end, year, month))
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

    # 2. предыдущий месяц закрыт (иначе задним числом поменяют базу этого)
    prev_end = start - timedelta(days=1)
    prev = period_of(prev_end)
    has_prev_docs = await db.scalar(
        select(func.count(Transaction.id)).where(Transaction.doc_date <= prev_end)
    )
    prev_closed = (await db.get(PeriodClose, prev)) is not None
    checks.append(_check(
        "prev_closed", prev_closed or not has_prev_docs, "Предыдущий месяц закрыт",
        f"Месяц {prev} ещё открыт — его правки будут менять входящие остатки этого месяца",
        level="warn",
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
    closing = _balance_derived(await _balance_at(db, end, year, month))
    diff = round(closing["_assets"] - closing["_passive"], 2)
    checks.append(_check(
        "balance_matches", abs(diff) < 1, "Актив = Пассив",
        f"Расхождение {_money(diff)} сум",
    ))

    # 6. прибыль ОФР = прирост нераспределённой прибыли.
    # Нераспределённая прибыль в балансе — балансирующая величина, поэтому
    # расхождение с ОФР означает, что какая-то операция не попала в отчёт.
    opening = _balance_derived(await _balance_at(db, start - timedelta(days=1)))
    report = await pnl(year=year, month=month, division=None, _=None, db=db)
    delta = round(closing["_retained"] - opening["_retained"], 2)
    gap = round(report["net"] - delta, 2)
    checks.append(_check(
        "profit_matches", abs(gap) < 1, "Прибыль ОФР = прирост нераспределённой прибыли",
        f"ОФР: {_money(report['net'])}; баланс: {_money(delta)}; "
        f"расхождение {_money(gap)} сум",
        level="warn",
    ))

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
