from datetime import date, datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, EmailStr, Field, computed_field

from .plates import format_plate


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- Auth ----------
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


# ---------- Roles ----------
class RoleBase(BaseModel):
    name: str
    description: str = ""
    permissions: list[str] = []


class RoleCreate(RoleBase):
    pass


class RoleUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    permissions: list[str] | None = None


class RoleOut(ORMModel, RoleBase):
    id: int
    is_system: bool
    created_at: datetime


# ---------- Users ----------
class UserBase(BaseModel):
    email: EmailStr
    full_name: str
    is_active: bool = True
    role_id: int | None = None
    organization_id: int | None = None


class UserCreate(UserBase):
    password: str = Field(min_length=6)


class UserUpdate(BaseModel):
    full_name: str | None = None
    is_active: bool | None = None
    role_id: int | None = None
    organization_id: int | None = None
    password: str | None = None


class UserOut(ORMModel):
    id: int
    email: EmailStr
    full_name: str
    is_active: bool
    is_superadmin: bool
    role_id: int | None
    organization_id: int | None
    created_at: datetime
    role: RoleOut | None = None


class MeOut(UserOut):
    permissions: list[str]


# ---------- Organizations ----------
class OrgBase(BaseModel):
    inn: str = ""
    name: str
    category: str = "other"
    ledger: str = "other"
    expense_code: str = ""
    belongs_to: str = "Прочие"
    nds_payer: bool = False
    nds_type: str = ""
    phone: str = ""
    opening_uzs: float = 0
    opening_usd: float = 0
    opening_rate: float = 0
    opening_date: date | None = None
    balance_usd: float = 0
    balance_uzs: float = 0


class OrgCreate(OrgBase):
    pass


class OrgUpdate(BaseModel):
    inn: str | None = None
    name: str | None = None
    category: str | None = None
    ledger: str | None = None
    expense_code: str | None = None
    belongs_to: str | None = None
    nds_payer: bool | None = None
    nds_type: str | None = None
    phone: str | None = None
    opening_uzs: float | None = None
    opening_usd: float | None = None
    opening_rate: float | None = None
    opening_date: date | None = None
    balance_usd: float | None = None
    balance_uzs: float | None = None


class OrgOut(ORMModel, OrgBase):
    id: int
    created_at: datetime

    # В книге «На начало месяца» — ДВЕ колонки (D «Дебет» и F «Кредит»),
    # а не одно число со знаком. Храним одно сальдо (дебет минус кредит),
    # но наружу отдаём обе стороны, чтобы форма и реестр не гадали по знаку.
    @computed_field
    @property
    def opening_debit(self) -> float:
        return round(max(float(self.opening_uzs or 0), 0), 2)

    @computed_field
    @property
    def opening_credit(self) -> float:
        return round(abs(min(float(self.opening_uzs or 0), 0)), 2)

    @computed_field
    @property
    def balance_debit(self) -> float:
        return round(max(float(self.balance_uzs or 0), 0), 2)

    @computed_field
    @property
    def balance_credit(self) -> float:
        return round(abs(min(float(self.balance_uzs or 0), 0)), 2)


# ---------- Bank accounts / cash registers ----------
class BankAccountBase(BaseModel):
    name: str
    account_no: str = ""
    bank_name: str = ""
    mfo: str = ""
    currency: str = "UZS"
    opening_uzs: float = 0
    opening_usd: float = 0
    opening_date: date | None = None
    is_active: bool = True


class BankAccountUpdate(BaseModel):
    name: str | None = None
    account_no: str | None = None
    bank_name: str | None = None
    mfo: str | None = None
    currency: str | None = None
    opening_uzs: float | None = None
    opening_usd: float | None = None
    opening_date: date | None = None
    is_active: bool | None = None


class BankAccountOut(ORMModel, BankAccountBase):
    id: int


class CashRegisterBase(BaseModel):
    name: str
    division: str = ""
    currency: str = "UZS"
    opening_uzs: float = 0
    opening_usd: float = 0
    opening_date: date | None = None
    is_active: bool = True


