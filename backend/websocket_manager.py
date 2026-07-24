from fastapi import WebSocket
from typing import Dict, List


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[int, WebSocket] = {}
        self.call_rooms: Dict[str, List[int]] = {}

    async def connect(self, user_id: int, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[user_id] = websocket

    def disconnect(self, user_id: int):
        if user_id in self.active_connections:
            del self.active_connections[user_id]

    async def send_personal_message(self, message: dict, user_id: int):
        if user_id in self.active_connections:
            await self.active_connections[user_id].send_json(message)

    async def broadcast_to_room(self, message: dict, room_id: str, exclude_user: int = None):
        if room_id in self.call_rooms:
            for user_id in self.call_rooms[room_id]:
                if user_id != exclude_user and user_id in self.active_connections:
                    await self.active_connections[user_id].send_json(message)

    def join_room(self, room_id: str, user_id: int):
        if room_id not in self.call_rooms:
            self.call_rooms[room_id] = []
        if user_id not in self.call_rooms[room_id]:
            self.call_rooms[room_id].append(user_id)

    def leave_room(self, room_id: str, user_id: int):
        if room_id in self.call_rooms and user_id in self.call_rooms[room_id]:
            self.call_rooms[room_id].remove(user_id)
            if not self.call_rooms[room_id]:
                del self.call_rooms[room_id]


manager = ConnectionManager()