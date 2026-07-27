from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..events import record
from ..models import Loan, Organization, Transaction, User
from ..schemas import OrgCreate, OrgOut, OrgUpdate
from ..security import require

router = APIRouter(prefix="/api/organizations", tags=["organizations"])


@router.get("", response_model=list[OrgOut])
async def list_orgs(
    category: str | None = None,
    q: str | None = Query(None),
    _: User = Depends(require("organizations:view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Organization).order_by(Organization.name)
    if category:
        stmt = stmt.where(Organization.category == category)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Organization.name.ilike(like), Organization.inn.ilike(like)))
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("", response_model=OrgOut, status_code=201)
async def create_org(
    body: OrgCreate,
    current: User = Depends(require("organizations:create")),
    db: AsyncSession = Depends(get_db),
):
    org = Organization(**body.model_dump())
    db.add(org)
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
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(org, k, v)
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
    tx_count = await db.scalar(
        select(func.count(Transaction.id)).where(Transaction.organization_id == org_id)
    )
    user_count = await db.scalar(
        select(func.count(User.id)).where(User.organization_id == org_id)
    )
    loan_count = await db.scalar(
        select(func.count(Loan.id)).where(Loan.organization_id == org_id)
    )
    blockers = []
    if tx_count:
        blockers.append(f"операции: {tx_count}")
    if user_count:
        blockers.append(f"пользователи: {user_count}")
    if loan_count:
        blockers.append(f"займы: {loan_count}")
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
