from sqlalchemy.ext.asyncio import AsyncSession

from .models import AuditLog, User
from .ws import manager


async def record(
    db: AsyncSession,
    user: User | None,
    action: str,
    entity: str,
    detail: str = "",
    broadcast_payload: dict | None = None,
):
    """Write an audit row and push a real-time event to all clients."""
    log = AuditLog(
        user_id=user.id if user else None,
        user_name=user.full_name if user else "system",
        action=action,
        entity=entity,
        detail=detail,
    )
    db.add(log)
    await db.commit()

    await manager.broadcast(
        f"{entity}.{action}",
        {
            "entity": entity,
            "action": action,
            "detail": detail,
            "by": user.full_name if user else "system",
            **(broadcast_payload or {}),
        },
    )
