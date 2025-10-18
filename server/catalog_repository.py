from __future__ import annotations

import os
from datetime import datetime
from typing import Any, Dict, List, Optional

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Json

from catalog_models import (
    ClassroomPayload,
    ClassroomRecord,
    DutyPayload,
    DutyRecord,
    FixedAssignmentPayload,
    FixedAssignmentRecord,
    LessonGroupPayload,
    LessonGroupRecord,
    LocationPayload,
    LocationRecord,
    SchoolSettingsPayload,
    SchoolSettingsRecord,
    SubjectPayload,
    SubjectRecord,
    TeacherPayload,
    TeacherRecord,
)

DATABASE_URL = os.environ.get('DATABASE_URL')
USE_DB = bool(DATABASE_URL)

if not USE_DB:  # pragma: no cover
    import storage as storage_backend  # type: ignore


def _now() -> datetime:
    return datetime.utcnow()


# --- DB helpers --------------------------------------------------------------


def _db_query(query: str, params: tuple) -> List[Dict[str, Any]]:
    if not USE_DB:
        raise RuntimeError('database is not configured')
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(query, params)
            return cur.fetchall()


def _db_execute(query: str, params: tuple) -> None:
    if not USE_DB:
        raise RuntimeError('database is not configured')
    with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(query, params)


def _db_fetch_one(query: str, params: tuple) -> Optional[Dict[str, Any]]:
    rows = _db_query(query, params)
    return rows[0] if rows else None


# --- Normalization helpers ---------------------------------------------------


def _load_branches(raw: Any) -> List[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(branch) for branch in raw]
    return []


def _safe_json(raw: Any) -> Any:
    if raw is None:
        return None
    return raw


def _teacher_from_row(row: Dict[str, Any]) -> TeacherRecord:
    return TeacherRecord(
        id=row['teacher_key'],
        name=row['name'],
        branches=_load_branches(row.get('branches')),
        availability=_safe_json(row.get('availability')) or [],
        canTeachMiddleSchool=bool(row.get('can_teach_middle')),
        canTeachHighSchool=bool(row.get('can_teach_high')),
        metadata=_safe_json(row.get('metadata')),
        isArchived=bool(row.get('is_archived', False)),
        createdAt=row.get('created_at'),
        updatedAt=row.get('updated_at'),
    )


def _classroom_from_row(row: Dict[str, Any]) -> ClassroomRecord:
    return ClassroomRecord(
        id=row['classroom_key'],
        name=row['name'],
        level=row['level'],
        group=row.get('class_group'),
        homeroomTeacherId=row.get('homeroom_teacher_key'),
        sessionType=row.get('session_type') or 'full',
        metadata=_safe_json(row.get('metadata')),
        isArchived=bool(row.get('is_archived', False)),
        createdAt=row.get('created_at'),
        updatedAt=row.get('updated_at'),
    )


def _location_from_row(row: Dict[str, Any]) -> LocationRecord:
    return LocationRecord(
        id=row['location_key'],
        name=row['name'],
        metadata=_safe_json(row.get('metadata')),
        isArchived=bool(row.get('is_archived', False)),
        createdAt=row.get('created_at'),
        updatedAt=row.get('updated_at'),
    )


def _subject_from_row(row: Dict[str, Any]) -> SubjectRecord:
    return SubjectRecord(
        id=row['subject_key'],
        name=row['name'],
        weeklyHours=int(row.get('weekly_hours', 0)),
        blockHours=int(row.get('block_hours', 0)),
        tripleBlockHours=int(row.get('triple_block_hours', 0)),
        maxConsec=row.get('max_consec'),
        locationId=row.get('location_key'),
        requiredTeacherCount=int(row.get('required_teacher_count') or 1),
        assignedClassIds=row.get('assigned_class_keys') or [],
        pinnedTeacherByClassroom=_safe_json(row.get('pinned_teacher_map')) or {},
        metadata=_safe_json(row.get('metadata')),
        isArchived=bool(row.get('is_archived', False)),
        createdAt=row.get('created_at'),
        updatedAt=row.get('updated_at'),
    )


def _fixed_assignment_from_row(row: Dict[str, Any]) -> FixedAssignmentRecord:
    return FixedAssignmentRecord(
        id=row['assignment_key'],
        classroomId=row['classroom_key'],
        subjectId=row['subject_key'],
        dayIndex=int(row['day_index']),
        hourIndex=int(row['hour_index']),
        metadata=_safe_json(row.get('metadata')),
        createdAt=row.get('created_at'),
        updatedAt=row.get('updated_at'),
    )


