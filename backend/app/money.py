"""Право «Суммы и цены» — сквозной слой поверх обычных прав раздела.

Зачем отдельно: кладовщику нужен реестр прихода и расхода, но не нужны — а
часто и не должны быть видны — цены, себестоимость и выручка. Прятать их
только в интерфейсе бессмысленно: данные всё равно уедут в браузер и видны
в любом ответе API. Поэтому деньги ГАСЯТСЯ НА СЕРВЕРЕ, а интерфейс просто не
рисует пустые колонки.

Гасим нулём, а не удаляем поле: схемы ответов объявляют суммы как float, и
исчезнувший ключ сломал бы типы у клиента. Ноль наружу не показывается —
без права колонки скрыты целиком.
"""
from fastapi import Depends, HTTPException

from .models import User
from .security import get_current_user, has_permission

AMOUNTS = "amounts:view"


def sees_money(user: User) -> bool:
    return has_permission(user, AMOUNTS)


async def money_visible(current: User = Depends(get_current_user)) -> bool:
    """Зависимость для эндпоинтов: показывать ли деньги этому пользователю."""
    return sees_money(current)


def require_money(current: User, what: str = "документ") -> None:
    """Запретить ВВОД документа, в котором есть цена.

    Иначе получилось бы, что человек без права видеть суммы заводит приход или
    продажу с невидимым для себя полем цены — и оно уходит нулём, занижая
    среднюю себестоимость по всему складу.
    """
    if not sees_money(current):
        raise HTTPException(
            403,
            detail=(
                f"Нет доступа: чтобы заводить {what}, нужно право "
                "«Суммы и цены» — в документе есть цена."
            ),
        )


def hide(item, *fields: str, nested: dict[str, tuple[str, ...]] | None = None):
    """Вернуть копию pydantic-модели с обнулёнными денежными полями.

    Копия, а не правка на месте: на входе может оказаться ORM-объект из живой
    сессии, и присваивание ему улетело бы в базу при ближайшем flush.
    """
    upd: dict = {f: 0.0 for f in fields}
    for name, sub in (nested or {}).items():
        child = getattr(item, name, None)
        if child is not None:
            upd[name] = child.model_copy(update={f: 0.0 for f in sub})
    return item.model_copy(update=upd)


def hide_all(items, *fields: str, nested: dict[str, tuple[str, ...]] | None = None):
    return [hide(x, *fields, nested=nested) for x in items]
