"""Финансовые отчёты: Cash Flow (ДДС), расходы по кодам, Дт-Кт ведомости,
ОФР (Форма №2), Баланс (Форма №1), обороты склада и ГП."""
import calendar
from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..ledger import (
    _rate_map,
    cash_opening,
    cash_position,
    fx_of,
    ledger_rows,
    loan_balances_at,
    opening_active,
    org_fx_documents,
    rate_on,
)
from ..periods import setting_value
from ..stock import stock_value_at
from ..rates import get_rates
from ..models import (
    BankAccount,
    CashRegister,
    CashflowCode,
    Division,
    Employee,
    ExchangeRate,
    ExpenseCode,
    Loan,
    LoanEntry,
    Material,
    MaterialIssue,
    MaterialReceipt,
    MaterialStock,
    Organization,
    PayrollEntry,
    Product,
    ProductStock,
    Production,
    Sale,
    Service,
    Tax,
    Transaction,
    User,
)
from ..periods import history_guard
from ..production import cost_parts
from ..security import require

router = APIRouter(
    prefix="/api/reports",
    tags=["reports"],
    # закрытые месяцы видны только с правом closing:history
    dependencies=[Depends(history_guard)],
)


def _period(stmt, year: int | None, month: int | None, col=None):
    """Filter by year/month on the given date column (default: Transaction.doc_date)."""
    col = col if col is not None else Transaction.doc_date
    if year:
        stmt = stmt.where(extract("year", col) == year)
    if month:
        stmt = stmt.where(extract("month", col) == month)
    return stmt


def _merge_divisions(rows: list[dict], numeric: tuple[str, ...]) -> list[dict]:
    """Свернуть строки складских отчётов по подразделениям в одну на номенклатуру."""
    merged: dict[str, dict] = {}
    for r in rows:
        key = f"{r['code']}|{r['name']}"
        tgt = merged.get(key)
        if tgt is None:
            merged[key] = {**r, "division": "все объекты"}
            continue
        for k in numeric:
            tgt[k] = round(tgt[k] + r[k], 3)
    return list(merged.values())


def _period_bounds(year: int | None, month: int | None) -> tuple[date | None, date | None]:
    """Первый и последний день отчётного периода (None = без ограничения)."""
    if not year:
        return None, None
    if month:
        last = calendar.monthrange(year, int(month))[1]
        return date(year, int(month), 1), date(year, int(month), last)
    return date(year, 1, 1), date(year, 12, 31)


@router.get("/cashflow")
async def cashflow(
    year: int | None = None,
    month: int | None = None,
    division: str | None = None,
    _: User = Depends(require("reports:view")),
    db: AsyncSession = Depends(get_db),
):
    """Лист «CASH FLOW»: по каждому коду ДДС — БАНК / КАССА / ВСЕГО (UZS и USD),
    по разделам (операционная / инвестиционная / финансовая), плюс остаток
    денежных средств на начало и конец периода.

    `division` даёт денежную позицию подразделения: обороты — помеченные этим
    объектом, входящий остаток — кассы этого объекта (банковские счета общие).
    """
    start, end = _period_bounds(year, month)
    opening = await cash_opening(db, start, division)

    def agg_stmt(*group_cols):
        stmt = select(
            *group_cols,
            func.coalesce(func.sum(Transaction.amount_uzs), 0),
            func.coalesce(func.sum(Transaction.amount_usd), 0),
        )
        if division:
            stmt = stmt.where(Transaction.division == division)
        return _period(stmt, year, month).group_by(*group_cols)

    # --- итоги по счетам ---
    acc = {a: {f"{d}_{c}": 0.0 for d in ("in", "out") for c in ("uzs", "usd")}
           for a in ("bank", "kassa")}
    stmt = agg_stmt(Transaction.account, Transaction.direction)
    for account, direction, uzs, usd in (await db.execute(stmt)).all():
        a = "bank" if account == "bank" else "kassa"
        side = "in" if direction == "income" else "out"
        acc[a][f"{side}_uzs"] += float(uzs or 0)
        acc[a][f"{side}_usd"] += float(usd or 0)

    # --- разрез по кодам ДДС ---
    cf_codes = (await db.execute(select(CashflowCode))).scalars().all()
    names = {c.code: c.name for c in cf_codes}
    acts = {c.code: (c.activity or "operating") for c in cf_codes}
    by_code: dict[str, dict] = {}
    stmt = agg_stmt(Transaction.cashflow_code, Transaction.account, Transaction.direction)
    for code, account, direction, uzs, usd in (await db.execute(stmt)).all():
        key = code or "—"
        row = by_code.setdefault(key, {
            "code": key, "name": names.get(key, "Без кода"),
            "activity": acts.get(key, "operating"),
            "bank_in": 0.0, "bank_out": 0.0, "kassa_in": 0.0, "kassa_out": 0.0,
            "bank_in_usd": 0.0, "bank_out_usd": 0.0, "kassa_in_usd": 0.0, "kassa_out_usd": 0.0,
            "in": 0.0, "out": 0.0, "in_usd": 0.0, "out_usd": 0.0,
        })
        pfx = "bank" if account == "bank" else "kassa"
        side = "in" if direction == "income" else "out"
        row[f"{pfx}_{side}"] += float(uzs or 0)
        row[f"{pfx}_{side}_usd"] += float(usd or 0)
        row[side] += float(uzs or 0)
        row[f"{side}_usd"] += float(usd or 0)

    for row in by_code.values():
        for k, v in list(row.items()):
            if isinstance(v, float):
                row[k] = round(v, 2)

    # --- итоги по разделам ДДС (операционная / инвестиционная / финансовая) ---
    sections = []
    for key, label in (
        ("operating", "ОПЕРАЦИОННАЯ ДЕЯТЕЛЬНОСТЬ"),
        ("investing", "ИНВЕСТИЦИОННАЯ ДЕЯТЕЛЬНОСТЬ"),
        ("financing", "ФИНАНСОВАЯ ДЕЯТЕЛЬНОСТЬ"),
    ):
        part = [r for r in by_code.values() if r["activity"] == key]
        sections.append({
            "key": key, "label": label,
            "in": round(sum(r["in"] for r in part), 2),
            "out": round(sum(r["out"] for r in part), 2),
            "net": round(sum(r["in"] - r["out"] for r in part), 2),
            "rows": sorted(part, key=lambda r: r["code"]),
        })

    def side(a: str) -> dict:
        o = acc[a]
        base_uzs = opening[f"{a}_uzs"]
        base_usd = opening[f"{a}_usd"]
        return {
            "open": base_uzs, "open_usd": base_usd,
            "in": round(o["in_uzs"], 2), "out": round(o["out_uzs"], 2),
            "in_usd": round(o["in_usd"], 2), "out_usd": round(o["out_usd"], 2),
            "end": round(base_uzs + o["in_uzs"] - o["out_uzs"], 2),
            "end_usd": round(base_usd + o["in_usd"] - o["out_usd"], 2),
        }

    bank, kassa = side("bank"), side("kassa")
    total = {
        k: round(bank[k] + kassa[k], 2)
        for k in ("open", "open_usd", "in", "out", "in_usd", "out_usd", "end", "end_usd")
    }
    # курсовая разница по деньгам — отдельная строка перед остатком на конец
    fx_line = 0.0
    if not division:
        fx = await fx_difference(year, month, None, db)
        r = fx["rate"] or 1
        for row_ in fx["rows"]:
            if "Денежные средства" in row_["name"]:
                fx_line += (row_["income"] - row_["loss"]) * r
    return {
        "period": {"start": start.isoformat() if start else None,
                   "end": end.isoformat() if end else None},
        "division": division or None,
        "bank": bank, "kassa": kassa, "total": total,
        "sections": sections,
        "fx": round(fx_line, 2),
        "by_code": sorted(by_code.values(), key=lambda x: x["code"]),
    }


@router.get("/cashflow-divisions")
async def cashflow_by_divisions(
    year: int | None = None,
    month: int | None = None,
    _: User = Depends(require("reports:view")),
    db: AsyncSession = Depends(get_db),
):
    """Свод ДДС по подразделениям: приход, расход и чистый поток каждого объекта.

    Строка «Без подразделения» — операции, у которых объект не указан; их сумма
    вместе с объектами даёт общий оборот по предприятию.
    """
    divs = (await db.execute(select(Division).order_by(Division.id))).scalars().all()
    rows = []
    for d in divs:
        data = await cashflow(year, month, d.name, None, db)
        t = data["total"]
        if t["in"] or t["out"]:
            rows.append({
                "division": d.name, "in": t["in"], "out": t["out"],
                "net": round(t["in"] - t["out"], 2),
                "sections": {s["key"]: s["net"] for s in data["sections"]},
            })

    total = await cashflow(year, month, None, None, db)
    named_in = sum(r["in"] for r in rows)
    named_out = sum(r["out"] for r in rows)
    rest_in = round(total["total"]["in"] - named_in, 2)
    rest_out = round(total["total"]["out"] - named_out, 2)
    if rest_in or rest_out:
        rows.append({
            "division": "Без подразделения", "in": rest_in, "out": rest_out,
            "net": round(rest_in - rest_out, 2), "sections": {},
        })
    return {"rows": rows, "total": total["total"]}