class CashRegisterUpdate(BaseModel):
    name: str | None = None
    division: str | None = None
    currency: str | None = None
    opening_uzs: float | None = None
    opening_usd: float | None = None
    opening_date: date | None = None
    is_active: bool | None = None


class CashRegisterOut(ORMModel, CashRegisterBase):
    id: int


# ---------- Directories: expense codes / CF codes / divisions ----------
class CodeBase(BaseModel):
    code: str
    name: str
    # для статей расходов — строка ОФР; для кодов ДДС — раздел отчёта
    pnl_group: str = "admin"
    activity: str = "operating"


class CodeUpdate(BaseModel):
    code: str | None = None
    name: str | None = None
    pnl_group: str | None = None
    activity: str | None = None


class CodeOut(ORMModel, CodeBase):
    id: int


class DivisionBase(BaseModel):
    name: str


class DivisionOut(ORMModel, DivisionBase):
    id: int


# ---------- Transactions (Bank / Kassa ledger) ----------
class TxBase(BaseModel):
    doc_date: date
    direction: str  # income | expense
    account: str = "bank"  # bank | kassa
    currency: str = "UZS"
    amount: float
    rate: float = 1
    payment_code: str = ""
    category: str = ""
    expense_code: str = ""
    cashflow_code: str = ""
    division: str = ""
    cash_register: str = ""
    bank_account_id: int | None = None
    cash_register_id: int | None = None
    doc_no: str = ""
    mfo: str = ""
    corr_account: str = ""
    corr_name: str = ""
    corr_inn: str = ""
    purpose: str = ""
    product_code: str = ""
    organization_id: int | None = None
    description: str = ""


class TxCreate(TxBase):
    pass


class TxUpdate(BaseModel):
    doc_date: date | None = None
    direction: str | None = None
    account: str | None = None
    currency: str | None = None
    amount: float | None = None
    rate: float | None = None
    payment_code: str | None = None
    category: str | None = None
    expense_code: str | None = None
    cashflow_code: str | None = None
    division: str | None = None
    cash_register: str | None = None
    bank_account_id: int | None = None
    cash_register_id: int | None = None
    doc_no: str | None = None
    mfo: str | None = None
    corr_account: str | None = None
    corr_name: str | None = None
    corr_inn: str | None = None
    purpose: str | None = None
    product_code: str | None = None
    organization_id: int | None = None
    description: str | None = None


class TxOut(ORMModel, TxBase):
    id: int
    amount_usd: float
    amount_uzs: float = 0
    created_at: datetime
    organization: OrgOut | None = None


# ---------- Products ----------
class ProductBase(BaseModel):
    code: str = ""
    name: str
    short_name: str = ""
    unit: str = ""
    opening_qty: float = 0
    opening_cost: float = 0
    stock_qty: float = 0
    price_usd: float = 0
    sale_price: float = 0


class ProductCreate(ProductBase):
    pass


class ProductUpdate(BaseModel):
    code: str | None = None
    name: str | None = None
    short_name: str | None = None
    unit: str | None = None
    opening_qty: float | None = None
    opening_cost: float | None = None
    stock_qty: float | None = None
    price_usd: float | None = None
    sale_price: float | None = None


class ProductOut(ORMModel, ProductBase):
    id: int
    avg_cost: float = 0
    created_at: datetime


# ---------- Materials ----------
class MaterialBase(BaseModel):
    code: str = ""
    name: str
    unit: str = ""
    kind: str = "raw"
    source: str = "Местный"
    warehouse: str = ""
    opening_qty: float = 0
    opening_cost: float = 0
    stock_qty: float = 0
    price_usd: float = 0


class MaterialCreate(MaterialBase):
    pass


class MaterialUpdate(BaseModel):
    code: str | None = None
    name: str | None = None
    unit: str | None = None
    kind: str | None = None
    source: str | None = None
    warehouse: str | None = None
    opening_qty: float | None = None
    opening_cost: float | None = None
    stock_qty: float | None = None
    price_usd: float | None = None


class MaterialOut(ORMModel, MaterialBase):
    id: int
    avg_cost: float = 0
    created_at: datetime


