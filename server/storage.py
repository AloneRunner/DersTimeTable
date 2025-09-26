
import json
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Dict, List, Optional

_lock = Lock()
_path = Path(__file__).parent / 'storage.json'

DEFAULT_STATE: Dict[str, Any] = {
    'schools': [],
    'teacher_schools': [],
    'users': [],
    'school_users': [],
    'login_tokens': [],
    'subscriptions': [],
}


def _ensure_defaults(data: Dict[str, Any]) -> Dict[str, Any]:
    for key, default in DEFAULT_STATE.items():
        if key not in data:
            data[key] = [] if isinstance(default, list) else default
    return data


def _read() -> Dict[str, Any]:
    if not _path.exists():
        return _ensure_defaults({})
    try:
        data = json.loads(_path.read_text(encoding='utf-8'))
    except Exception:
        data = {}
    return _ensure_defaults(data)


def _write(obj: Dict[str, Any]):
    with _lock:
        _path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding='utf-8')


def _next_id(items: List[Dict[str, Any]]) -> int:
    return max((int(item.get('id', 0)) for item in items), default=0) + 1


# --- Schools -----------------------------------------------------------------


def list_schools() -> List[Dict[str, Any]]:
    return _read().get('schools', [])


def create_school(name: str, slug: str = None, metadata: Dict[str, Any] = None) -> Dict[str, Any]:
    obj = _read()
    schools = obj.setdefault('schools', [])
    new_id = _next_id(schools)
    rec = {
        'id': new_id,
        'name': name,
        'slug': slug or f'school-{new_id}',
        'metadata': metadata or {},
        'created_at': datetime.now(timezone.utc).isoformat(),
    }
    schools.append(rec)
    _write(obj)
    return rec


def get_school_by_id(school_id: int) -> Optional[Dict[str, Any]]:
    for school in list_schools():
        if school.get('id') == school_id:
            return school
    return None


# Legacy teacher-school helpers (kept for backwards compatibility)

def list_teacher_schools() -> List[Dict[str, Any]]:
    return _read().get('teacher_schools', [])


def add_teacher_school(teacher_id: str, school_id: int) -> Dict[str, Any]:
    obj = _read()
    ts = obj.setdefault('teacher_schools', [])
    pair = {'teacher_id': teacher_id, 'school_id': school_id}
    if pair not in ts:
        ts.append(pair)
        _write(obj)
    return pair


def remove_teacher_school(teacher_id: str, school_id: int) -> bool:
    obj = _read()
    ts = obj.setdefault('teacher_schools', [])
    new = [p for p in ts if not (p['teacher_id'] == teacher_id and p['school_id'] == school_id)]
    if len(new) != len(ts):
        obj['teacher_schools'] = new
        _write(obj)
        return True
    return False


# --- Users -------------------------------------------------------------------


def list_users() -> List[Dict[str, Any]]:
    return _read().get('users', [])


def get_user_by_id(user_id: int) -> Optional[Dict[str, Any]]:
    for user in list_users():
        if user.get('id') == user_id:
            return user
    return None


def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    normalized = email.strip().lower()
    for user in list_users():
        if user.get('email', '').lower() == normalized:
            return user
    return None


def upsert_user(email: str, name: Optional[str] = None, role: str = 'admin') -> Dict[str, Any]:
    obj = _read()
    users = obj.setdefault('users', [])
    normalized = email.strip().lower()
    for user in users:
        if user.get('email', '').lower() == normalized:
            if name is not None:
                user['name'] = name
            if role:
                user['role'] = role
            _write(obj)
            return user
    new_id = _next_id(users)
    rec = {
        'id': new_id,
        'email': normalized,
        'name': name,
        'role': role or 'admin',
        'created_at': datetime.now(timezone.utc).isoformat(),
    }
    users.append(rec)
    _write(obj)
    return rec


def list_school_users() -> List[Dict[str, Any]]:
    return _read().get('school_users', [])


def get_school_users_by_user(user_id: int) -> List[Dict[str, Any]]:
    return [rec for rec in list_school_users() if rec.get('user_id') == user_id]


def add_school_user(user_id: int, school_id: int, role: str = 'admin') -> Dict[str, Any]:
    obj = _read()
    records = obj.setdefault('school_users', [])
    for rec in records:
        if rec.get('user_id') == user_id and rec.get('school_id') == school_id:
            rec['role'] = role or rec.get('role', 'admin')
            _write(obj)
            return rec
    new_id = _next_id(records)
    rec = {
        'id': new_id,
        'user_id': user_id,
        'school_id': school_id,
        'role': role or 'admin',
        'created_at': datetime.now(timezone.utc).isoformat(),
    }
    records.append(rec)
    _write(obj)
    return rec