@router.get("/expenses")
async def expenses_by_code(
    year: int | None = None,
    month: int | None = None,
    division: str | None = None,
    with_zero: bool = False,
    _: User = Depends(require("reports:view")),
    db: AsyncSession = Depends(get_db),
):
    """Лист «ВСЕГО расходы»: по каждому коду — откуда пришла сумма и ВСЕГО.

    В книге строка кода собирается из ЧЕТЫРЁХ источников (см. формулу D6):

        SUMIFS('Расход сырья и запчастей'; код)   -> колонка «со склада»
      + SUMIFS('Полученные УСЛУГИ';        код)   -> колонка «услуги»
      + SUMIFS(БАНК;                       код)   -> колонка «банк»
      + SUMIFS(КАССА;                      код)   -> колонка «касса»

    Начисленная зарплата (оклад + ЕСП) деньгами не проходит, поэтому попадает
    в отдельную колонку «начислено» и суммируется только во ВСЕГО — ровно как
    строка 2012 в Excel.
    """
    codes = (await db.execute(select(ExpenseCode).order_by(ExpenseCode.code))).scalars().all()
    names = {c.code: c.name for c in codes}
    pnl = {c.code: (c.pnl_group or "admin") for c in codes}

    def blank(code: str, name: str) -> dict:
        return {
            "code": code, "name": name, "group": _group_of(code, pnl), "qty": 0,
            "bank_uzs": 0.0, "bank_usd": 0.0, "kassa_uzs": 0.0, "kassa_usd": 0.0,
            "stock_uzs": 0.0, "service_uzs": 0.0,
            "accrued_uzs": 0.0, "total_uzs": 0.0, "total_usd": 0.0,
        }

    by_code: dict[str, dict] = {c.code: blank(c.code, c.name) for c in codes}

    # --- деньги (БАНК / КАССА) ---
    stmt = select(
        Transaction.expense_code,
        Transaction.account,
        func.count(Transaction.id),
        func.coalesce(func.sum(Transaction.amount_uzs), 0),
        func.coalesce(func.sum(Transaction.amount_usd), 0),
    ).where(Transaction.direction == "expense")
    if division:
        stmt = stmt.where(Transaction.division == division)
    stmt = _not_salary_payment(stmt, await _salary_org_ids(db))
    stmt = stmt.group_by(Transaction.expense_code, Transaction.account)
    for code, account, qty, uzs, usd in (await db.execute(_period(stmt, year, month))).all():
        c = code or "—"
        row = by_code.setdefault(c, blank(c, names.get(c, "Без кода")))
        pfx = "bank" if account == "bank" else "kassa"
        row[f"{pfx}_uzs"] += float(uzs or 0)
        row[f"{pfx}_usd"] += float(usd or 0)
        row["qty"] += int(qty or 0)

    # --- списание ТМЦ со склада по коду расхода (лист «Расход сырья и запчастей») ---
    istmt = select(
        MaterialIssue.expense_code,
        func.coalesce(func.sum(MaterialIssue.cost_uzs), 0),
    ).group_by(MaterialIssue.expense_code)
    if division:
        istmt = istmt.where(MaterialIssue.division == division)
    for code, uzs in (await db.execute(_period(istmt, year, month, MaterialIssue.doc_date))).all():
        if not code:
            continue  # без кода списание никуда не относится (как SUMIFS в книге)
        row = by_code.setdefault(code, blank(code, names.get(code, "Без кода")))
        row["stock_uzs"] += float(uzs or 0)

    # --- полученные услуги по коду расхода (лист «Полученные УСЛУГИ») ---
    sstmt = select(
        Service.expense_code,
        func.coalesce(func.sum(Service.net), 0),
    ).where(Service.direction == "received").group_by(Service.expense_code)
    if division:
        sstmt = sstmt.where(Service.division == division)
    for code, uzs in (await db.execute(_period(sstmt, year, month, Service.doc_date))).all():
        if not code:
            continue
        row = by_code.setdefault(code, blank(code, names.get(code, "Без кода")))
        row["service_uzs"] += float(uzs or 0)

    # --- начисленная зарплата: сама зарплата и налоги идут РАЗНЫМИ строками ---
    # На код сотрудника ложится только зарплата (начислено − НДФЛ − ИНПС, то есть
    # то, что человек получает), а НДФЛ / ЕСП / ИНПС — на свои коды внутри той же
    # строки ОФР. Иначе всё сваливалось бы в 2012, а налоговые строки пустовали.
    tax_codes = await _salary_tax_codes(db)
    pstmt = select(
        Employee.expense_code,
        func.coalesce(func.sum(PayrollEntry.gross), 0),
        func.coalesce(func.sum(PayrollEntry.ndfl), 0),
        func.coalesce(func.sum(PayrollEntry.inps), 0),
        func.coalesce(func.sum(PayrollEntry.esp), 0),
    ).join(Employee, Employee.id == PayrollEntry.employee_id).group_by(Employee.expense_code)
    if year and month:
        pstmt = pstmt.where(PayrollEntry.period == f"{year}-{int(month):02d}")
    if division:
        pstmt = pstmt.where(Employee.division == division)

    def put(code: str, amount: float, fallback: str):
        if not code or not amount:
            return
        r = by_code.setdefault(code, blank(code, names.get(code, fallback)))
        r["accrued_uzs"] += round(float(amount), 2)

    for code, gross, ndfl, inps, esp in (await db.execute(pstmt)).all():
        c = code or "2012"
        gross, ndfl, inps, esp = (float(x or 0) for x in (gross, ndfl, inps, esp))
        slots = tax_codes.get(_group_of(c, pnl), {})
        # НДФЛ и ИНПС удержаны ИЗ начисленного, поэтому строку зарплаты на них
        # уменьшаем — сумма по всем строкам остаётся равной расходу на сотрудника
        put(c, gross - ndfl - inps, "Зарплата")
        put(slots.get("ndfl", ""), ndfl, "НДФЛ")
        put(slots.get("esp", ""), esp, "ЕСП")
        put(slots.get("inps", ""), inps, "ИНПС")

    parts = ("bank_uzs", "bank_usd", "kassa_uzs", "kassa_usd",
             "stock_uzs", "service_uzs", "accrued_uzs")
    groups = {k: 0.0 for k in PNL_GROUPS}
    totals = {k: 0.0 for k in parts + ("total_uzs", "total_usd")}
    for row in by_code.values():
        row["total_uzs"] = round(
            row["bank_uzs"] + row["kassa_uzs"] + row["stock_uzs"]
            + row["service_uzs"] + row["accrued_uzs"], 2
        )
        row["total_usd"] = round(row["bank_usd"] + row["kassa_usd"], 2)
        row["skip"] = row["group"] in PNL_SKIP
        for k in parts:
            row[k] = round(row[k], 2)
        if row["skip"]:
            # итоговая строка книги / покупка ТМЗ — показываем, но не суммируем
            continue
        for k in parts:
            totals[k] += row[k]
        totals["total_uzs"] += row["total_uzs"]
        totals["total_usd"] += row["total_usd"]
        groups[row["group"]] += row["total_uzs"]

    rows = sorted(by_code.values(), key=lambda r: r["code"])
    if not with_zero:
        rows = [r for r in rows if r["total_uzs"]]

    groups["period"] = groups["sell"] + groups["admin"] + groups["other"]
    groups["total"] = groups["prod"] + groups["period"]
    return {
        "rows": rows,
        "groups": {k: round(v, 2) for k, v in groups.items()},
        "totals": {k: round(v, 2) for k, v in totals.items()},
        # совместимость со старым фронтом
        "items": [
            {"code": r["code"], "name": r["name"], "amount": r["total_uzs"]}
            for r in sorted(rows, key=lambda r: -r["total_uzs"])
        ],
    }


PNL_GROUPS = ("prod", "sell", "admin", "other", "financial", "extraordinary",
              "profit_tax", "income", "subtotal", "asset")

# Группы, которые НЕ участвуют в расчётах:
#   subtotal — итоговая строка книги (2010, 9410, 9420, 9430): она равна сумме
#              своих подстатей, поэтому её нельзя складывать с ними;
#   asset    — 2011 «Стоимость приобретенных ТМЗ»: стоимость запасов приходит
#              в себестоимость через склад, прямой суммой это был бы двойной счёт.
# Именно так устроена книга: 2010 = SUM(2012..2035), 2011 в неё не входит.
PNL_SKIP = ("subtotal", "asset")

_PNL_CACHE: dict[str, str] = {}


async def _salary_org_ids(db: AsyncSession) -> list[int]:
    """Контрагенты «Ойлик(ОБЪЕКТ)» — на них гасится долг по зарплате."""
    res = await db.execute(select(Organization.id).where(Organization.ledger == "salary"))
    return list(res.scalars().all())


def _not_salary_payment(stmt, ids: list[int]):
    """Выплата зарплаты — погашение долга, а не расход периода.

    Сам расход уже начислен по ведомости («оклад + ЕСП» из модуля «Зарплата»),
    поэтому выдача денег на «Ойлик(ОБЪЕКТ)» второй раз в ОФР идти не должна —
    иначе одна и та же зарплата попадёт и в 060, и в начисления.
    """
    if not ids:
        return stmt
    return stmt.where(
        (Transaction.organization_id.is_(None)) | (Transaction.organization_id.not_in(ids))
    )


async def _salary_tax_codes(db: AsyncSession) -> dict[str, dict[str, str]]:
    """Для каждой строки ОФР — свои коды НДФЛ / ЕСП / ИНПС.

    В книге налоги с зарплаты лежат отдельными строками рядом с самой
    зарплатой: 2012 → 2013/2014/2015, 94101 → 94103/94104/94105,
    94201 → 94202/94203/94204. Ищем по названию внутри группы, а не по
    номеру: нумерация в блоках разная.
    """
    rows = (await db.execute(
        select(ExpenseCode.code, ExpenseCode.name, ExpenseCode.pnl_group)
        .order_by(ExpenseCode.code)
    )).all()
    out: dict[str, dict[str, str]] = {}
    for code, name, group in rows:
        n = (name or "").lower()
        if "ндфл" in n or "доходы физ" in n:
            slot = "ndfl"
        elif "есп" in n or "социальн" in n:
            slot = "esp"
        elif "инпс" in n:
            slot = "inps"
        else:
            continue
        out.setdefault(group or "admin", {}).setdefault(slot, code)
    return out


