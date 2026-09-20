from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Dict, List, Optional, Any
from datetime import datetime, timezone
import os
import time
from threading import BoundedSemaphore
from solver_cpsat import solve_cp_sat
from diagnose import diagnose_infeasible
from schools import router as schools_router
from subscriptions import router as subs_router
from auth import router as auth_router, get_session_context, get_teacher_links_for_user
from catalog_router import catalog_router
from usage import router as usage_router
from published_schedule_repository import get_published_schedule, upsert_published_schedule
import solve_quota


class Teacher(BaseModel):
    id: str
    name: str
    branches: List[str]
    availability: List[List[bool]]
    canTeachMiddleSchool: bool
    canTeachHighSchool: bool
    maxWeeklyHours: Optional[int] = Field(default=None, ge=1, le=80)


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
    notSameDayWith: List[str] = Field(default_factory=list)


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
    timeLimitSeconds: int = Field(default=60, ge=5, le=180)
    defaults: dict | None = None
    preferences: dict | None = None
    stopAtFirst: bool | None = None
    # Cozum cikmazsa sebebini ara. Istemci bunu yalnizca SON denemede true
    # gonderiyor; yoksa blok esnetmeli ikinci deneme yuzunden tesihs iki kez kosar.
    diagnose: bool = False
    # Ayni "Program Olustur" tiklamasinin ikinci (blok esnetmeli) istegi. Kotada
    # ayri bir deneme sayilmaz; yoksa bloklu okullar haklarini iki kat hizli bitirir.
    followUp: bool = False


app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://ozariktable.netlify.app",
        "https://idare.ozarik.org",
        "https://www.idare.ozarik.org",
        "http://localhost:5173",
        "http://localhost:3000",
        "capacitor://localhost",
        "http://localhost",
        "https://localhost",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount schools/api router (tenant helpers)
app.include_router(schools_router)
app.include_router(subs_router)
app.include_router(auth_router)
app.include_router(catalog_router)
app.include_router(usage_router)

try:
    _solver_concurrency = max(1, min(4, int(os.environ.get("SOLVER_MAX_CONCURRENCY", "2"))))
except (TypeError, ValueError):
    _solver_concurrency = 2
_solver_slots = BoundedSemaphore(_solver_concurrency)

# Tesihs butcesi. Cozum cikmayinca sebep aranirken cozucu yuvasi mesgul kalir,
# yani bu sure dogrudan "mesgul" cevabi riskini artirir. Ortam degiskeniyle
# ayarlanabilir; 0 yazilirsa tesihs tamamen kapanir.
try:
    _diagnose_budget = max(0, min(120, int(os.environ.get("SOLVER_DIAGNOSE_BUDGET", "30"))))
except (TypeError, ValueError):
    _diagnose_budget = 30

# Tek denemenin ust siniri. Istemci 180'e kadar gonderebiliyordu ve sure asimi
# mesaji kullaniciyi sureyi artirmaya yonlendiriyordu; tek kisi 180 sn'lik
# yuzlerce denemeyle aylik butceyi bitirdi. Eski istemciler (Android paketi)
# hala buyuk deger gonderebilecegi icin 422 vermek yerine sessizce kirpiyoruz.
try:
    _max_solve_seconds = max(15, min(180, int(os.environ.get("SOLVER_MAX_SECONDS", "90"))))
except (TypeError, ValueError):
    _max_solve_seconds = 90


_BLOCKER_NAMES = {
    'fixed': 'saate sabitlenmiş dersler',
    'pinned_teacher': 'derslere sabitlenen öğretmenler',
    'blocks': "2'li / 3'lü blok kuralları",
    'not_same_day': '"aynı gün olamaz" kuralları',
    'same_day_split': 'dersin aynı gün bölünememesi',
    'max_consec': 'art arda ders sınırı',
    'daily_max': 'öğretmen günlük ders sınırı',
    'weekly_max': 'öğretmen haftalık üst sınırı',
    'gap_limit': 'öğretmen boşluk sınırı',
    'availability': 'öğretmen müsaitlikleri',
    'availability_teacher': 'bir öğretmenin müsaitliği',
}


@app.get("/health")
def health():
    return {"ok": True}


