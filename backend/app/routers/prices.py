"""Прайс-лист: цена продукции для конкретного покупателя, действующая с даты.

Как это работает и почему именно так:

  · Цена хранится ИСТОРИЕЙ, а не одним «текущим» числом: 01.08 — 80 000,
    07.08 — 100 000. Действующей на дату D считается последняя запись с
    start_date <= D.
  · Прайс НИЧЕГО не пересчитывает. Он только подставляет цену в форму
    продажи; в самом документе цена лежит своя (Sale.price_uzs) и остаётся
    той, какой её ввели. Поэтому новая цена с 7-го числа не трогает
    продажи с 1-го по 6-е — это главное требование к прайсу.
  · Поиск идёт по ДАТЕ ДОКУМЕНТА, а не по «сегодня»: продажа, введённая
    задним числом, получает ту цену, что действовала тогда.
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..events import record
from ..money import require_money
from ..models import Organization, Product, ProductPrice, User
from ..security import require

router = APIRouter(prefix="/api/prices", tags=["prices"])


class PriceItem(BaseModel):
    product_id: int
    # None — убрать цену этого дня (не «ноль», а «записи нет»)
    price_uzs: float | None = None
    # цена с НДС внутри — флажок едет в продажу вместе с ценой
    vat: bool = False


class PriceSave(BaseModel):
    organization_id: int
    start_date: date
    items: list[PriceItem] = Field(min_length=1, max_length=500)


async def _effective(
    db: AsyncSession, organization_id: int, on: date
) -> dict[int, tuple[float, date, bool]]:
    """{product_id: (цена, с какой даты, с НДС ли)} — что действует на `on`.

    Берём все записи не позже даты и оставляем самую свежую по каждому
    товару. Так «цена с 1-го» продолжает работать 2-го, 3-го и далее, пока
    не появится новая.
    """
    rows = (await db.execute(
        select(ProductPrice)
        .where(ProductPrice.organization_id == organization_id,
               ProductPrice.start_date <= on)
        .order_by(ProductPrice.product_id, ProductPrice.start_date)
    )).scalars().all()
    out: dict[int, tuple[float, date, bool]] = {}
    for r in rows:  # отсортировано по дате -> последняя перезапишет предыдущую
        out[r.product_id] = (float(r.price_uzs or 0), r.start_date, bool(r.vat))
    return out


@router.get("/effective")
async def effective(
    organization_id: int,
    on: date,
    current: User = Depends(require("sales:view")),
    db: AsyncSession = Depends(get_db),
):
    """Цены, действующие на дату — этим форма продажи заполняет поле цены."""
    require_money(current, "прайс-лист")
    got = await _effective(db, organization_id, on)
    return {
        str(pid): {"price_uzs": p, "start_date": d.isoformat(), "vat": v}
        for pid, (p, d, v) in got.items()
    }


@router.get("")
async def price_sheet(
    organization_id: int,
    on: date,
    current: User = Depends(require("prices:view")),
    db: AsyncSession = Depends(get_db),
):
    """Лист прайса: все товары + действующая цена + цена именно этого дня."""
    require_money(current, "прайс-лист")
    if not await db.get(Organization, organization_id):
        raise HTTPException(404, detail="Покупатель не найден")
    eff = await _effective(db, organization_id, on)
    today_rows = {
        r.product_id: (float(r.price_uzs or 0), bool(r.vat))
        for r in (await db.execute(
            select(ProductPrice).where(
                ProductPrice.organization_id == organization_id,
                ProductPrice.start_date == on,
            )
        )).scalars().all()
    }
    products = (await db.execute(select(Product).order_by(Product.code, Product.name))).scalars().all()
    rows = []
    for p in products:
        price, since, vat = eff.get(p.id, (None, None, False))
        own = today_rows.get(p.id)
        rows.append({
            "product_id": p.id, "code": p.code, "name": p.name, "unit": p.unit,
            # что действует на выбранную дату (может быть задано раньше)
            "price_uzs": price, "start_date": since.isoformat() if since else None,
            "vat": vat,
            # задано ли значение именно на эту дату — его и правит форма
            "own": own is not None,
            "own_price": own[0] if own else None,
            # у новой строки НДС наследуем от действующей цены: обычно у
            # покупателя режим не меняется, а перещёлкивать его каждый день лишнее
            "own_vat": own[1] if own else vat,
        })
    return {"organization_id": organization_id, "on": on.isoformat(), "rows": rows}


@router.put("")
async def save_sheet(
    body: PriceSave,
    current: User = Depends(require("prices:edit")),
    db: AsyncSession = Depends(get_db),
):
    """Сохранить цены на дату. Пустое значение убирает цену этого дня.

    Прошлые даты не трогаем: правим только записи с этой start_date, поэтому
    уже проведённые продажи и вчерашние цены остаются как были.
    """
    require_money(current, "прайс-лист")
    if not await db.get(Organization, body.organization_id):
        raise HTTPException(404, detail="Покупатель не найден")
    existing = {
        r.product_id: r
        for r in (await db.execute(
            select(ProductPrice).where(
                ProductPrice.organization_id == body.organization_id,
                ProductPrice.start_date == body.start_date,
            )
        )).scalars().all()
    }
    saved = removed = 0
    for it in body.items:
        row = existing.get(it.product_id)
        if it.price_uzs is None:
            if row is not None:
                await db.delete(row)
                removed += 1
            continue
        if float(it.price_uzs) < 0:
            raise HTTPException(400, detail="Цена не может быть отрицательной")
        if row is None:
            if not await db.get(Product, it.product_id):
                raise HTTPException(404, detail=f"Продукция #{it.product_id} не найдена")
            db.add(ProductPrice(
                organization_id=body.organization_id, product_id=it.product_id,
                start_date=body.start_date, price_uzs=float(it.price_uzs),
                vat=it.vat, created_by=current.id,
            ))
        else:
            row.price_uzs = float(it.price_uzs)
            row.vat = it.vat
        saved += 1
    await db.commit()
    await record(db, current, "edit", "product_price",
                 f"{body.start_date}: {saved} цен, снято {removed}")
    return {"saved": saved, "removed": removed}


@router.get("/history")
async def history(
    organization_id: int,
    product_id: int,
    current: User = Depends(require("prices:view")),
    db: AsyncSession = Depends(get_db),
):
    """Вся история цены по товару — видно, с какого числа сколько стоило."""
    require_money(current, "прайс-лист")
    rows = (await db.execute(
        select(ProductPrice)
        .options(selectinload(ProductPrice.product))
        .where(ProductPrice.organization_id == organization_id,
               ProductPrice.product_id == product_id)
        .order_by(ProductPrice.start_date.desc())
    )).scalars().all()
    return [{"id": r.id, "start_date": r.start_date.isoformat(),
             "price_uzs": float(r.price_uzs or 0), "vat": bool(r.vat)} for r in rows]


@router.delete("/{pid}", status_code=204)
async def remove(
    pid: int,
    current: User = Depends(require("prices:edit")),
    db: AsyncSession = Depends(get_db),
):
    """Убрать одну запись прайса. Проведённых продаж это не касается."""
    require_money(current, "прайс-лист")
    await db.execute(delete(ProductPrice).where(ProductPrice.id == pid))
    await db.commit()
    await record(db, current, "delete", "product_price", f"#{pid}")
