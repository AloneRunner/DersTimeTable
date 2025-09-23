from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import os
from typing import Dict

router = APIRouter(prefix='/api')

USE_DB = bool(os.environ.get('DATABASE_URL'))

class CreateSchool(BaseModel):
    name: str
    slug: str | None = None

class InviteRequest(BaseModel):
    school_id: int
    teacher_id: str

if not USE_DB:
    # JSON fallback storage
    from . import storage as db


@router.get('/schools')
def get_schools():
    if USE_DB:
        raise HTTPException(status_code=501, detail='DB-backed schools not yet implemented')
    return db.list_schools()


@router.post('/schools')
def create_school(payload: CreateSchool):
    if USE_DB:
        raise HTTPException(status_code=501, detail='DB-backed schools not yet implemented')
    return db.create_school(payload.name, payload.slug)


@router.post('/schools/invite')
def invite_teacher(payload: InviteRequest):
    # This is a lightweight invite: just create the teacher-school relation server-side.
    if USE_DB:
        raise HTTPException(status_code=501, detail='DB-backed invite not implemented')
    rec = db.add_teacher_school(payload.teacher_id, payload.school_id)
    return {'ok': True, 'assigned': rec}


@router.post('/schools/remove-teacher')
def remove_teacher(payload: InviteRequest):
    if USE_DB:
        raise HTTPException(status_code=501, detail='DB-backed remove not implemented')
    ok = db.remove_teacher_school(payload.teacher_id, payload.school_id)
    return {'ok': ok}