async def _pnl_map(db: AsyncSession) -> dict[str, str]:
    """Код статьи -> строка ОФР. Задаётся в справочнике «Статьи расходов»."""
    rows = (await db.execute(select(ExpenseCode.code, ExpenseCode.pnl_group))).all()
    return {c: (g or "admin") for c, g in rows}


def _group_of(code: str, mapping: dict[str, str] | None = None) -> str:
    """Строка ОФР для статьи. Без кода (напр. зарплата) -> административные."""
    c = code or ""
    if mapping is not None and c in mapping:
        return mapping[c]
    # запасной вариант — по префиксу плана счетов
    if c.startswith("20"):
        return "prod"
    if c.startswith("941"):
        return "sell"
    if c.startswith("942"):
        return "admin"
    if c.startswith(("96", "681")):
        return "financial"
    if c.startswith("943"):
        return "other"
    return "admin"


async def _payroll_groups(db: AsyncSession, year, month, division=None,
                          mapping: dict[str, str] | None = None) -> dict:
    """Начисленная зарплата (gross + ЕСП) по группам, из модуля «Зарплата»."""
    g = {k: 0.0 for k in PNL_GROUPS}
    stmt = select(PayrollEntry.gross, PayrollEntry.esp, Employee.expense_code).join(
        Employee, Employee.id == PayrollEntry.employee_id
    )
    if year and month:
        stmt = stmt.where(PayrollEntry.period == f"{year}-{int(month):02d}")
    if division:
        stmt = stmt.where(Employee.division == division)
    for gross, esp, code in (await db.execute(stmt)).all():
        grp = _group_of(code, mapping)
        if grp in PNL_SKIP:
            grp = "prod"  # зарплата не может «висеть» на итоговой строке
        g[grp] += float(gross or 0) + float(esp or 0)
    return g


async def _expense_groups_uzs(db: AsyncSession, year, month, division=None) -> dict:
    """Расходы и прочие доходы по строкам ОФР (в сумах)."""
    mapping = await _pnl_map(db)
    g = {k: 0.0 for k in PNL_GROUPS}

    stmt = select(
        Transaction.expense_code,
        Transaction.direction,
        func.coalesce(func.sum(Transaction.amount_uzs), 0),
    )
    if division:
        stmt = stmt.where(Transaction.division == division)
    stmt = _not_salary_payment(stmt, await _salary_org_ids(db))
    stmt = stmt.group_by(Transaction.expense_code, Transaction.direction)
    for code, direction, v in (await db.execute(_period(stmt, year, month))).all():
        if not code:
            # в книге это SUMIFS по коду: строка без кода не попадает никуда
            # (как и для списания ТМЦ/услуг ниже) — не превращать её в «прочий
            # административный расход» умолчанием _group_of
            continue
        grp = _group_of(code, mapping)
        amount = float(v or 0)
        if grp in PNL_SKIP:
            continue  # итоговая строка или покупка ТМЗ — в ОФР не идут
        if direction == "income":
            # приход попадает в ОФР только как «прочие доходы» (стр. 090)
            if grp == "income":
                g["income"] += amount
            continue
        if grp == "income":
            continue  # статья доходов, но расходная операция — в ОФР не берём
        g[grp] += amount

    # списание ТМЦ со склада и полученные услуги — в книге они входят
    # в ту же строку кода, что и деньги (см. формулу листа «ВСЕГО расходы»)
    for model, col, extra in (
        (MaterialIssue, MaterialIssue.cost_uzs, None),
        (Service, Service.net, Service.direction == "received"),
    ):
        stmt = select(model.expense_code, func.coalesce(func.sum(col), 0))
        if extra is not None:
            stmt = stmt.where(extra)
        if division:
            stmt = stmt.where(model.division == division)
        stmt = stmt.group_by(model.expense_code)
        for code, v in (await db.execute(_period(stmt, year, month, model.doc_date))).all():
            if not code:
                # в книге это SUMIFS по коду: строка без кода не попадает никуда.
                # Списание сырья без кода — это расход в производство, и делать
                # из него административный расход (умолчание _group_of) нельзя.
                continue
            grp = _group_of(code, mapping)
            if grp in PNL_SKIP or grp == "income":
                continue
            g[grp] += float(v or 0)

    # начисленная зарплата (оклад + ЕСП) тоже расход периода
    pg = await _payroll_groups(db, year, month, division, mapping)
    for k in PNL_GROUPS:
        if k != "income":
            g[k] += pg[k]

    g["period"] = g["sell"] + g["admin"] + g["other"]
    return g


# ================= Дт-Кт ведомости (counterparties) =================
@router.get("/counterparties")
async def counterparties(
    category: str | None = None,
    ledger: str | None = None,
    year: int | None = None,
    month: int | None = None,
    _: User = Depends(require("reports:view")),
    db: AsyncSession = Depends(get_db),
):
    """Сводная ведомость Дт-Кт: начало / оборот / конец по каждому контрагенту."""
    start, end = _period_bounds(year, month)
    data = await ledger_rows(db, ledger, start, end)
    if category:
        data["rows"] = [r for r in data["rows"] if r["category"] == category]
        keys = data["totals"].keys()
        data["totals"] = {
            k: round(sum(r[k] for r in data["rows"]), 2) for k in keys
        }
    return data


# ================= ОФР (Форма №2) =================
@router.get("/pnl")
async def pnl(
    year: int | None = None,
    month: int | None = None,
    division: str | None = None,
    _: User = Depends(require("reports:view")),
    db: AsyncSession = Depends(get_db),
):
    """Отчёт о финансовых результатах — Форма №2 (в сумах).

    Цепочка строк как в бланке:
        030 = 010 − 020                       валовая прибыль
        040 = 050 + 060 + 070                 расходы периода
        100 = 030 − 040 + 090                 прибыль от основной деятельности
        220 = 100 + 120 − 130                 прибыль от общехозяйственной
        240 = 220 ± 230                       прибыль до налога
        270 = 240 − 250 − 260                 чистая прибыль

    Курсовая разница входит в 120 (доходы) и 130 (убытки) — как в книге.
    `division` даёт ОФР по подразделению (листы «ОФР Махстон/Турк/Жби»).
    """
    sstmt = select(
        func.coalesce(func.sum(Sale.revenue_net), 0),
        func.coalesce(func.sum(Sale.vat_amount), 0),
    )
    if division:
        sstmt = sstmt.where(Sale.division == division)
    revenue, vat = (await db.execute(_period(sstmt, year, month, Sale.doc_date))).one()
    revenue, vat = float(revenue), float(vat)

    # 020 берём из «ГП оборот» (колонка P), как в книге: ='ГП оборот'!P5.
    # Это средневзвешенная за период, а не сумма с/с по каждому документу.
    turn = await gp_turnover(year=year, month=month, division=division,
                             by_division=False, _=None, db=db)
    cogs = round(sum(r["sold_val"] for r in turn["rows"]), 2)

    g = await _expense_groups_uzs(db, year, month, division)
    gross = revenue - cogs                                    # 030
    other_income = g["income"]                                # 090
    op_profit = gross - g["period"] + other_income            # 100

    # --- финансовая деятельность (120 / 130) ---
    # курсовая разница — величина общефирменная, по подразделениям не делится
    # (в книге листы «ОФР Махстон/Турк/Жби» финансового раздела не содержат)
    fx_income = fx_loss = 0.0
    if not division:
        fx = await fx_difference(year, month, None, db)
        rate = fx["rate"] or 1
        fx_income = round(fx["total_income"] * rate, 2)        # отчёт в USD -> сумы
        fx_loss = round(fx["total_loss"] * rate, 2)
    fin_expense = g["financial"]
    fin_income = fx_income
    fin_loss = fin_expense + fx_loss

    gh_profit = op_profit + fin_income - fin_loss              # 220
    extraordinary = -g["extraordinary"]                        # 230 (убыток -> минус)
    before_tax = gh_profit + extraordinary                     # 240

    # Налог на прибыль (250): ТОЛЬКО начисленное в модуле «Налоги».
    # Автоподстановка по ставке убрана — налог считает бухгалтер, как земельный
    # и прочие налоги. Не начислено — в отчёте ноль, а не расчётная величина.
    tax = float(
        await db.scalar(
            select(func.coalesce(func.sum(Tax.accrued), 0)).where(Tax.name.ilike("%прибыль%"))
        )
        or 0
    )
    other_taxes = g["profit_tax"]                              # 260
    net = before_tax - tax - other_taxes                        # 270

    return {
        "revenue": round(revenue, 2), "vat": round(vat, 2),
        "cogs": round(cogs, 2), "gross": round(gross, 2),
        "prod_expenses": round(g["prod"], 2),
        "sell": round(g["sell"], 2), "admin": round(g["admin"], 2), "other": round(g["other"], 2),
        "period": round(g["period"], 2),
        "other_income": round(other_income, 2),
        "op_profit": round(op_profit, 2),
        "fin_income": round(fin_income, 2),
        "fx_income": fx_income, "fx_loss": fx_loss,
        "fin_expense": round(fin_expense, 2),
        "fin_loss": round(fin_loss, 2),
        "gh_profit": round(gh_profit, 2),
        "extraordinary": round(extraordinary, 2),
        "before_tax": round(before_tax, 2),
        "tax": round(tax, 2), "other_taxes": round(other_taxes, 2),
        "net": round(net, 2),
        "gross_margin": round(gross / revenue * 100, 1) if revenue else 0,
        "net_margin": round(net / revenue * 100, 1) if revenue else 0,
    }


