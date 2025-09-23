from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Dict, List, Optional, Any
from solver_cpsat import solve_cp_sat
from schools import router as schools_router
from subscriptions import router as subs_router


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


app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount schools/api router (tenant helpers)
app.include_router(schools_router)
app.include_router(subs_router)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/solve/cpsat")
def solve_cpsat(req: SolveRequest) -> Any:
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
