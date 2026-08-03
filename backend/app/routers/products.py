from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..events import record
from ..models import Product, ProductStock, Production, Sale, User
from ..periods import assert_no_closed
from ..schemas import ProductCreate, ProductOut, ProductUpdate
from ..security import require
from .inventory import recompute_product

router = APIRouter(prefix="/api/products", tags=["products"])


@router.get("", response_model=list[ProductOut])
async def list_products(
    _: User = Depends(require("products:view")), db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Product).order_by(Product.code))
    return result.scalars().all()


@router.post("", response_model=ProductOut, status_code=201)
async def create_product(
    body: ProductCreate,
    current: User = Depends(require("products:create")),
    db: AsyncSession = Depends(get_db),
):
    p = Product(**body.model_dump())
    if float(p.opening_qty or 0) or float(p.opening_cost or 0):
        await assert_no_closed(db, what="входящий остаток продукции")
    db.add(p)
    await db.flush()
    await recompute_product(db, p.id)
    await db.commit()
    await db.refresh(p)
    await record(db, current, "create", "product", p.name, {"id": p.id})
    return p


@router.put("/{pid}", response_model=ProductOut)
async def update_product(
    pid: int,
    body: ProductUpdate,
    current: User = Depends(require("products:edit")),
    db: AsyncSession = Depends(get_db),
):
    p = await db.get(Product, pid)
    if not p:
        raise HTTPException(status_code=404, detail="Продукция не найдена")
    data = body.model_dump(exclude_unset=True)
    # входящий остаток даты не имеет и переписывает всю историю — см. assert_no_closed
    if any(float(data[k] or 0) != float(getattr(p, k) or 0)
           for k in ("opening_qty", "opening_cost") if k in data):
        await assert_no_closed(db, what="входящий остаток продукции")
    for k, v in data.items():
        setattr(p, k, v)
    await db.flush()
    # входящий остаток мог измениться -> полный пересчёт склада и себестоимости
    await recompute_product(db, p.id)
    await db.commit()
    await db.refresh(p)
    await record(db, current, "edit", "product", p.name, {"id": p.id})
    return p


@router.delete("/{pid}", status_code=204)
async def delete_product(
    pid: int,
    current: User = Depends(require("products:delete")),
    db: AsyncSession = Depends(get_db),
):
    p = await db.get(Product, pid)
    if not p:
        raise HTTPException(status_code=404, detail="Продукция не найдена")
    made = await db.scalar(
        select(func.count(Production.id)).where(Production.product_id == pid)
    )
    sold = await db.scalar(select(func.count(Sale.id)).where(Sale.product_id == pid))
    if made or sold:
        raise HTTPException(
            400,
            detail=f"Нельзя удалить — есть движения (производство: {made or 0}, продажи: {sold or 0}).",
        )
    name = p.name
    # карточки остатков по объектам — производные данные, уходят вместе с продукцией
    await db.execute(delete(ProductStock).where(ProductStock.product_id == pid))
    await db.delete(p)
    await db.commit()
    await record(db, current, "delete", "product", name)
