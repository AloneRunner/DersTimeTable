from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from . import models, schemas
from .auth import get_password_hash
import uuid

async def get_user_by_email(db: AsyncSession, email: str):
    result = await db.execute(select(models.User).filter(models.User.email == email))
    return result.scalars().first()

async def create_user(db: AsyncSession, user: schemas.UserCreate):
    hashed_password = get_password_hash(user.password)
    db_user = models.User(
        email=user.email,
        hashed_password=hashed_password,
        role=user.role,
        school_id=user.school_id
    )
    db.add(db_user)
    await db.commit()
    await db.refresh(db_user)
    return db_user

async def create_school(db: AsyncSession, school: schemas.SchoolCreate) -> models.School:
    db_school = models.School(name=school.name)
    db.add(db_school)
    await db.commit()
    await db.refresh(db_school)
    return db_school

async def get_school(db: AsyncSession, school_id: uuid.UUID):
    result = await db.execute(select(models.School).filter(models.School.id == school_id))
    return result.scalars().first()
