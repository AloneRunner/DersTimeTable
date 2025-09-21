import uuid
from sqlalchemy import Column, String, ForeignKey, DateTime, func, Enum as SAEnum
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import UUID
from .database import Base
import enum

class UserRole(enum.Enum):
    admin = "admin"
    teacher = "teacher"

class School(Base):
    __tablename__ = "schools"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    created_at = Column(DateTime, default=func.now())

    users = relationship("User", back_populates="school")

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(SAEnum(UserRole), nullable=False)
    created_at = Column(DateTime, default=func.now())
    
    school_id = Column(UUID(as_uuid=True), ForeignKey("schools.id"), nullable=False)
    school = relationship("School", back_populates="users")
