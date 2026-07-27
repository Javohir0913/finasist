"""Bootstrap: super admin, roles, and ALL reference directories from the
PROFIT DIVIDER workbook (organizations, expense/CF codes, products, materials,
divisions) — loaded with ZERO balances, ready for a fresh company."""
import json
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .models import (
    CashflowCode,
    Division,
    ExpenseCode,
    Material,
    Organization,
    Product,
    Role,
    Setting,
    Tax,
    User,
)
from .permissions import all_permissions
from .security import hash_password

DATA = Path(__file__).parent / "seed_data.json"


async def seed(db: AsyncSession) -> None:
    if await db.scalar(select(func.count(User.id))):
        return  # already seeded

    # ---- super admin ----
    db.add(
        User(
            email=settings.superadmin_email,
            full_name=settings.superadmin_name,
            hashed_password=hash_password(settings.superadmin_password),
            is_active=True,
            is_superadmin=True,
        )
    )

    # ---- roles (explicit permissions, nothing default) ----
    db.add_all(
        [
            Role(name="Администратор", description="Полный доступ", permissions=all_permissions()),
            Role(
                name="Бухгалтер",
                description="Финансовые операции и справочники",
                permissions=[
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
                ],
            ),
            Role(name="Поставщик", description="Только свои операции",
                 permissions=["dashboard:view", "transactions:view"]),
            Role(name="Заказчик", description="Только свои заказы",
                 permissions=["dashboard:view", "transactions:view"]),
            Role(name="Наблюдатель", description="Только просмотр",
                 permissions=["dashboard:view", "reports:view"]),
            Role(name="Без доступа", description="Прав нет (по умолчанию)", permissions=[]),
        ]
    )

    # ---- reference directories ----
    ref = json.loads(DATA.read_text(encoding="utf-8"))

    db.add_all([Division(name=n) for n in ref["divisions"]])
    db.add_all([ExpenseCode(code=c["code"], name=c["name"]) for c in ref["expenseCodes"]])
    db.add_all([CashflowCode(code=c["code"], name=c["name"]) for c in ref["cashflowCodes"]])

    for o in ref["orgs"]:
        vat = (o.get("vat") or "")
        db.add(
            Organization(
                inn=str(o.get("inn") or ""),
                name=o["name"],
                category="other",
                belongs_to=o.get("group") or "Прочие",
                nds_payer="с учет" in vat.lower(),
                nds_type=vat,
            )
        )

    db.add_all([Product(code=p["code"], name=p["name"], unit=p.get("unit", "")) for p in ref["products"]])
    db.add_all(
        [
            Material(code=m["code"], name=m["name"], unit=m.get("unit", ""),
                     kind="raw", warehouse=m.get("wh") or "")
            for m in ref["materials"]
        ]
    )

    # tax types (amounts 0) — начислено считается автоматически
    db.add_all([Tax(name=n, period="") for n in ["НДС", "Налог на прибыль", "НДФЛ", "ЕСП", "ИНПС", "Земельный налог"]])

    # configurable rates (super-admin editable, not hardcoded)
    db.add_all([
        Setting(key="nds_rate", value="0.12", label="Ставка НДС", group="Налоги", kind="percent"),
        Setting(key="ndfl_rate", value="0.12", label="Ставка НДФЛ", group="Налоги", kind="percent"),
        Setting(key="inps_rate", value="0", label="Ставка ИНПС", group="Налоги", kind="percent"),
        Setting(key="esp_rate", value="0.12", label="Ставка ЕСП (соц. налог)", group="Налоги", kind="percent"),
        Setting(key="profit_tax_rate", value="0.15", label="Ставка налога на прибыль", group="Налоги", kind="percent"),
    ])

    await db.commit()
