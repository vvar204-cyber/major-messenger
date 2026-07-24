from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel
import shutil
import os
import uuid
from pathlib import Path

import models
from database import engine, get_db
from auth import get_password_hash, verify_password, create_access_token, get_current_user
from websocket_manager import manager

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Major Messenger")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"
UPLOADS_DIR = BASE_DIR / "uploads"

os.makedirs(UPLOADS_DIR, exist_ok=True)
os.makedirs(FRONTEND_DIR, exist_ok=True)

app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


class UserCreate(BaseModel):
    username: str
    email: str
    password: str

class FriendRequestCreate(BaseModel):
    to_username: str


@app.get("/")
def read_root():
    return FileResponse(str(FRONTEND_DIR / "index.html"))


@app.post("/register")
def register(user: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(
        (models.User.username == user.username) | (models.User.email == user.email)
    ).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username or email already exists")

    hashed_password = get_password_hash(user.password)
    new_user = models.User(
        username=user.username,
        email=user.email,
        hashed_password=hashed_password
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    access_token = create_access_token(data={"sub": new_user.username})
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "username": new_user.username,
        "user_id": new_user.id
    }


@app.post("/token")
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect username or password")

    access_token = create_access_token(data={"sub": user.username})
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "username": user.username,
        "user_id": user.id
    }


@app.get("/me")
def read_users_me(current_user: models.User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "username": current_user.username,
        "email": current_user.email,
        "avatar": current_user.avatar
    }