# ---------- Inventory movements / production / sales ----------
# Госномер к единому виду: «01a123bc», «01 A 123 BC» и «01A 123BC» — одна и та
# же машина, иначе фильтр по авто разваливается на несколько вариантов, а в
# накладной печатается нечитаемый комок. Правило — в app/plates.py.
VehicleNo = Annotated[str, AfterValidator(format_plate)]


class ReceiptBase(BaseModel):
    doc_date: date
    material_id: int
    organization_id: int | None = None
    division: str = ""
    qty: float
    price_uzs: float = 0
    vat: bool = False
    vehicle_no: VehicleNo = ""  # госномер машины, которой привезли груз
    payment_type: str = ""      # Наличные / Перечисление / КПК
    note: str = ""


class ReceiptOut(ORMModel, ReceiptBase):
    id: int
    amount_uzs: float           # без НДС
    vat_amount: float = 0       # сумма НДС
    amount_gross: float = 0     # с НДС
    material: MaterialOut | None = None
    organization: OrgOut | None = None


class IssueBase(BaseModel):
    doc_date: date
    material_id: int
    division: str = ""
    expense_code: str = ""
    qty: float
    vat: bool = False
    vehicle_no: VehicleNo = ""  # госномер машины, которой вывезли материал
    note: str = ""


class IssueOut(ORMModel, IssueBase):
    id: int
    cost_uzs: float
    material: MaterialOut | None = None


class ProductionBase(BaseModel):
    doc_date: date
    product_id: int
    division: str = ""
    qty: float
    # себестоимость расчётная: делится на весь выпуск месяца, поэтому приходит
    # только в ответе — на входе игнорируется (см. app/production.py)
    unit_cost: float = 0
    note: str = ""


class ProductionOut(ORMModel, ProductionBase):
    id: int
    amount_uzs: float
    product: ProductOut | None = None


class SaleBase(BaseModel):
    doc_date: date
    product_id: int
    organization_id: int | None = None
    division: str = ""
    qty: float
    # цена из счёта-фактуры: при vat=True НДС сидит ВНУТРИ неё и выделяется
    # обратным счётом, при vat=False налога нет и вся сумма — выручка
    price_uzs: float = 0
    vat: bool = False
    vehicle_no: VehicleNo = ""  # госномер машины, которой отгрузили продукцию
    payment_type: str = ""      # Наличные / Перечисление / КПК
    note: str = ""


class SaleOut(ORMModel, SaleBase):
    id: int
    revenue_net: float
    vat_amount: float
    cogs_uzs: float
    product: ProductOut | None = None
    organization: OrgOut | None = None


# ---------- Пакетный ввод ----------
# Экраны склада вводят документы таблицей: одна поставка — десяток строк.
# Пакет пишется одной транзакцией: либо проходят все строки, либо ни одной,
# иначе половина накладной осталась бы в базе после ошибки на пятой строке.
BATCH_MAX = 200


class ReceiptBatch(BaseModel):
    items: list[ReceiptBase] = Field(min_length=1, max_length=BATCH_MAX)


class IssueBatch(BaseModel):
    items: list[IssueBase] = Field(min_length=1, max_length=BATCH_MAX)


class ProductionBatch(BaseModel):
    items: list[ProductionBase] = Field(min_length=1, max_length=BATCH_MAX)


class SaleBatch(BaseModel):
    items: list[SaleBase] = Field(min_length=1, max_length=BATCH_MAX)


class BatchResult(BaseModel):
    created: int
    ids: list[int]


# ---------- Services ----------
class ServiceBase(BaseModel):
    doc_date: date
    direction: str  # received | provided
    organization_id: int | None = None
    service_type: str = ""
    expense_code: str = ""
    division: str = ""
    amount: float = 0
    vat: bool = False
    note: str = ""


class ServiceOut(ORMModel, ServiceBase):
    id: int
    net: float
    vat_amount: float
    organization: OrgOut | None = None


# ---------- Payroll ----------
class EmployeeBase(BaseModel):
    full_name: str
    inn: str = ""
    division: str = ""
    department: str = ""
    position: str = ""
    category: str = ""
    group: str = ""
    status: str = ""
    state: str = "Работает"
    hire_date: date | None = None
    expense_code: str = ""
    payment_type: str = "Карта"
    currency: str = "UZS"
    salary: float = 0
    is_active: bool = True