@router.get("/pnl-divisions")
async def pnl_by_divisions(
    year: int | None = None,
    month: int | None = None,
    _: User = Depends(require("reports:view")),
    db: AsyncSession = Depends(get_db),
):
    """Свод ОФР по подразделениям — как строки Мачстон / Жби / Турк в книге."""
    divs = (await db.execute(select(Division).order_by(Division.id))).scalars().all()
    rows = []
    for d in divs:
        data = await pnl(year, month, d.name, None, db)
        if data["revenue"] or data["cogs"] or data["period"]:
            rows.append({"division": d.name, **data})
    total = await pnl(year, month, None, None, db)
    return {"rows": rows, "total": total}


# ================= Налоги (авто-расчёт, как в Excel) =================
NDS_RATE = 0.12
# коды оплаты по видам налогов (для «оплачено» из операций)
TAX_PAY_CODES = {
    "НДС": ["94321"],
    "Налог на прибыль": ["94319"],
    "НДФЛ": ["2013", "94103", "94203"],
    "ЕСП": ["2014", "94104", "94204"],
    "ИНПС": ["2015", "94105", "94205"],
    "Земельный налог": ["94322"],
    "Прочие налоги": ["94323"],
}


@router.get("/taxes")
async def taxes_report(
    year: int | None = None,
    month: int | None = None,
    _: User = Depends(require("taxes:view")),
    db: AsyncSession = Depends(get_db),
):
    return await _taxes_core(db, year, month)


async def _taxes_core(db: AsyncSession, year, month, on: date | None = None):
    """Авто-расчёт налогов: начислено — из операций (как формулы Excel), долг = нач + начислено − оплачено.

    Два режима:
      · `year`/`month` — отчёт ЗА ПЕРИОД (начислено и оплачено внутри месяца);
      · `on` — состояние НА ДАТУ, нарастающим итогом с начала учёта. Балансу
        нужен именно он: неоплаченный июньский налог обязан висеть в июльском
        балансе, а раньше туда попадали только начисления самого июля.
    """
    rates = await get_rates(db)

    async def s(stmt, col):
        if on is not None:
            return float(await db.scalar(stmt.where(col <= on)) or 0)
        return float(await db.scalar(_period(stmt, year, month, col)) or 0)

    # --- НДС = выходной НДС − входной НДС ---
    out_vat = await s(select(func.coalesce(func.sum(Sale.vat_amount), 0)), Sale.doc_date)
    out_vat += await s(select(func.coalesce(func.sum(Service.vat_amount), 0)).where(Service.direction == "provided"), Service.doc_date)
    in_vat = await s(select(func.coalesce(func.sum(Service.vat_amount), 0)).where(Service.direction == "received"), Service.doc_date)
    recv_net = await s(select(func.coalesce(func.sum(MaterialReceipt.amount_uzs), 0)).where(MaterialReceipt.vat.is_(True)), MaterialReceipt.doc_date)
    in_vat += round(recv_net * rates["nds_rate"], 2)
    nds_accrued = round(out_vat - in_vat, 2)

    # --- зарплатные налоги ---
    pstmt = select(
        func.coalesce(func.sum(PayrollEntry.ndfl), 0),
        func.coalesce(func.sum(PayrollEntry.inps), 0),
        func.coalesce(func.sum(PayrollEntry.esp), 0),
    )
    if on is not None:
        pstmt = pstmt.where(PayrollEntry.period <= f"{on.year}-{on.month:02d}")
    elif year and month:
        pstmt = pstmt.where(PayrollEntry.period == f"{year}-{int(month):02d}")
    ndfl_a, inps_a, esp_a = (await db.execute(pstmt)).one()
    ndfl_a, inps_a, esp_a = float(ndfl_a), float(inps_a), float(esp_a)

    # Налог на прибыль СЧИТАЕТСЯ ВРУЧНУЮ — как земельный и прочие налоги:
    # начисление берётся из карточки налога, автоподстановки 15% больше нет.
    accrued_map = {
        "НДС": nds_accrued,
        "НДФЛ": ndfl_a,
        "ЕСП": esp_a,
        "ИНПС": inps_a,
    }

    # оплачено — из операций по кодам оплаты
    async def paid_of(name: str) -> float:
        codes = TAX_PAY_CODES.get(name, [])
        if not codes:
            return 0.0
        stmt = select(func.coalesce(func.sum(Transaction.amount_uzs), 0)).where(
            Transaction.direction == "expense", Transaction.expense_code.in_(codes)
        )
        return await s(stmt, Transaction.doc_date)

    p_start, p_end = (None, on) if on is not None else _period_bounds(year, month)
    taxes = (await db.execute(select(Tax).order_by(Tax.id))).scalars().all()
    rows = []
    tot = {"start": 0.0, "accrued": 0.0, "paid": 0.0, "end": 0.0}
    for t in taxes:
        # начислено: авто, если известен вид; иначе ручное значение
        acc_auto = None
        for key, val in accrued_map.items():
            if key.lower() in t.name.lower():
                acc_auto = val
                break
        # ручные суммы попадают только в тот период, где стоит их дата
        manual_in_period = (
            (p_start is None or (t.accrued_date and t.accrued_date >= p_start))
            and (p_end is None or (t.accrued_date and t.accrued_date <= p_end))
        )
        # авто-начисление уже собрано по датам первичных документов
        accrued = acc_auto if acc_auto is not None else (
            float(t.accrued or 0) if manual_in_period else 0.0
        )
        paid = await paid_of(t.name)          # по дате платёжной операции
        if paid == 0 and manual_in_period:
            paid = float(t.paid or 0)         # запасной вариант — ручное
        # долг на начало — по той же дате: до неё его ещё не было
        start = float(t.debt_start or 0) if opening_active(t.accrued_date, p_end) else 0.0
        end = round(start + accrued - paid, 2)
        rows.append({
            "id": t.id, "name": t.name, "debt_start": start,
            "accrued_date": t.accrued_date.isoformat() if t.accrued_date else None,
            "accrued": round(accrued, 2), "auto": acc_auto is not None,
            "paid": round(paid, 2), "debt_end": max(end, 0), "overpay": max(-end, 0),
        })
        tot["start"] += start; tot["accrued"] += accrued; tot["paid"] += paid; tot["end"] += max(end, 0)
    return {"rows": rows, "totals": {k: round(v, 2) for k, v in tot.items()}}


# ================= Курсовая разница (переоценка по последнему курсу) =================
@router.get("/fx-difference")
async def fx_difference(
    year: int | None = None,
    month: int | None = None,
    _: User = Depends(require("reports:view")),
    db: AsyncSession = Depends(get_db),
):
    """Лист «Курсовая разница» (в долларах США), методика книги:

    · задолженность — переоценка сальдо КАЖДОГО контрагента на конец периода:
      сумма в сумах / курс на конец − накопленная валютная сумма;
      доходы и убытки суммируются раздельно по строкам, а не сальдируются;
    · деньги — ежедневная переоценка остатка, как колонки «Курсовая разница в $»
      листа «ОСТАТОК UZS»: остаток на конец вчера × (1/курс сегодня − 1/курс вчера);
    · займы — валютная база берётся по курсу на дату каждого движения.
    """
    start, end = _period_bounds(year, month)
    rates, last_rate = await _rate_map(db)
    rate_end = rate_on(rates, end, last_rate) if end else last_rate

    # ---- 1. дебиторская и кредиторская задолженность (построчно) ----
    led = await ledger_rows(db, None, start, end)
    org_income = led["totals"]["fx_income"]
    org_loss = led["totals"]["fx_loss"]

    # ---- 2-3. деньги: ежедневная переоценка остатка ----
    async def money_fx(account: str) -> tuple[float, float]:
        opening = await cash_opening(db, start)
        balance = opening["bank_uzs"] if account == "bank" else opening["kassa_uzs"]

        stmt = select(
            Transaction.doc_date,
            Transaction.direction,
            func.coalesce(func.sum(Transaction.amount_uzs), 0),
        ).where(Transaction.account == account).group_by(
            Transaction.doc_date, Transaction.direction
        )
        moves: dict[date, float] = {}
        for d, direction, uzs in (await db.execute(_period(stmt, year, month))).all():
            moves[d] = moves.get(d, 0.0) + (1 if direction == "income" else -1) * float(uzs or 0)

        if not (start and end):
            return 0.0, 0.0
        income = loss = 0.0
        day = start
        while day <= end:
            prev = day - timedelta(days=1)
            r_now, r_prev = rate_on(rates, day, last_rate), rate_on(rates, prev, last_rate)
            if r_now and r_prev and r_now != r_prev:
                fx = balance / r_now - balance / r_prev
                income += max(fx, 0)
                loss += abs(min(fx, 0))
            balance += moves.get(day, 0.0)
            day += timedelta(days=1)
        return round(income, 2), round(loss, 2)

    bank_income, bank_loss = await money_fx("bank")
    kassa_income, kassa_loss = await money_fx("kassa")

    # ---- 4-5. займы: валютная база по курсу на дату движения ----
    async def loans_fx(direction: str) -> tuple[float, float]:
        loans = (
            await db.execute(select(Loan).where(Loan.direction == direction))
        ).scalars().all()
        if not loans:
            return 0.0, 0.0
        entries: dict[int, list] = {}
        for lid, d, kind, amount in (
            await db.execute(
                select(LoanEntry.loan_id, LoanEntry.doc_date, LoanEntry.kind, LoanEntry.amount_uzs)
            )
        ).all():
            entries.setdefault(lid, []).append((d, kind, float(amount or 0)))

        income = loss = 0.0
        for l in loans:
            if (l.currency or "UZS") == "USD":
                continue  # займ уже в долларах — переоценивать нечего
            # сальдо займа берём по его собственной дате: и сумму, и курс
            uzs = float(l.opening_uzs or 0) if opening_active(l.opening_date, end) else 0.0
            base_day = l.opening_date or start
            usd = uzs / rate_on(rates, base_day, last_rate) if base_day else uzs / last_rate
            for d, kind, amount in entries.get(l.id, []):
                if end and d > end:
                    continue
                sign = 1 if kind == "debit" else -1
                uzs += sign * amount
                usd += sign * amount / rate_on(rates, d, last_rate)
            fx = fx_of(uzs, usd, rate_end)
            income += max(fx, 0)
            loss += abs(min(fx, 0))
        return round(income, 2), round(loss, 2)

    given = await loans_fx("given")
    taken = await loans_fx("received")

    def row(name, income, loss):
        return {"name": name, "income": round(income, 2), "loss": round(loss, 2)}

    rows = [
        row("Дебиторская и кредиторская задолженность", org_income, org_loss),
        row("Денежные средства на расчетном счете", bank_income, bank_loss),
        row("Денежные средства в кассе", kassa_income, kassa_loss),
        row("Выданные займы", *given),
        row("Полученные займы", *taken),
    ]

    # дыры в таблице курсов: подтягивается последний известный курс, и если он
    # из другого месяца — переоценка получится абсурдной. Лучше предупредить.
    warnings: list[str] = []
    if start and end:
        missing = [
            start + timedelta(days=i)
            for i in range((end - start).days + 1)
            if (start + timedelta(days=i)) not in rates
        ]
        base = start - timedelta(days=1)
        if base not in rates:
            warnings.append(
                f"Не задан курс на {base.strftime('%d.%m.%Y')} — день перед началом периода. "
                "С него считается переоценка первого дня."
            )
        if missing:
            warnings.append(
                f"Нет курса за {len(missing)} дн. периода "
                f"(например, {missing[0].strftime('%d.%m.%Y')}) — берётся последний известный."
            )

    return {
        "rate": rate_end,
        "currency": "USD",
        "rows": rows,
        "warnings": warnings,
        "total_income": round(sum(r["income"] for r in rows), 2),
        "total_loss": round(sum(r["loss"] for r in rows), 2),
        "net": round(sum(r["income"] - r["loss"] for r in rows), 2),
    }


