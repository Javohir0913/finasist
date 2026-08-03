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
    UniqueConstraint,
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
    # какая Дт-Кт ведомость Excel: suppliers | customers | safe | services |
    # salary | rbp | office | loans | other
    ledger: Mapped[str] = mapped_column(String(20), default="other", index=True)
    # код затрат (лист «Офис Note» / «Офис қоплаши керак»)
    expense_code: Mapped[str] = mapped_column(String(20), default="")
    belongs_to: Mapped[str] = mapped_column(String(120), default="Прочие")
    nds_payer: Mapped[bool] = mapped_column(Boolean, default=False)
    nds_type: Mapped[str] = mapped_column(String(60), default="")
    phone: Mapped[str] = mapped_column(String(60), default="")
    # входящее сальдо на дату начала учёта (+ дебет / − кредит)
    opening_uzs: Mapped[float] = mapped_column(Numeric(20, 2), default=0)
    # валютная база сальдо — сервер считает её как opening_uzs / opening_rate
    opening_usd: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    # курс, по которому сальдо зафиксировано в валюте. Работает ТОЛЬКО для
    # входящего сальдо: документы берут курс на свою собственную дату.
    opening_rate: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    # дата, НА которую зафиксировано сальдо: по ней берётся курс и до неё
    # сальдо в отчёты не попадает
    opening_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # running balances (positive = they owe us / debit)
    balance_usd: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    balance_uzs: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BankAccount(Base):
    """Банковский счёт (лист «ОСТАТОК UZS/USD» — колонка на каждый счёт)."""

    __tablename__ = "bank_accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), index=True)  # наименование счёта
    account_no: Mapped[str] = mapped_column(String(40), default="")
    bank_name: Mapped[str] = mapped_column(String(200), default="")
    mfo: Mapped[str] = mapped_column(String(20), default="")
    currency: Mapped[str] = mapped_column(String(3), default="UZS")
    opening_uzs: Mapped[float] = mapped_column(Numeric(20, 2), default=0)
    opening_usd: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    # дата, на которую зафиксирован входящий остаток
    opening_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class CashRegister(Base):
    """Касса (лист «КАССА» — колонка A «Касса»: Офис касса, Махстон касса, ...)."""

    __tablename__ = "cash_registers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), index=True)
    division: Mapped[str] = mapped_column(String(80), default="")
    currency: Mapped[str] = mapped_column(String(3), default="UZS")
    opening_uzs: Mapped[float] = mapped_column(Numeric(20, 2), default=0)
    opening_usd: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    # дата, на которую зафиксирован входящий остаток
    opening_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


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
    # реквизиты банковской выписки (лист «БАНК»)
    bank_account_id: Mapped[int | None] = mapped_column(ForeignKey("bank_accounts.id"), nullable=True)
    cash_register_id: Mapped[int | None] = mapped_column(ForeignKey("cash_registers.id"), nullable=True)
    doc_no: Mapped[str] = mapped_column(String(40), default="")  # номер документа
    mfo: Mapped[str] = mapped_column(String(20), default="")  # МФО корресп.
    corr_account: Mapped[str] = mapped_column(String(40), default="")  # счёт корреспондента
    corr_name: Mapped[str] = mapped_column(String(255), default="")  # наименование корресп.
    corr_inn: Mapped[str] = mapped_column(String(20), default="")  # ИНН по данным банка
    purpose: Mapped[str] = mapped_column(String(200), default="")  # назначение по кодировке
    product_code: Mapped[str] = mapped_column(String(30), default="")  # код ГП
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
    """Справочник статей расходов (Xarajat kodi) — коды 20xx/941xx/942xx/943xx.

    `pnl_group` определяет, в какую строку ОФР (Форма №2) попадёт статья:
      prod          — производственные (входят в себестоимость)
      sell          — расходы по реализации (стр. 050)
      admin         — административные (стр. 060)
      other         — прочие операционные (стр. 070)
      financial     — расходы по финансовой деятельности (стр. 130)
      extraordinary — чрезвычайные убытки (стр. 230)
      profit_tax    — прочие налоги и сборы от прибыли (стр. 260)
      income        — прочие доходы (стр. 090), если операция приходная
    """

    __tablename__ = "expense_codes"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    pnl_group: Mapped[str] = mapped_column(String(20), default="admin", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CashflowCode(Base):
    """Справочник кодов движения денежных средств (Cash Flow kodi).

    `activity` — раздел отчёта ДДС: operating | investing | financing.
    """

    __tablename__ = "cashflow_codes"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    activity: Mapped[str] = mapped_column(String(20), default="operating", index=True)
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
    # остаток на начало учёта (лист «Остаток ГП»)
    opening_qty: Mapped[float] = mapped_column(Numeric(18, 3), default=0)
    opening_cost: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
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
    # остаток на начало учёта (лист «Остаток сырья и запчастей»)
    opening_qty: Mapped[float] = mapped_column(Numeric(18, 3), default=0)
    opening_cost: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
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
    # дата начисления — обязательна для налогов, которые вводятся руками.
    # Авто-налоги (НДС, НДФЛ, ЕСП, ИНПС) берут дату из первичных документов.
    accrued_date: Mapped[date | None] = mapped_column(Date, nullable=True)
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
    # входящее сальдо на дату начала учёта (+ дебет = нам должны, − кредит = мы должны)
    opening_uzs: Mapped[float] = mapped_column(Numeric(20, 2), default=0)
    # дата, на которую зафиксировано входящее сальдо займа
    opening_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    balance: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    note: Mapped[str] = mapped_column(String(255), default="")


class LoanEntry(Base):
    """Движение по займу: выдача (дебет) / погашение (кредит)."""

    __tablename__ = "loan_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    loan_id: Mapped[int] = mapped_column(ForeignKey("loans.id"))
    doc_date: Mapped[date] = mapped_column(Date, index=True)
    kind: Mapped[str] = mapped_column(String(10), default="debit")  # debit | credit
    amount_uzs: Mapped[float] = mapped_column(Numeric(20, 2), default=0)
    note: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    loan: Mapped["Loan"] = relationship()


class MaterialStock(Base):
    """Остаток сырья/запчастей на складе КОНКРЕТНОГО подразделения (дробилки).

    В книге «Склад сырья оборот» и «Остаток сырья и запчастей» ведутся отдельно
    по Махстон / Турк / Жби, поэтому у одной номенклатуры может быть разное
    количество и разная средняя цена на разных объектах.
    Пустое `division` — общий склад (объект не указан).
    """

    __tablename__ = "material_stocks"
    __table_args__ = (UniqueConstraint("material_id", "division", name="uq_material_division"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id"), index=True)
    division: Mapped[str] = mapped_column(String(80), default="", index=True)
    opening_qty: Mapped[float] = mapped_column(Numeric(18, 3), default=0)
    opening_cost: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    stock_qty: Mapped[float] = mapped_column(Numeric(18, 3), default=0)
    avg_cost: Mapped[float] = mapped_column(Numeric(18, 2), default=0)

    material: Mapped["Material"] = relationship()


class ProductStock(Base):
    """Остаток готовой продукции по подразделению (лист «Остаток ГП»)."""

    __tablename__ = "product_stocks"
    __table_args__ = (UniqueConstraint("product_id", "division", name="uq_product_division"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    division: Mapped[str] = mapped_column(String(80), default="", index=True)
    opening_qty: Mapped[float] = mapped_column(Numeric(18, 3), default=0)
    opening_cost: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    stock_qty: Mapped[float] = mapped_column(Numeric(18, 3), default=0)
    avg_cost: Mapped[float] = mapped_column(Numeric(18, 2), default=0)

    product: Mapped["Product"] = relationship()


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
    amount_uzs: Mapped[float] = mapped_column(Numeric(20, 2), default=0)  # сумма без НДС
    vat: Mapped[bool] = mapped_column(Boolean, default=False)  # плательщик НДС
    vat_amount: Mapped[float] = mapped_column(Numeric(20, 2), default=0)  # сумма НДС
    amount_gross: Mapped[float] = mapped_column(Numeric(20, 2), default=0)  # сумма с НДС
    # вид оплаты из книги: Наличные / Перечисление / КПК
    payment_type: Mapped[str] = mapped_column(String(30), default="")
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
    # вид оплаты из книги: Наличные / Перечисление / КПК
    payment_type: Mapped[str] = mapped_column(String(30), default="")
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
    category: Mapped[str] = mapped_column(String(80), default="")  # ТМ/УП/С/ПП/ТП/ВП/ОП
    group: Mapped[str] = mapped_column(String(120), default="")  # группа (профессия)
    status: Mapped[str] = mapped_column(String(60), default="")  # Выдача / Расчет / ...
    state: Mapped[str] = mapped_column(String(80), default="Работает")  # состояние
    hire_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    expense_code: Mapped[str] = mapped_column(String(20), default="")
    payment_type: Mapped[str] = mapped_column(String(20), default="Карта")  # Касса | Карта
    currency: Mapped[str] = mapped_column(String(3), default="UZS")
    salary: Mapped[float] = mapped_column(Numeric(18, 2), default=0)  # оклад, UZS
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PayrollEntry(Base):
    """Расчёт зарплаты за период по сотруднику (структура листа «Зарплата»)."""

    __tablename__ = "payroll_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"))
    period: Mapped[str] = mapped_column(String(7), index=True)  # YYYY-MM
    currency: Mapped[str] = mapped_column(String(3), default="UZS")
    # Канал выплаты решает, как считать налоги:
    #   cash — через кассу, наличными: налоги не начисляются;
    #   card — на пластиковую карту: НДФЛ/ИНПС начисляются СВЕРХУ введённой
    #          суммы (введённое — это «на руки»), ЕСП — за счёт предприятия.
    pay_mode: Mapped[str] = mapped_column(String(10), default="card")
    # чем выдан аванс — обязательно, если аванс больше нуля
    avans_type: Mapped[str] = mapped_column(String(10), default="")
    # дни
    norm_days: Mapped[float] = mapped_column(Numeric(6, 1), default=0)
    worked_days: Mapped[float] = mapped_column(Numeric(6, 1), default=0)
    overtime_days: Mapped[float] = mapped_column(Numeric(6, 1), default=0)  # сверхурочные
    # входящая задолженность предприятия перед сотрудником
    debt_start: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    # --- начисления ---
    oklad: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    nadbavka: Mapped[float] = mapped_column(Numeric(18, 2), default=0)  # надбавка
    pitanie: Mapped[float] = mapped_column(Numeric(18, 2), default=0)  # питание
    bonus: Mapped[float] = mapped_column(Numeric(18, 2), default=0)  # премия
    benzin: Mapped[float] = mapped_column(Numeric(18, 2), default=0)  # бензин пули
    other_accrued: Mapped[float] = mapped_column(Numeric(18, 2), default=0)  # прочие начисления
    # --- удержания ---
    hold_pitanie: Mapped[float] = mapped_column(Numeric(18, 2), default=0)  # удержание за питание
    hold_alimony: Mapped[float] = mapped_column(Numeric(18, 2), default=0)  # алименты
    hold_other: Mapped[float] = mapped_column(Numeric(18, 2), default=0)  # прочие удержания
    fine: Mapped[float] = mapped_column(Numeric(18, 2), default=0)  # штраф
    # --- выплаты ---
    avans: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    paid_cash: Mapped[float] = mapped_column(Numeric(18, 2), default=0)  # через кассу
    paid_card: Mapped[float] = mapped_column(Numeric(18, 2), default=0)  # на пласт. карту
    # --- расчётные ---
    gross: Mapped[float] = mapped_column(Numeric(18, 2), default=0)  # всего начислено
    ndfl: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    inps: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    esp: Mapped[float] = mapped_column(Numeric(18, 2), default=0)  # налог работодателя
    withheld: Mapped[float] = mapped_column(Numeric(18, 2), default=0)  # всего удержано
    net: Mapped[float] = mapped_column(Numeric(18, 2), default=0)  # сумма к выдаче
    paid: Mapped[float] = mapped_column(Numeric(18, 2), default=0)  # выплачено всего
    balance: Mapped[float] = mapped_column(Numeric(18, 2), default=0)  # задолженность на конец
    total_cost: Mapped[float] = mapped_column(Numeric(18, 2), default=0)  # расходы на сотрудника
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    employee: Mapped["Employee"] = relationship()


class PeriodClose(Base):
    """Закрытый месяц: после закрытия документы этого периода не меняются.

    Проверку делает `app/periods.py::assert_open`, подключённая ко всем
    эндпоинтам, которые пишут первичку. Пока таблица пуста, проверка ничего
    не запрещает — система работает как раньше.

    `snapshot` — свободный слепок показателей на момент закрытия (баланс, ОФР,
    курс, остатки). Нужен, чтобы закрытый месяц можно было показать ровно
    таким, каким его закрыли, и сверить с пересчётом.
    """

    __tablename__ = "period_closes"

    period: Mapped[str] = mapped_column(String(7), primary_key=True)  # YYYY-MM
    closed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    closed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    closed_by_name: Mapped[str] = mapped_column(String(160), default="")
    note: Mapped[str] = mapped_column(String(255), default="")
    snapshot: Mapped[dict] = mapped_column(JSONB, default=dict)


class PeriodSetting(Base):
    """Значение настройки, действующее в КОНКРЕТНОМ месяце.

    ОС, износ, капитал меняются каждый месяц, а `Setting` хранит одно текущее
    значение — из-за этого баланс за прошлый месяц пересчитывался по сегодняшним
    цифрам. Здесь то же значение привязано к периоду; если на месяц значения нет,
    берётся ближайшее более раннее, а затем — текущее из `Setting`.
    """

    __tablename__ = "period_settings"
    __table_args__ = (UniqueConstraint("period", "key", name="uq_period_setting"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    period: Mapped[str] = mapped_column(String(7), index=True)  # YYYY-MM
    key: Mapped[str] = mapped_column(String(50), index=True)
    value: Mapped[str] = mapped_column(String(80), default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    user_name: Mapped[str] = mapped_column(String(160), default="")
    action: Mapped[str] = mapped_column(String(30))
    entity: Mapped[str] = mapped_column(String(60))
    detail: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
