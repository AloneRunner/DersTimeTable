from __future__ import annotations

import os
import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, EmailStr

import psycopg  # type: ignore
from psycopg import errors as psycopg_errors  # type: ignore
from psycopg.rows import dict_row  # type: ignore
from psycopg.types.json import Json  # type: ignore
from revenuecat import fetch_entitlement

DATABASE_URL = os.environ.get('DATABASE_URL')
USE_DB = bool(DATABASE_URL)

if not USE_DB:  # pragma: no cover - fallback only used in local/dev mode
    import storage as db  # type: ignore


router = APIRouter(prefix='/api/auth', tags=['auth'])


CODE_PURPOSE = 'web_bridge_code'
SESSION_PURPOSE = 'web_session'


class RequestCodePayload(BaseModel):
    email: EmailStr
    name: Optional[str] = None
    school_id: Optional[int] = None


class RequestCodeResponse(BaseModel):
    ok: bool = True
    code: str
    token: str
    expires_at: datetime
    user: Dict[str, Any]
    schools: List[Dict[str, Any]]


class VerifyPayload(BaseModel):
    code: Optional[str] = None
    token: Optional[str] = None


class SessionResponse(BaseModel):
    ok: bool = True
    session_token: Optional[str] = None
    expires_at: Optional[datetime] = None
    user: Dict[str, Any]
    schools: List[Dict[str, Any]]
    subscription: Optional[Dict[str, Any]] = None


class LinkTeacherPayload(BaseModel):
    school_id: int
    teacher_id: str
    email: EmailStr
    name: Optional[str] = None


def _generate_code(length: int = 6) -> str:
    digits = string.digits
    return ''.join(secrets.choice(digits) for _ in range(length))


def _generate_token() -> str:
    return secrets.token_urlsafe(32)


def _now() -> datetime:
    return datetime.now(timezone.utc)


# -- Database helpers --------------------------------------------------------


def _db_execute(query: str, params: tuple = (), *, returning: bool = False) -> Optional[Dict[str, Any]]:
    if not USE_DB:
        raise RuntimeError('database helpers should not be used without DATABASE_URL')
    with psycopg.connect(DATABASE_URL, autocommit=True) as conn:  # type: ignore[arg-type]
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(query, params)
            if returning:
                return cur.fetchone()
            return None


def _db_query(query: str, params: tuple = ()) -> List[Dict[str, Any]]:
    if not USE_DB:
        raise RuntimeError('database helpers should not be used without DATABASE_URL')
    with psycopg.connect(DATABASE_URL) as conn:  # type: ignore[arg-type]
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(query, params)
            return cur.fetchall()


def _db_upsert_user(email: str, name: Optional[str], *, default_role: str = 'admin') -> Dict[str, Any]:
    row = _db_query('SELECT id, email, name, role FROM users WHERE email = %s', (email.lower(),))
    if row:
        user = dict(row[0])
        if name and not user.get('name'):
            _db_execute('UPDATE users SET name = %s WHERE id = %s', (name, user['id']))
            user['name'] = name
        return user
    created = _db_execute(
        'INSERT INTO users (email, name, role) VALUES (%s, %s, %s) RETURNING id, email, name, role',
        (email.lower(), name, default_role or 'admin'),
        returning=True,
    )
    if not created:
        raise HTTPException(status_code=500, detail='user-create-failed')
    return dict(created)


def _db_attach_school(user_id: int, school_id: int, role: str = 'admin') -> None:
    try:
        existing = _db_query(
            'SELECT role FROM school_users WHERE user_id = %s AND school_id = %s',
            (user_id, school_id),
        )
        if existing:
            current_role = existing[0]['role']
            if current_role != (role or current_role):
                _db_execute(
                    'UPDATE school_users SET role = %s WHERE user_id = %s AND school_id = %s',
                    (role or current_role, user_id, school_id),
                )
        else:
            _db_execute(
                'INSERT INTO school_users (user_id, school_id, role) VALUES (%s, %s, %s)',
                (user_id, school_id, role or 'admin'),
            )
    except psycopg_errors.ForeignKeyViolation as exc:
        raise HTTPException(status_code=404, detail='school-not-found') from exc


