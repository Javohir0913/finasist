"""Справочники: коды расходов, коды Cash Flow, подразделения,
банковские счета и кассы (листы «ОСТАТОК UZS/USD», «БАНК», «КАССА»)."""
import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..events import record
from ..ledger import LEDGERS, OPENING_DATE_REQUIRED
from ..models import (
    BankAccount,
    CashRegister,
    CashflowCode,
    Division,
    Employee,
    ExpenseCode,
    MaterialIssue,
    MaterialReceipt,
    Production,
    Sale,
    Service,
    Transaction,
    User,
)
from ..periods import assert_open
from ..rates import get_rates
from ..schemas import (
    BankAccountBase,
    BankAccountOut,
    BankAccountUpdate,
    CashRegisterBase,
    CashRegisterOut,
    CashRegisterUpdate,
    CodeBase,
    CodeOut,
    CodeUpdate,
    DivisionBase,
    DivisionOut,
)
from ..security import get_current_user, require

router = APIRouter(prefix="/api", tags=["directories"])


_REF = json.loads((Path(__file__).parent.parent / "seed_data.json").read_text(encoding="utf-8"))


@router.get("/ledger-types")
async def ledger_types(_: User = Depends(require("articles:view"))):
    """Виды ведомостей Дт-Кт (по листам Excel)."""
    return [{"key": k, "label": v} for k, v in LEDGERS]


# строки ОФР, куда может попасть статья расходов
PNL_GROUPS = [
    ("prod", "Производственные (в себестоимость)"),
    ("sell", "Расходы по реализации (050)"),
    ("admin", "Административные расходы (060)"),
    ("other", "Прочие операционные расходы (070)"),
    ("financial", "Расходы по финансовой деятельности (130)"),
    ("extraordinary", "Чрезвычайные убытки (230)"),
    ("profit_tax", "Прочие налоги и сборы от прибыли (260)"),
    ("income", "Прочие доходы (090)"),
    ("subtotal", "Итоговая строка группы — в расчётах не участвует"),
    ("asset", "Покупка ТМЗ — в себестоимость идёт через склад"),
]
CF_ACTIVITIES = [
    ("operating", "Операционная деятельность"),
    ("investing", "Инвестиционная деятельность"),
    ("financing", "Финансовая деятельность"),
]
PNL_KEYS = {k for k, _ in PNL_GROUPS}
CF_KEYS = {k for k, _ in CF_ACTIVITIES}


