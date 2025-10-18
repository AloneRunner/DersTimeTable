from typing import Dict, List

from fastapi import APIRouter, HTTPException, Request

from auth import get_session_context
from catalog_models import (
    ClassroomPayload,
    DutyPayload,
    FixedAssignmentPayload,
    LessonGroupPayload,
    LocationPayload,
    SchoolSettingsPayload,
    SubjectPayload,
    TeacherPayload,
)
import catalog_repository as repo


catalog_router = APIRouter(prefix='/api/catalog', tags=['catalog'])


def _require_school_membership(request: Request, school_id: int) -> None:
    _user, memberships, _ = get_session_context(request)
    allowed = any(
        membership.get('id') == school_id and (membership.get('role') in {'admin', 'owner', 'manager', 'super_admin'})
        for membership in memberships
    )
    if not allowed:
        raise HTTPException(status_code=403, detail='not-authorized-for-school')


@catalog_router.get('/{school_id}/teachers')
def list_teachers(request: Request, school_id: int):
    _require_school_membership(request, school_id)
    records = repo.list_teachers(school_id)
    return {'items': [record.model_dump() for record in records]}


@catalog_router.put('/{school_id}/teachers')
def upsert_teacher(request: Request, school_id: int, payload: TeacherPayload):
    _require_school_membership(request, school_id)
    record = repo.upsert_teacher(school_id, payload)
    return {'item': record.model_dump()}


@catalog_router.delete('/{school_id}/teachers/{teacher_id}')
def delete_teacher(request: Request, school_id: int, teacher_id: str):
    _require_school_membership(request, school_id)
    repo.delete_teacher(school_id, teacher_id)
    return {'ok': True}


@catalog_router.get('/{school_id}/classrooms')
def list_classrooms(request: Request, school_id: int):
    _require_school_membership(request, school_id)
    records = repo.list_classrooms(school_id)
    return {'items': [record.model_dump() for record in records]}


@catalog_router.put('/{school_id}/classrooms')
def upsert_classroom(request: Request, school_id: int, payload: ClassroomPayload):
    _require_school_membership(request, school_id)
    record = repo.upsert_classroom(school_id, payload)
    return {'item': record.model_dump()}


@catalog_router.delete('/{school_id}/classrooms/{classroom_id}')
def delete_classroom(request: Request, school_id: int, classroom_id: str):
    _require_school_membership(request, school_id)
    repo.delete_classroom(school_id, classroom_id)
    return {'ok': True}


@catalog_router.get('/{school_id}/locations')
def list_locations(request: Request, school_id: int):
    _require_school_membership(request, school_id)
    records = repo.list_locations(school_id)
    return {'items': [record.model_dump() for record in records]}


@catalog_router.put('/{school_id}/locations')
def upsert_location(request: Request, school_id: int, payload: LocationPayload):
    _require_school_membership(request, school_id)
    record = repo.upsert_location(school_id, payload)
    return {'item': record.model_dump()}


@catalog_router.delete('/{school_id}/locations/{location_id}')
def delete_location(request: Request, school_id: int, location_id: str):
    _require_school_membership(request, school_id)
    repo.delete_location(school_id, location_id)
    return {'ok': True}


@catalog_router.get('/{school_id}/subjects')
def list_subjects(request: Request, school_id: int):
    _require_school_membership(request, school_id)
    records = repo.list_subjects(school_id)
    return {'items': [record.model_dump() for record in records]}


@catalog_router.put('/{school_id}/subjects')
def upsert_subject(request: Request, school_id: int, payload: SubjectPayload):
    _require_school_membership(request, school_id)
    record = repo.upsert_subject(school_id, payload)
    return {'item': record.model_dump()}


@catalog_router.delete('/{school_id}/subjects/{subject_id}')
def delete_subject(request: Request, school_id: int, subject_id: str):
    _require_school_membership(request, school_id)
    repo.delete_subject(school_id, subject_id)
    return {'ok': True}


