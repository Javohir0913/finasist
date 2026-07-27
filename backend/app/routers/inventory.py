"""Склад и производство: приход/расход сырья, производство и продажа ГП.
Остатки и средняя себестоимость пересчитываются полным реплеем движений
(гарантирует корректность при любом создании/изменении/удалении)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..events import record
from ..models import (
    ExchangeRate,
    Material,
    MaterialIssue,
    MaterialReceipt,
    Organization,
    Product,
    Production,
    Sale,
    User,
)
from ..rates import get_rates


async def _latest_rate(db: AsyncSession) -> float:
    r = await db.scalar(select(ExchangeRate.rate).order_by(ExchangeRate.rate_date.desc()).limit(1))
    return float(r) if r else 1.0


async def _post_bal(db: AsyncSession, org_id, uzs: float, sign: int):
    """Проводка в баланс контрагента: sign +1 (дебет/нам должны), -1 (кредит/мы должны)."""
    if not org_id or not uzs:
        return
    org = await db.get(Organization, org_id)
    if not org:
        return
    rate = await _latest_rate(db)
    org.balance_uzs = float(org.balance_uzs or 0) + sign * uzs
    org.balance_usd = float(org.balance_usd or 0) + sign * (uzs / rate if rate else 0)
from ..schemas import (
    IssueBase,
    IssueOut,
    ProductionBase,
    ProductionOut,
    ReceiptBase,
    ReceiptOut,
    SaleBase,
    SaleOut,
)
from ..security import require

router = APIRouter(prefix="/api", tags=["inventory"])

NDS = 0.12


async def recompute_material(db: AsyncSession, material_id: int):
    """Replay all receipts + issues chronologically -> stock & moving-avg cost."""
    mat = await db.get(Material, material_id)
    if not mat:
        return
    recs = (await db.execute(
        select(MaterialReceipt).where(MaterialReceipt.material_id == material_id)
    )).scalars().all()
    iss = (await db.execute(
        select(MaterialIssue).where(MaterialIssue.material_id == material_id)
    )).scalars().all()
    events = [("in", r.doc_date, r.id, r) for r in recs] + [("out", i.doc_date, i.id, i) for i in iss]
    events.sort(key=lambda e: (e[1], e[0] != "in", e[2]))  # by date, receipts first
    stock = 0.0
    avg = 0.0
    for kind, _d, _id, obj in events:
        if kind == "in":
            q = float(obj.qty)
            p = float(obj.price_uzs)
            obj.amount_uzs = round(q * p, 2)
            new = stock + q
            avg = round((stock * avg + q * p) / new, 4) if new else 0.0
            stock = new
        else:
            q = float(obj.qty)
            obj.cost_uzs = round(q * avg, 2)
            stock -= q
    mat.stock_qty = round(stock, 3)
    mat.avg_cost = round(avg, 2)


async def recompute_product(db: AsyncSession, product_id: int):
    """Replay productions (in) + sales (out) -> stock & moving-avg cost (себестоимость)."""
    prod = await db.get(Product, product_id)
    if not prod:
        return
    nds = (await get_rates(db))["nds_rate"]
    prods = (await db.execute(
        select(Production).where(Production.product_id == product_id)
    )).scalars().all()
    sales = (await db.execute(
        select(Sale).where(Sale.product_id == product_id)
    )).scalars().all()
    events = [("in", p.doc_date, p.id, p) for p in prods] + [("out", s.doc_date, s.id, s) for s in sales]
    events.sort(key=lambda e: (e[1], e[0] != "in", e[2]))
    stock = 0.0
    avg = 0.0
    for kind, _d, _id, obj in events:
        if kind == "in":
            q = float(obj.qty)
            c = float(obj.unit_cost)
            obj.amount_uzs = round(q * c, 2)
            new = stock + q
            avg = round((stock * avg + q * c) / new, 4) if new else 0.0
            stock = new
        else:
            q = float(obj.qty)
            amount = q * float(obj.price_uzs)
            net = amount / (1 + nds) if obj.vat else amount
            obj.revenue_net = round(net, 2)
            obj.vat_amount = round(amount - net, 2)
            obj.cogs_uzs = round(q * avg, 2)
            stock -= q
    prod.stock_qty = round(stock, 3)
    prod.avg_cost = round(avg, 2)


# ================= MATERIAL RECEIPTS =================
@router.get("/material-receipts", response_model=list[ReceiptOut])
async def list_receipts(_: User = Depends(require("materials:view")), db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(MaterialReceipt).options(selectinload(MaterialReceipt.material), selectinload(MaterialReceipt.organization)).order_by(MaterialReceipt.doc_date.desc(), MaterialReceipt.id.desc())
    )
    return res.scalars().all()


@router.post("/material-receipts", response_model=ReceiptOut, status_code=201)
async def create_receipt(body: ReceiptBase, current: User = Depends(require("materials:create")), db: AsyncSession = Depends(get_db)):
    row = MaterialReceipt(**body.model_dump(), created_by=current.id)
    db.add(row)
    await db.flush()
    await recompute_material(db, row.material_id)
    nds = (await get_rates(db))["nds_rate"]
    total = float(row.qty) * float(row.price_uzs) * (1 + nds if row.vat else 1)
    await _post_bal(db, row.organization_id, total, -1)  # мы должны поставщику (кредиторка)
    await db.commit()
    await db.refresh(row, ["material", "organization"])
    await record(db, current, "create", "material_receipt", f"{body.qty}", {"id": row.id})
    return row


def _receipt_ap(row, nds: float) -> float:
    return float(row.qty) * float(row.price_uzs) * (1 + nds if row.vat else 1)


@router.put("/material-receipts/{rid}", response_model=ReceiptOut)
async def update_receipt(rid: int, body: ReceiptBase, current: User = Depends(require("materials:edit")), db: AsyncSession = Depends(get_db)):
    row = await db.get(MaterialReceipt, rid)
    if not row:
        raise HTTPException(404, detail="Не найдено")
    old_mat = row.material_id
    nds = (await get_rates(db))["nds_rate"]
    old_org, old_ap = row.organization_id, _receipt_ap(row, nds)
    for k, v in body.model_dump().items():
        setattr(row, k, v)
    await db.flush()
    await recompute_material(db, old_mat)
    if row.material_id != old_mat:
        await recompute_material(db, row.material_id)
    await _post_bal(db, old_org, old_ap, +1)  # снять старую кредиторку
    await _post_bal(db, row.organization_id, _receipt_ap(row, nds), -1)  # новая
    await db.commit()
    await db.refresh(row, ["material", "organization"])
    await record(db, current, "edit", "material_receipt", f"#{rid}")
    return row


@router.delete("/material-receipts/{rid}", status_code=204)
async def delete_receipt(rid: int, current: User = Depends(require("materials:delete")), db: AsyncSession = Depends(get_db)):
    row = await db.get(MaterialReceipt, rid)
    if not row:
        raise HTTPException(404, detail="Не найдено")
    mid = row.material_id
    nds = (await get_rates(db))["nds_rate"]
    await _post_bal(db, row.organization_id, _receipt_ap(row, nds), +1)  # снять кредиторку
    await db.delete(row)
    await db.flush()
    await recompute_material(db, mid)
    await db.commit()
    await record(db, current, "delete", "material_receipt", f"#{rid}")


# ================= MATERIAL ISSUES =================
@router.get("/material-issues", response_model=list[IssueOut])
async def list_issues(_: User = Depends(require("materials:view")), db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(MaterialIssue).options(selectinload(MaterialIssue.material)).order_by(MaterialIssue.doc_date.desc(), MaterialIssue.id.desc())
    )
    return res.scalars().all()


@router.post("/material-issues", response_model=IssueOut, status_code=201)
async def create_issue(body: IssueBase, current: User = Depends(require("materials:create")), db: AsyncSession = Depends(get_db)):
    mat = await db.get(Material, body.material_id)
    if not mat:
        raise HTTPException(404, detail="Материал не найден")
    if float(mat.stock_qty) < body.qty:
        raise HTTPException(400, detail=f"Недостаточно на складе: остаток {mat.stock_qty} {mat.unit}")
    row = MaterialIssue(**body.model_dump(), created_by=current.id)
    db.add(row)
    await db.flush()
    await recompute_material(db, row.material_id)
    await db.commit()
    await db.refresh(row, ["material"])
    await record(db, current, "create", "material_issue", f"{body.qty}", {"id": row.id})
    return row


@router.put("/material-issues/{rid}", response_model=IssueOut)
async def update_issue(rid: int, body: IssueBase, current: User = Depends(require("materials:edit")), db: AsyncSession = Depends(get_db)):
    row = await db.get(MaterialIssue, rid)
    if not row:
        raise HTTPException(404, detail="Не найдено")
    old_mat = row.material_id
    for k, v in body.model_dump().items():
        setattr(row, k, v)
    await db.flush()
    await recompute_material(db, old_mat)
    if row.material_id != old_mat:
        await recompute_material(db, row.material_id)
    await db.commit()
    await db.refresh(row, ["material"])
    await record(db, current, "edit", "material_issue", f"#{rid}")
    return row


@router.delete("/material-issues/{rid}", status_code=204)
async def delete_issue(rid: int, current: User = Depends(require("materials:delete")), db: AsyncSession = Depends(get_db)):
    row = await db.get(MaterialIssue, rid)
    if not row:
        raise HTTPException(404, detail="Не найдено")
    mid = row.material_id
    await db.delete(row)
    await db.flush()
    await recompute_material(db, mid)
    await db.commit()
    await record(db, current, "delete", "material_issue", f"#{rid}")


# ================= PRODUCTION =================
@router.get("/productions", response_model=list[ProductionOut])
async def list_prod(_: User = Depends(require("production:view")), db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(Production).options(selectinload(Production.product)).order_by(Production.doc_date.desc(), Production.id.desc())
    )
    return res.scalars().all()


@router.post("/productions", response_model=ProductionOut, status_code=201)
async def create_prod(body: ProductionBase, current: User = Depends(require("production:create")), db: AsyncSession = Depends(get_db)):
    row = Production(**body.model_dump(), created_by=current.id)
    db.add(row)
    await db.flush()
    await recompute_product(db, row.product_id)
    await db.commit()
    await db.refresh(row, ["product"])
    await record(db, current, "create", "production", f"{body.qty}", {"id": row.id})
    return row


@router.put("/productions/{rid}", response_model=ProductionOut)
async def update_prod(rid: int, body: ProductionBase, current: User = Depends(require("production:edit")), db: AsyncSession = Depends(get_db)):
    row = await db.get(Production, rid)
    if not row:
        raise HTTPException(404, detail="Не найдено")
    old_p = row.product_id
    for k, v in body.model_dump().items():
        setattr(row, k, v)
    await db.flush()
    await recompute_product(db, old_p)
    if row.product_id != old_p:
        await recompute_product(db, row.product_id)
    await db.commit()
    await db.refresh(row, ["product"])
    await record(db, current, "edit", "production", f"#{rid}")
    return row


@router.delete("/productions/{rid}", status_code=204)
async def delete_prod(rid: int, current: User = Depends(require("production:delete")), db: AsyncSession = Depends(get_db)):
    row = await db.get(Production, rid)
    if not row:
        raise HTTPException(404, detail="Не найдено")
    pid = row.product_id
    await db.delete(row)
    await db.flush()
    await recompute_product(db, pid)
    await db.commit()
    await record(db, current, "delete", "production", f"#{rid}")


# ================= SALES =================
@router.get("/sales", response_model=list[SaleOut])
async def list_sales(current: User = Depends(require("sales:view")), db: AsyncSession = Depends(get_db)):
    stmt = select(Sale).options(selectinload(Sale.product), selectinload(Sale.organization)).order_by(Sale.doc_date.desc(), Sale.id.desc())
    if current.organization_id and not current.is_superadmin:
        stmt = stmt.where(Sale.organization_id == current.organization_id)
    res = await db.execute(stmt)
    return res.scalars().all()


@router.post("/sales", response_model=SaleOut, status_code=201)
async def create_sale(body: SaleBase, current: User = Depends(require("sales:create")), db: AsyncSession = Depends(get_db)):
    prod = await db.get(Product, body.product_id)
    if not prod:
        raise HTTPException(404, detail="Продукция не найдена")
    if float(prod.stock_qty) < body.qty:
        raise HTTPException(400, detail=f"Недостаточно на складе: остаток {prod.stock_qty} {prod.unit}")
    row = Sale(**body.model_dump(), created_by=current.id)
    db.add(row)
    await db.flush()
    await recompute_product(db, row.product_id)
    # продажа -> дебиторка покупателя (нам должны за отгрузку, с НДС)
    await _post_bal(db, row.organization_id, float(row.qty) * float(row.price_uzs), +1)
    await db.commit()
    await db.refresh(row, ["product", "organization"])
    await record(db, current, "create", "sale", f"{body.qty}", {"id": row.id})
    return row


@router.put("/sales/{rid}", response_model=SaleOut)
async def update_sale(rid: int, body: SaleBase, current: User = Depends(require("sales:edit")), db: AsyncSession = Depends(get_db)):
    row = await db.get(Sale, rid)
    if not row:
        raise HTTPException(404, detail="Не найдено")
    old_p = row.product_id
    old_org, old_amt = row.organization_id, float(row.qty) * float(row.price_uzs)
    for k, v in body.model_dump().items():
        setattr(row, k, v)
    await db.flush()
    await recompute_product(db, old_p)
    if row.product_id != old_p:
        await recompute_product(db, row.product_id)
    await _post_bal(db, old_org, old_amt, -1)  # снять старую дебиторку
    await _post_bal(db, row.organization_id, float(row.qty) * float(row.price_uzs), +1)  # новая
    await db.commit()
    await db.refresh(row, ["product", "organization"])
    await record(db, current, "edit", "sale", f"#{rid}")
    return row


@router.delete("/sales/{rid}", status_code=204)
async def delete_sale(rid: int, current: User = Depends(require("sales:delete")), db: AsyncSession = Depends(get_db)):
    row = await db.get(Sale, rid)
    if not row:
        raise HTTPException(404, detail="Не найдено")
    pid = row.product_id
    await _post_bal(db, row.organization_id, float(row.qty) * float(row.price_uzs), -1)  # снять дебиторку
    await db.delete(row)
    await db.flush()
    await recompute_product(db, pid)
    await db.commit()
    await record(db, current, "delete", "sale", f"#{rid}")