def _record_attempt(quota_keys, req: SolveRequest, time_limit: int, started_at: float, result: Any) -> None:
    """Destek icin son denemenin ayar ve sonucunu yazar; okul verisi yazilmaz."""
    try:
        stats = (result or {}).get('stats') or {}
        status = next((str(n).split('=', 1)[1] for n in (stats.get('notes') or []) if str(n).startswith('status=')), None)
        solve_quota.record_attempt(quota_keys, {
            'at': datetime.now(timezone.utc).isoformat(),
            'solved': bool((result or {}).get('schedule')),
            'status': status,
            'blocker': (stats.get('diagnosis') or {}).get('blocker'),
            'seconds': round(time.time() - started_at, 1),
            'timeLimit': time_limit,
            'blocksRelaxed': bool(req.followUp),
            'maxConsec': (req.defaults or {}).get('maxConsec'),
            'preferences': req.preferences or {},
            'classrooms': len(req.data.classrooms),
            'teachers': len(req.data.teachers),
            'subjects': len(req.data.subjects),
        })
    except Exception:  # pylint: disable=broad-except
        pass  # not almak hicbir zaman cozumu bozmamali


@app.get("/solve/quota")
def solve_quota_status(request: Request) -> Any:
    """Kalan sunucu cozucu suresi; istemci "Program Olustur" dugmesinin yaninda gosterir."""
    return solve_quota.remaining(solve_quota.identity_keys(request))


@app.post("/solve/quota/request")
def solve_quota_request(request: Request) -> Any:
    """Kullanici limit artisi ister; yonetici panelinde "istek var" olarak gorunur."""
    return {"ok": solve_quota.request_increase(solve_quota.identity_keys(request))}


@app.post("/solve/cpsat")
def solve_cpsat(req: SolveRequest, request: Request) -> Any:
    quota_keys = solve_quota.identity_keys(request)
    if not _solver_slots.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="solver-busy-try-again")
    defaults = req.defaults or {}
    prefs = req.preferences or {}
    started_at: Optional[float] = None
    try:
        # Verinin parmak izi de bir kimliktir: ayni veriyi yeni hesaba yuklemek butceyi sifirlamaz.
        if not solve_quota.is_exempt(quota_keys):
            fingerprint = solve_quota.school_key(req.data.model_dump())
            if fingerprint:
                quota_keys = quota_keys + [fingerprint]
        # Ayni tiklamanin ikinci (blok esnetmeli) istegi IP freninde ayri sayilmaz;
        # sure butcesinden ise her istek harcadigi kadar duser.
        blocked, time_limit = solve_quota.authorize(
            quota_keys, min(req.timeLimitSeconds, _max_solve_seconds), count_ip=not req.followUp
        )
        if blocked:
            raise HTTPException(
                status_code=429,
                detail=f"solver-quota-{blocked['scope']}",
                headers={"Retry-After": str(blocked['retryAfter'])},
            )
        # Ust uste basarisizlikta sureyi kisaltmayi denedik ve geri aldik: gercek bir
        # okulun verisi (20 Eylul 2026) cozulebilir cikti ama ~60 sn istiyordu. Sureyi
        # kisaltmak boyle bir okulu KESIN basarisizliga mahkum eder; masrafi zaten
        # sure butcesi sinirliyor.
        started_at = time.time()
        result = solve_cp_sat(
            req.data.model_dump(),
            req.schoolHours.model_dump(),
            time_limit,
            default_max_consec=defaults.get('maxConsec'),
            preferences=prefs,
            stop_at_first=bool(req.stopAtFirst) if req.stopAtFirst is not None else False,
        )
        # TESHIS. Cozucu "mumkun degil" dediginde kullaniciya duzeltecek bir sey
        # soylemek gerekiyor; ekrandaki on kontrol yesilken bu mesaj tek basina
        # cikmaz sokak oluyordu. Kurallari tek tek gevsetip hangisinin engel
        # oldugunu buluyoruz. Sure asiminda (UNKNOWN) da kosar: ilk surumde
        # kosmuyordu, kullanici yalnizca "sureyi artirip yeniden deneyin" goruyor
        # ve ayni veriyle yuzlerce kez deniyordu. Bir kural gevsetilince 8 sn'de
        # cozum cikiyorsa engel o kuraldir; asil cozumun sureye sigmamis olmasi
        # bunu degistirmez.
        if req.diagnose and _diagnose_budget > 0 and not result.get('schedule'):
            stats = result.get('stats') or {}
            notes = list(stats.get('notes') or [])
            timed_out = any(str(n).strip() == 'status=UNKNOWN' for n in notes)
            if timed_out or any(str(n).strip() == 'status=INFEASIBLE' for n in notes):
                tani = diagnose_infeasible(
                    req.data.model_dump(),
                    req.schoolHours.model_dump(),
                    defaults.get('maxConsec'),
                    prefs,
                    probe_seconds=8,
                    budget_seconds=_diagnose_budget,
                )
                # Sure asiminda program IMKANSIZ degil, yalnizca zor olabilir: bir okulun
                # verisi sabitlemelerle 63 sn'de, sabitlemesiz 8 sn'de cozuldu. "Kural
                # karsilamiyor" demek yanlis olur; "bu kural isi zorlastiriyor" diyoruz.
                if timed_out and tani.get('found'):
                    kural = _BLOCKER_NAMES.get(tani.get('blocker'), 'bazı kurallar')
                    tani['message'] = (
                        f"Program verilen sürede bulunamadı, ama imkânsız görünmüyor: {kural} gevşetilince "
                        "birkaç saniyede oluşuyor. Bu kuralların hepsini değil, birkaçını gevşetin; ayrıca "
                        "\"Yer bulamazsa blokları esnet\" seçeneğini açmak çoğu zaman yeterli olur."
                    )
                stats['diagnosis'] = tani
                if tani.get('message'):
                    stats['notes'] = notes + [tani['message']]
                result['stats'] = stats
        _record_attempt(quota_keys, req, time_limit, started_at, result)
        # Harcanan sure yazildiktan SONRA kalan hesaplanir ki istemci guncel degeri gorsun.
        solve_quota.charge(quota_keys, time.time() - started_at, count_attempt=not req.followUp)
        started_at = None
        stats = result.get('stats') or {}
        stats['quota'] = solve_quota.remaining(quota_keys)
        result['stats'] = stats
        return result
    finally:
        if started_at is not None:
            # Cozucu hata verdiyse de harcanan islemci suresi butceden duser.
            solve_quota.charge(quota_keys, time.time() - started_at, count_attempt=not req.followUp)
        _solver_slots.release()