def _db_get_school_memberships(user_id: int) -> List[Dict[str, Any]]:
    _ensure_teacher_link_table()
    rows = _db_query(
        '''SELECT su.school_id AS id,
                  su.role,
                  s.name,
                  tul.teacher_id
           FROM school_users su
           LEFT JOIN schools s ON s.id = su.school_id
           LEFT JOIN teacher_user_links tul
             ON tul.school_id = su.school_id AND tul.user_id = su.user_id
           WHERE su.user_id = %s
           ORDER BY su.school_id''',
        (user_id,),
    )
    return [dict(row) for row in rows]


def _db_insert_login_token(
    user_id: int,
    *,
    token: str,
    code: Optional[str],
    purpose: str,
    expires_at: datetime,
    metadata: Optional[Dict[str, Any]] = None,
    consumed: bool = False,
) -> Dict[str, Any]:
    rec = _db_execute(
        '''INSERT INTO login_tokens (user_id, token, code, purpose, expires_at, metadata, consumed)
           VALUES (%s, %s, %s, %s, %s, %s, %s)
           RETURNING id, user_id, token, code, purpose, expires_at, metadata, consumed''',
        (user_id, token, code, purpose, expires_at, Json(metadata) if metadata is not None else None, consumed),
        returning=True,
    )
    if not rec:
        raise HTTPException(status_code=500, detail='token-create-failed')
    return dict(rec)


def _db_find_token_by_code(code: str, purpose: str) -> Optional[Dict[str, Any]]:
    rows = _db_query(
        '''SELECT id, user_id, token, code, purpose, expires_at, metadata, consumed
           FROM login_tokens
           WHERE purpose = %s AND code = %s
           ORDER BY id DESC''',
        (purpose, code),
    )
    now = _now()
    for row in rows:
        if row.get('consumed'):
            continue
        expires = row.get('expires_at')
        if expires and expires < now:
            continue
        return dict(row)
    return None


def _db_mark_token_consumed(token: str) -> None:
    _db_execute('UPDATE login_tokens SET consumed = TRUE WHERE token = %s', (token,))


def _db_find_session(token: str) -> Optional[Dict[str, Any]]:
    rows = _db_query(
        '''SELECT id, user_id, token, purpose, expires_at, metadata, consumed
           FROM login_tokens
           WHERE purpose = %s AND token = %s
           ORDER BY id DESC
           LIMIT 1''',
        (SESSION_PURPOSE, token),
    )
    if not rows:
        return None
    rec = dict(rows[0])
    expires = rec.get('expires_at')
    if expires and expires < _now():
        return None
    return rec


def _db_get_user(user_id: int) -> Optional[Dict[str, Any]]:
    rows = _db_query('SELECT id, email, name, role FROM users WHERE id = %s', (user_id,))
    return dict(rows[0]) if rows else None


def _db_get_subscription(user_id: int) -> Optional[Dict[str, Any]]:
    rows = _db_query(
        '''SELECT id, user_id, provider, start_at, expires_at, status
           FROM subscriptions
           WHERE user_id = %s
           ORDER BY COALESCE(expires_at, start_at) DESC
           LIMIT 1''',
        (str(user_id),),
    )
    if not rows:
        return None
    rec = dict(rows[0])
    expires = rec.get('expires_at')
    if expires and expires < _now():
        rec['status'] = 'expired'
    return rec


def _ensure_teacher_link_table() -> None:
    if not USE_DB:
        return
    _db_execute(
        '''CREATE TABLE IF NOT EXISTS teacher_user_links (
             id SERIAL PRIMARY KEY,
             school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
             teacher_id TEXT NOT NULL,
             user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
             created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
             UNIQUE (school_id, teacher_id),
             UNIQUE (school_id, user_id)
           )'''
    )


def _db_insert_teacher_school(teacher_id: str, school_id: int) -> None:
    _db_execute(
        '''INSERT INTO teacher_schools (teacher_id, school_id)
           VALUES (%s, %s)
           ON CONFLICT (teacher_id, school_id) DO NOTHING''',
        (teacher_id, school_id),
    )