@catalog_router.get('/{school_id}/fixed-assignments')
def list_fixed_assignments(request: Request, school_id: int):
    _require_school_membership(request, school_id)
    records = repo.list_fixed_assignments(school_id)
    return {'items': [record.model_dump() for record in records]}


@catalog_router.put('/{school_id}/fixed-assignments')
def upsert_fixed_assignment(request: Request, school_id: int, payload: FixedAssignmentPayload):
    _require_school_membership(request, school_id)
    record = repo.upsert_fixed_assignment(school_id, payload)
    return {'item': record.model_dump()}


@catalog_router.delete('/{school_id}/fixed-assignments/{assignment_id}')
def delete_fixed_assignment(request: Request, school_id: int, assignment_id: str):
    _require_school_membership(request, school_id)
    repo.delete_fixed_assignment(school_id, assignment_id)
    return {'ok': True}


@catalog_router.get('/{school_id}/lesson-groups')
def list_lesson_groups(request: Request, school_id: int):
    _require_school_membership(request, school_id)
    records = repo.list_lesson_groups(school_id)
    return {'items': [record.model_dump() for record in records]}


@catalog_router.put('/{school_id}/lesson-groups')
def upsert_lesson_group(request: Request, school_id: int, payload: LessonGroupPayload):
    _require_school_membership(request, school_id)
    record = repo.upsert_lesson_group(school_id, payload)
    return {'item': record.model_dump()}


@catalog_router.delete('/{school_id}/lesson-groups/{group_id}')
def delete_lesson_group(request: Request, school_id: int, group_id: str):
    _require_school_membership(request, school_id)
    repo.delete_lesson_group(school_id, group_id)
    return {'ok': True}


@catalog_router.get('/{school_id}/duties')
def list_duties(request: Request, school_id: int):
    _require_school_membership(request, school_id)
    records = repo.list_duties(school_id)
    return {'items': [record.model_dump() for record in records]}


@catalog_router.put('/{school_id}/duties')
def upsert_duty(request: Request, school_id: int, payload: DutyPayload):
    _require_school_membership(request, school_id)
    record = repo.upsert_duty(school_id, payload)
    return {'item': record.model_dump()}


@catalog_router.delete('/{school_id}/duties/{duty_id}')
def delete_duty(request: Request, school_id: int, duty_id: str):
    _require_school_membership(request, school_id)
    repo.delete_duty(school_id, duty_id)
    return {'ok': True}


@catalog_router.get('/{school_id}/settings')
def get_settings(request: Request, school_id: int):
    _require_school_membership(request, school_id)
    record = repo.get_school_settings(school_id)
    return {'item': record.model_dump()}


@catalog_router.put('/{school_id}/settings')
def upsert_settings(request: Request, school_id: int, payload: SchoolSettingsPayload):
    _require_school_membership(request, school_id)
    record = repo.upsert_school_settings(school_id, payload)
    return {'item': record.model_dump()}


@catalog_router.get('/{school_id}/export')
def export_catalog(request: Request, school_id: int):
    _require_school_membership(request, school_id)
    return repo.export_school_catalog(school_id)


@catalog_router.post('/{school_id}/replace')
def replace_catalog(request: Request, school_id: int, payload: Dict[str, List[Dict]]):
    _require_school_membership(request, school_id)
    teachers = [TeacherPayload(**item) for item in payload.get('teachers', [])]
    classrooms = [ClassroomPayload(**item) for item in payload.get('classrooms', [])]
    locations = [LocationPayload(**item) for item in payload.get('locations', [])]
    subjects = [SubjectPayload(**item) for item in payload.get('subjects', [])]
    fixed_assignments = [FixedAssignmentPayload(**item) for item in payload.get('fixedAssignments', [])]
    lesson_groups = [LessonGroupPayload(**item) for item in payload.get('lessonGroups', [])]
    duties = [DutyPayload(**item) for item in payload.get('duties', [])]
    repo.replace_school_catalog(
        school_id,
        teachers=teachers,
        classrooms=classrooms,
        locations=locations,
        subjects=subjects,
        fixed_assignments=fixed_assignments,
        lesson_groups=lesson_groups,
        duties=duties,
    )
    return {'ok': True}