class PublishSchedulePayload(BaseModel):
    school_id: int
    schedule: Dict[str, Any]
    data: TimetableData
    substitution_assignments: List[Dict[str, Any]] = Field(default_factory=list)


class PublishedScheduleRecord(BaseModel):
    school_id: int
    schedule: Dict[str, Any]
    data: Dict[str, Any]
    published_at: datetime
    substitution_assignments: List[Dict[str, Any]] = Field(default_factory=list)
    published_by: Optional[Dict[str, Any]] = None


class TeacherScheduleResponse(BaseModel):
    school_id: int
    teacher_id: str
    teacher_name: Optional[str]
    data: Dict[str, Any]
    schedule: Dict[str, Any]
    published_at: datetime
    max_daily_hours: int
    substitution_assignments: List[Dict[str, Any]] = Field(default_factory=list)


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
        'substitution_assignments': payload.substitution_assignments or [],
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

    record = get_published_schedule(target_school_id)
    if not record:
        raise HTTPException(status_code=404, detail="schedule-not-found")
    record.setdefault("substitution_assignments", [])
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

    record = get_published_schedule(target_school_id)
    if not record:
        raise HTTPException(status_code=404, detail="schedule-not-found")

    data = record.get('data') or {}
    schedule = record.get('schedule') or {}
    all_substitutions = record.get('substitution_assignments') or []
    teacher_substitutions = [item for item in all_substitutions if item.get('substituteTeacherId') == teacher_id]

    teacher_entry = None
    for teacher in data.get('teachers', []):
        if teacher.get('id') == teacher_id:
            teacher_entry = teacher
            break

    max_daily_hours = 0

    for class_schedule in schedule.values():
        if not isinstance(class_schedule, list):
            continue
        for day in class_schedule:
            if not isinstance(day, list):
                continue
            for hour_index, assignment in enumerate(day):
                if not assignment:
                    continue
                teacher_ids = assignment.get('teacherIds') or []
                if teacher_id in teacher_ids:
                    max_daily_hours = max(max_daily_hours, hour_index + 1)

    for substitution in teacher_substitutions:
        hour_index = substitution.get('hourIndex')
        if isinstance(hour_index, int):
            max_daily_hours = max(max_daily_hours, hour_index + 1)

    if max_daily_hours == 0 and teacher_entry and teacher_entry.get('availability'):
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
        'substitution_assignments': teacher_substitutions,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)