def _lesson_group_from_row(row: Dict[str, Any]) -> LessonGroupRecord:
    return LessonGroupRecord(
        id=row['lesson_group_key'],
        name=row['name'],
        subjectId=row['subject_key'],
        classroomIds=row.get('classroom_keys') or [],
        weeklyHours=int(row.get('weekly_hours', 0)),
        isBlock=bool(row.get('is_block', False)),
        metadata=_safe_json(row.get('metadata')),
        createdAt=row.get('created_at'),
        updatedAt=row.get('updated_at'),
    )


def _duty_from_row(row: Dict[str, Any]) -> DutyRecord:
    return DutyRecord(
        id=row['duty_key'],
        teacherId=row['teacher_key'],
        name=row['name'],
        dayIndex=int(row['day_index']),
        hourIndex=int(row['hour_index']),
        metadata=_safe_json(row.get('metadata')),
        createdAt=row.get('created_at'),
        updatedAt=row.get('updated_at'),
    )


def _settings_from_row(row: Dict[str, Any]) -> SchoolSettingsRecord:
    return SchoolSettingsRecord(
        schoolHours=_safe_json(row.get('school_hours')),
        preferences=_safe_json(row.get('preferences')),
        metadata=_safe_json(row.get('metadata')),
        updatedAt=row.get('updated_at'),
    )


# --- Teacher operations ------------------------------------------------------


def list_teachers(school_id: int) -> List[TeacherRecord]:
    if USE_DB:
        rows = _db_query(
            """SELECT *
               FROM school_teachers
               WHERE school_id = %s
               ORDER BY name""",
            (school_id,),
        )
        return [_teacher_from_row(row) for row in rows]
    records = storage_backend.list_school_teachers(school_id)  # type: ignore[attr-defined]
    normalized: List[Dict[str, Any]] = []
    for rec in records:
        normalized.append({
            'teacher_key': rec.get('teacher_key') or rec.get('id') or rec.get('key') or rec.get('teacherId'),
            'name': rec.get('name'),
            'branches': rec.get('branches'),
            'availability': rec.get('availability'),
            'can_teach_middle': rec.get('can_teach_middle') if 'can_teach_middle' in rec else rec.get('canTeachMiddleSchool'),
            'can_teach_high': rec.get('can_teach_high') if 'can_teach_high' in rec else rec.get('canTeachHighSchool'),
            'metadata': rec.get('metadata'),
            'is_archived': rec.get('is_archived', rec.get('isArchived', False)),
            'created_at': rec.get('created_at'),
            'updated_at': rec.get('updated_at'),
        })
    return [_teacher_from_row(row) for row in normalized]


def upsert_teacher(school_id: int, payload: TeacherPayload) -> TeacherRecord:
    if USE_DB:
        row = _db_fetch_one(
            """INSERT INTO school_teachers (
                   school_id, teacher_key, name, branches, availability,
                   can_teach_middle, can_teach_high, metadata, is_archived, updated_at
               )
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, now())
               ON CONFLICT (school_id, teacher_key) DO UPDATE
               SET name = EXCLUDED.name,
                   branches = EXCLUDED.branches,
                   availability = EXCLUDED.availability,
                   can_teach_middle = EXCLUDED.can_teach_middle,
                   can_teach_high = EXCLUDED.can_teach_high,
                   metadata = EXCLUDED.metadata,
                   is_archived = EXCLUDED.is_archived,
                   updated_at = now()
               RETURNING *""",
            (
                school_id,
                payload.id,
                payload.name,
                payload.branches,
                Json(payload.availability or []),
                payload.canTeachMiddleSchool,
                payload.canTeachHighSchool,
                Json(payload.metadata) if payload.metadata is not None else None,
                payload.isArchived,
            ),
        )
        if not row:
            raise RuntimeError('failed-to-upsert-teacher')
        return _teacher_from_row(row)

    record = {
        'school_id': school_id,
        'teacher_key': payload.id,
        'name': payload.name,
        'branches': payload.branches,
        'availability': payload.availability,
        'can_teach_middle': payload.canTeachMiddleSchool,
        'can_teach_high': payload.canTeachHighSchool,
        'metadata': payload.metadata,
        'is_archived': payload.isArchived,
    }
    stored = storage_backend.upsert_school_teacher(record)  # type: ignore[attr-defined]
    return _teacher_from_row(stored)