def _db_upsert_teacher_link(school_id: int, teacher_id: str, user_id: int) -> Dict[str, Any]:
    _ensure_teacher_link_table()
    rec = _db_execute(
        '''INSERT INTO teacher_user_links (school_id, teacher_id, user_id)
           VALUES (%s, %s, %s)
           ON CONFLICT (school_id, teacher_id)
           DO UPDATE SET user_id = EXCLUDED.user_id
           RETURNING id, school_id, teacher_id, user_id, created_at''',
        (school_id, teacher_id, user_id),
        returning=True,
    )
    if not rec:
        raise HTTPException(status_code=500, detail='teacher-link-upsert-failed')
    return rec


def _db_get_teacher_links(user_id: int) -> List[Dict[str, Any]]:
    _ensure_teacher_link_table()
    rows = _db_query(
        '''SELECT school_id, teacher_id FROM teacher_user_links WHERE user_id = %s''',
        (user_id,),
    )
    return [dict(row) for row in rows]


# -- JSON storage helpers ----------------------------------------------------


def _storage_upsert_user(email: str, name: Optional[str], *, default_role: str = 'admin') -> Dict[str, Any]:
    user = db.upsert_user(email, name, role=default_role or 'admin')  # type: ignore[attr-defined]
    return {k: user[k] for k in ('id', 'email', 'name', 'role') if k in user}


def _storage_attach_school(user_id: int, school_id: int, role: str = 'admin') -> None:
    db.add_school_user(user_id, school_id, role)  # type: ignore[attr-defined]


def _storage_get_school_memberships(user_id: int) -> List[Dict[str, Any]]:
    memberships = db.get_school_users_by_user(user_id)  # type: ignore[attr-defined]
    teacher_links = {f"{link.get('school_id')}": link.get('teacher_id') for link in db.get_teacher_links_for_user(user_id)}  # type: ignore[attr-defined]
    result: List[Dict[str, Any]] = []
    for item in memberships:
        school = db.get_school_by_id(item.get('school_id'))  # type: ignore[attr-defined]
        result.append({
            'id': item.get('school_id'),
            'role': item.get('role'),
            'name': school.get('name') if school else None,
            'teacher_id': teacher_links.get(str(item.get('school_id'))),
        })
    return result


def _storage_insert_token(
    user_id: int,
    *,
    token: str,
    code: Optional[str],
    purpose: str,
    expires_at: datetime,
    metadata: Optional[Dict[str, Any]] = None,
    consumed: bool = False,
) -> Dict[str, Any]:
    record = db.add_login_token(user_id, token, code, purpose, expires_at, metadata, consumed)  # type: ignore[attr-defined]
    return record


def _storage_find_token_by_code(code: str, purpose: str) -> Optional[Dict[str, Any]]:
    return db.find_login_token_by_code(code, purpose)  # type: ignore[attr-defined]


def _storage_mark_consumed(token: str) -> None:
    db.mark_login_token_consumed(token)  # type: ignore[attr-defined]


def _storage_find_session(token: str) -> Optional[Dict[str, Any]]:
    return db.find_login_token(token, SESSION_PURPOSE)  # type: ignore[attr-defined]


def _storage_get_user(user_id: int) -> Optional[Dict[str, Any]]:
    user = db.get_user_by_id(user_id)  # type: ignore[attr-defined]
    if not user:
        return None
    return {k: user[k] for k in ('id', 'email', 'name', 'role') if k in user}


def _storage_get_subscription(user_id: int) -> Optional[Dict[str, Any]]:
    return db.get_subscription_for_user(user_id)  # type: ignore[attr-defined]


def _storage_insert_teacher_school(teacher_id: str, school_id: int) -> None:
    db.add_teacher_school(teacher_id, school_id)  # type: ignore[attr-defined]


def _storage_upsert_teacher_link(school_id: int, teacher_id: str, user_id: int) -> Dict[str, Any]:
    return db.upsert_teacher_user_link(school_id, teacher_id, user_id)  # type: ignore[attr-defined]


def _storage_get_teacher_links(user_id: int) -> List[Dict[str, Any]]:
    return db.get_teacher_links_for_user(user_id)  # type: ignore[attr-defined]


# -- Common helpers ----------------------------------------------------------


