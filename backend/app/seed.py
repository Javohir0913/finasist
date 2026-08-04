"""Bootstrap: super admin, roles, and ALL reference directories from the
PROFIT DIVIDER workbook (organizations, expense/CF codes, products, materials,
divisions, cash registers, payroll directories) — loaded with ZERO balances.

Сид ИДЕМПОТЕНТЕН: справочники дополняются при каждом старте (без затирания
введённых данных), а супер-админ и роли создаются только один раз.
"""
import json
from pathlib import Path

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .models import (
    CashRegister,
    CashflowCode,
    Division,
    Employee,
    ExpenseCode,
    Material,
    MaterialReceipt,
    Organization,
    Product,
    Role,
    Setting,
    Tax,
    Transaction,
    User,
)
from .permissions import all_permissions
from .security import hash_password

DATA = Path(__file__).parent / "seed_data.json"

# ранние версии сида использовали латинские названия подразделений —
# приводим к названиям из Excel, сохраняя ссылки в документах
DIVISION_RENAMES = {
    "Maxston": "Махстон",
    "Turk": "Турк",
    "Jbi": "Жби",
    "Ofis": "Офис",
}

BUKH_PERMS = [
    "dashboard:view",
    "organizations:view", "organizations:create", "organizations:edit",
    "articles:view", "articles:create", "articles:edit",
    "transactions:view", "transactions:create", "transactions:edit",
    "products:view", "products:create", "products:edit",
    "materials:view", "materials:create", "materials:edit",
    "production:view", "production:create", "production:edit",
    "sales:view", "sales:create", "sales:edit",
    "payroll:view", "payroll:create", "payroll:edit",
    "services:view", "services:create", "services:edit",
    "taxes:view", "taxes:create", "taxes:edit",
    "loans:view", "loans:create", "loans:edit",
    "exchange:view", "exchange:create",
    "reports:view", "reports:export",
]

RATES = [
    ("nds_rate", "0.12", "Ставка НДС", "Налоги", "percent"),
    ("ndfl_rate", "0.12", "Ставка НДФЛ", "Налоги", "percent"),
    ("inps_rate", "0", "Ставка ИНПС", "Налоги", "percent"),
    ("esp_rate", "0.12", "Ставка ЕСП (соц. налог)", "Налоги", "percent"),
    ("profit_tax_rate", "0.15", "Ставка налога на прибыль", "Налоги", "percent"),
    ("period_start", "2025-08-01", "Дата начала учёта (входящие сальдо)", "Учёт", "text"),
    ("company_name", 'ООО "PROFIT DIVIDER"', "Наименование предприятия", "Реквизиты", "text"),
    ("company_group", "DURABLE GROUP", "Отрасль / группа", "Реквизиты", "text"),
    # собственный капитал — строки 410/420/430 Формы №1, вводятся вручную
    ("capital_charter", "0", "Уставный капитал (8300)", "Капитал", "number"),
    ("capital_added", "0", "Добавленный капитал (8400)", "Капитал", "number"),
    ("capital_reserve", "0", "Резервный капитал (8500)", "Капитал", "number"),
    # долгосрочные активы — вводятся вручную, пока нет модуля основных средств
    ("fa_cost", "0", "Основные средства: первоначальная стоимость (0100)", "Долгосрочные активы", "number"),
    ("fa_depreciation", "0", "Основные средства: сумма износа (0200)", "Долгосрочные активы", "number"),
    ("ia_cost", "0", "Нематериальные активы (0400)", "Долгосрочные активы", "number"),
    ("ia_depreciation", "0", "Нематериальные активы: износ (0500)", "Долгосрочные активы", "number"),
    ("equipment_install", "0", "Оборудование к установке (0700)", "Долгосрочные активы", "number"),
]

TAX_NAMES = ["НДС", "Налог на прибыль", "НДФЛ", "ИНПС", "ЕСП", "Земельный налог", "Прочие налоги"]


async def _rename_divisions(db: AsyncSession) -> None:
    """Одноразовое приведение старых латинских названий к названиям из Excel."""
    for old, new in DIVISION_RENAMES.items():
        row = await db.scalar(select(Division).where(Division.name == old))
        if not row:
            continue
        if await db.scalar(select(Division).where(Division.name == new)):
            await db.delete(row)
        else:
            row.name = new
        for model in (Transaction, Employee):
            await db.execute(
                update(model).where(model.division == old).values(division=new)
            )