def delete_teacher(school_id: int, teacher_id: str) -> bool:
    if USE_DB:
        _db_execute(
            "DELETE FROM school_teachers WHERE school_id = %s AND teacher_key = %s",
            (school_id, teacher_id),
        )
        return True
    return storage_backend.delete_school_teacher(school_id, teacher_id)  # type: ignore[attr-defined]


# --- Classroom operations ----------------------------------------------------


def list_classrooms(school_id: int) -> List[ClassroomRecord]:
    if USE_DB:
        rows = _db_query(
            """SELECT *
               FROM school_classrooms
               WHERE school_id = %s
               ORDER BY name""",
            (school_id,),
        )
        return [_classroom_from_row(row) for row in rows]
    records = storage_backend.list_school_classrooms(school_id)  # type: ignore[attr-defined]
    normalized: List[Dict[str, Any]] = []
    for rec in records:
        normalized.append({
            'classroom_key': rec.get('classroom_key') or rec.get('id') or rec.get('classroomId'),
            'name': rec.get('name'),
            'level': rec.get('level'),
            'class_group': rec.get('class_group', rec.get('group')),
            'homeroom_teacher_key': rec.get('homeroom_teacher_key', rec.get('homeroomTeacherId')),
            'session_type': rec.get('session_type', rec.get('sessionType', 'full')),
            'metadata': rec.get('metadata'),
            'is_archived': rec.get('is_archived', rec.get('isArchived', False)),
            'created_at': rec.get('created_at'),
            'updated_at': rec.get('updated_at'),
        })
    return [_classroom_from_row(row) for row in normalized]


def upsert_classroom(school_id: int, payload: ClassroomPayload) -> ClassroomRecord:
    if USE_DB:
        row = _db_fetch_one(
            """INSERT INTO school_classrooms (
                   school_id, classroom_key, name, level, class_group,
                   homeroom_teacher_key, session_type, metadata, is_archived, updated_at
               )
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, now())
               ON CONFLICT (school_id, classroom_key) DO UPDATE
               SET name = EXCLUDED.name,
                   level = EXCLUDED.level,
                   class_group = EXCLUDED.class_group,
                   homeroom_teacher_key = EXCLUDED.homeroom_teacher_key,
                   session_type = EXCLUDED.session_type,
                   metadata = EXCLUDED.metadata,
                   is_archived = EXCLUDED.is_archived,
                   updated_at = now()
               RETURNING *""",
            (
                school_id,
                payload.id,
                payload.name,
                payload.level,
                payload.group,
                payload.homeroomTeacherId,
                payload.sessionType,
                Json(payload.metadata) if payload.metadata is not None else None,
                payload.isArchived,
            ),
        )
        if not row:
            raise RuntimeError('failed-to-upsert-classroom')
        return _classroom_from_row(row)

    record = {
        'school_id': school_id,
        'classroom_key': payload.id,
        'name': payload.name,
        'level': payload.level,
        'class_group': payload.group,
        'homeroom_teacher_key': payload.homeroomTeacherId,
        'session_type': payload.sessionType,
        'metadata': payload.metadata,
        'is_archived': payload.isArchived,
    }
    stored = storage_backend.upsert_school_classroom(record)  # type: ignore[attr-defined]
    return _classroom_from_row(stored)


def delete_classroom(school_id: int, classroom_id: str) -> bool:
    if USE_DB:
        _db_execute(
            "DELETE FROM school_classrooms WHERE school_id = %s AND classroom_key = %s",
            (school_id, classroom_id),
        )
        return True
    return storage_backend.delete_school_classroom(school_id, classroom_id)  # type: ignore[attr-defined]


# --- Location operations -----------------------------------------------------


def list_locations(school_id: int) -> List[LocationRecord]:
    if USE_DB:
        rows = _db_query(
            """SELECT *
               FROM school_locations
               WHERE school_id = %s
               ORDER BY name""",
            (school_id,),
        )
        return [_location_from_row(row) for row in rows]
    records = storage_backend.list_school_locations(school_id)  # type: ignore[attr-defined]
    normalized: List[Dict[str, Any]] = []
    for rec in records:
        normalized.append({
            'location_key': rec.get('location_key') or rec.get('id'),
            'name': rec.get('name'),
            'metadata': rec.get('metadata'),
            'is_archived': rec.get('is_archived', rec.get('isArchived', False)),
            'created_at': rec.get('created_at'),
            'updated_at': rec.get('updated_at'),
        })
    return [_location_from_row(row) for row in normalized]


