from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    description: Mapped[str] = mapped_column(String(255), default="")
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)
    # granular permission strings, e.g. ["transactions:view", "organizations:edit"]
    permissions: Mapped[list] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    users: Mapped[list["User"]] = relationship(back_populates="role")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(160))
    hashed_password: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_superadmin: Mapped[bool] = mapped_column(Boolean, default=False)
    role_id: Mapped[int | None] = mapped_column(ForeignKey("roles.id"), nullable=True)
    # optional link: a supplier/customer user is tied to their organization
    organization_id: Mapped[int | None] = mapped_column(
        ForeignKey("organizations.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    role: Mapped[Role | None] = relationship(back_populates="users")
    organization: Mapped["Organization | None"] = relationship()


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[int] = mapped_column(primary_key=True)
    inn: Mapped[str] = mapped_column(String(20), index=True, default="")
    name: Mapped[str] = mapped_column(String(255), index=True)
    # supplier | customer | other
    category: Mapped[str] = mapped_column(String(20), default="other", index=True)
    belongs_to: Mapped[str] = mapped_column(String(120), default="Прочие")
    nds_payer: Mapped[bool] = mapped_column(Boolean, default=False)
    nds_type: Mapped[str] = mapped_column(String(60), default="")
    phone: Mapped[str] = mapped_column(String(60), default="")
    # running balances (positive = they owe us / debit)
    balance_usd: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    balance_uzs: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    doc_date: Mapped[date] = mapped_column(Date, index=True)
    # income | expense
    direction: Mapped[str] = mapped_column(String(10), index=True)
    # bank | cash
    account: Mapped[str] = mapped_column(String(10), default="bank", index=True)
    currency: Mapped[str] = mapped_column(String(3), default="UZS")
    amount: Mapped[float] = mapped_column(Numeric(18, 2))
    rate: Mapped[float] = mapped_column(Numeric(18, 4), default=1)
    amount_usd: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    amount_uzs: Mapped[float] = mapped_column(Numeric(20, 2), default=0)
    payment_code: Mapped[str] = mapped_column(String(20), default="")
    category: Mapped[str] = mapped_column(String(160), default="")
    # reference codes (from directories) + analytics dimension
    expense_code: Mapped[str] = mapped_column(String(20), default="", index=True)
    cashflow_code: Mapped[str] = mapped_column(String(20), default="", index=True)
    division: Mapped[str] = mapped_column(String(80), default="", index=True)
    cash_register: Mapped[str] = mapped_column(String(80), default="")
    organization_id: Mapped[int | None] = mapped_column(
        ForeignKey("organizations.id"), nullable=True
    )
    description: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    organization: Mapped[Organization | None] = relationship()


class Setting(Base):
    """Настраиваемые параметры (ставки налогов и т.п.) — редактирует супер-админ."""

    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    value: Mapped[str] = mapped_column(String(80), default="0")
    label: Mapped[str] = mapped_column(String(200), default="")
    group: Mapped[str] = mapped_column(String(60), default="")
    kind: Mapped[str] = mapped_column(String(20), default="percent")  # percent | number | text


class ExpenseCode(Base):
    """Справочник статей расходов (Xarajat kodi) — коды 20xx/941xx/942xx/943xx."""

    __tablename__ = "expense_codes"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CashflowCode(Base):
    """Справочник кодов движения денежных средств (Cash Flow kodi)."""

    __tablename__ = "cashflow_codes"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Division(Base):
    """Подразделения / Bo'linmalar (Maxston, Turk, Jbi, Sement, Pompa, Sementovoz, Ofis)."""

    __tablename__ = "divisions"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(30), default="")
    name: Mapped[str] = mapped_column(String(200), index=True)
    short_name: Mapped[str] = mapped_column(String(120), default="")
    unit: Mapped[str] = mapped_column(String(20), default="")
    stock_qty: Mapped[float] = mapped_column(Numeric(18, 3), default=0)
    price_usd: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    avg_cost: Mapped[float] = mapped_column(Numeric(18, 2), default=0)  # себестоимость, UZS
    sale_price: Mapped[float] = mapped_column(Numeric(18, 2), default=0)  # прайс, UZS
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Material(Base):
    __tablename__ = "materials"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(30), default="")
    name: Mapped[str] = mapped_column(String(200), index=True)
    unit: Mapped[str] = mapped_column(String(20), default="")
    # raw | spare
    kind: Mapped[str] = mapped_column(String(10), default="raw", index=True)
    source: Mapped[str] = mapped_column(String(20), default="Местный")
    warehouse: Mapped[str] = mapped_column(String(80), default="")
    stock_qty: Mapped[float] = mapped_column(Numeric(18, 3), default=0)
    price_usd: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    avg_cost: Mapped[float] = mapped_column(Numeric(18, 2), default=0)  # moving avg, UZS
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ExchangeRate(Base):
    __tablename__ = "exchange_rates"

    id: Mapped[int] = mapped_column(primary_key=True)
    rate_date: Mapped[date] = mapped_column(Date, unique=True, index=True)
    rate: Mapped[float] = mapped_column(Numeric(18, 4))