@app.post("/friends/request")
def send_friend_request(
        request: FriendRequestCreate,
        current_user: models.User = Depends(get_current_user),
        db: Session = Depends(get_db)
):
    target_user = db.query(models.User).filter(
        models.User.username == request.to_username
    ).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    if target_user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot add yourself")
    if target_user in current_user.friends:
        raise HTTPException(status_code=400, detail="Already friends")

    existing = db.query(models.FriendRequest).filter(
        models.FriendRequest.from_user_id == current_user.id,
        models.FriendRequest.to_user_id == target_user.id,
        models.FriendRequest.status == "pending"
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Request already sent")

    new_request = models.FriendRequest(
        from_user_id=current_user.id,
        to_user_id=target_user.id
    )
    db.add(new_request)
    db.commit()
    return {"message": "Friend request sent"}


@app.get("/friends/requests")
def get_friend_requests(
        current_user: models.User = Depends(get_current_user),
        db: Session = Depends(get_db)
):
    requests = db.query(models.FriendRequest).filter(
        models.FriendRequest.to_user_id == current_user.id,
        models.FriendRequest.status == "pending"
    ).all()

    result = []
    for req in requests:
        sender = db.query(models.User).filter(models.User.id == req.from_user_id).first()
        result.append({
            "id": req.id,
            "from_username": sender.username,
            "from_user_id": sender.id
        })
    return result


@app.post("/friends/accept/{request_id}")
def accept_friend_request(
        request_id: int,
        current_user: models.User = Depends(get_current_user),
        db: Session = Depends(get_db)
):
    req = db.query(models.FriendRequest).filter(
        models.FriendRequest.id == request_id
    ).first()
    if not req or req.to_user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Request not found")

    req.status = "accepted"
    from_user = db.query(models.User).filter(models.User.id == req.from_user_id).first()
    to_user = db.query(models.User).filter(models.User.id == req.to_user_id).first()
    from_user.friends.append(to_user)
    to_user.friends.append(from_user)
    db.commit()
    return {"message": "Friend request accepted"}


@app.post("/friends/reject/{request_id}")
def reject_friend_request(
        request_id: int,
        current_user: models.User = Depends(get_current_user),
        db: Session = Depends(get_db)
):
    req = db.query(models.FriendRequest).filter(
        models.FriendRequest.id == request_id
    ).first()
    if not req or req.to_user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Request not found")
    req.status = "rejected"
    db.commit()
    return {"message": "Friend request rejected"}


@app.get("/friends")
def get_friends(
        current_user: models.User = Depends(get_current_user),
        db: Session = Depends(get_db)
):
    return [
        {"id": f.id, "username": f.username, "is_online": f.is_online}
        for f in current_user.friends
    ]


@app.delete("/friends/{friend_id}")
def remove_friend(
        friend_id: int,
        current_user: models.User = Depends(get_current_user),
        db: Session = Depends(get_db)
):
    friend = db.query(models.User).filter(models.User.id == friend_id).first()
    if not friend:
        raise HTTPException(status_code=404, detail="User not found")
    if friend in current_user.friends:
        current_user.friends.remove(friend)
    if current_user in friend.friends:
        friend.friends.remove(current_user)
    db.commit()
    return {"message": "Friend removed"}


@app.get("/users/search/{username}")
def search_user(
        username: str,
        current_user: models.User = Depends(get_current_user),
        db: Session = Depends(get_db)
):
    users = db.query(models.User).filter(
        models.User.username.contains(username),
        models.User.id != current_user.id
    ).limit(10).all()
    return [{"id": u.id, "username": u.username} for u in users]


@app.get("/messages/{friend_id}")
def get_messages(
        friend_id: int,
        current_user: models.User = Depends(get_current_user),
        db: Session = Depends(get_db)
):
    messages = db.query(models.Message).filter(
        ((models.Message.sender_id == current_user.id) &
         (models.Message.receiver_id == friend_id)) |
        ((models.Message.sender_id == friend_id) &
         (models.Message.receiver_id == current_user.id))
    ).order_by(models.Message.created_at).all()

    return [{
        "id": m.id,
        "sender_id": m.sender_id,
        "content": m.content,
        "file_url": m.file_url,
        "message_type": m.message_type,
        "created_at": m.created_at.isoformat()
    } for m in messages]


@app.post("/upload")
async def upload_file(
        file: UploadFile = File(...),
        current_user: models.User = Depends(get_current_user)
):
    file_extension = file.filename.split(".")[-1] if "." in file.filename else "bin"
    file_name = f"{uuid.uuid4()}.{file_extension}"
    file_path = UPLOADS_DIR / file_name

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return {"file_url": f"/uploads/{file_name}"}


@app.websocket("/ws/{user_id}")
async def websocket_endpoint(
        websocket: WebSocket,
        user_id: int,
        db: Session = Depends(get_db)
):
    await manager.connect(user_id, websocket)
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if user:
        user.is_online = 1
        db.commit()

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "chat_message":
                receiver_id = data["receiver_id"]
                content = data["content"]
                message_type = data.get("message_type", "text")
                file_url = data.get("file_url")

                new_message = models.Message(
                    sender_id=user_id,
                    receiver_id=receiver_id,
                    content=content,
                    file_url=file_url,
                    message_type=message_type
                )
                db.add(new_message)
                db.commit()
                db.refresh(new_message)

                await manager.send_personal_message({
                    "type": "new_message",
                    "sender_id": user_id,
                    "content": content,
                    "file_url": file_url,
                    "message_type": message_type,
                    "message_id": new_message.id,
                    "created_at": new_message.created_at.isoformat()
                }, receiver_id)

            elif msg_type == "call_offer":
                await manager.send_personal_message({
                    "type": "call_offer",
                    "from_id": user_id,
                    "offer": data["offer"],
                    "call_type": data.get("call_type", "audio")
                }, data["target_id"])

            elif msg_type == "call_answer":
                await manager.send_personal_message({
                    "type": "call_answer",
                    "from_id": user_id,
                    "answer": data["answer"]
                }, data["target_id"])

            elif msg_type == "ice_candidate":
                await manager.send_personal_message({
                    "type": "ice_candidate",
                    "from_id": user_id,
                    "candidate": data["candidate"]
                }, data["target_id"])

            elif msg_type == "call_reject":
                await manager.send_personal_message({
                    "type": "call_reject",
                    "from_id": user_id
                }, data["target_id"])

            elif msg_type == "call_end":
                await manager.send_personal_message({
                    "type": "call_end",
                    "from_id": user_id
                }, data["target_id"])

            elif msg_type == "join_group_call":
                room_id = data["room_id"]
                manager.join_room(room_id, user_id)
                await manager.broadcast_to_room({
                    "type": "user_joined_call",
                    "user_id": user_id,
                    "room_id": room_id
                }, room_id, exclude_user=user_id)

            elif msg_type == "leave_group_call":
                room_id = data["room_id"]
                manager.leave_room(room_id, user_id)
                await manager.broadcast_to_room({
                    "type": "user_left_call",
                    "user_id": user_id,
                    "room_id": room_id
                }, room_id)

            elif msg_type == "group_call_offer":
                await manager.send_personal_message({
                    "type": "group_call_offer",
                    "from_id": user_id,
                    "offer": data["offer"],
                    "room_id": data["room_id"]
                }, data["target_id"])

            elif msg_type == "group_call_answer":
                await manager.send_personal_message({
                    "type": "group_call_answer",
                    "from_id": user_id,
                    "answer": data["answer"]
                }, data["target_id"])

            elif msg_type == "group_ice_candidate":
                await manager.send_personal_message({
                    "type": "group_ice_candidate",
                    "from_id": user_id,
                    "candidate": data["candidate"]
                }, data["target_id"])

    except WebSocketDisconnect:
        manager.disconnect(user_id)
        if user:
            user.is_online = 0
            db.commit()