def upsert_location(school_id: int, payload: LocationPayload) -> LocationRecord:
    if USE_DB:
        row = _db_fetch_one(
            """INSERT INTO school_locations (
                   school_id, location_key, name, metadata, is_archived, updated_at
               )
               VALUES (%s, %s, %s, %s, %s, now())
               ON CONFLICT (school_id, location_key) DO UPDATE
               SET name = EXCLUDED.name,
                   metadata = EXCLUDED.metadata,
                   is_archived = EXCLUDED.is_archived,
                   updated_at = now()
               RETURNING *""",
            (
                school_id,
                payload.id,
                payload.name,
                Json(payload.metadata) if payload.metadata is not None else None,
                payload.isArchived,
            ),
        )
        if not row:
            raise RuntimeError('failed-to-upsert-location')
        return _location_from_row(row)

    record = {
        'school_id': school_id,
        'location_key': payload.id,
        'name': payload.name,
        'metadata': payload.metadata,
        'is_archived': payload.isArchived,
    }
    stored = storage_backend.upsert_school_location(record)  # type: ignore[attr-defined]
    return _location_from_row(stored)


def delete_location(school_id: int, location_id: str) -> bool:
    if USE_DB:
        _db_execute(
            "DELETE FROM school_locations WHERE school_id = %s AND location_key = %s",
            (school_id, location_id),
        )
        return True
    return storage_backend.delete_school_location(school_id, location_id)  # type: ignore[attr-defined]


# --- Subject operations ------------------------------------------------------


def list_subjects(school_id: int) -> List[SubjectRecord]:
    if USE_DB:
        rows = _db_query(
            """SELECT *
               FROM school_subjects
               WHERE school_id = %s
               ORDER BY name""",
            (school_id,),
        )
        return [_subject_from_row(row) for row in rows]
    records = storage_backend.list_school_subjects(school_id)  # type: ignore[attr-defined]
    normalized: List[Dict[str, Any]] = []
    for rec in records:
        normalized.append({
            'subject_key': rec.get('subject_key') or rec.get('id'),
            'name': rec.get('name'),
            'weekly_hours': rec.get('weekly_hours', rec.get('weeklyHours')),
            'block_hours': rec.get('block_hours', rec.get('blockHours', 0)),
            'triple_block_hours': rec.get('triple_block_hours', rec.get('tripleBlockHours', 0)),
            'max_consec': rec.get('max_consec', rec.get('maxConsec')),
            'location_key': rec.get('location_key', rec.get('locationId')),
            'required_teacher_count': rec.get('required_teacher_count', rec.get('requiredTeacherCount', 1)),
            'assigned_class_keys': rec.get('assigned_class_keys', rec.get('assignedClassIds', [])),
            'pinned_teacher_map': rec.get('pinned_teacher_map', rec.get('pinnedTeacherByClassroom', {})),
            'metadata': rec.get('metadata'),
            'is_archived': rec.get('is_archived', rec.get('isArchived', False)),
            'created_at': rec.get('created_at'),
            'updated_at': rec.get('updated_at'),
        })
    return [_subject_from_row(row) for row in normalized]