@router.get("/fx-difference/documents")
async def fx_difference_documents(
    year: int | None = None,
    month: int | None = None,
    _: User = Depends(require("reports:view")),
    db: AsyncSession = Depends(get_db),
):
    """Расшифровка курсовой разницы по задолженности — до каждого документа.

    Строка «Дебиторская и кредиторская задолженность» сводного отчёта здесь
    разложена: контрагент → его документы → вклад каждого в переоценку.
    Сумма вкладов по контрагенту равна его курсовой разнице в ведомости Дт-Кт.

    Деньги и займы сюда не входят: они переоцениваются не по документам,
    а ежедневно (остаток) и по курсу на дату движения соответственно.
    """
    start, end = _period_bounds(year, month)
    rates, last_rate = await _rate_map(db)
    rate_end = rate_on(rates, end, last_rate) if end else last_rate
    orgs = await org_fx_documents(db, start, end)
    income = sum(o["fx"] for o in orgs if o["fx"] > 0)
    loss = sum(-o["fx"] for o in orgs if o["fx"] < 0)
    return {
        "rate": rate_end,
        "currency": "USD",
        "orgs": orgs,
        "totals": {
            "income": round(income, 2),
            "loss": round(loss, 2),
            "net": round(income - loss, 2),
            "docs": sum(len(o["docs"]) for o in orgs),
        },
    }


# ================= Займы (лист «Займы») =================
@router.get("/loans")
async def loans_report(
    year: int | None = None,
    month: int | None = None,
    _: User = Depends(require("loans:view")),
    db: AsyncSession = Depends(get_db),
):
    """Ведомость по займам: начало / оборот (выдача-погашение) / конец."""
    start, end = _period_bounds(year, month)
    loans = (await db.execute(select(Loan).order_by(Loan.id))).scalars().all()

    before: dict[int, float] = {}
    turn: dict[int, dict[str, float]] = {}
    for lid, kind, d, amount in (
        await db.execute(
            select(LoanEntry.loan_id, LoanEntry.kind, LoanEntry.doc_date, LoanEntry.amount_uzs)
        )
    ).all():
        v = float(amount or 0)
        sign = 1 if kind == "debit" else -1
        if end and d > end:
            continue
        if start and d < start:
            before[lid] = before.get(lid, 0.0) + sign * v
            continue
        t = turn.setdefault(lid, {"debit": 0.0, "credit": 0.0})
        t["debit" if kind == "debit" else "credit"] += v

    rows = []
    tot = {k: 0.0 for k in ("open_debit", "open_credit", "turn_debit", "turn_credit",
                            "end_debit", "end_credit")}
    for l in loans:
        live = opening_active(l.opening_date, end)
        opening = (float(l.opening_uzs or 0) if live else 0.0) + before.get(l.id, 0.0)
        t = turn.get(l.id, {"debit": 0.0, "credit": 0.0})
        closing = opening + t["debit"] - t["credit"]
        d = {
            "id": l.id, "name": l.counterparty or "—", "direction": l.direction,
            "currency": l.currency,
            "open_debit": round(max(opening, 0), 2), "open_credit": round(abs(min(opening, 0)), 2),
            "turn_debit": round(t["debit"], 2), "turn_credit": round(t["credit"], 2),
            "end_debit": round(max(closing, 0), 2), "end_credit": round(abs(min(closing, 0)), 2),
        }
        rows.append(d)
        for k in tot:
            tot[k] += d[k]
    return {"rows": rows, "totals": {k: round(v, 2) for k, v in tot.items()}}


# ================= Баланс (Форма №1) =================
async def _balance_at(db: AsyncSession, on: date | None) -> dict:
    """Показатели баланса на дату (None = на текущий момент).

    ВСЁ здесь считается именно НА ДАТУ. Раньше часть показателей бралась «как
    сейчас» (склад, займы, ОС/капитал), и колонка «на начало периода» показывала
    сегодняшние остатки, а закрытый месяц менялся от каждого нового документа.
    """
    money = await cash_position(db, on)
    kassa, bank = money["kassa_uzs"], money["bank_uzs"]

    # --- запасы: реплей движений по дату (см. app/stock.py) ---
    stock = await stock_value_at(db, on)
    raw_val, spare_val, gp_val = stock["raw"], stock["spare"], stock["gp"]

    # --- расчёты с контрагентами по видам ведомостей ---
    led = await ledger_rows(db, None, None, on)
    by_ledger: dict[str, dict[str, float]] = {}
    for r in led["rows"]:
        b = by_ledger.setdefault(r["ledger"], {"dt": 0.0, "kt": 0.0})
        b["dt"] += r["end_debit"]
        b["kt"] += r["end_credit"]

    def L(ledger: str, side: str) -> float:
        return by_ledger.get(ledger, {}).get(side, 0.0)

    def L_many(ledgers, side: str) -> float:
        return sum(L(x, side) for x in ledgers)

    # --- налоги и займы ---
    # налоги — нарастающим итогом НА ДАТУ, а не за месяц: в балансе висит вся
    # неоплаченная задолженность, включая начисленную в прошлых месяцах
    tax_data = await _taxes_core(db, None, None, on=on)
    tax_debt = float(tax_data["totals"]["end"])
    tax_overpay = float(sum(r["overpay"] for r in tax_data["rows"]))
    loans = await loan_balances_at(db, on)
    loan_taken, loan_given = loans["taken"], loans["given"]

    # --- собственный капитал и долгосрочные активы ---
    # значение берётся то, что действовало НА ЭТУ ДАТУ (см. app/periods.py):
    # износ обновляют каждый месяц, и без этого прошлый баланс «уезжал».
    async def setting(key: str) -> float:
        return await setting_value(db, key, on)

    fa = await setting("fa_cost")
    fa_dep = await setting("fa_depreciation")
    ia = await setting("ia_cost")
    ia_dep = await setting("ia_depreciation")
    equip = await setting("equipment_install")
    cap_charter = await setting("capital_charter")
    cap_added = await setting("capital_added")
    cap_reserve = await setting("capital_reserve")

    return {
        "fa": fa, "fa_dep": fa_dep, "fa_net": fa - fa_dep,
        "ia": ia, "ia_dep": ia_dep, "ia_net": ia - ia_dep,
        "equip": equip,
        "raw": raw_val, "spare": spare_val, "gp": gp_val,
        "rbp": L("rbp", "dt"),
        "dt_customers": L("customers", "dt"),
        "dt_office": L("office", "dt"),
        "dt_safe": L("safe", "dt"),
        "dt_salary": L("salary", "dt"),
        "dt_suppliers": L("suppliers", "dt"),
        "dt_tax": tax_overpay,
        "dt_other": L_many(("services", "other"), "dt"),
        "kassa": kassa, "bank": bank,
        "loan_given": loan_given, "loan_taken": loan_taken,
        "kt_customers": L("customers", "kt"),
        "kt_office": L("office", "kt"),
        "kt_suppliers": L("suppliers", "kt"),
        "kt_safe": L("safe", "kt"),
        "kt_salary": L("salary", "kt"),
        "kt_services": L_many(("services", "other", "rbp"), "kt"),
        "tax_debt": tax_debt,
        "cap_charter": cap_charter, "cap_added": cap_added, "cap_reserve": cap_reserve,
    }


