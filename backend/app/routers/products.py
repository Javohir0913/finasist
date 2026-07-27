from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..events import record
from ..models import Product, User
from ..schemas import ProductCreate, ProductOut, ProductUpdate
from ..security import require

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
    db.add(p)
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
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(p, k, v)
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
    name = p.name
    await db.delete(p)
    await db.commit()
    await record(db, current, "delete", "product", name)