@router.get("/lookups")
async def lookups(_: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Списки-подсказки из книги Excel (лист «INFO зарплата» и «INFO»)."""
    return {
        # ставка НДС настраиваемая — форма должна подписывать её так же, как
        # считает сервер, иначе «12 %» в интерфейсе разойдётся с расчётом
        "ndsRate": (await get_rates(db))["nds_rate"],
        "payCategories": _REF.get("payCategories", []),
        "payGroups": _REF.get("payGroups", []),
        "payStatuses": _REF.get("payStatuses", []),
        "payStates": _REF.get("payStates", []),
        "paymentTypes": _REF.get("paymentTypes", []),
        "sources": _REF.get("sources", []),
        "vatTypes": _REF.get("vatTypes", []),
        "departments": ["АУП", "ПП", "ТП", "ВП", "ОП", "С"],
        "pnlGroups": [{"key": k, "label": v} for k, v in PNL_GROUPS],
        "cfActivities": [{"key": k, "label": v} for k, v in CF_ACTIVITIES],
    }


def _code_fields(body, model, allowed: set[str], field: str, valid: set[str]) -> dict:
    """Оставить только поля, которые есть у модели, и проверить классификацию."""
    data = {
        k: v for k, v in body.model_dump(exclude_unset=True).items()
        if k in {"code", "name"} | allowed
    }
    if field in data and data[field] not in valid:
        raise HTTPException(400, detail=f"Недопустимое значение «{data[field]}»")
    return data


# ---------- Expense codes ----------
@router.get("/expense-codes", response_model=list[CodeOut])
async def list_expense_codes(
    _: User = Depends(require("articles:view")), db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(ExpenseCode).order_by(ExpenseCode.code))
    return res.scalars().all()


@router.post("/expense-codes", response_model=CodeOut, status_code=201)
async def create_expense_code(
    body: CodeBase,
    current: User = Depends(require("articles:create")),
    db: AsyncSession = Depends(get_db),
):
    if await db.scalar(select(ExpenseCode).where(ExpenseCode.code == body.code)):
        raise HTTPException(400, detail="Такой код уже существует")
    row = ExpenseCode(**_code_fields(body, ExpenseCode, {"pnl_group"}, "pnl_group", PNL_KEYS))
    db.add(row)
    await db.commit()
    await db.refresh(row)
    await record(db, current, "create", "expense_code", f"{row.code} {row.name}")
    return row


@router.put("/expense-codes/{cid}", response_model=CodeOut)
async def update_expense_code(
    cid: int,
    body: CodeUpdate,
    current: User = Depends(require("articles:edit")),
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(ExpenseCode, cid)
    if not row:
        raise HTTPException(404, detail="Код не найден")
    for k, v in _code_fields(body, ExpenseCode, {"pnl_group"}, "pnl_group", PNL_KEYS).items():
        setattr(row, k, v)
    await db.commit()
    await db.refresh(row)
    await record(db, current, "edit", "expense_code", row.code)
    return row


@router.delete("/expense-codes/{cid}", status_code=204)
async def delete_expense_code(
    cid: int,
    current: User = Depends(require("articles:delete")),
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(ExpenseCode, cid)
    if not row:
        raise HTTPException(404, detail="Код не найден")
    code = row.code
    await db.delete(row)
    await db.commit()
    await record(db, current, "delete", "expense_code", code)


# ---------- Cash Flow codes ----------
@router.get("/cashflow-codes", response_model=list[CodeOut])
async def list_cf_codes(
    _: User = Depends(require("articles:view")), db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(CashflowCode).order_by(CashflowCode.code))
    return res.scalars().all()


@router.post("/cashflow-codes", response_model=CodeOut, status_code=201)
async def create_cf_code(
    body: CodeBase,
    current: User = Depends(require("articles:create")),
    db: AsyncSession = Depends(get_db),
):
    if await db.scalar(select(CashflowCode).where(CashflowCode.code == body.code)):
        raise HTTPException(400, detail="Такой код уже существует")
    row = CashflowCode(**_code_fields(body, CashflowCode, {"activity"}, "activity", CF_KEYS))
    db.add(row)
    await db.commit()
    await db.refresh(row)
    await record(db, current, "create", "cashflow_code", f"{row.code} {row.name}")
    return row


@router.put("/cashflow-codes/{cid}", response_model=CodeOut)
async def update_cf_code(
    cid: int,
    body: CodeUpdate,
    current: User = Depends(require("articles:edit")),
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(CashflowCode, cid)
    if not row:
        raise HTTPException(404, detail="Код не найден")
    for k, v in _code_fields(body, CashflowCode, {"activity"}, "activity", CF_KEYS).items():
        setattr(row, k, v)
    await db.commit()
    await db.refresh(row)
    await record(db, current, "edit", "cashflow_code", row.code)
    return row


@router.delete("/cashflow-codes/{cid}", status_code=204)
async def delete_cf_code(
    cid: int,
    current: User = Depends(require("articles:delete")),
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(CashflowCode, cid)
    if not row:
        raise HTTPException(404, detail="Код не найден")
    code = row.code
    await db.delete(row)
    await db.commit()
    await record(db, current, "delete", "cashflow_code", code)


# ---------- Divisions ----------
@router.get("/divisions", response_model=list[DivisionOut])
async def list_divisions(
    _: User = Depends(require("articles:view")), db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(Division).order_by(Division.id))
    return res.scalars().all()


@router.post("/divisions", response_model=DivisionOut, status_code=201)
async def create_division(
    body: DivisionBase,
    current: User = Depends(require("articles:create")),
    db: AsyncSession = Depends(get_db),
):
    if await db.scalar(select(Division).where(Division.name == body.name)):
        raise HTTPException(400, detail="Подразделение уже существует")
    row = Division(**body.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    await record(db, current, "create", "division", row.name)
    return row


# во всех документах подразделение хранится строкой — при переименовании
# и удалении надо пройтись по каждой такой колонке
DIVISION_REFS = [
    (Transaction, Transaction.division, "операции"),
    (MaterialReceipt, MaterialReceipt.division, "приход ТМЦ"),
    (MaterialIssue, MaterialIssue.division, "расход ТМЦ"),
    (Production, Production.division, "производство"),
    (Sale, Sale.division, "продажи"),
    (Service, Service.division, "услуги"),
    (Employee, Employee.division, "сотрудники"),
    (CashRegister, CashRegister.division, "кассы"),
]


async def _division_usage(db: AsyncSession, name: str) -> list[str]:
    used = []
    for model, col, label in DIVISION_REFS:
        n = await db.scalar(select(func.count(model.id)).where(col == name))
        if n:
            used.append(f"{label}: {n}")
    return used


@router.put("/divisions/{did}", response_model=DivisionOut)
async def update_division(
    did: int,
    body: DivisionBase,
    current: User = Depends(require("articles:edit")),
    db: AsyncSession = Depends(get_db),
):
    """Переименование с обновлением ссылок во всех документах."""
    row = await db.get(Division, did)
    if not row:
        raise HTTPException(404, detail="Подразделение не найдено")
    new = (body.name or "").strip()
    if not new:
        raise HTTPException(400, detail="Название не может быть пустым")
    if new == row.name:
        return row
    dup = await db.scalar(select(Division).where(Division.name == new, Division.id != did))
    if dup:
        raise HTTPException(400, detail=f"Подразделение «{new}» уже существует")
    old = row.name
    row.name = new
    for model, col, _ in DIVISION_REFS:
        await db.execute(update(model).where(col == old).values(division=new))
    await db.commit()
    await db.refresh(row)
    await record(db, current, "edit", "division", f"{old} -> {new}")
    return row


@router.delete("/divisions/{did}", status_code=204)
async def delete_division(
    did: int,
    current: User = Depends(require("articles:delete")),
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(Division, did)
    if not row:
        raise HTTPException(404, detail="Подразделение не найдено")
    used = await _division_usage(db, row.name)
    if used:
        raise HTTPException(
            400,
            detail="Нельзя удалить — подразделение используется (" + ", ".join(used)
            + "). Переименуйте его или сначала перепривяжите документы.",
        )
    name = row.name
    await db.delete(row)
    await db.commit()
    await record(db, current, "delete", "division", name)


# ---------- Банковские счета ----------
@router.get("/bank-accounts", response_model=list[BankAccountOut])
async def list_bank_accounts(
    _: User = Depends(require("articles:view")), db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(BankAccount).order_by(BankAccount.id))
    return res.scalars().all()


def _check_opening_date(row) -> None:
    """Входящий остаток без даты не принимаем — см. OPENING_DATE_REQUIRED."""
    has_opening = float(row.opening_uzs or 0) or float(getattr(row, "opening_usd", 0) or 0)
    if has_opening and not row.opening_date:
        raise HTTPException(400, detail=OPENING_DATE_REQUIRED)


@router.post("/bank-accounts", response_model=BankAccountOut, status_code=201)
async def create_bank_account(
    body: BankAccountBase,
    current: User = Depends(require("articles:create")),
    db: AsyncSession = Depends(get_db),
):
    row = BankAccount(**body.model_dump())
    _check_opening_date(row)
    await assert_open(db, row.opening_date, what="входящий остаток счёта")
    db.add(row)
    await db.commit()
    await db.refresh(row)
    await record(db, current, "create", "bank_account", row.name)
    return row


@router.put("/bank-accounts/{bid}", response_model=BankAccountOut)
async def update_bank_account(
    bid: int,
    body: BankAccountUpdate,
    current: User = Depends(require("articles:edit")),
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(BankAccount, bid)
    if not row:
        raise HTTPException(404, detail="Счёт не найден")
    old_opening = row.opening_date
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    _check_opening_date(row)
    await assert_open(db, old_opening, row.opening_date, what="входящий остаток счёта")
    await db.commit()
    await db.refresh(row)
    await record(db, current, "edit", "bank_account", row.name)
    return row


@router.delete("/bank-accounts/{bid}", status_code=204)
async def delete_bank_account(
    bid: int,
    current: User = Depends(require("articles:delete")),
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(BankAccount, bid)
    if not row:
        raise HTTPException(404, detail="Счёт не найден")
    used = await db.scalar(
        select(Transaction.id).where(Transaction.bank_account_id == bid).limit(1)
    )
    if used:
        raise HTTPException(400, detail="По счёту есть операции — удаление запрещено")
    name = row.name
    await db.delete(row)
    await db.commit()
    await record(db, current, "delete", "bank_account", name)


# ---------- Кассы ----------
@router.get("/cash-registers", response_model=list[CashRegisterOut])
async def list_cash_registers(
    _: User = Depends(require("articles:view")), db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(CashRegister).order_by(CashRegister.id))
    return res.scalars().all()


@router.post("/cash-registers", response_model=CashRegisterOut, status_code=201)
async def create_cash_register(
    body: CashRegisterBase,
    current: User = Depends(require("articles:create")),
    db: AsyncSession = Depends(get_db),
):
    row = CashRegister(**body.model_dump())
    _check_opening_date(row)
    await assert_open(db, row.opening_date, what="входящий остаток кассы")
    db.add(row)
    await db.commit()
    await db.refresh(row)
    await record(db, current, "create", "cash_register", row.name)
    return row


@router.put("/cash-registers/{cid}", response_model=CashRegisterOut)
async def update_cash_register(
    cid: int,
    body: CashRegisterUpdate,
    current: User = Depends(require("articles:edit")),
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(CashRegister, cid)
    if not row:
        raise HTTPException(404, detail="Касса не найдена")
    old_opening = row.opening_date
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    _check_opening_date(row)
    await assert_open(db, old_opening, row.opening_date, what="входящий остаток кассы")
    await db.commit()
    await db.refresh(row)
    await record(db, current, "edit", "cash_register", row.name)
    return row


@router.delete("/cash-registers/{cid}", status_code=204)
async def delete_cash_register(
    cid: int,
    current: User = Depends(require("articles:delete")),
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(CashRegister, cid)
    if not row:
        raise HTTPException(404, detail="Касса не найдена")
    used = await db.scalar(
        select(Transaction.id).where(Transaction.cash_register_id == cid).limit(1)
    )
    if used:
        raise HTTPException(400, detail="По кассе есть операции — удаление запрещено")
    name = row.name
    await db.delete(row)
    await db.commit()
    await record(db, current, "delete", "cash_register", name)
