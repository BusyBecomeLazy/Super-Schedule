from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select

from app.core.security import decode_access_token
from app.db.session import AsyncSessionLocal
from app.models.group import GroupMember
from app.ws.manager import connection_manager

router = APIRouter()


@router.websocket("/ws/groups/{group_id}")
async def group_socket(websocket: WebSocket, group_id: int, token: str | None = None) -> None:
    if token is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    subject = decode_access_token(token)
    if subject is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(GroupMember).where(
                GroupMember.group_id == group_id,
                GroupMember.user_id == int(subject),
                GroupMember.left_at.is_(None),
            )
        )
        membership = result.scalar_one_or_none()
        if membership is None:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

    await connection_manager.connect(group_id, websocket, membership.role)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        connection_manager.disconnect(group_id, websocket)