def upsert_subject(school_id: int, payload: SubjectPayload) -> SubjectRecord:
    if USE_DB:
        row = _db_fetch_one(
            """INSERT INTO school_subjects (
                   school_id, subject_key, name, weekly_hours, block_hours,
                   triple_block_hours, max_consec, location_key, required_teacher_count,
                   assigned_class_keys, pinned_teacher_map, metadata, is_archived, updated_at
               )
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
               ON CONFLICT (school_id, subject_key) DO UPDATE
               SET name = EXCLUDED.name,
                   weekly_hours = EXCLUDED.weekly_hours,
                   block_hours = EXCLUDED.block_hours,
                   triple_block_hours = EXCLUDED.triple_block_hours,
                   max_consec = EXCLUDED.max_consec,
                   location_key = EXCLUDED.location_key,
                   required_teacher_count = EXCLUDED.required_teacher_count,
                   assigned_class_keys = EXCLUDED.assigned_class_keys,
                   pinned_teacher_map = EXCLUDED.pinned_teacher_map,
                   metadata = EXCLUDED.metadata,
                   is_archived = EXCLUDED.is_archived,
                   updated_at = now()
               RETURNING *""",
            (
                school_id,
                payload.id,
                payload.name,
                payload.weeklyHours,
                payload.blockHours,
                payload.tripleBlockHours,
                payload.maxConsec,
                payload.locationId,
                payload.requiredTeacherCount,
                payload.assignedClassIds,
                Json(payload.pinnedTeacherByClassroom or {}),
                Json(payload.metadata) if payload.metadata is not None else None,
                payload.isArchived,
            ),
        )
        if not row:
            raise RuntimeError('failed-to-upsert-subject')
        return _subject_from_row(row)

    record = {
        'school_id': school_id,
        'subject_key': payload.id,
        'name': payload.name,
        'weekly_hours': payload.weeklyHours,
        'block_hours': payload.blockHours,
        'triple_block_hours': payload.tripleBlockHours,
        'max_consec': payload.maxConsec,
        'location_key': payload.locationId,
        'required_teacher_count': payload.requiredTeacherCount,
        'assigned_class_keys': payload.assignedClassIds,
        'pinned_teacher_map': payload.pinnedTeacherByClassroom,
        'metadata': payload.metadata,
        'is_archived': payload.isArchived,
    }
    stored = storage_backend.upsert_school_subject(record)  # type: ignore[attr-defined]
    return _subject_from_row(stored)


def delete_subject(school_id: int, subject_id: str) -> bool:
    if USE_DB:
        _db_execute(
            "DELETE FROM school_subjects WHERE school_id = %s AND subject_key = %s",
            (school_id, subject_id),
        )
        return True
    return storage_backend.delete_school_subject(school_id, subject_id)  # type: ignore[attr-defined]


# --- Fixed assignments -------------------------------------------------------


def list_fixed_assignments(school_id: int) -> List[FixedAssignmentRecord]:
    if USE_DB:
        rows = _db_query(
            """SELECT *
               FROM school_fixed_assignments
               WHERE school_id = %s
               ORDER BY day_index, hour_index""",
            (school_id,),
        )
        return [_fixed_assignment_from_row(row) for row in rows]
    records = storage_backend.list_school_fixed_assignments(school_id)  # type: ignore[attr-defined]
    normalized: List[Dict[str, Any]] = []
    for rec in records:
        normalized.append({
            'assignment_key': rec.get('assignment_key') or rec.get('id'),
            'classroom_key': rec.get('classroom_key', rec.get('classroomId')),
            'subject_key': rec.get('subject_key', rec.get('subjectId')),
            'day_index': rec.get('day_index', rec.get('dayIndex')),
            'hour_index': rec.get('hour_index', rec.get('hourIndex')),
            'metadata': rec.get('metadata'),
            'created_at': rec.get('created_at'),
            'updated_at': rec.get('updated_at'),
        })
    return [_fixed_assignment_from_row(row) for row in normalized]


def upsert_fixed_assignment(school_id: int, payload: FixedAssignmentPayload) -> FixedAssignmentRecord:
    if USE_DB:
        row = _db_fetch_one(
            """INSERT INTO school_fixed_assignments (
                   school_id, assignment_key, classroom_key, subject_key,
                   day_index, hour_index, metadata, updated_at
               )
               VALUES (%s, %s, %s, %s, %s, %s, %s, now())
               ON CONFLICT (school_id, assignment_key) DO UPDATE
               SET classroom_key = EXCLUDED.classroom_key,
                   subject_key = EXCLUDED.subject_key,
                   day_index = EXCLUDED.day_index,
                   hour_index = EXCLUDED.hour_index,
                   metadata = EXCLUDED.metadata,
                   updated_at = now()
               RETURNING *""",
            (
                school_id,
                payload.id,
                payload.classroomId,
                payload.subjectId,
                payload.dayIndex,
                payload.hourIndex,
                Json(payload.metadata) if payload.metadata is not None else None,
            ),
        )
        if not row:
            raise RuntimeError('failed-to-upsert-fixed-assignment')
        return _fixed_assignment_from_row(row)

    record = {
        'school_id': school_id,
        'assignment_key': payload.id,
        'classroom_key': payload.classroomId,
        'subject_key': payload.subjectId,
        'day_index': payload.dayIndex,
        'hour_index': payload.hourIndex,
        'metadata': payload.metadata,
    }
    stored = storage_backend.upsert_school_fixed_assignment(record)  # type: ignore[attr-defined]
    return _fixed_assignment_from_row(stored)


