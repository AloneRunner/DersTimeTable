from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import os
import psycopg
from psycopg.rows import dict_row

router = APIRouter(prefix='/api')

DATABASE_URL = os.environ.get('DATABASE_URL')
USE_DB = bool(DATABASE_URL)


class CreateSchool(BaseModel):
    name: str
    slug: str | None = None


class InviteRequest(BaseModel):
    school_id: int
    teacher_id: str


if not USE_DB:
    # JSON fallback storage
    import storage as db


def _slugify(name: str) -> str:
    slug = name.strip().lower().replace(' ', '-')
    return ''.join(ch for ch in slug if ch.isalnum() or ch == '-')


def _db_query(query: str, params: tuple = ()):  # returns list[dict]
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(query, params)
            return cur.fetchall()


def _db_execute(query: str, params: tuple = (), returning: bool = False):
    with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(query, params)
            if returning:
                return cur.fetchone()
            return cur.rowcount


@router.get('/schools')
def get_schools():
    if not USE_DB:
        return db.list_schools()
    rows = _db_query('SELECT id, name, slug, metadata, created_at FROM schools ORDER BY id')
    return rows


@router.post('/schools')
def create_school(payload: CreateSchool):
    if not USE_DB:
        return db.create_school(payload.name, payload.slug)

    slug = payload.slug or _slugify(payload.name)
    try:
        rec = _db_execute(
            """INSERT INTO schools (name, slug)
                 VALUES (%s, %s)
                 RETURNING id, name, slug, metadata, created_at""",
            (payload.name, slug or None),
            returning=True,
        )
    except psycopg.errors.UniqueViolation as exc:  # type: ignore[attr-defined]
        raise HTTPException(status_code=409, detail='slug-already-exists') from exc

    if not rec:
        raise HTTPException(status_code=400, detail='failed-to-create-school')
    return rec


@router.post('/schools/invite')
def invite_teacher(payload: InviteRequest):
    if not USE_DB:
        rec = db.add_teacher_school(payload.teacher_id, payload.school_id)
        return {'ok': True, 'assigned': rec}

    rec = _db_execute(
        """INSERT INTO teacher_schools (teacher_id, school_id)
             VALUES (%s, %s)
             ON CONFLICT (teacher_id, school_id) DO NOTHING
             RETURNING teacher_id, school_id""",
        (payload.teacher_id, payload.school_id),
        returning=True,
    )
    if rec is None:
        return {'ok': False, 'reason': 'already-assigned'}
    return {'ok': True, 'assigned': rec}


@router.post('/schools/remove-teacher')
def remove_teacher(payload: InviteRequest):
    if not USE_DB:
        ok = db.remove_teacher_school(payload.teacher_id, payload.school_id)
        return {'ok': ok}

    count = _db_execute(
        'DELETE FROM teacher_schools WHERE teacher_id = %s AND school_id = %s',
        (payload.teacher_id, payload.school_id),
    )
    return {'ok': count > 0}
