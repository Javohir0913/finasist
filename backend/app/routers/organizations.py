from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..events import record
from ..ledger import LEDGER_KEYS, recompute_org_balances
from ..models import (
    Loan,
    MaterialReceipt,
    Organization,
    Sale,
    Service,
    Transaction,
    User,
)
from ..schemas import OrgCreate, OrgOut, OrgUpdate
from ..security import require

router = APIRouter(prefix="/api/organizations", tags=["organizations"])


@router.get("", response_model=list[OrgOut])
async def list_orgs(
    category: str | None = None,
    ledger: str | None = None,
    q: str | None = Query(None),
    _: User = Depends(require("organizations:view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Organization).order_by(Organization.name)
    if category:
        stmt = stmt.where(Organization.category == category)
    if ledger:
        stmt = stmt.where(Organization.ledger == ledger)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Organization.name.ilike(like), Organization.inn.ilike(like)))
    result = await db.execute(stmt)
    return result.scalars().all()


def _check_ledger(value: str | None):
    if value and value not in LEDGER_KEYS:
        raise HTTPException(400, detail=f"Неизвестный вид ведомости: {value}")


@router.post("", response_model=OrgOut, status_code=201)
async def create_org(
    body: OrgCreate,
    current: User = Depends(require("organizations:create")),
    db: AsyncSession = Depends(get_db),
):
    _check_ledger(body.ledger)
    org = Organization(**body.model_dump())
    db.add(org)
    await db.flush()
    # сальдо = входящее + обороты по документам, а не то, что прислал клиент
    await recompute_org_balances(db, [org.id])
    await db.commit()
    await db.refresh(org)
    await record(db, current, "create", "organization", org.name, {"id": org.id})
    return org


@router.put("/{org_id}", response_model=OrgOut)
async def update_org(
    org_id: int,
    body: OrgUpdate,
    current: User = Depends(require("organizations:edit")),
    db: AsyncSession = Depends(get_db),
):
    org = await db.get(Organization, org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Организация не найдена")
    _check_ledger(body.ledger)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(org, k, v)
    await db.flush()
    await recompute_org_balances(db, [org.id])
    await db.commit()
    await db.refresh(org)
    await record(db, current, "edit", "organization", org.name, {"id": org.id})
    return org


@router.delete("/{org_id}", status_code=204)
async def delete_org(
    org_id: int,
    current: User = Depends(require("organizations:delete")),
    db: AsyncSession = Depends(get_db),
):
    org = await db.get(Organization, org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Организация не найдена")

    # protect financial integrity: block deletion while linked records exist
    async def count(model, label: str) -> tuple[str, int]:
        n = await db.scalar(
            select(func.count(model.id)).where(model.organization_id == org_id)
        )
        return label, int(n or 0)

    blockers = [
        f"{label}: {n}"
        for label, n in [
            await count(Transaction, "операции"),
            await count(User, "пользователи"),
            await count(Loan, "займы"),
            await count(MaterialReceipt, "приход ТМЦ"),
            await count(Sale, "продажи"),
            await count(Service, "услуги"),
        ]
        if n
    ]
    if blockers:
        raise HTTPException(
            status_code=400,
            detail="Нельзя удалить организацию — есть связанные записи ("
            + ", ".join(blockers)
            + "). Сначала удалите или перепривяжите их.",
        )

    name = org.name
    await db.delete(org)
    await db.commit()
    await record(db, current, "delete", "organization", name)