def delete_fixed_assignment(school_id: int, assignment_id: str) -> bool:
    if USE_DB:
        _db_execute(
            "DELETE FROM school_fixed_assignments WHERE school_id = %s AND assignment_key = %s",
            (school_id, assignment_id),
        )
        return True
    return storage_backend.delete_school_fixed_assignment(school_id, assignment_id)  # type: ignore[attr-defined]


# --- Lesson groups -----------------------------------------------------------


def list_lesson_groups(school_id: int) -> List[LessonGroupRecord]:
    if USE_DB:
        rows = _db_query(
            """SELECT *
               FROM school_lesson_groups
               WHERE school_id = %s
               ORDER BY name""",
            (school_id,),
        )
        return [_lesson_group_from_row(row) for row in rows]
    records = storage_backend.list_school_lesson_groups(school_id)  # type: ignore[attr-defined]
    normalized: List[Dict[str, Any]] = []
    for rec in records:
        normalized.append({
            'lesson_group_key': rec.get('lesson_group_key') or rec.get('id'),
            'name': rec.get('name'),
            'subject_key': rec.get('subject_key', rec.get('subjectId')),
            'classroom_keys': rec.get('classroom_keys', rec.get('classroomIds', [])),
            'weekly_hours': rec.get('weekly_hours', rec.get('weeklyHours', 0)),
            'is_block': rec.get('is_block', rec.get('isBlock', False)),
            'metadata': rec.get('metadata'),
            'created_at': rec.get('created_at'),
            'updated_at': rec.get('updated_at'),
        })
    return [_lesson_group_from_row(row) for row in normalized]


def upsert_lesson_group(school_id: int, payload: LessonGroupPayload) -> LessonGroupRecord:
    if USE_DB:
        row = _db_fetch_one(
            """INSERT INTO school_lesson_groups (
                   school_id, lesson_group_key, name, subject_key,
                   classroom_keys, weekly_hours, is_block, metadata, updated_at
               )
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, now())
               ON CONFLICT (school_id, lesson_group_key) DO UPDATE
               SET name = EXCLUDED.name,
                   subject_key = EXCLUDED.subject_key,
                   classroom_keys = EXCLUDED.classroom_keys,
                   weekly_hours = EXCLUDED.weekly_hours,
                   is_block = EXCLUDED.is_block,
                   metadata = EXCLUDED.metadata,
                   updated_at = now()
               RETURNING *""",
            (
                school_id,
                payload.id,
                payload.name,
                payload.subjectId,
                payload.classroomIds,
                payload.weeklyHours,
                payload.isBlock,
                Json(payload.metadata) if payload.metadata is not None else None,
            ),
        )
        if not row:
            raise RuntimeError('failed-to-upsert-lesson-group')
        return _lesson_group_from_row(row)

    record = {
        'school_id': school_id,
        'lesson_group_key': payload.id,
        'name': payload.name,
        'subject_key': payload.subjectId,
        'classroom_keys': payload.classroomIds,
        'weekly_hours': payload.weeklyHours,
        'is_block': payload.isBlock,
        'metadata': payload.metadata,
    }
    stored = storage_backend.upsert_school_lesson_group(record)  # type: ignore[attr-defined]
    return _lesson_group_from_row(stored)


def delete_lesson_group(school_id: int, lesson_group_id: str) -> bool:
    if USE_DB:
        _db_execute(
            "DELETE FROM school_lesson_groups WHERE school_id = %s AND lesson_group_key = %s",
            (school_id, lesson_group_id),
        )
        return True
    return storage_backend.delete_school_lesson_group(school_id, lesson_group_id)  # type: ignore[attr-defined]


# --- Duties ------------------------------------------------------------------


def list_duties(school_id: int) -> List[DutyRecord]:
    if USE_DB:
        rows = _db_query(
            """SELECT *
               FROM school_duties
               WHERE school_id = %s
               ORDER BY day_index, hour_index""",
            (school_id,),
        )
        return [_duty_from_row(row) for row in rows]
    records = storage_backend.list_school_duties(school_id)  # type: ignore[attr-defined]
    normalized: List[Dict[str, Any]] = []
    for rec in records:
        normalized.append({
            'duty_key': rec.get('duty_key') or rec.get('id'),
            'teacher_key': rec.get('teacher_key', rec.get('teacherId')),
            'name': rec.get('name'),
            'day_index': rec.get('day_index', rec.get('dayIndex')),
            'hour_index': rec.get('hour_index', rec.get('hourIndex')),
            'metadata': rec.get('metadata'),
            'created_at': rec.get('created_at'),
            'updated_at': rec.get('updated_at'),
        })
    return [_duty_from_row(row) for row in normalized]


