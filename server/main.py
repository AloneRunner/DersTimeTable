from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Dict, List, Optional, Any
from datetime import datetime, timezone
from solver_cpsat import solve_cp_sat
from schools import router as schools_router
from subscriptions import router as subs_router
from auth import router as auth_router, get_session_context, get_teacher_links_for_user
from storage import upsert_published_schedule, get_published_schedule as storage_get_published_schedule


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
    requiredTeacherCount: int = Field(default=1, ge=1)
    pinnedTeacherByClassroom: Dict[str, List[str]] = Field(default_factory=dict)


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
    allow_origins=["https://ozariktable.netlify.app", "http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount schools/api router (tenant helpers)
app.include_router(schools_router)
app.include_router(subs_router)
app.include_router(auth_router)


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


class PublishSchedulePayload(BaseModel):
    school_id: int
    schedule: Dict[str, Any]
    data: TimetableData


class PublishedScheduleRecord(BaseModel):
    school_id: int
    schedule: Dict[str, Any]
    data: Dict[str, Any]
    published_at: datetime
    published_by: Optional[Dict[str, Any]] = None


class TeacherScheduleResponse(BaseModel):
    school_id: int
    teacher_id: str
    teacher_name: Optional[str]
    data: Dict[str, Any]
    schedule: Dict[str, Any]
    published_at: datetime
    max_daily_hours: int


@app.post("/api/schedules/publish")
def api_publish_schedule(payload: PublishSchedulePayload, request: Request) -> Dict[str, Any]:
    user, memberships, _ = get_session_context(request)
    allowed_school_ids = {m.get('id') for m in memberships if m.get('id') is not None}
    if payload.school_id not in allowed_school_ids:
        raise HTTPException(status_code=403, detail="not-member-of-school")

    published_at = datetime.now(timezone.utc).isoformat()
    record = {
        'school_id': payload.school_id,
        'schedule': payload.schedule,
        'data': payload.data.model_dump(),
        'published_at': published_at,
        'published_by': {
            'user_id': user.get('id'),
            'name': user.get('name'),
            'email': user.get('email'),
        },
    }
    upsert_published_schedule(record)
    return {'ok': True, 'published_at': published_at, 'record': record}


@app.get("/api/schedules/published", response_model=PublishedScheduleRecord)
def api_get_published_schedule(request: Request, school_id: Optional[int] = None) -> Dict[str, Any]:
    user, memberships, _ = get_session_context(request)
    allowed_school_ids = [m.get('id') for m in memberships if m.get('id') is not None]
    if not allowed_school_ids:
        raise HTTPException(status_code=403, detail="no-school-memberships")
    target_school_id = school_id if school_id is not None else allowed_school_ids[0]
    if target_school_id not in allowed_school_ids:
        raise HTTPException(status_code=403, detail="not-member-of-school")

    record = storage_get_published_schedule(target_school_id)
    if not record:
        raise HTTPException(status_code=404, detail="schedule-not-found")
    return record


@app.get("/api/teacher/schedule", response_model=TeacherScheduleResponse)
def api_teacher_schedule(request: Request, school_id: Optional[int] = None) -> Dict[str, Any]:
    user, memberships, _ = get_session_context(request)
    user_id = user.get('id')
    if user_id is None:
        raise HTTPException(status_code=401, detail="unauthenticated")

    teacher_links = get_teacher_links_for_user(user_id)
    if not teacher_links:
        raise HTTPException(status_code=404, detail="teacher-link-not-found")

    target_link = None
    if school_id is not None:
        target_link = next((link for link in teacher_links if link.get('school_id') == school_id), None)
        if target_link is None:
            raise HTTPException(status_code=403, detail="not-linked-to-school")
    else:
        # pick first school where membership role is teacher if available
        teacher_school_ids = {link.get('school_id') for link in teacher_links}
        for membership in memberships:
            if membership.get('id') in teacher_school_ids and membership.get('role') in ('teacher', 'admin'):
                target_link = next((link for link in teacher_links if link.get('school_id') == membership.get('id')), None)
                if target_link:
                    break
        if target_link is None:
            target_link = teacher_links[0]

    target_school_id = target_link.get('school_id')
    teacher_id = target_link.get('teacher_id')
    if target_school_id is None or teacher_id is None:
        raise HTTPException(status_code=400, detail="invalid-teacher-link")

    record = storage_get_published_schedule(target_school_id)
    if not record:
        raise HTTPException(status_code=404, detail="schedule-not-found")

    data = record.get('data') or {}
    schedule = record.get('schedule') or {}

    teacher_entry = None
    for teacher in data.get('teachers', []):
        if teacher.get('id') == teacher_id:
            teacher_entry = teacher
            break

    max_daily_hours = 0
    if teacher_entry and teacher_entry.get('availability'):
        for day in teacher_entry['availability']:
            if isinstance(day, list):
                max_daily_hours = max(max_daily_hours, len(day))
    if max_daily_hours == 0:
        for class_schedule in schedule.values():
            if not isinstance(class_schedule, list):
                continue
            for day in class_schedule:
                if isinstance(day, list):
                    max_daily_hours = max(max_daily_hours, len(day))
    if max_daily_hours == 0:
        max_daily_hours = 12

    return {
        'school_id': target_school_id,
        'teacher_id': teacher_id,
        'teacher_name': teacher_entry.get('name') if teacher_entry else None,
        'data': data,
        'schedule': schedule,
        'published_at': record.get('published_at'),
        'max_daily_hours': max_daily_hours,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)


