from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Table, Text
from sqlalchemy.orm import relationship
from database import Base
import datetime

# Таблица друзей (many-to-many)
friends_table = Table('friends', Base.metadata,
    Column('user_id', Integer, ForeignKey('users.id')),
    Column('friend_id', Integer, ForeignKey('users.id'))
)

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    email = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    avatar = Column(String, default="default.png")
    is_online = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    
    friends = relationship("User", secondary=friends_table,
                          primaryjoin=id==friends_table.c.user_id,
                          secondaryjoin=id==friends_table.c.friend_id)

class Message(Base):
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"))
    receiver_id = Column(Integer, ForeignKey("users.id"))
    content = Column(Text, nullable=True)
    file_url = Column(String, nullable=True)
    message_type = Column(String, default="text")  # text, image, file
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    is_read = Column(Integer, default=0)

class FriendRequest(Base):
    __tablename__ = "friend_requests"
    id = Column(Integer, primary_key=True, index=True)
    from_user_id = Column(Integer, ForeignKey("users.id"))
    to_user_id = Column(Integer, ForeignKey("users.id"))
    status = Column(String, default="pending")  # pending, accepted, rejected
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class CallRoom(Base):
    __tablename__ = "call_rooms"
    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(String, unique=True, index=True)
    creator_id = Column(Integer, ForeignKey("users.id"))
    room_type = Column(String, default="private")  # private, group
    created_at = Column(DateTime, default=datetime.datetime.utcnow)