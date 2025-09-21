from pydantic import BaseModel, EmailStr
import uuid
import datetime
from typing import List
from .models import UserRole

# Token Schemas
class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    email: EmailStr | None = None

# User Schemas
class UserBase(BaseModel):
    email: EmailStr
    role: UserRole

class UserCreate(UserBase):
    password: str
    school_id: uuid.UUID

class UserInDBBase(UserBase):
    id: uuid.UUID
    school_id: uuid.UUID
    created_at: datetime.datetime

    class Config:
        orm_mode = True

class User(UserInDBBase):
    pass

# School Schemas
class SchoolBase(BaseModel):
    name: str

class SchoolCreate(SchoolBase):
    pass

class SchoolInDBBase(SchoolBase):
    id: uuid.UUID
    created_at: datetime.datetime
    users: List[User] = []

    class Config:
        orm_mode = True

class School(SchoolInDBBase):
    pass