def upsert_duty(school_id: int, payload: DutyPayload) -> DutyRecord:
    if USE_DB:
        row = _db_fetch_one(
            """INSERT INTO school_duties (
                   school_id, duty_key, teacher_key, name,
                   day_index, hour_index, metadata, updated_at
               )
               VALUES (%s, %s, %s, %s, %s, %s, %s, now())
               ON CONFLICT (school_id, duty_key) DO UPDATE
               SET teacher_key = EXCLUDED.teacher_key,
                   name = EXCLUDED.name,
                   day_index = EXCLUDED.day_index,
                   hour_index = EXCLUDED.hour_index,
                   metadata = EXCLUDED.metadata,
                   updated_at = now()
               RETURNING *""",
            (
                school_id,
                payload.id,
                payload.teacherId,
                payload.name,
                payload.dayIndex,
                payload.hourIndex,
                Json(payload.metadata) if payload.metadata is not None else None,
            ),
        )
        if not row:
            raise RuntimeError('failed-to-upsert-duty')
        return _duty_from_row(row)

    record = {
        'school_id': school_id,
        'duty_key': payload.id,
        'teacher_key': payload.teacherId,
        'name': payload.name,
        'day_index': payload.dayIndex,
        'hour_index': payload.hourIndex,
        'metadata': payload.metadata,
    }
    stored = storage_backend.upsert_school_duty(record)  # type: ignore[attr-defined]
    return _duty_from_row(stored)


def delete_duty(school_id: int, duty_id: str) -> bool:
    if USE_DB:
        _db_execute(
            "DELETE FROM school_duties WHERE school_id = %s AND duty_key = %s",
            (school_id, duty_id),
        )
        return True
    return storage_backend.delete_school_duty(school_id, duty_id)  # type: ignore[attr-defined]


# --- Settings ----------------------------------------------------------------


def get_school_settings(school_id: int) -> SchoolSettingsRecord:
    if USE_DB:
        row = _db_fetch_one(
            "SELECT * FROM school_settings WHERE school_id = %s",
            (school_id,),
        )
        if not row:
            return SchoolSettingsRecord(schoolHours=None, preferences=None, metadata=None, updatedAt=None)
        return _settings_from_row(row)

    record = storage_backend.get_school_settings(school_id)  # type: ignore[attr-defined]
    if not record:
        return SchoolSettingsRecord(schoolHours=None, preferences=None, metadata=None, updatedAt=None)
    return _settings_from_row(record)


def upsert_school_settings_db(school_id: int, payload: SchoolSettingsPayload) -> SchoolSettingsRecord:
    row = _db_fetch_one(
        """INSERT INTO school_settings (school_id, school_hours, preferences, metadata, updated_at)
           VALUES (%s, %s, %s, %s, now())
           ON CONFLICT (school_id) DO UPDATE
           SET school_hours = EXCLUDED.school_hours,
               preferences = EXCLUDED.preferences,
               metadata = EXCLUDED.metadata,
               updated_at = now()
           RETURNING *""",
        (
            school_id,
            Json(payload.schoolHours) if payload.schoolHours is not None else None,
            Json(payload.preferences) if payload.preferences is not None else None,
            Json(payload.metadata) if payload.metadata is not None else None,
        ),
    )
    if not row:
        raise RuntimeError('failed-to-upsert-settings')
    return _settings_from_row(row)


def upsert_school_settings_local(school_id: int, payload: SchoolSettingsPayload) -> SchoolSettingsRecord:
    record = storage_backend.upsert_school_settings(  # type: ignore[attr-defined]
        school_id,
        {
            'school_hours': payload.schoolHours,
            'preferences': payload.preferences,
            'metadata': payload.metadata,
        },
    )
    return _settings_from_row(record)


def upsert_school_settings(school_id: int, payload: SchoolSettingsPayload) -> SchoolSettingsRecord:
    if USE_DB:
        return upsert_school_settings_db(school_id, payload)
    return upsert_school_settings_local(school_id, payload)


# --- Aggregates --------------------------------------------------------------