async def _sync_directories(db: AsyncSession, ref: dict) -> None:
    """Первичное наполнение справочников.

    Каждый справочник заполняется ТОЛЬКО когда он пуст. Иначе удалённая
    пользователем запись возвращалась бы при каждом перезапуске.

    Флаг «directories_seeded» отключает наполнение совсем. Он ставится, когда
    базу намеренно очистили под ручной ввод: пустой справочник — это выбор
    пользователя, а не признак новой установки.
    """
    async def existing(model, col):
        return {v for (v,) in (await db.execute(select(col))).all()}

    manual = await db.scalar(
        select(Setting.value).where(Setting.key == "directories_seeded")
    )

    async def is_empty(model) -> bool:
        if manual:
            return False
        return not await db.scalar(select(func.count()).select_from(model))

    if await is_empty(Division):
        db.add_all([Division(name=n) for n in ref["divisions"]])

    if await is_empty(ExpenseCode):
        db.add_all([
            ExpenseCode(code=c["code"], name=c["name"], pnl_group=c.get("pnl") or "admin")
            for c in ref["expenseCodes"]
        ])
    if await is_empty(CashflowCode):
        db.add_all([
            CashflowCode(code=c["code"], name=c["name"], activity=c.get("activity") or "operating")
            for c in ref["cashflowCodes"]
        ])
    if await is_empty(CashRegister):
        db.add_all([CashRegister(name=n) for n in ref.get("cashRegisters", [])])

    # Разовые правки классификации для баз, заведённых до её появления.
    # Каждая помечается флагом в «Настройках», поэтому при рестарте выбор
    # пользователя больше не перетирается.
    await db.flush()
    if not await db.scalar(select(Setting).where(Setting.key == "codes_classified")):
        by_code = {c["code"]: c for c in ref["expenseCodes"]}
        for ec in (await db.execute(select(ExpenseCode))).scalars().all():
            src = by_code.get(ec.code)
            if src:
                ec.pnl_group = src.get("pnl") or "admin"
        cf_ref = {c["code"]: c for c in ref["cashflowCodes"]}
        for cc in (await db.execute(select(CashflowCode))).scalars().all():
            src = cf_ref.get(cc.code)
            if src:
                cc.activity = src.get("activity") or "operating"
        db.add(Setting(key="codes_classified", value="1",
                       label="Классификация кодов перенесена", group="Служебное", kind="text"))

    # Итоговые строки книги (2010, 9410, 9420, 9430) и «Стоимость приобретенных
    # ТМЗ» (2011) не должны участвовать в расчётах — иначе двойной счёт.
    if not await db.scalar(select(Setting).where(Setting.key == "codes_subtotals")):
        special = {c["code"]: c["pnl"] for c in ref["expenseCodes"]
                   if c.get("pnl") in ("subtotal", "asset")}
        for ec in (await db.execute(select(ExpenseCode))).scalars().all():
            if ec.code in special:
                ec.pnl_group = special[ec.code]
        db.add(Setting(key="codes_subtotals", value="1",
                       label="Итоговые статьи размечены", group="Служебное", kind="text"))

    # разовая классификация организаций по ведомостям Дт-Кт (листы книги)
    if not await db.scalar(select(Setting).where(Setting.key == "orgs_classified")):
        by_name = {o["name"].upper(): o for o in ref["orgs"]}
        for org in (await db.execute(select(Organization))).scalars().all():
            src = by_name.get((org.name or "").upper())
            if src and org.ledger in ("", "other") and org.category in ("", "other"):
                org.ledger = src.get("ledger") or "other"
                org.category = src.get("category") or "other"
        db.add(Setting(key="orgs_classified", value="1",
                       label="Организации разнесены по ведомостям", group="Служебное", kind="text"))

    if await is_empty(Organization):
        for o in ref["orgs"]:
            vat = o.get("vat") or ""
            db.add(
                Organization(
                    inn=str(o.get("inn") or ""),
                    name=o["name"],
                    category=o.get("category") or "other",
                    ledger=o.get("ledger") or "other",
                    belongs_to=o.get("group") or "Прочие",
                    nds_payer="с учет" in vat.lower(),
                    nds_type=vat,
                )
            )

    if await is_empty(Product):
        db.add_all([
            Product(code=p["code"], name=p["name"], unit=p.get("unit", ""),
                    short_name=p.get("short", ""))
            for p in ref["products"]
        ])

    if await is_empty(Material):
        db.add_all([
            Material(code=m["code"], name=m["name"], unit=m.get("unit", ""),
                     kind=m.get("kind", "raw"), source=m.get("src") or "Местный",
                     warehouse=m.get("wh") or "")
            for m in ref["materials"]
        ])

    if not manual:
        have = await existing(Tax, Tax.name)
        db.add_all([Tax(name=n, period="") for n in TAX_NAMES if n not in have])

    have = await existing(Setting, Setting.key)
    db.add_all(
        [
            Setting(key=k, value=v, label=lbl, group=grp, kind=kind)
            for k, v, lbl, grp, kind in RATES if k not in have
        ]
    )