# бланк Формы №1: (код, наименование, ключ показателя | None, уровень)
BALANCE_ASSETS = [
    ("", "I. ДОЛГОСРОЧНЫЕ АКТИВЫ", None, 0),
    ("010", "Основные средства: первоначальная стоимость (0100; 0300)", "fa", 1),
    ("011", "Сумма износа (0200)", "fa_dep", 1),
    ("012", "Остаточная (балансовая) стоимость (010−011)", "fa_net", 1),
    ("020", "Нематериальные активы (0400)", "ia", 1),
    ("021", "Сумма износа (0500)", "ia_dep", 1),
    ("022", "Остаточная (балансовая) стоимость (020−021)", "ia_net", 1),
    ("090", "Оборудование к установке (0700)", "equip", 1),
    ("130", "Итого по разделу I", "_total_fixed", 0),
    ("", "II. ТЕКУЩИЕ АКТИВЫ", None, 0),
    ("140", "Товарно-материальные запасы, всего", "_inventory", 0),
    ("150", "Производственные запасы (материал)", "raw", 1),
    ("160", "Производственные запасы (запчасти)", "spare", 1),
    ("170", "Готовая продукция (2800)", "gp", 1),
    ("190", "Расходы будущих периодов (3100)", "rbp", 0),
    ("210", "Дебиторы, всего", "_debtors", 0),
    ("220", "Задолженность покупателей и заказчиков (4010)", "dt_customers", 1),
    ("230", "Задолженность обособленных подразделений (4110) (Офис)", "dt_office", 1),
    ("240", "Задолженность дочерних и зависимых обществ (4120)", "dt_safe", 1),
    ("250", "Авансы, выданные персоналу (4200)", "dt_salary", 1),
    ("260", "Авансы, выданные поставщикам и подрядчикам (4300)", "dt_suppliers", 1),
    ("270", "Авансовые платежи по налогам и сборам (4400, 4500)", "dt_tax", 1),
    ("310", "Прочие дебиторские задолженности (4800)", "dt_other", 1),
    ("320", "Денежные средства, всего", "_money", 0),
    ("332", "Денежные средства в кассе (5010)", "kassa", 1),
    ("340", "Денежные средства на расчётном счёте (5100)", "bank", 1),
    ("370", "Краткосрочные инвестиции (5800) — выданные займы", "loan_given", 0),
    ("390", "Итого по разделу II (140+190+210+320+370)", "_total_current", 0),
    ("400", "ВСЕГО ПО АКТИВУ БАЛАНСА (130+390)", "_assets", 0),
]

BALANCE_LIABILITIES = [
    ("", "I. ИСТОЧНИКИ СОБСТВЕННЫХ СРЕДСТВ", None, 0),
    ("410", "Уставный капитал (8300)", "cap_charter", 1),
    ("420", "Добавленный капитал (8400)", "cap_added", 1),
    ("430", "Резервный капитал (8500)", "cap_reserve", 1),
    ("450", "Нераспределённая прибыль (непокрытый убыток) (8700)", "_retained", 1),
    ("480", "Итого по разделу I", "_equity", 0),
    ("", "II. ОБЯЗАТЕЛЬСТВА", None, 0),
    ("490", "Долгосрочные обязательства, всего", "_longterm", 0),
    ("600", "Текущие обязательства, всего", "_current_liab", 0),
    ("601", "Текущая кредиторская задолженность", "_creditors", 1),
    ("610", "Задолженность покупателям и заказчикам (6010)", "kt_customers", 2),
    ("620", "Задолженность обособленным подразделениям (6110) (Офис)", "kt_office", 2),
    ("630", "Задолженность дочерним и зависимым обществам (6120)", "kt_safe", 2),
    ("670", "Полученные авансы (6300)", "kt_suppliers", 2),
    ("680", "Задолженность по платежам в бюджет и ГЦФ (6400, 6500)", "tax_debt", 2),
    ("720", "Задолженность по оплате труда (6700)", "kt_salary", 2),
    ("740", "Краткосрочные займы (6820, 6830, 6840)", "loan_taken", 2),
    ("760", "Прочие кредиторские задолженности (6900)", "kt_services", 2),
    ("770", "Итого по разделу II (490+600)", "_current_liab", 1),
    ("780", "ВСЕГО ПО ПАССИВУ БАЛАНСА (480+770)", "_passive", 0),
]


def _balance_derived(v: dict) -> dict:
    """Итоговые строки бланка."""
    d = dict(v)
    d["_total_fixed"] = v["fa_net"] + v["ia_net"] + v["equip"]
    d["_inventory"] = v["raw"] + v["spare"] + v["gp"]
    d["_debtors"] = (v["dt_customers"] + v["dt_office"] + v["dt_safe"] + v["dt_salary"]
                     + v["dt_suppliers"] + v["dt_tax"] + v["dt_other"])
    d["_money"] = v["kassa"] + v["bank"]
    d["_total_current"] = d["_inventory"] + v["rbp"] + d["_debtors"] + d["_money"] + v["loan_given"]
    d["_assets"] = d["_total_fixed"] + d["_total_current"]
    d["_creditors"] = (v["kt_customers"] + v["kt_office"] + v["kt_safe"] + v["kt_suppliers"]
                       + v["tax_debt"] + v["kt_salary"] + v["kt_services"])
    d["_longterm"] = 0.0
    d["_current_liab"] = d["_creditors"] + v["loan_taken"]
    # нераспределённая прибыль — балансирующая величина
    d["_retained"] = (d["_assets"] - d["_current_liab"] - d["_longterm"]
                      - v["cap_charter"] - v["cap_added"] - v["cap_reserve"])
    d["_equity"] = v["cap_charter"] + v["cap_added"] + v["cap_reserve"] + d["_retained"]
    d["_passive"] = d["_equity"] + d["_current_liab"] + d["_longterm"]
    return d


@router.get("/balance")
async def balance(
    year: int | None = None,
    month: int | None = None,
    _: User = Depends(require("reports:view")),
    db: AsyncSession = Depends(get_db),
):
    """Баланс — Форма №1 (в сумах): колонки «на начало» и «на конец» периода."""
    start, end = _period_bounds(year, month)
    opening = _balance_derived(
        await _balance_at(db, start - timedelta(days=1) if start else None)
    )
    closing = _balance_derived(await _balance_at(db, end))

    def build(spec):
        out = []
        for code, name, key, level in spec:
            out.append({
                "code": code, "name": name, "level": level,
                "opening": round(opening.get(key, 0.0), 2) if key else None,
                "amount": round(closing.get(key, 0.0), 2) if key else None,
            })
        return out

    asset_rows = build(BALANCE_ASSETS)
    liab_rows = build(BALANCE_LIABILITIES)
    return {
        "asset_rows": asset_rows,
        "liability_rows": liab_rows,
        "check": round(closing["_assets"] - closing["_passive"], 2),
        # плоская сводка (совместимость)
        "assets": {
            "cash": round(closing["_money"], 2),
            "materials": round(closing["raw"] + closing["spare"], 2),
            "products": round(closing["gp"], 2),
            "receivable": round(closing["_debtors"], 2),
            "total": round(closing["_assets"], 2),
        },
        "liabilities": {
            "payable": round(closing["_creditors"] - closing["tax_debt"], 2),
            "taxes": round(closing["tax_debt"], 2),
            "loans": round(closing["loan_taken"], 2),
            "total": round(closing["_current_liab"], 2),
        },
        "equity": round(closing["_equity"], 2),
    }