def _upsert_user(email: str, name: Optional[str], *, default_role: str = 'admin') -> Dict[str, Any]:
    return _db_upsert_user(email, name, default_role=default_role) if USE_DB else _storage_upsert_user(email, name, default_role=default_role)


def _attach_school(user_id: int, school_id: Optional[int], role: str = 'admin') -> None:
    if school_id is None:
        return
    if USE_DB:
        _db_attach_school(user_id, school_id, role)
    else:  # pragma: no cover
        _storage_attach_school(user_id, school_id, role)


def _get_school_memberships(user_id: int) -> List[Dict[str, Any]]:
    return _db_get_school_memberships(user_id) if USE_DB else _storage_get_school_memberships(user_id)


def _insert_teacher_school(teacher_id: str, school_id: int) -> None:
    if USE_DB:
        _db_insert_teacher_school(teacher_id, school_id)
    else:  # pragma: no cover
        _storage_insert_teacher_school(teacher_id, school_id)


def _upsert_teacher_link(school_id: int, teacher_id: str, user_id: int) -> Dict[str, Any]:
    if USE_DB:
        return _db_upsert_teacher_link(school_id, teacher_id, user_id)
    return _storage_upsert_teacher_link(school_id, teacher_id, user_id)  # pragma: no cover


def _get_teacher_links(user_id: int) -> List[Dict[str, Any]]:
    return _db_get_teacher_links(user_id) if USE_DB else _storage_get_teacher_links(user_id)


def get_teacher_links_for_user(user_id: int) -> List[Dict[str, Any]]:
    """
    Expose teacher link mappings for other modules (e.g., schedule API).
    """
    return _get_teacher_links(user_id)


def _insert_login_token(
    user_id: int,
    *,
    token: str,
    code: Optional[str],
    purpose: str,
    expires_at: datetime,
    metadata: Optional[Dict[str, Any]] = None,
    consumed: bool = False,
) -> Dict[str, Any]:
    if USE_DB:
        return _db_insert_login_token(user_id, token=token, code=code, purpose=purpose, expires_at=expires_at, metadata=metadata, consumed=consumed)
    return _storage_insert_token(user_id, token=token, code=code, purpose=purpose, expires_at=expires_at, metadata=metadata, consumed=consumed)


def _find_token_by_code(code: str, purpose: str) -> Optional[Dict[str, Any]]:
    return _db_find_token_by_code(code, purpose) if USE_DB else _storage_find_token_by_code(code, purpose)


def _mark_token_consumed(token: str) -> None:
    if USE_DB:
        _db_mark_token_consumed(token)
    else:  # pragma: no cover
        _storage_mark_consumed(token)


def _find_session(token: str) -> Optional[Dict[str, Any]]:
    return _db_find_session(token) if USE_DB else _storage_find_session(token)


def _get_user(user_id: int) -> Optional[Dict[str, Any]]:
    return _db_get_user(user_id) if USE_DB else _storage_get_user(user_id)


def _get_subscription(user_id: int) -> Optional[Dict[str, Any]]:
    return _db_get_subscription(user_id) if USE_DB else _storage_get_subscription(user_id)


def _session_payload(user: Dict[str, Any], school_memberships: List[Dict[str, Any]], session_token: Optional[str] = None, expires_at: Optional[datetime] = None) -> SessionResponse:
    subscription = _get_subscription(user['id'])
    email = user.get('email')
    rc_entitlement = fetch_entitlement(email) if email else None
    if rc_entitlement:
        expires_at_dt = rc_entitlement.get('parsed_expires_date')
        start_at_dt = rc_entitlement.get('parsed_purchase_date')
        subscription = {
            'provider': 'revenuecat',
            'status': 'active' if rc_entitlement.get('is_active') else 'inactive',
            'product_id': rc_entitlement.get('product_identifier'),
            'entitlement_id': os.environ.get('RC_ENTITLEMENT_ID'),
            'expires_at': expires_at_dt.isoformat() if expires_at_dt else None,
            'start_at': start_at_dt.isoformat() if start_at_dt else None,
        }
    return SessionResponse(
        session_token=session_token,
        expires_at=expires_at,
        user=user,
        schools=school_memberships,
        subscription=subscription,
    )


# -- Routes ------------------------------------------------------------------