class EmployeeUpdate(BaseModel):
    full_name: str | None = None
    inn: str | None = None
    division: str | None = None
    department: str | None = None
    position: str | None = None
    category: str | None = None
    group: str | None = None
    status: str | None = None
    state: str | None = None
    hire_date: date | None = None
    expense_code: str | None = None
    payment_type: str | None = None
    currency: str | None = None
    salary: float | None = None
    is_active: bool | None = None


class EmployeeOut(ORMModel, EmployeeBase):
    id: int
    created_at: datetime


class PayrollBase(BaseModel):
    employee_id: int
    period: str
    currency: str = "UZS"
    pay_mode: str = "card"        # cash — без налогов | card — налог сверху
    avans_type: str = ""          # cash | card, обязателен при авансе > 0
    norm_days: float = 0
    worked_days: float = 0
    overtime_days: float = 0
    debt_start: float = 0
    # начисления
    oklad: float = 0
    nadbavka: float = 0
    pitanie: float = 0
    bonus: float = 0
    benzin: float = 0
    other_accrued: float = 0
    # удержания
    hold_pitanie: float = 0
    hold_alimony: float = 0
    hold_other: float = 0
    fine: float = 0
    # выплаты
    avans: float = 0
    paid_cash: float = 0
    paid_card: float = 0


class PayrollUpdate(BaseModel):
    currency: str | None = None
    pay_mode: str | None = None
    avans_type: str | None = None
    norm_days: float | None = None
    worked_days: float | None = None
    overtime_days: float | None = None
    debt_start: float | None = None
    oklad: float | None = None
    nadbavka: float | None = None
    pitanie: float | None = None
    bonus: float | None = None
    benzin: float | None = None
    other_accrued: float | None = None
    hold_pitanie: float | None = None
    hold_alimony: float | None = None
    hold_other: float | None = None
    fine: float | None = None
    avans: float | None = None
    paid_cash: float | None = None
    paid_card: float | None = None


class PayrollOut(ORMModel, PayrollBase):
    id: int
    gross: float
    ndfl: float
    inps: float
    esp: float
    withheld: float
    net: float
    paid: float
    balance: float
    total_cost: float
    employee: EmployeeOut | None = None


# ---------- Exchange ----------
class RateBase(BaseModel):
    rate_date: date
    rate: float


class RateOut(ORMModel, RateBase):
    id: int


# ---------- Taxes ----------
class TaxBase(BaseModel):
    name: str
    period: str = ""
    accrued_date: date | None = None
    debt_start: float = 0
    accrued: float = 0
    paid: float = 0
    debt_end: float = 0


class TaxUpdate(BaseModel):
    name: str | None = None
    period: str | None = None
    accrued_date: date | None = None
    debt_start: float | None = None
    accrued: float | None = None
    paid: float | None = None


class TaxOut(ORMModel, TaxBase):
    id: int


# ---------- Loans ----------
class LoanBase(BaseModel):
    organization_id: int | None = None
    counterparty: str = ""
    direction: str = "received"
    currency: str = "USD"
    principal: float = 0
    opening_uzs: float = 0
    opening_date: date | None = None
    balance: float = 0
    note: str = ""


class LoanUpdate(BaseModel):
    counterparty: str | None = None
    direction: str | None = None
    currency: str | None = None
    principal: float | None = None
    opening_uzs: float | None = None
    opening_date: date | None = None
    balance: float | None = None
    note: str | None = None


class LoanOut(ORMModel, LoanBase):
    id: int


class LoanEntryBase(BaseModel):
    loan_id: int
    doc_date: date
    kind: str = "debit"  # debit = выдача, credit = погашение
    amount_uzs: float = 0
    note: str = ""


class LoanEntryOut(ORMModel, LoanEntryBase):
    id: int


# ---------- Audit ----------
class AuditOut(ORMModel):
    id: int
    user_name: str
    action: str
    entity: str
    detail: str
    created_at: datetime