def export_school_catalog(school_id: int) -> Dict[str, Any]:
    return {
        'teachers': [record.model_dump() for record in list_teachers(school_id)],
        'classrooms': [record.model_dump() for record in list_classrooms(school_id)],
        'locations': [record.model_dump() for record in list_locations(school_id)],
        'subjects': [record.model_dump() for record in list_subjects(school_id)],
        'fixedAssignments': [record.model_dump() for record in list_fixed_assignments(school_id)],
        'lessonGroups': [record.model_dump() for record in list_lesson_groups(school_id)],
        'duties': [record.model_dump() for record in list_duties(school_id)],
        'settings': get_school_settings(school_id).model_dump(),
    }


def replace_school_catalog(
    school_id: int,
    *,
    teachers: List[TeacherPayload],
    classrooms: List[ClassroomPayload],
    locations: List[LocationPayload],
    subjects: List[SubjectPayload],
    fixed_assignments: List[FixedAssignmentPayload],
    lesson_groups: List[LessonGroupPayload],
    duties: List[DutyPayload],
) -> None:
    if USE_DB:
        with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM school_duties WHERE school_id = %s", (school_id,))
                cur.execute("DELETE FROM school_lesson_groups WHERE school_id = %s", (school_id,))
                cur.execute("DELETE FROM school_fixed_assignments WHERE school_id = %s", (school_id,))
                cur.execute("DELETE FROM school_subjects WHERE school_id = %s", (school_id,))
                cur.execute("DELETE FROM school_locations WHERE school_id = %s", (school_id,))
                cur.execute("DELETE FROM school_classrooms WHERE school_id = %s", (school_id,))
                cur.execute("DELETE FROM school_teachers WHERE school_id = %s", (school_id,))

        for teacher in teachers:
            upsert_teacher(school_id, teacher)
        for classroom in classrooms:
            upsert_classroom(school_id, classroom)
        for location in locations:
            upsert_location(school_id, location)
        for subject in subjects:
            upsert_subject(school_id, subject)
        for assignment in fixed_assignments:
            upsert_fixed_assignment(school_id, assignment)
        for group in lesson_groups:
            upsert_lesson_group(school_id, group)
        for duty in duties:
            upsert_duty(school_id, duty)
        return

    # storage fallback: clear and reinsert
    for record in storage_backend.list_school_duties(school_id):  # type: ignore[attr-defined]
        storage_backend.delete_school_duty(school_id, record.get('duty_key') or record.get('id'))  # type: ignore[attr-defined]
    for record in storage_backend.list_school_lesson_groups(school_id):  # type: ignore[attr-defined]
        storage_backend.delete_school_lesson_group(school_id, record.get('lesson_group_key') or record.get('id'))  # type: ignore[attr-defined]
    for record in storage_backend.list_school_fixed_assignments(school_id):  # type: ignore[attr-defined]
        storage_backend.delete_school_fixed_assignment(school_id, record.get('assignment_key') or record.get('id'))  # type: ignore[attr-defined]
    for record in storage_backend.list_school_subjects(school_id):  # type: ignore[attr-defined]
        storage_backend.delete_school_subject(school_id, record.get('subject_key') or record.get('id'))  # type: ignore[attr-defined]
    for record in storage_backend.list_school_locations(school_id):  # type: ignore[attr-defined]
        storage_backend.delete_school_location(school_id, record.get('location_key') or record.get('id'))  # type: ignore[attr-defined]
    for record in storage_backend.list_school_classrooms(school_id):  # type: ignore[attr-defined]
        storage_backend.delete_school_classroom(school_id, record.get('classroom_key') or record.get('id'))  # type: ignore[attr-defined]
    for record in storage_backend.list_school_teachers(school_id):  # type: ignore[attr-defined]
        storage_backend.delete_school_teacher(school_id, record.get('teacher_key') or record.get('id'))  # type: ignore[attr-defined]

    for teacher in teachers:
        upsert_teacher(school_id, teacher)
    for classroom in classrooms:
        upsert_classroom(school_id, classroom)
    for location in locations:
        upsert_location(school_id, location)
    for subject in subjects:
        upsert_subject(school_id, subject)
    for assignment in fixed_assignments:
        upsert_fixed_assignment(school_id, assignment)
    for group in lesson_groups:
        upsert_lesson_group(school_id, group)
    for duty in duties:
        upsert_duty(school_id, duty)
