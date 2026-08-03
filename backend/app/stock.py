"""Оценка склада НА ДАТУ — тем же реплеем движений, что и текущие остатки.

Зачем отдельный модуль. `Material.stock_qty` / `avg_cost` (и строки
`MaterialStock` / `ProductStock`) хранят только «сейчас»: реплей в
`routers/inventory.py` прогоняет ВСЕ движения без отсечки по дате. Баланс же
строится на дату, и до этого модуля он подставлял сегодняшний склад в колонку
«на начало периода» — из-за чего баланс за январь менялся после каждого
февральского прихода.

Здесь тот же самый реплей, но с отсечкой `doc_date <= on`. Формула средней
цены одна на оба места — `apply_receipt`, чтобы оценка на сегодня в точности
совпадала с сохранёнными остатками.
"""
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import (
    Material,
    MaterialIssue,
    MaterialReceipt,
    MaterialStock,
    Product,
    ProductStock,
    Production,
    Sale,
)


def apply_receipt(stock: float, avg: float, qty: float, price: float) -> tuple[float, float]:
    """Приход по средней взвешенной цене. Используется и при пересчёте остатков,
    и при оценке склада на дату — расхождение здесь означало бы, что баланс
    не сходится с карточкой склада."""
    new = stock + qty
    return new, (round((stock * avg + qty * price) / new, 4) if new else 0.0)


def _div(obj) -> str:
    return (getattr(obj, "division", "") or "").strip()


async def _replay(
    db: AsyncSession,
    on: date | None,
    stock_model,
    stock_fk,
    card_model,
    ins: list,          # приходные документы
    outs: list,         # расходные документы
    price_of,           # документ прихода -> цена за единицу
) -> dict[tuple[int, str], list[float]]:
    """Состояние склада на дату: {(id номенклатуры, подразделение): [кол-во, средняя]}."""
    openings: dict[tuple[int, str], tuple[float, float]] = {}
    for row in (await db.execute(select(stock_model))).scalars().all():
        openings[(getattr(row, stock_fk), (row.division or "").strip())] = (
            float(row.opening_qty or 0),
            float(row.opening_cost or 0),
        )
    cards = (await db.execute(select(card_model))).scalars().all()
    for c in cards:
        # общий склад: если строки подразделения нет, входящий остаток берётся
        # из карточки — так же, как в recompute_material / recompute_product
        openings.setdefault((c.id, ""), (float(c.opening_qty or 0), float(c.opening_cost or 0)))

    events: list[tuple[date, int, int, object, str]] = []
    for r in ins:
        events.append((r.doc_date, 0, r.id, r, "in"))
    for r in outs:
        events.append((r.doc_date, 1, r.id, r, "out"))
    events.sort(key=lambda e: (e[0], e[1], e[2]))  # дата, приход раньше расхода, id

    state = {k: [q, a] for k, (q, a) in openings.items()}
    for doc_date, _order, _id, obj, kind in events:
        if on is not None and doc_date > on:
            continue
        owner = getattr(obj, stock_fk)
        key = (owner, _div(obj))
        stock, avg = state.setdefault(key, [0.0, 0.0])
        qty = float(obj.qty or 0)
        if kind == "in":
            stock, avg = apply_receipt(stock, avg, qty, float(price_of(obj) or 0))
        else:
            stock -= qty
        state[key] = [stock, avg]

    # округляем ТОЛЬКО в конце и ровно так, как это делает пересчёт остатков
    # (round(qty, 3) / round(avg, 2) в recompute_material): иначе оценка склада
    # в балансе на копейки разошлась бы с экраном «Остатки по подразделениям»
    return {k: [round(q, 3), round(a, 2)] for k, (q, a) in state.items()}


def _docs(model, on: date | None):
    return select(model).where(model.doc_date <= on) if on is not None else select(model)


async def _material_state(db: AsyncSession, on: date | None):
    receipts = (await db.execute(_docs(MaterialReceipt, on))).scalars().all()
    issues = (await db.execute(_docs(MaterialIssue, on))).scalars().all()
    return await _replay(
        db, on, MaterialStock, "material_id", Material,
        receipts, issues, lambda r: r.price_uzs,
    )


async def _product_state(db: AsyncSession, on: date | None):
    prods = (await db.execute(_docs(Production, on))).scalars().all()
    sales = (await db.execute(_docs(Sale, on))).scalars().all()
    return await _replay(
        db, on, ProductStock, "product_id", Product,
        prods, sales, lambda r: r.unit_cost,
    )


async def stock_value_at(db: AsyncSession, on: date | None = None) -> dict[str, float]:
    """Стоимость запасов на дату: сырьё, запчасти, готовая продукция (UZS).

    `on = None` — на текущий момент; результат совпадает с суммой по карточкам.
    """
    kinds = dict((await db.execute(select(Material.id, Material.kind))).all())
    raw = spare = 0.0
    for (mid, _d), (qty, avg) in (await _material_state(db, on)).items():
        if kinds.get(mid) == "raw":
            raw += qty * avg
        else:
            spare += qty * avg
    gp = sum(qty * avg for (qty, avg) in (await _product_state(db, on)).values())
    return {"raw": round(raw, 2), "spare": round(spare, 2), "gp": round(gp, 2)}


async def negative_stock_at(db: AsyncSession, on: date | None = None) -> list[dict]:
    """Позиции, ушедшие в минус на дату — закрывать месяц с ними нельзя.

    Минус означает, что списали больше, чем было: себестоимость списания
    посчитана по неверной средней цене, и ОФР этого месяца недостоверен.
    """
    out: list[dict] = []
    names = dict((await db.execute(select(Material.id, Material.name))).all())
    for (mid, div), (qty, _avg) in (await _material_state(db, on)).items():
        if qty < -0.001:
            out.append({"kind": "Сырьё/запчасти", "name": names.get(mid, f"#{mid}"),
                        "division": div or "— общий склад —", "qty": round(qty, 3)})
    names = dict((await db.execute(select(Product.id, Product.name))).all())
    for (pid, div), (qty, _avg) in (await _product_state(db, on)).items():
        if qty < -0.001:
            out.append({"kind": "Продукция", "name": names.get(pid, f"#{pid}"),
                        "division": div or "— общий склад —", "qty": round(qty, 3)})
    return out
