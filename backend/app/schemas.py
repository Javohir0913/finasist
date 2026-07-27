from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


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
    belongs_to: str = "Прочие"
    nds_payer: bool = False
    nds_type: str = ""
    phone: str = ""
    balance_usd: float = 0
    balance_uzs: float = 0


class OrgCreate(OrgBase):
    pass


class OrgUpdate(BaseModel):
    inn: str | None = None
    name: str | None = None
    category: str | None = None
    belongs_to: str | None = None
    nds_payer: bool | None = None
    nds_type: str | None = None
    phone: str | None = None
    balance_usd: float | None = None
    balance_uzs: float | None = None


class OrgOut(ORMModel, OrgBase):
    id: int
    created_at: datetime


# ---------- Directories: expense codes / CF codes / divisions ----------
class CodeBase(BaseModel):
    code: str
    name: str


class CodeUpdate(BaseModel):
    code: str | None = None
    name: str | None = None


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
    stock_qty: float = 0
    price_usd: float = 0


class ProductCreate(ProductBase):
    pass


class ProductUpdate(BaseModel):
    code: str | None = None
    name: str | None = None
    short_name: str | None = None
    unit: str | None = None
    stock_qty: float | None = None
    price_usd: float | None = None


class ProductOut(ORMModel, ProductBase):
    id: int
    avg_cost: float = 0
    sale_price: float = 0
    created_at: datetime


# ---------- Materials ----------
class MaterialBase(BaseModel):
    code: str = ""
    name: str
    unit: str = ""
    kind: str = "raw"
    source: str = "Местный"
    warehouse: str = ""
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
    stock_qty: float | None = None
    price_usd: float | None = None


class MaterialOut(ORMModel, MaterialBase):
    id: int
    avg_cost: float = 0
    created_at: datetime


# ---------- Inventory movements / production / sales ----------
class ReceiptBase(BaseModel):
    doc_date: date
    material_id: int
    organization_id: int | None = None
    division: str = ""
    qty: float
    price_uzs: float = 0
    vat: bool = False
    note: str = ""


class ReceiptOut(ORMModel, ReceiptBase):
    id: int
    amount_uzs: float
    material: MaterialOut | None = None
    organization: OrgOut | None = None


class IssueBase(BaseModel):
    doc_date: date
    material_id: int
    division: str = ""
    expense_code: str = ""
    qty: float
    vat: bool = False
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
    price_uzs: float = 0
    vat: bool = False
    note: str = ""


class SaleOut(ORMModel, SaleBase):
    id: int
    revenue_net: float
    vat_amount: float
    cogs_uzs: float
    product: ProductOut | None = None
    organization: OrgOut | None = None


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
    expense_code: str = ""
    payment_type: str = "Карта"
    salary: float = 0
    is_active: bool = True


class EmployeeUpdate(BaseModel):
    full_name: str | None = None
    inn: str | None = None
    division: str | None = None
    department: str | None = None
    position: str | None = None
    category: str | None = None
    expense_code: str | None = None
    payment_type: str | None = None
    salary: float | None = None
    is_active: bool | None = None


class EmployeeOut(ORMModel, EmployeeBase):
    id: int
    created_at: datetime


class PayrollBase(BaseModel):
    employee_id: int
    period: str
    norm_days: float = 0
    worked_days: float = 0
    oklad: float = 0
    bonus: float = 0
    nadbavka: float = 0
    pitanie: float = 0
    other_accrued: float = 0
    avans: float = 0
    paid: float = 0


class PayrollUpdate(BaseModel):
    norm_days: float | None = None
    worked_days: float | None = None
    oklad: float | None = None
    bonus: float | None = None
    nadbavka: float | None = None
    pitanie: float | None = None
    other_accrued: float | None = None
    avans: float | None = None
    paid: float | None = None


class PayrollOut(ORMModel, PayrollBase):
    id: int
    gross: float
    ndfl: float
    inps: float
    esp: float
    net: float
    balance: float
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
    debt_start: float = 0
    accrued: float = 0
    paid: float = 0
    debt_end: float = 0


class TaxUpdate(BaseModel):
    name: str | None = None
    period: str | None = None
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
    balance: float = 0
    note: str = ""


class LoanUpdate(BaseModel):
    counterparty: str | None = None
    direction: str | None = None
    currency: str | None = None
    principal: float | None = None
    balance: float | None = None
    note: str | None = None


class LoanOut(ORMModel, LoanBase):
    id: int


# ---------- Audit ----------
class AuditOut(ORMModel):
    id: int
    user_name: str
    action: str
    entity: str
    detail: str
    created_at: datetime
