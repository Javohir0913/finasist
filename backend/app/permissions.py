"""Central registry of all permissions in the system.

Permission string format:  "<module>:<action>"
The super admin bypasses every check. New roles start with an EMPTY permission
list — nothing is granted by default, exactly as required.
"""

# Modules exposed by the platform (order = sidebar order)
MODULES = [
    ("dashboard", "Dashboard / Панель"),
    ("organizations", "Реестр организаций"),
    ("counterparties", "Дт-Кт (поставщики/заказчики)"),
    ("articles", "Справочники: коды и подразделения"),
    ("transactions", "Банк и Касса (Cash Flow)"),
    ("products", "Готовая продукция"),
    ("materials", "Сырьё и запчасти"),
    ("production", "Производство ГП"),
    ("sales", "Продажа ГП"),
    ("payroll", "Зарплата"),
    ("services", "Услуги (получ./оказ.)"),
    ("taxes", "Налоги"),
    ("loans", "Займы"),
    ("exchange", "Курс доллара"),
    ("reports", "Отчёты (ОФР / Баланс)"),
    ("closing", "Закрытие месяца"),
    ("users", "Пользователи"),
    ("roles", "Роли и доступы"),
    ("settings", "Настройки (ставки налогов)"),
]

ACTIONS = ["view", "create", "edit", "delete", "export"]

# Some modules are read-mostly
MODULE_ACTIONS = {
    "dashboard": ["view"],
    "reports": ["view", "export"],
    # view   — экран «Закрытие месяца»
    # create — закрыть месяц, delete — открыть обратно
    # history — ВИДЕТЬ документы закрытых месяцев (менять их всё равно нельзя)
    "closing": ["view", "history", "create", "delete"],
    "exchange": ["view", "create", "edit", "delete"],
    "users": ["view", "create", "edit", "delete"],
    "roles": ["view", "create", "edit", "delete"],
    "settings": ["view", "edit"],
}


def all_permissions() -> list[str]:
    perms: list[str] = []
    for mod, _ in MODULES:
        for act in MODULE_ACTIONS.get(mod, ACTIONS):
            perms.append(f"{mod}:{act}")
    return perms


def permission_catalog() -> list[dict]:
    """Structured catalog for the admin UI (role editor)."""
    out = []
    for mod, label in MODULES:
        out.append(
            {
                "module": mod,
                "label": label,
                "actions": MODULE_ACTIONS.get(mod, ACTIONS),
            }
        )
    return out


ALL_PERMISSIONS = set(all_permissions())