# ================= Обороты склада (сырьё / запчасти) =================
@router.get("/materials")
async def materials_report(
    kind: str | None = None,
    _: User = Depends(require("materials:view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Material).order_by(Material.code)
    if kind:
        stmt = stmt.where(Material.kind == kind)
    mats = (await db.execute(stmt)).scalars().all()
    rows = [{
        "code": m.code, "name": m.name, "unit": m.unit, "kind": m.kind,
        "stock_qty": float(m.stock_qty or 0), "avg_cost": float(m.avg_cost or 0),
        "value": round(float(m.stock_qty or 0) * float(m.avg_cost or 0), 2),
    } for m in mats]
    return {"rows": rows, "total_value": round(sum(r["value"] for r in rows), 2)}


# ================= Авто-себестоимость производства (из расхода сырья) =================
@router.get("/production-cost")
async def production_cost(
    division: str = "",
    year: int | None = None,
    month: int | None = None,
    exclude_id: int | None = None,
    add_qty: float = 0.0,
    _: User = Depends(require("production:view")),
    db: AsyncSession = Depends(get_db),
):
    """Себестоимость единицы — колонка K листа «С-сть ГП»:

        (расход сырья/запчастей/солярки + производственные расходы) / выпуск

    В себестоимость входят ТОЛЬКО производственные статьи. Расходы по
    реализации, административные и прочие операционные — расходы периода,
    они идут в ОФР строкой 040 и в колонки Q/R/S листа, но не в K.

    Какие статьи считаются производственными, задаётся в справочнике
    («Статьи расходов» → строка ОФР = «Производственные»), а не префиксом кода.

    Делитель — ВЫПУСК подразделения за период (в книге это E3 = SUM(E4:E8)),
    а не количество прихода сырья:
      · `exclude_id` — не учитывать этот документ выпуска (нужно при его правке,
        иначе его количество попадёт в делитель дважды);
      · `add_qty`   — добавить количество, которое пользователь сейчас вводит.
    """
    return await cost_parts(db, division, year, month, exclude_id, add_qty)


# ================= Оборот склада сырья/запчастей (Остаток нач + Приход − Расход = кон) =================
@router.get("/materials-turnover")
async def materials_turnover(
    kind: str | None = None,
    year: int | None = None,
    month: int | None = None,
    division: str | None = None,
    by_division: bool = False,
    _: User = Depends(require("materials:view")),
    db: AsyncSession = Depends(get_db),
):
    """Лист «Склад сырья оборот»: остаток нач + приход − расход = остаток кон.

    `by_division=true` — как в книге, отдельными блоками по каждой дробилке.
    """
    mstmt = select(Material).order_by(Material.code)
    if kind:
        mstmt = mstmt.where(Material.kind == kind)
    mats = {m.id: m for m in (await db.execute(mstmt)).scalars().all()}
    if not mats:
        return {"rows": [], "by_division": by_division}

    start, _end = _period_bounds(year, month)

    async def agg(model, qty_col, val_col, before: bool = False):
        stmt = select(model.material_id, model.division,
                      func.coalesce(func.sum(qty_col), 0),
                      func.coalesce(func.sum(val_col), 0)).where(
            model.material_id.in_(list(mats))
        )
        if division:
            stmt = stmt.where(model.division == division)
        if before:
            if start is None:
                return {}
            stmt = stmt.where(model.doc_date < start)
        else:
            stmt = _period(stmt, year, month, model.doc_date)
        stmt = stmt.group_by(model.material_id, model.division)
        out: dict[tuple[int, str], tuple[float, float]] = {}
        for mid, d, q, v in (await db.execute(stmt)).all():
            out[(mid, d or "")] = (float(q or 0), float(v or 0))
        return out

    recv = await agg(MaterialReceipt, MaterialReceipt.qty, MaterialReceipt.amount_uzs)
    iss = await agg(MaterialIssue, MaterialIssue.qty, MaterialIssue.cost_uzs)
    recv_before = await agg(MaterialReceipt, MaterialReceipt.qty, MaterialReceipt.amount_uzs, before=True)
    iss_before = await agg(MaterialIssue, MaterialIssue.qty, MaterialIssue.cost_uzs, before=True)

    # Входящие остатки — как на листе «Остаток сырья»: количество и цена за
    # единицу. Раньше закрывающий остаток брался из карточки («как сейчас»), а
    # входящий выводился обратным счётом — из-за этого отчёт за апрель показывал
    # июльский склад. Теперь всё считается движениями, как в «ГП оборот».
    sstmt = select(MaterialStock).where(MaterialStock.material_id.in_(list(mats)))
    if division:
        sstmt = sstmt.where(MaterialStock.division == division)
    stocks = {
        (s.material_id, s.division or ""): s
        for s in (await db.execute(sstmt)).scalars().all()
    }

    keys = set(recv) | set(iss) | set(recv_before) | set(iss_before) | set(stocks)
    rows = []
    for mid, d in sorted(keys, key=lambda k: (mats[k[0]].code or "", k[1])):
        m = mats[mid]
        recv_q, recv_v = recv.get((mid, d), (0.0, 0.0))
        iss_q, iss_v = iss.get((mid, d), (0.0, 0.0))

        src = stocks.get((mid, d)) or (m if d == "" else None)
        op_q = float(getattr(src, "opening_qty", 0) or 0) if src else 0.0
        op_price = float(getattr(src, "opening_cost", 0) or 0) if src else 0.0
        bq, bv = recv_before.get((mid, d), (0.0, 0.0))
        sq, sv = iss_before.get((mid, d), (0.0, 0.0))
        open_q = round(op_q + bq - sq, 3)
        open_v = round(op_q * op_price + bv - sv, 2)
        close_q = round(open_q + recv_q - iss_q, 3)
        close_v = round(open_v + recv_v - iss_v, 2)
        if not any([open_q, recv_q, iss_q, close_q]):
            continue
        rows.append({
            "code": m.code, "name": m.name, "unit": m.unit,
            "division": d or "— общий склад —",
            "open_qty": open_q, "open_val": open_v,
            "recv_qty": recv_q, "recv_val": round(recv_v, 2),
            "iss_qty": iss_q, "iss_val": round(iss_v, 2),
            "close_qty": close_q, "close_val": close_v,
        })

    if not by_division:
        rows = _merge_divisions(
            rows, ("open_qty", "open_val", "recv_qty", "recv_val",
                   "iss_qty", "iss_val", "close_qty", "close_val")
        )
    return {"rows": rows, "by_division": by_division}


# ================= Себестоимость ГП (С-сть) =================
@router.get("/cost")
async def cost_report(
    year: int | None = None,
    month: int | None = None,
    division: str | None = None,
    _: User = Depends(require("products:view")),
    db: AsyncSession = Depends(get_db),
):
    """Лист «С-сть ГП»: раскладка себестоимости 1 м³ по статьям
    (сырьё · запчасти · солярка · общие расходы) и полная стоимость с учётом
    расходов по реализации, административных и прочих операционных."""
    products = (await db.execute(select(Product).order_by(Product.code))).scalars().all()

    async def agg(model, cols, pid, div_col=None):
        stmt = select(*[func.coalesce(func.sum(c), 0) for c in cols]).where(model.product_id == pid)
        if division and div_col is not None:
            stmt = stmt.where(div_col == division)
        return (await db.execute(_period(stmt, year, month, model.doc_date))).one()

    # --- расход сырья/запчастей по видам, за период и подразделение ---
    istmt = select(
        Material.kind, Material.name,
        func.coalesce(func.sum(MaterialIssue.cost_uzs), 0),
    ).join(Material, Material.id == MaterialIssue.material_id).group_by(
        Material.kind, Material.name
    )
    if division:
        istmt = istmt.where(MaterialIssue.division == division)
    raw_cost = spare_cost = fuel_cost = 0.0
    for kind, name, v in (await db.execute(_period(istmt, year, month, MaterialIssue.doc_date))).all():
        amount = float(v or 0)
        if "СОЛЯР" in (name or "").upper() or "ДИЗЕЛ" in (name or "").upper():
            fuel_cost += amount
        elif kind == "raw":
            raw_cost += amount
        else:
            spare_cost += amount

    g = await _expense_groups_uzs(db, year, month, division)

    qstmt = select(func.coalesce(func.sum(Production.qty), 0))
    if division:
        qstmt = qstmt.where(Production.division == division)
    total_qty = float(await db.scalar(_period(qstmt, year, month, Production.doc_date)) or 0)

    # Расходы периода в СЕБЕСТОИМОСТЬ НЕ входят. Они разносятся на выпуск
    # отдельными колонками Q/R/S/T и дают «Итого стоимость» (U = K+Q+R+S+T) —
    # справочную цифру полной стоимости единицы, а не себестоимость.
    profit_tax = float(
        await db.scalar(
            select(func.coalesce(func.sum(Tax.accrued), 0)).where(Tax.name.ilike("%прибыль%"))
        ) or 0
    ) if not division else 0.0
    per_unit = {
        "sell": round(g["sell"] / total_qty, 2) if total_qty else 0,
        "admin": round(g["admin"] / total_qty, 2) if total_qty else 0,
        "other": round(g["other"] / total_qty, 2) if total_qty else 0,
        "tax": round(profit_tax / total_qty, 2) if total_qty else 0,
    }

    rows = []
    for p in products:
        pq, pv = await agg(Production, [Production.qty, Production.amount_uzs], p.id, Production.division)
        pq, pv = float(pq), float(pv)
        sq, rev, cogs = await agg(Sale, [Sale.qty, Sale.revenue_net, Sale.cogs_uzs], p.id, Sale.division)
        sq, rev, cogs = float(sq), float(rev), float(cogs)
        if not (pq or sq):
            continue
        unit_cost = round(pv / pq, 2) if pq else 0
        avg_price = round(rev / sq, 2) if sq else 0
        profit = round(rev - cogs, 2)
        share = pq / total_qty if total_qty else 0
        full_unit = round(
            unit_cost + per_unit["sell"] + per_unit["admin"]
            + per_unit["other"] + per_unit["tax"], 2
        )
        rows.append({
            "code": p.code, "name": p.name, "unit": p.unit,
            "produced": pq, "unit_cost": unit_cost, "total_cost": round(pv, 2),
            # раскладка себестоимости выпуска по статьям (пропорционально объёму)
            "raw_cost": round(raw_cost * share, 2),
            "spare_cost": round(spare_cost * share, 2),
            "fuel_cost": round(fuel_cost * share, 2),
            "overhead": round(max(pv - (raw_cost + spare_cost + fuel_cost) * share, 0), 2),
            "sell_unit": per_unit["sell"], "admin_unit": per_unit["admin"],
            "other_unit": per_unit["other"], "tax_unit": per_unit["tax"],
            "full_unit_cost": full_unit,
            "sold": sq, "revenue": round(rev, 2), "cogs": round(cogs, 2),
            "avg_price": avg_price, "price_list": float(p.sale_price or 0),
            "diff": round(avg_price - unit_cost, 2),
            "profit": profit,
            "margin": round(profit / rev * 100, 1) if rev else 0,
        })
    return {
        "rows": rows,
        "produced_qty": total_qty,
        "materials": {
            "raw": round(raw_cost, 2), "spare": round(spare_cost, 2),
            "fuel": round(fuel_cost, 2),
            "total": round(raw_cost + spare_cost + fuel_cost, 2),
        },
        "period_expenses": {
            "sell": round(g["sell"], 2), "admin": round(g["admin"], 2),
            "other": round(g["other"], 2), "total": round(g["period"], 2),
        },
        "per_unit": per_unit,
    }


# ================= ГП оборот (Остаток нач + Произведено − Реализовано = Остаток кон) =================
@router.get("/gp-turnover")
async def gp_turnover(
    year: int | None = None,
    month: int | None = None,
    division: str | None = None,
    by_division: bool = False,
    _: User = Depends(require("products:view")),
    db: AsyncSession = Depends(get_db),
):
    """Лист «ГП оборот»: остаток нач + произведено − реализовано = остаток кон.

    Оценка — СРЕДНЕВЗВЕШЕННАЯ ЗА ПЕРИОД, ровно как в книге (строки 8..12):

        K = E + H                    всего количество (начало + выпуск)
        M = G + J                    всего сумма
        L = M / K                    средняя цена периода
        O = L,  P = N × O            реализовано  -> это и есть строка 020
        Q = K − N,  R = L,  S = Q×R  остаток на конец

    То есть все продажи месяца оцениваются ОДНОЙ средней, а не скользящей
    себестоимостью на момент каждого документа: в книге цена реализации (O)
    и цена остатка (R) — это одна и та же ячейка L.
    """
    products = {p.id: p for p in (await db.execute(select(Product).order_by(Product.code))).scalars().all()}
    if not products:
        return {"rows": [], "by_division": by_division}

    start, _end = _period_bounds(year, month)

    async def agg(model, qty_col, val_col, before: bool = False):
        stmt = select(model.product_id, model.division,
                      func.coalesce(func.sum(qty_col), 0),
                      func.coalesce(func.sum(val_col), 0))
        if division:
            stmt = stmt.where(model.division == division)
        if before:
            if start is None:
                return {}
            stmt = stmt.where(model.doc_date < start)
        else:
            stmt = _period(stmt, year, month, model.doc_date)
        stmt = stmt.group_by(model.product_id, model.division)
        out: dict[tuple[int, str], tuple[float, float]] = {}
        for pid, d, q, v in (await db.execute(stmt)).all():
            out[(pid, d or "")] = (float(q or 0), float(v or 0))
        return out

    made = await agg(Production, Production.qty, Production.amount_uzs)
    sold = await agg(Sale, Sale.qty, Sale.cogs_uzs)
    made_before = await agg(Production, Production.qty, Production.amount_uzs, before=True)
    sold_before = await agg(Sale, Sale.qty, Sale.cogs_uzs, before=True)

    sstmt = select(ProductStock)
    if division:
        sstmt = sstmt.where(ProductStock.division == division)
    stocks = {
        (s.product_id, s.division or ""): s
        for s in (await db.execute(sstmt)).scalars().all()
    }

    keys = set(made) | set(sold) | set(made_before) | set(sold_before) | set(stocks)
    rows = []
    for pid, d in sorted(keys, key=lambda k: (products[k[0]].code or "", k[1]) if k[0] in products else ("", "")):
        p = products.get(pid)
        if not p:
            continue
        s = stocks.get((pid, d))
        prod_q, prod_v = made.get((pid, d), (0.0, 0.0))
        sold_q, sold_v = sold.get((pid, d), (0.0, 0.0))

        # остаток на начало = ввод остатков + всё, что было до периода
        # (opening_cost — цена за единицу, как в «Остаток ГП»: F=кол-во, G=цена)
        src = s if s is not None else (p if d == "" else None)
        op_q = float(getattr(src, "opening_qty", 0) or 0) if src else 0.0
        op_price = float(getattr(src, "opening_cost", 0) or 0) if src else 0.0
        bq, bv = made_before.get((pid, d), (0.0, 0.0))
        sq, sv = sold_before.get((pid, d), (0.0, 0.0))
        open_q = op_q + bq - sq
        open_v = op_q * op_price + bv - sv

        # K / M / L листа: одна средняя на весь период
        total_q = round(open_q + prod_q, 3)
        total_v = round(open_v + prod_v, 2)
        avg = round(total_v / total_q, 2) if total_q else 0.0
        sold_v = round(sold_q * avg, 2)          # P = N × L  -> строка 020
        close_q = round(total_q - sold_q, 3)
        close_v = round(close_q * avg, 2)        # S = Q × L
        if not any([open_q, prod_q, sold_q, close_q]):
            continue
        rows.append({
            "code": p.code, "name": p.name, "unit": p.unit,
            "division": d or "— общий склад —",
            "open_qty": round(open_q, 3), "open_val": round(open_v, 2),
            "prod_qty": prod_q, "prod_val": round(prod_v, 2),
            "total_qty": total_q, "total_val": total_v, "avg_cost": avg,
            "sold_qty": sold_q, "sold_val": sold_v,
            "close_qty": close_q, "close_val": close_v,
        })

    if not by_division:
        rows = _merge_divisions(
            rows, ("open_qty", "open_val", "prod_qty", "prod_val",
                   "total_qty", "total_val", "sold_qty", "sold_val",
                   "close_qty", "close_val")
        )
        for r in rows:  # средняя после свёртки пересчитывается, а не складывается
            r["avg_cost"] = round(r["total_val"] / r["total_qty"], 2) if r["total_qty"] else 0.0
    return {"rows": rows, "by_division": by_division}


# ================= Ежедневные остатки денежных средств =================
@router.get("/daily-balance")
async def daily_balance(
    year: int | None = None,
    month: int | None = None,
    currency: str = "UZS",
    division: str | None = None,
    _: User = Depends(require("reports:view")),
    db: AsyncSession = Depends(get_db),
):
    """Листы «ОСТАТОК UZS» / «ОСТАТОК USD»: остаток на каждый день с разрезом
    по банковским счетам и кассам (колонка на каждый счёт, как в Excel)."""
    usd = currency.upper() == "USD"
    amount = Transaction.amount_usd if usd else Transaction.amount_uzs
    start, _end = _period_bounds(year, month)
    opening = await cash_opening(db, start, division)

    banks = (await db.execute(select(BankAccount).order_by(BankAccount.id))).scalars().all()
    tstmt = select(CashRegister).order_by(CashRegister.id)
    if division:
        tstmt = tstmt.where(CashRegister.division == division)
        banks = []          # счета к подразделениям не привязаны
    tills = (await db.execute(tstmt)).scalars().all()
    # колонки отчёта: сначала кассы, затем банковские счета
    columns = (
        [{"key": f"till{c.id}", "label": c.name, "kind": "kassa"} for c in tills]
        + [{"key": f"bank{b.id}", "label": b.name, "kind": "bank"} for b in banks]
        + [{"key": "unassigned", "label": "Без счёта", "kind": "other"}]
    )
    # остаток, зафиксированный позже начала периода, в стартовую колонку не идёт
    def op(row) -> float:
        if not opening_active(row.opening_date, start):
            return 0.0
        return float((row.opening_usd if usd else row.opening_uzs) or 0)

    opening_col = {f"till{c.id}": op(c) for c in tills}
    opening_col |= {f"bank{b.id}": op(b) for b in banks}
    opening_col["unassigned"] = 0.0

    # движения до начала периода уже входят в общий остаток на начало
    if start:
        stmt = select(
            Transaction.bank_account_id,
            Transaction.cash_register_id,
            Transaction.account,
            Transaction.direction,
            func.coalesce(func.sum(amount), 0),
        ).where(Transaction.doc_date < start)
        if division:
            stmt = stmt.where(Transaction.division == division)
        stmt = stmt.group_by(
            Transaction.bank_account_id, Transaction.cash_register_id,
            Transaction.account, Transaction.direction,
        )
        for bid, cid, account, direction, total in (await db.execute(stmt)).all():
            key = _col_key(bid, cid)
            sign = 1 if direction == "income" else -1
            opening_col[key] = opening_col.get(key, 0.0) + sign * float(total or 0)

    stmt = select(
        Transaction.doc_date,
        Transaction.bank_account_id,
        Transaction.cash_register_id,
        Transaction.account,
        Transaction.direction,
        func.coalesce(func.sum(amount), 0),
    )
    if division:
        stmt = stmt.where(Transaction.division == division)
    stmt = stmt.group_by(
        Transaction.doc_date, Transaction.bank_account_id,
        Transaction.cash_register_id, Transaction.account, Transaction.direction,
    ).order_by(Transaction.doc_date)

    by_day: dict[str, dict] = {}
    for d, bid, cid, account, direction, total in (await db.execute(_period(stmt, year, month))).all():
        day = by_day.setdefault(d.isoformat(), {"income": 0.0, "expense": 0.0, "cols": {}})
        v = float(total or 0)
        sign = 1 if direction == "income" else -1
        day["income" if direction == "income" else "expense"] += v
        key = _col_key(bid, cid)
        day["cols"][key] = day["cols"].get(key, 0.0) + sign * v

    running = dict(opening_col)
    total_open = round(sum(opening_col.values()), 2)
    out = []
    total_running = total_open
    for day in sorted(by_day):
        r = by_day[day]
        for key, delta in r["cols"].items():
            running[key] = running.get(key, 0.0) + delta
        total_running += r["income"] - r["expense"]
        out.append({
            "date": day,
            "income": round(r["income"], 2), "expense": round(r["expense"], 2),
            "closing": round(total_running, 2),
            "cols": {k: round(v, 2) for k, v in running.items()},
        })
    return {
        "currency": "USD" if usd else "UZS",
        "columns": columns,
        "opening": {"total": total_open, "cols": {k: round(v, 2) for k, v in opening_col.items()}},
        "rows": out,
        "final": round(total_running, 2),
    }


def _col_key(bank_id, till_id) -> str:
    if bank_id:
        return f"bank{bank_id}"
    if till_id:
        return f"till{till_id}"
    return "unassigned"


# ================= Ведомости Дт-Кт по видам (листы «Дт Кт ...») =================
@router.get("/ledger")
async def ledger_report(
    ledger: str | None = None,
    year: int | None = None,
    month: int | None = None,
    _: User = Depends(require("reports:view")),
    db: AsyncSession = Depends(get_db),
):
    """Одна ведомость Дт-Кт: начало / оборот / конец по каждому контрагенту."""
    start, end = _period_bounds(year, month)
    data = await ledger_rows(db, ledger, start, end)
    data["ledger"] = ledger or "all"
    return data


# ================= ГП оборот / остаток / себестоимость =================
@router.get("/products")
async def products_report(
    _: User = Depends(require("products:view")),
    db: AsyncSession = Depends(get_db),
):
    prods = (await db.execute(select(Product).order_by(Product.code))).scalars().all()
    rows = [{
        "code": p.code, "name": p.name, "unit": p.unit,
        "stock_qty": float(p.stock_qty or 0), "avg_cost": float(p.avg_cost or 0),
        "value": round(float(p.stock_qty or 0) * float(p.avg_cost or 0), 2),
        "sale_price": float(p.sale_price or 0),
    } for p in prods]
    return {"rows": rows, "total_value": round(sum(r["value"] for r in rows), 2)}
