import json
from collections import defaultdict
from typing import Any

from fastapi import WebSocket

from app.services.permissions import permissions_for_role


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[int, dict[WebSocket, str]] = defaultdict(dict)

    async def connect(self, group_id: int, websocket: WebSocket, role: str) -> None:
        await websocket.accept()
        self._connections[group_id][websocket] = role

    def disconnect(self, group_id: int, websocket: WebSocket) -> None:
        self._connections[group_id].pop(websocket, None)
        if not self._connections[group_id]:
            self._connections.pop(group_id, None)

    async def broadcast(
        self, group_id: int, message: dict[str, Any], required_permission: str | None = None
    ) -> None:
        dead_connections: list[WebSocket] = []
        encoded = json.dumps(message, ensure_ascii=False)
        for websocket, role in self._connections.get(group_id, {}).items():
            if required_permission and not getattr(permissions_for_role(role), required_permission):
                continue
            try:
                await websocket.send_text(encoded)
            except RuntimeError:
                dead_connections.append(websocket)
        for websocket in dead_connections:
            self.disconnect(group_id, websocket)


connection_manager = ConnectionManager()
