"""Склад и производство: приход/расход сырья, производство и продажа ГП.
Остатки и средняя себестоимость пересчитываются полным реплеем движений
(гарантирует корректность при любом создании/изменении/удалении)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..events import record
from ..ledger import recompute_org_balances
from ..models import (
    ExchangeRate,
    Material,
    MaterialIssue,
    MaterialReceipt,
    MaterialStock,
    Product,
    ProductStock,
    Production,
    Sale,
    User,
)
from ..production import recompute_production
from ..rates import get_rates
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


# ================= ОСТАТКИ ПО ПОДРАЗДЕЛЕНИЯМ =================
@router.get("/material-stocks")
async def material_stocks(
    material_id: int | None = None,
    division: str | None = None,
    kind: str | None = None,
    _: User = Depends(require("materials:view")),
    db: AsyncSession = Depends(get_db),
):
    """Остаток сырья/запчастей в разрезе подразделений (дробилок)."""
    stmt = select(MaterialStock, Material).join(Material, Material.id == MaterialStock.material_id)
    if material_id:
        stmt = stmt.where(MaterialStock.material_id == material_id)
    if division is not None and division != "":
        stmt = stmt.where(MaterialStock.division == division)
    if kind:
        stmt = stmt.where(Material.kind == kind)
    rows = []
    for st, m in (await db.execute(stmt.order_by(Material.code, MaterialStock.division))).all():
        qty, avg = float(st.stock_qty or 0), float(st.avg_cost or 0)
        if not (qty or float(st.opening_qty or 0)):
            continue
        rows.append({
            "material_id": m.id, "code": m.code, "name": m.name, "unit": m.unit, "kind": m.kind,
            "division": st.division or "— общий склад —",
            # сырое значение — им и правим строку, подпись для показа не годится
            "division_key": st.division or "",
            "opening_qty": float(st.opening_qty or 0), "opening_cost": float(st.opening_cost or 0),
            "stock_qty": qty, "avg_cost": avg, "value": round(qty * avg, 2),
        })
    return {"rows": rows, "total_value": round(sum(r["value"] for r in rows), 2)}


@router.put("/material-stocks")
async def set_material_opening(
    body: dict,
    current: User = Depends(require("materials:edit")),
    db: AsyncSession = Depends(get_db),
):
    """Задать входящий остаток номенклатуры на конкретном объекте."""
    mid = int(body.get("material_id") or 0)
    division = (body.get("division") or "").strip()
    if not await db.get(Material, mid):
        raise HTTPException(404, detail="Материал не найден")
    row = await db.scalar(
        select(MaterialStock).where(
            MaterialStock.material_id == mid, MaterialStock.division == division
        )
    )
    if row is None:
        row = MaterialStock(material_id=mid, division=division)
        db.add(row)
    row.opening_qty = float(body.get("opening_qty") or 0)
    row.opening_cost = float(body.get("opening_cost") or 0)
    await db.flush()
    await recompute_material(db, mid)
    await db.commit()
    await record(db, current, "edit", "material_stock", f"#{mid} {division or 'общий'}")
    return {"ok": True}


@router.get("/product-stocks")
async def product_stocks(
    product_id: int | None = None,
    division: str | None = None,
    _: User = Depends(require("products:view")),
    db: AsyncSession = Depends(get_db),
):
    """Остаток готовой продукции в разрезе подразделений."""
    stmt = select(ProductStock, Product).join(Product, Product.id == ProductStock.product_id)
    if product_id:
        stmt = stmt.where(ProductStock.product_id == product_id)
    if division is not None and division != "":
        stmt = stmt.where(ProductStock.division == division)
    rows = []
    for st, p in (await db.execute(stmt.order_by(Product.code, ProductStock.division))).all():
        qty, avg = float(st.stock_qty or 0), float(st.avg_cost or 0)
        if not (qty or float(st.opening_qty or 0)):
            continue
        rows.append({
            "product_id": p.id, "code": p.code, "name": p.name, "unit": p.unit,
            "division": st.division or "— общий склад —",
            "division_key": st.division or "",
            "opening_qty": float(st.opening_qty or 0), "opening_cost": float(st.opening_cost or 0),
            "stock_qty": qty, "avg_cost": avg, "value": round(qty * avg, 2),
        })
    return {"rows": rows, "total_value": round(sum(r["value"] for r in rows), 2)}


@router.put("/product-stocks")
async def set_product_opening(
    body: dict,
    current: User = Depends(require("products:edit")),
    db: AsyncSession = Depends(get_db),
):
    """Задать входящий остаток готовой продукции на конкретном объекте."""
    pid = int(body.get("product_id") or 0)
    division = (body.get("division") or "").strip()
    if not await db.get(Product, pid):
        raise HTTPException(404, detail="Продукция не найдена")
    row = await db.scalar(
        select(ProductStock).where(
            ProductStock.product_id == pid, ProductStock.division == division
        )
    )
    if row is None:
        row = ProductStock(product_id=pid, division=division)
        db.add(row)
    row.opening_qty = float(body.get("opening_qty") or 0)
    row.opening_cost = float(body.get("opening_cost") or 0)
    await db.flush()
    await recompute_product(db, pid)
    await db.commit()
    await record(db, current, "edit", "product_stock", f"#{pid} {division or 'общий'}")
    return {"ok": True}


async def _latest_rate(db: AsyncSession) -> float:
    r = await db.scalar(select(ExchangeRate.rate).order_by(ExchangeRate.rate_date.desc()).limit(1))
    return float(r) if r else 1.0


async def _sync_orgs(db: AsyncSession, *org_ids):
    """Пересчитать Дт-Кт сальдо затронутых контрагентов из первичных документов."""
    ids = [i for i in org_ids if i]
    if ids:
        await recompute_org_balances(db, ids)


async def _check_material_stock(db: AsyncSession, mat: Material, division: str, qty: float,
                                exclude_id: int | None = None):
    """Списывать можно только то, что есть на складе ЭТОГО объекта.

    Без проверки расход с пустого объекта молча уходил бы по нулевой средней
    цене — и себестоимость занижалась бы незаметно.
    """
    d = (division or "").strip()
    have = await db.scalar(
        select(MaterialStock.stock_qty).where(
            MaterialStock.material_id == mat.id, MaterialStock.division == d
        )
    )
    have = float(have or 0)
    if exclude_id:  # при правке своё же старое количество возвращается на склад
        old = await db.scalar(
            select(MaterialIssue.qty).where(
                MaterialIssue.id == exclude_id, MaterialIssue.division == d
            )
        )
        have += float(old or 0)
    if have < qty:
        where = f" на объекте «{d}»" if d else " на общем складе"
        raise HTTPException(
            400,
            detail=f"Недостаточно «{mat.name}»{where}: остаток {have:g} {mat.unit}. "
                   "Сначала оприходуйте материал на этот объект.",
        )


async def _check_stock(db: AsyncSession, prod: Product, division: str, qty: float):
    """Отгружать можно только то, что есть на складе ЭТОГО подразделения."""
    d = (division or "").strip()
    have = await db.scalar(
        select(ProductStock.stock_qty).where(
            ProductStock.product_id == prod.id, ProductStock.division == d
        )
    )
    have = float(have or 0)
    if have < qty:
        where = f" на объекте «{d}»" if d else " на общем складе"
        raise HTTPException(
            400, detail=f"Недостаточно продукции{where}: остаток {have:g} {prod.unit}"
        )

NDS = 0.12


async def _stock_rows(db: AsyncSession, model, fk_col, owner_id: int) -> dict[str, object]:
    """Остатки по подразделениям для одной номенклатуры, ключ — название объекта."""
    rows = (await db.execute(select(model).where(fk_col == owner_id))).scalars().all()
    return {(r.division or ""): r for r in rows}


def _div(obj) -> str:
    return (getattr(obj, "division", "") or "").strip()


async def recompute_material(db: AsyncSession, material_id: int):
    """Полный реплей прихода и расхода — ОТДЕЛЬНО ПО КАЖДОМУ ПОДРАЗДЕЛЕНИЮ.

    В книге склад ведётся по дробилкам: у одной номенклатуры на Махстоне и
    Турке свои количества и своя средняя цена. Списание идёт по средней цене
    того объекта, с которого списывают.
    """
    mat = await db.get(Material, material_id)
    if not mat:
        return
    nds = (await get_rates(db))["nds_rate"]
    recs = (await db.execute(
        select(MaterialReceipt).where(MaterialReceipt.material_id == material_id)
    )).scalars().all()
    iss = (await db.execute(
        select(MaterialIssue).where(MaterialIssue.material_id == material_id)
    )).scalars().all()
    stocks = await _stock_rows(db, MaterialStock, MaterialStock.material_id, material_id)

    events = [("in", r.doc_date, r.id, r) for r in recs] + [("out", i.doc_date, i.id, i) for i in iss]
    events.sort(key=lambda e: (e[1], e[0] != "in", e[2]))  # по дате, приход раньше расхода

    # общий склад ("") участвует всегда: у номенклатуры может быть только
    # входящий остаток из карточки и ни одного движения
    divisions = {_div(x) for x in recs} | {_div(x) for x in iss} | set(stocks) | {""}
    # входящий остаток: из строки подразделения, а для общего склада — из карточки
    state = {}
    for d in divisions:
        row = stocks.get(d)
        if row is not None:
            state[d] = [float(row.opening_qty or 0), float(row.opening_cost or 0)]
        elif d == "":
            state[d] = [float(mat.opening_qty or 0), float(mat.opening_cost or 0)]
        else:
            state[d] = [0.0, 0.0]

    for kind, _d, _id, obj in events:
        d = _div(obj)
        stock, avg = state.setdefault(d, [0.0, 0.0])
        q = float(obj.qty)
        if kind == "in":
            p = float(obj.price_uzs)
            obj.amount_uzs = round(q * p, 2)          # без НДС
            obj.vat_amount = round(obj.amount_uzs * nds, 2) if obj.vat else 0.0
            obj.amount_gross = round(obj.amount_uzs + float(obj.vat_amount), 2)
            new = stock + q
            avg = round((stock * avg + q * p) / new, 4) if new else 0.0
            stock = new
        else:
            obj.cost_uzs = round(q * avg, 2)
            stock -= q
        state[d] = [stock, avg]

    total_qty = total_val = 0.0
    for d, (qty, avg) in state.items():
        row = stocks.get(d)
        if row is None:
            row = MaterialStock(material_id=material_id, division=d)
            if d == "":
                row.opening_qty = mat.opening_qty
                row.opening_cost = mat.opening_cost
            db.add(row)
            stocks[d] = row
        row.stock_qty = round(qty, 3)
        row.avg_cost = round(avg, 2)
        total_qty += qty
        total_val += qty * avg

    # в карточке номенклатуры — свод по всем объектам
    mat.stock_qty = round(total_qty, 3)
    mat.avg_cost = round(total_val / total_qty, 2) if total_qty else 0.0


async def recompute_product(db: AsyncSession, product_id: int):
    """Реплей производства и продаж по каждому подразделению (лист «Остаток ГП»)."""
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
    stocks = await _stock_rows(db, ProductStock, ProductStock.product_id, product_id)

    events = [("in", p.doc_date, p.id, p) for p in prods] + [("out", s.doc_date, s.id, s) for s in sales]
    events.sort(key=lambda e: (e[1], e[0] != "in", e[2]))

    divisions = {_div(x) for x in prods} | {_div(x) for x in sales} | set(stocks) | {""}
    state = {}
    for d in divisions:
        row = stocks.get(d)
        if row is not None:
            state[d] = [float(row.opening_qty or 0), float(row.opening_cost or 0)]
        elif d == "":
            state[d] = [float(prod.opening_qty or 0), float(prod.opening_cost or 0)]
        else:
            state[d] = [0.0, 0.0]

    for kind, _d, _id, obj in events:
        d = _div(obj)
        stock, avg = state.setdefault(d, [0.0, 0.0])
        q = float(obj.qty)
        if kind == "in":
            c = float(obj.unit_cost)
            obj.amount_uzs = round(q * c, 2)
            new = stock + q
            avg = round((stock * avg + q * c) / new, 4) if new else 0.0
            stock = new
        else:
            amount = q * float(obj.price_uzs)
            net = amount / (1 + nds) if obj.vat else amount
            obj.revenue_net = round(net, 2)
            obj.vat_amount = round(amount - net, 2)
            obj.cogs_uzs = round(q * avg, 2)
            stock -= q
        state[d] = [stock, avg]

    total_qty = total_val = 0.0
    for d, (qty, avg) in state.items():
        row = stocks.get(d)
        if row is None:
            row = ProductStock(product_id=product_id, division=d)
            if d == "":
                row.opening_qty = prod.opening_qty
                row.opening_cost = prod.opening_cost
            db.add(row)
            stocks[d] = row
        row.stock_qty = round(qty, 3)
        row.avg_cost = round(avg, 2)
        total_qty += qty
        total_val += qty * avg

    prod.stock_qty = round(total_qty, 3)
    prod.avg_cost = round(total_val / total_qty, 2) if total_qty else 0.0


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
    await recompute_production(db, row.division, row.doc_date)
    await _sync_orgs(db, row.organization_id)
    await db.commit()
    await db.refresh(row, ["material", "organization"])
    await record(db, current, "create", "material_receipt", f"{body.qty}", {"id": row.id})
    return row


@router.put("/material-receipts/{rid}", response_model=ReceiptOut)
async def update_receipt(rid: int, body: ReceiptBase, current: User = Depends(require("materials:edit")), db: AsyncSession = Depends(get_db)):
    row = await db.get(MaterialReceipt, rid)
    if not row:
        raise HTTPException(404, detail="Не найдено")
    old_mat, old_org = row.material_id, row.organization_id
    old_div, old_date = row.division, row.doc_date
    for k, v in body.model_dump().items():
        setattr(row, k, v)
    await db.flush()
    await recompute_material(db, old_mat)
    if row.material_id != old_mat:
        await recompute_material(db, row.material_id)
    await recompute_production(db, old_div, old_date)
    await recompute_production(db, row.division, row.doc_date)
    await _sync_orgs(db, old_org, row.organization_id)
    await db.commit()
    await db.refresh(row, ["material", "organization"])
    await record(db, current, "edit", "material_receipt", f"#{rid}")
    return row


@router.delete("/material-receipts/{rid}", status_code=204)
async def delete_receipt(rid: int, current: User = Depends(require("materials:delete")), db: AsyncSession = Depends(get_db)):
    row = await db.get(MaterialReceipt, rid)
    if not row:
        raise HTTPException(404, detail="Не найдено")
    mid, org_id = row.material_id, row.organization_id
    div, when = row.division, row.doc_date
    await db.delete(row)
    await db.flush()
    await recompute_material(db, mid)
    await recompute_production(db, div, when)
    await _sync_orgs(db, org_id)
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
    await _check_material_stock(db, mat, body.division, body.qty)
    row = MaterialIssue(**body.model_dump(), created_by=current.id)
    db.add(row)
    await db.flush()
    await recompute_material(db, row.material_id)
    await recompute_production(db, row.division, row.doc_date)
    await db.commit()
    await db.refresh(row, ["material"])
    await record(db, current, "create", "material_issue", f"{body.qty}", {"id": row.id})
    return row


@router.put("/material-issues/{rid}", response_model=IssueOut)
async def update_issue(rid: int, body: IssueBase, current: User = Depends(require("materials:edit")), db: AsyncSession = Depends(get_db)):
    row = await db.get(MaterialIssue, rid)
    if not row:
        raise HTTPException(404, detail="Не найдено")
    old_mat, old_div, old_date = row.material_id, row.division, row.doc_date
    mat = await db.get(Material, body.material_id)
    if not mat:
        raise HTTPException(404, detail="Материал не найден")
    await _check_material_stock(db, mat, body.division, body.qty, exclude_id=rid)
    for k, v in body.model_dump().items():
        setattr(row, k, v)
    await db.flush()
    await recompute_material(db, old_mat)
    if row.material_id != old_mat:
        await recompute_material(db, row.material_id)
    await recompute_production(db, old_div, old_date)
    await recompute_production(db, row.division, row.doc_date)
    await db.commit()
    await db.refresh(row, ["material"])
    await record(db, current, "edit", "material_issue", f"#{rid}")
    return row


@router.delete("/material-issues/{rid}", status_code=204)
async def delete_issue(rid: int, current: User = Depends(require("materials:delete")), db: AsyncSession = Depends(get_db)):
    row = await db.get(MaterialIssue, rid)
    if not row:
        raise HTTPException(404, detail="Не найдено")
    mid, div, when = row.material_id, row.division, row.doc_date
    await db.delete(row)
    await db.flush()
    await recompute_material(db, mid)
    await recompute_production(db, div, when)
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
    # себестоимость не принимаем: она делится на весь выпуск месяца и потому
    # пересчитывается после каждого документа — см. app/production.py
    data = body.model_dump()
    data.pop("unit_cost", None)
    row = Production(**data, created_by=current.id)
    db.add(row)
    await db.flush()
    await recompute_production(db, row.division, row.doc_date)
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
    old_p, old_div, old_date = row.product_id, row.division, row.doc_date
    data = body.model_dump()
    data.pop("unit_cost", None)
    for k, v in data.items():
        setattr(row, k, v)
    await db.flush()
    await recompute_production(db, old_div, old_date)
    await recompute_production(db, row.division, row.doc_date)
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
    pid, div, when = row.product_id, row.division, row.doc_date
    await db.delete(row)
    await db.flush()
    await recompute_production(db, div, when)
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
    await _check_stock(db, prod, body.division, body.qty)
    row = Sale(**body.model_dump(), created_by=current.id)
    db.add(row)
    await db.flush()
    await recompute_product(db, row.product_id)
    # продажа -> дебиторка покупателя (нам должны за отгрузку, с НДС)
    await _sync_orgs(db, row.organization_id)
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
    old_org = row.organization_id
    for k, v in body.model_dump().items():
        setattr(row, k, v)
    await db.flush()
    await recompute_product(db, old_p)
    if row.product_id != old_p:
        await recompute_product(db, row.product_id)
    await _sync_orgs(db, old_org, row.organization_id)
    await db.commit()
    await db.refresh(row, ["product", "organization"])
    await record(db, current, "edit", "sale", f"#{rid}")
    return row


@router.delete("/sales/{rid}", status_code=204)
async def delete_sale(rid: int, current: User = Depends(require("sales:delete")), db: AsyncSession = Depends(get_db)):
    row = await db.get(Sale, rid)
    if not row:
        raise HTTPException(404, detail="Не найдено")
    pid, org_id = row.product_id, row.organization_id
    await db.delete(row)
    await db.flush()
    await recompute_product(db, pid)
    await _sync_orgs(db, org_id)
    await db.commit()
    await record(db, current, "delete", "sale", f"#{rid}")