async def seed(db: AsyncSession) -> None:
    ref = json.loads(DATA.read_text(encoding="utf-8"))

    # Роли и супер-админ создаются НЕЗАВИСИМО друг от друга: очистка базы может
    # снести пользователей (users ссылается на organizations), а роли остаться —
    # тогда общее условие пыталось бы завести роли повторно.
    if not await db.scalar(select(func.count(Role.id))):
        db.add_all(
            [
                Role(name="Администратор", description="Полный доступ", permissions=all_permissions()),
                Role(name="Бухгалтер", description="Финансовые операции и справочники",
                     permissions=BUKH_PERMS),
                Role(name="Поставщик", description="Только свои операции",
                     permissions=["dashboard:view", "transactions:view"]),
                Role(name="Заказчик", description="Только свои заказы",
                     permissions=["dashboard:view", "transactions:view"]),
                Role(name="Наблюдатель", description="Только просмотр",
                     permissions=["dashboard:view", "reports:view"]),
                Role(name="Без доступа", description="Прав нет (по умолчанию)", permissions=[]),
            ]
        )

    if not await db.scalar(select(func.count(User.id))):
        db.add(
            User(
                email=settings.superadmin_email,
                full_name=settings.superadmin_name,
                hashed_password=hash_password(settings.superadmin_password),
                is_active=True,
                is_superadmin=True,
            )
        )

    await _rename_divisions(db)
    await _sync_directories(db, ref)
    await _backfill_receipt_vat(db)
    await _grant_amounts_to_existing_roles(db)
    await _grant_prices_to_sales_roles(db)
    await _reformat_plates(db)
    await db.commit()


async def _reformat_plates(db: AsyncSession) -> None:
    """Разово разбить уже сохранённые госномера на группы.

    Первая версия нормализации только схлопывала пробелы, поэтому «01123ABC»
    так и лежало комком и таким же печаталось в накладной. Правило поменялось
    (app/plates.py) — прогоняем старые записи через него.
    """
    from .models import MaterialIssue, Sale
    from .plates import format_plate

    if await db.scalar(select(Setting).where(Setting.key == "plates_regrouped")):
        return
    for model in (MaterialReceipt, MaterialIssue, Sale):
        rows = (await db.execute(
            select(model).where(model.vehicle_no != "")
        )).scalars().all()
        for r in rows:
            fixed = format_plate(r.vehicle_no)
            if fixed != r.vehicle_no:
                r.vehicle_no = fixed
    db.add(Setting(key="plates_regrouped", value="1",
                   label="Госномера разбиты на группы", group="Служебное", kind="text"))


async def _grant_amounts_to_existing_roles(db: AsyncSession) -> None:
    """Разово выдать «amounts:view» ролям, которые уже были в базе.

    Право появилось позже и ГАСИТ суммы у того, у кого его нет. Без этой
    выдачи обновление молча ослепило бы всех действующих пользователей.
    Новое ограничение должен включать администратор, а не апдейт.
    """
    if await db.scalar(select(Setting).where(Setting.key == "amounts_perm_granted")):
        return
    for role in (await db.execute(select(Role))).scalars().all():
        perms = list(role.permissions or [])
        # роль «Без доступа» пустая намеренно — её не трогаем
        if perms and "amounts:view" not in perms:
            role.permissions = perms + ["amounts:view"]
    db.add(Setting(key="amounts_perm_granted", value="1",
                   label="Право «Суммы» выдано старым ролям", group="Служебное", kind="text"))


async def _grant_prices_to_sales_roles(db: AsyncSession) -> None:
    """Прайс-лист выдать тем, кто и так заводит продажи.

    Иначе новый раздел не увидит никто, включая бухгалтера, который его и
    ждёт, — а искать причину он пойдёт не в «Роли», а к разработчику.
    """
    if await db.scalar(select(Setting).where(Setting.key == "prices_perm_granted")):
        return
    for role in (await db.execute(select(Role))).scalars().all():
        perms = list(role.permissions or [])
        if "sales:create" in perms or "sales:edit" in perms:
            perms += [p for p in ("prices:view", "prices:edit") if p not in perms]
            role.permissions = perms
    db.add(Setting(key="prices_perm_granted", value="1",
                   label="Прайс-лист выдан ролям продаж", group="Служебное", kind="text"))


async def _backfill_receipt_vat(db: AsyncSession) -> None:
    """Разово заполнить НДС в уже заведённых приходах.

    Колонки `vat_amount` / `amount_gross` появились позже, у старых документов
    они нулевые — пересчитываем склад по каждой затронутой номенклатуре.
    """
    if await db.scalar(select(Setting).where(Setting.key == "receipts_vat_filled")):
        return
    from .routers.inventory import recompute_material

    ids = [
        i for (i,) in (
            await db.execute(select(MaterialReceipt.material_id).distinct())
        ).all() if i
    ]
    for mid in ids:
        await recompute_material(db, mid)
    db.add(Setting(key="receipts_vat_filled", value="1",
                   label="НДС в приходах пересчитан", group="Служебное", kind="text"))
