"""Лёгкая авто-миграция схемы.

`Base.metadata.create_all` создаёт только НОВЫЕ таблицы — добавленные в модели
колонки в уже существующей таблице он не создаёт. Этот модуль сравнивает
модели с information_schema и выполняет недостающие `ALTER TABLE ADD COLUMN`.
Ничего не удаляет и не меняет типы — только добавляет.
"""
from sqlalchemy import text
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncConnection

from .database import Base

_PG = postgresql.dialect()


def _ddl_type(col) -> str | None:
    try:
        return col.type.compile(dialect=_PG)
    except Exception:  # noqa: BLE001
        return None


def _default_sql(col) -> str:
    """Server-side default for backfilling existing rows."""
    d = col.default
    if d is not None and getattr(d, "is_scalar", False):
        v = d.arg
        if isinstance(v, bool):
            return f" DEFAULT {'true' if v else 'false'}"
        if isinstance(v, (int, float)):
            return f" DEFAULT {v}"
        if isinstance(v, str):
            return " DEFAULT " + "'" + v.replace("'", "''") + "'"
    return ""


async def auto_migrate(conn: AsyncConnection) -> list[str]:
    """Add columns that exist in the models but not yet in the database."""
    rows = (
        await conn.execute(
            text(
                "SELECT table_name, column_name FROM information_schema.columns "
                "WHERE table_schema = current_schema()"
            )
        )
    ).all()
    existing: dict[str, set[str]] = {}
    for tbl, colname in rows:
        existing.setdefault(tbl, set()).add(colname)

    applied: list[str] = []
    for table in Base.metadata.sorted_tables:
        have = existing.get(table.name)
        if have is None:
            continue  # brand-new table -> create_all handles it
        for col in table.columns:
            if col.name in have:
                continue
            ddl = _ddl_type(col)
            if not ddl:
                continue
            stmt = f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {ddl}{_default_sql(col)}'
            await conn.execute(text(stmt))
            applied.append(f"{table.name}.{col.name}")
    return applied
