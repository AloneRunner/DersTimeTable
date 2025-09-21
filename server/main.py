from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, Field
from typing import Dict, List, Optional, Any
from contextlib import asynccontextmanager
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import timedelta

# Local imports
from . import crud, models, schemas, auth
from .database import engine, get_db, Base
from .solver_cpsat import solve_cp_sat


# Timetable-related Pydantic models (from original main.py)
class Teacher(BaseModel):
    id: str
    name: str
    branches: List[str]
    availability: List[List[bool]]
    canTeachMiddleSchool: bool
    canTeachHighSchool: bool

class Classroom(BaseModel):
    id: str
    name: str
    level: str
    group: Optional[str] = None
    homeroomTeacherId: Optional[str] = None
    sessionType: str

class Subject(BaseModel):
    id: str
    name: str
    blockHours: int = 0
    tripleBlockHours: Optional[int] = 0
    maxConsec: Optional[int] = None
    locationId: Optional[str] = None
    weeklyHours: int
    assignedClassIds: List[str]
    pinnedTeacherByClassroom: Dict[str, str] = Field(default_factory=dict)

class Location(BaseModel):
    id: str
    name: str

class FixedAssignment(BaseModel):
    id: str
    classroomId: str
    subjectId: str
    dayIndex: int
    hourIndex: int

class LessonGroup(BaseModel):
    id: str
    name: str
    subjectId: str
    classroomIds: List[str]
    weeklyHours: int
    isBlock: bool

class Duty(BaseModel):
    id: str
    teacherId: str
    name: str
    dayIndex: int
    hourIndex: int

class TimetableData(BaseModel):
    teachers: List[Teacher]
    classrooms: List[Classroom]
    subjects: List[Subject]
    locations: List[Location]
    fixedAssignments: List[FixedAssignment]
    lessonGroups: List[LessonGroup]
    duties: List[Duty]

class SchoolHours(BaseModel):
    Ortaokul: List[int]
    Lise: List[int]

class SolveRequest(BaseModel):
    data: TimetableData
    schoolHours: SchoolHours
    timeLimitSeconds: int = 60
    defaults: dict | None = None
    preferences: dict | None = None
    stopAtFirst: bool | None = None

# --- App Setup ---

@asynccontextmanager
async def lifespan(app: FastAPI):
    # On startup, create database tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    # On shutdown (if needed)

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Auth Endpoints ---

@app.post("/token", response_model=schemas.Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)):
    user = await auth.authenticate_user(db, form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=auth.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = auth.create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}


# --- User & School Endpoints ---

@app.post("/schools/", response_model=schemas.School)
async def create_school(school: schemas.SchoolCreate, db: AsyncSession = Depends(get_db)):
    # In a real app, you might want to protect this endpoint
    return await crud.create_school(db=db, school=school)

@app.post("/users/", response_model=schemas.User)
async def create_user(user: schemas.UserCreate, db: AsyncSession = Depends(get_db)):
    db_user = await crud.get_user_by_email(db, email=user.email)
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    # Ensure school exists
    db_school = await crud.get_school(db, school_id=user.school_id)
    if not db_school:
        raise HTTPException(status_code=404, detail="School not found")
    return await crud.create_user(db=db, user=user)

@app.get("/users/me/", response_model=schemas.User)
async def read_users_me(current_user: models.User = Depends(auth.get_current_user)):
    return current_user


# --- Core App Endpoints ---

@app.get("/health")
def health():
    return {"ok": True}

@app.post("/solve/cpsat")
def solve_cpsat_endpoint(req: SolveRequest) -> Any:
    # TODO: Protect this endpoint and associate data with a school/user
    defaults = req.defaults or {}
    prefs = req.preferences or {}
    result = solve_cp_sat(
        req.data.model_dump(),
        req.schoolHours.model_dump(),
        req.timeLimitSeconds,
        default_max_consec=defaults.get('maxConsec'),
        preferences=prefs,
        stop_at_first=bool(req.stopAtFirst) if req.stopAtFirst is not None else False,
    )
    return result


# --- Main Execution ---

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)