class Tax(Base):
    __tablename__ = "taxes"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    period: Mapped[str] = mapped_column(String(20), default="")
    debt_start: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    accrued: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    paid: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    debt_end: Mapped[float] = mapped_column(Numeric(18, 2), default=0)


class Loan(Base):
    __tablename__ = "loans"

    id: Mapped[int] = mapped_column(primary_key=True)
    organization_id: Mapped[int | None] = mapped_column(
        ForeignKey("organizations.id"), nullable=True
    )
    counterparty: Mapped[str] = mapped_column(String(200), default="")
    # given | received
    direction: Mapped[str] = mapped_column(String(10), default="received")
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    principal: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    balance: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    note: Mapped[str] = mapped_column(String(255), default="")


class MaterialReceipt(Base):
    """Приход сырья/запчастей — увеличивает склад по средней цене."""

    __tablename__ = "material_receipts"

    id: Mapped[int] = mapped_column(primary_key=True)
    doc_date: Mapped[date] = mapped_column(Date, index=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id"))
    organization_id: Mapped[int | None] = mapped_column(ForeignKey("organizations.id"), nullable=True)
    division: Mapped[str] = mapped_column(String(80), default="", index=True)
    qty: Mapped[float] = mapped_column(Numeric(18, 3))
    price_uzs: Mapped[float] = mapped_column(Numeric(18, 2), default=0)  # цена без НДС
    amount_uzs: Mapped[float] = mapped_column(Numeric(20, 2), default=0)
    vat: Mapped[bool] = mapped_column(Boolean, default=False)
    note: Mapped[str] = mapped_column(String(255), default="")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    material: Mapped["Material"] = relationship()
    organization: Mapped["Organization | None"] = relationship()


class MaterialIssue(Base):
    """Расход сырья/запчастей — списывает со склада по средней цене."""

    __tablename__ = "material_issues"

    id: Mapped[int] = mapped_column(primary_key=True)
    doc_date: Mapped[date] = mapped_column(Date, index=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id"))
    division: Mapped[str] = mapped_column(String(80), default="", index=True)
    expense_code: Mapped[str] = mapped_column(String(20), default="")
    qty: Mapped[float] = mapped_column(Numeric(18, 3))
    vat: Mapped[bool] = mapped_column(Boolean, default=False)
    cost_uzs: Mapped[float] = mapped_column(Numeric(20, 2), default=0)  # qty * avg на момент
    note: Mapped[str] = mapped_column(String(255), default="")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    material: Mapped["Material"] = relationship()


class Production(Base):
    """Производство ГП — приходует готовую продукцию по себестоимости."""

    __tablename__ = "productions"

    id: Mapped[int] = mapped_column(primary_key=True)
    doc_date: Mapped[date] = mapped_column(Date, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    division: Mapped[str] = mapped_column(String(80), default="", index=True)
    qty: Mapped[float] = mapped_column(Numeric(18, 3))
    unit_cost: Mapped[float] = mapped_column(Numeric(18, 2), default=0)  # себест. за ед., UZS
    amount_uzs: Mapped[float] = mapped_column(Numeric(20, 2), default=0)
    note: Mapped[str] = mapped_column(String(255), default="")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    product: Mapped["Product"] = relationship()


class Sale(Base):
    """Продажа ГП — списывает продукцию по себестоимости, формирует выручку."""

    __tablename__ = "sales"

    id: Mapped[int] = mapped_column(primary_key=True)
    doc_date: Mapped[date] = mapped_column(Date, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    organization_id: Mapped[int | None] = mapped_column(ForeignKey("organizations.id"), nullable=True)
    division: Mapped[str] = mapped_column(String(80), default="", index=True)
    qty: Mapped[float] = mapped_column(Numeric(18, 3))
    price_uzs: Mapped[float] = mapped_column(Numeric(18, 2), default=0)  # цена с НДС
    vat: Mapped[bool] = mapped_column(Boolean, default=False)
    revenue_net: Mapped[float] = mapped_column(Numeric(20, 2), default=0)  # без НДС
    vat_amount: Mapped[float] = mapped_column(Numeric(20, 2), default=0)
    cogs_uzs: Mapped[float] = mapped_column(Numeric(20, 2), default=0)  # себестоимость проданного
    note: Mapped[str] = mapped_column(String(255), default="")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    product: Mapped["Product"] = relationship()
    organization: Mapped["Organization | None"] = relationship()


class Service(Base):
    """Полученные / Оказанные услуги."""

    __tablename__ = "services"

    id: Mapped[int] = mapped_column(primary_key=True)
    doc_date: Mapped[date] = mapped_column(Date, index=True)
    direction: Mapped[str] = mapped_column(String(10), index=True)  # received | provided
    organization_id: Mapped[int | None] = mapped_column(ForeignKey("organizations.id"), nullable=True)
    service_type: Mapped[str] = mapped_column(String(200), default="")
    expense_code: Mapped[str] = mapped_column(String(20), default="")
    division: Mapped[str] = mapped_column(String(80), default="", index=True)
    amount: Mapped[float] = mapped_column(Numeric(20, 2), default=0)  # сумма с НДС, UZS
    vat: Mapped[bool] = mapped_column(Boolean, default=False)
    net: Mapped[float] = mapped_column(Numeric(20, 2), default=0)
    vat_amount: Mapped[float] = mapped_column(Numeric(20, 2), default=0)
    note: Mapped[str] = mapped_column(String(255), default="")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    organization: Mapped["Organization | None"] = relationship()


class Employee(Base):
    """Сотрудник (Зарплата / INFO зарплата)."""

    __tablename__ = "employees"

    id: Mapped[int] = mapped_column(primary_key=True)
    full_name: Mapped[str] = mapped_column(String(200), index=True)
    inn: Mapped[str] = mapped_column(String(20), default="")
    division: Mapped[str] = mapped_column(String(80), default="", index=True)
    department: Mapped[str] = mapped_column(String(120), default="")  # отдел (АУП, ПП...)
    position: Mapped[str] = mapped_column(String(160), default="")  # должность
    category: Mapped[str] = mapped_column(String(80), default="")
    expense_code: Mapped[str] = mapped_column(String(20), default="")
    payment_type: Mapped[str] = mapped_column(String(20), default="Карта")  # Касса | Карта
    salary: Mapped[float] = mapped_column(Numeric(18, 2), default=0)  # оклад, UZS
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PayrollEntry(Base):
    """Расчёт зарплаты за период по сотруднику."""

    __tablename__ = "payroll_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"))
    period: Mapped[str] = mapped_column(String(7), index=True)  # YYYY-MM
    norm_days: Mapped[float] = mapped_column(Numeric(6, 1), default=0)
    worked_days: Mapped[float] = mapped_column(Numeric(6, 1), default=0)
    oklad: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    bonus: Mapped[float] = mapped_column(Numeric(18, 2), default=0)  # премия
    nadbavka: Mapped[float] = mapped_column(Numeric(18, 2), default=0)  # надбавка
    pitanie: Mapped[float] = mapped_column(Numeric(18, 2), default=0)  # питание
    other_accrued: Mapped[float] = mapped_column(Numeric(18, 2), default=0)  # прочие начисления
    avans: Mapped[float] = mapped_column(Numeric(18, 2), default=0)  # аванс (выплачен)
    # computed
    gross: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    ndfl: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    inps: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    esp: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    net: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    paid: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    balance: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    employee: Mapped["Employee"] = relationship()


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    user_name: Mapped[str] = mapped_column(String(160), default="")
    action: Mapped[str] = mapped_column(String(30))
    entity: Mapped[str] = mapped_column(String(60))
    detail: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