def remove_school_user(user_id: int, school_id: int) -> bool:
    obj = _read()
    records = obj.setdefault('school_users', [])
    new = [rec for rec in records if not (rec.get('user_id') == user_id and rec.get('school_id') == school_id)]
    if len(new) != len(records):
        obj['school_users'] = new
        _write(obj)
        return True
    return False


# --- Login tokens ------------------------------------------------------------


def list_login_tokens() -> List[Dict[str, Any]]:
    return _read().get('login_tokens', [])


def add_login_token(user_id: int, token: str, code: Optional[str], purpose: str, expires_at: datetime, metadata: Optional[Dict[str, Any]] = None, consumed: bool = False) -> Dict[str, Any]:
    obj = _read()
    tokens = obj.setdefault('login_tokens', [])
    new_id = _next_id(tokens)
    rec = {
        'id': new_id,
        'user_id': user_id,
        'token': token,
        'code': code,
        'purpose': purpose,
        'expires_at': expires_at.isoformat(),
        'consumed': consumed,
        'metadata': metadata or {},
        'created_at': datetime.now(timezone.utc).isoformat(),
    }
    tokens.append(rec)
    _write(obj)
    return rec


def _match_token(rec: Dict[str, Any], *, token: Optional[str] = None, code: Optional[str] = None, purpose: Optional[str] = None) -> bool:
    if purpose and rec.get('purpose') != purpose:
        return False
    if token and rec.get('token') != token:
        return False
    if code and rec.get('code') != code:
        return False
    return True


def find_login_token(token: str, purpose: str) -> Optional[Dict[str, Any]]:
    now = datetime.now(timezone.utc)
    for rec in list_login_tokens():
        if _match_token(rec, token=token, purpose=purpose):
            expires = datetime.fromisoformat(rec['expires_at']) if rec.get('expires_at') else None
            if rec.get('consumed') or (expires and expires < now):
                continue
            return rec
    return None


def find_login_token_by_code(code: str, purpose: str) -> Optional[Dict[str, Any]]:
    now = datetime.now(timezone.utc)
    for rec in list_login_tokens():
        if _match_token(rec, code=code, purpose=purpose):
            expires = datetime.fromisoformat(rec['expires_at']) if rec.get('expires_at') else None
            if rec.get('consumed') or (expires and expires < now):
                continue
            return rec
    return None


def mark_login_token_consumed(token: str) -> Optional[Dict[str, Any]]:
    obj = _read()
    tokens = obj.setdefault('login_tokens', [])
    for rec in tokens:
        if rec.get('token') == token:
            rec['consumed'] = True
            rec['consumed_at'] = datetime.now(timezone.utc).isoformat()
            _write(obj)
            return rec
    return None


def update_login_token(token: str, **changes) -> Optional[Dict[str, Any]]:
    obj = _read()
    tokens = obj.setdefault('login_tokens', [])
    for rec in tokens:
        if rec.get('token') == token:
            rec.update(changes)
            _write(obj)
            return rec
    return None


def purge_expired_login_tokens():
    obj = _read()
    tokens = obj.setdefault('login_tokens', [])
    now = datetime.now(timezone.utc)
    filtered = []
    for rec in tokens:
        expires = datetime.fromisoformat(rec['expires_at']) if rec.get('expires_at') else None
        if expires and expires < now and rec.get('consumed', False):
            continue
        filtered.append(rec)
    if len(filtered) != len(tokens):
        obj['login_tokens'] = filtered
        _write(obj)


# --- Subscriptions -----------------------------------------------------------


def get_subscription_for_user(user_id: int | str) -> Optional[Dict[str, Any]]:
    uid = str(user_id)
    subs = _read().get('subscriptions', [])
    matching = [rec for rec in subs if str(rec.get('user_id')) == uid]
    if not matching:
        return None
    matching.sort(key=lambda rec: rec.get('expires_at') or rec.get('trial_expires_at') or rec.get('start_at') or '', reverse=True)
    latest = dict(matching[0])
    exp_text = latest.get('expires_at') or latest.get('trial_expires_at')
    if exp_text:
        expires = datetime.fromisoformat(exp_text)
        if expires < datetime.now(timezone.utc):
            latest['status'] = 'expired'
    return latest