@router.post('/request-code', response_model=RequestCodeResponse)
def request_code(payload: RequestCodePayload) -> RequestCodeResponse:
    user = _upsert_user(payload.email, payload.name)
    _attach_school(user['id'], payload.school_id, role=user.get('role') or 'admin')

    code = _generate_code()
    token = _generate_token()
    expires_at = _now() + timedelta(minutes=10)

    metadata = {'school_id': payload.school_id}
    _insert_login_token(
        user['id'],
        token=token,
        code=code,
        purpose=CODE_PURPOSE,
        expires_at=expires_at,
        metadata=metadata,
    )

    memberships = _get_school_memberships(user['id'])

    return RequestCodeResponse(
        code=code,
        token=token,
        expires_at=expires_at,
        user=user,
        schools=memberships,
    )


@router.post('/link-teacher')
def link_teacher(payload: LinkTeacherPayload, request: Request) -> Dict[str, Any]:
    requester, memberships, _ = get_session_context(request)
    allowed = any(
        m.get('id') == payload.school_id and (m.get('role') in ('admin', 'owner', 'manager', 'super_admin'))
        for m in memberships
    )
    if not allowed:
        raise HTTPException(status_code=403, detail='not-authorized')

    teacher_user = _upsert_user(payload.email, payload.name, default_role='teacher')
    _attach_school(teacher_user['id'], payload.school_id, role='teacher')
    _insert_teacher_school(payload.teacher_id, payload.school_id)
    link_record = _upsert_teacher_link(payload.school_id, payload.teacher_id, teacher_user['id'])

    return {
        'ok': True,
        'teacher': {
            'school_id': payload.school_id,
            'teacher_id': payload.teacher_id,
            'user_id': teacher_user['id'],
            'email': teacher_user['email'],
            'name': teacher_user.get('name'),
        },
        'linked_by': {
            'id': requester.get('id'),
            'email': requester.get('email'),
            'name': requester.get('name'),
        },
        'link': link_record,
    }


@router.post('/verify', response_model=SessionResponse)
def verify_code(payload: VerifyPayload) -> SessionResponse:
    code = payload.code.strip() if payload.code else None
    token = payload.token
    if not code and not token:
        raise HTTPException(status_code=400, detail='code-or-token-required')

    record: Optional[Dict[str, Any]] = None
    if code:
        record = _find_token_by_code(code, CODE_PURPOSE)
    if record is None and token:
        record = _find_session(token)
    if record is None:
        raise HTTPException(status_code=404, detail='code-not-found')

    # If this is a one-time code, consume it and issue a session
    if record.get('purpose') == CODE_PURPOSE:
        _mark_token_consumed(record['token'])
        session_token = _generate_token()
        expires_at = _now() + timedelta(hours=12)
        _insert_login_token(
            record['user_id'],
            token=session_token,
            code=None,
            purpose=SESSION_PURPOSE,
            expires_at=expires_at,
            metadata=record.get('metadata') or {},
        )
    else:
        session_token = record['token']
        expires_at = record.get('expires_at')

    user = _get_user(record['user_id'])
    if not user:
        raise HTTPException(status_code=404, detail='user-not-found')

    memberships = _get_school_memberships(user['id'])

    return _session_payload(user, memberships, session_token=session_token, expires_at=expires_at)


@router.get('/me', response_model=SessionResponse)
def session_info(request: Request) -> SessionResponse:
    user, memberships, record = get_session_context(request)
    return _session_payload(user, memberships, session_token=record.get('token'), expires_at=record.get('expires_at'))


def get_session_context(request: Request) -> tuple[Dict[str, Any], List[Dict[str, Any]], Dict[str, Any]]:
    auth_header = request.headers.get('Authorization') or request.headers.get('authorization')
    if not auth_header or not auth_header.lower().startswith('bearer '):
        raise HTTPException(status_code=401, detail='missing-session-token')
    token = auth_header.split(' ', 1)[1].strip()
    record = _find_session(token)
    if not record:
        raise HTTPException(status_code=401, detail='invalid-session-token')

    user = _get_user(record['user_id'])
    if not user:
        raise HTTPException(status_code=404, detail='user-not-found')

    memberships = _get_school_memberships(user['id'])

    return user, memberships, record
