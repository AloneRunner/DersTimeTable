import json
from pathlib import Path
from threading import Lock
from typing import Any, Dict, List

_lock = Lock()
_path = Path(__file__).parent / 'storage.json'

def _read() -> Dict[str, Any]:
    if not _path.exists():
        return {'schools': [], 'teacher_schools': []}
    try:
        return json.loads(_path.read_text(encoding='utf-8'))
    except Exception:
        return {'schools': [], 'teacher_schools': []}

def _write(obj: Dict[str, Any]):
    with _lock:
        _path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding='utf-8')

def list_schools() -> List[Dict[str, Any]]:
    return _read().get('schools', [])

def create_school(name: str, slug: str = None, metadata: Dict[str, Any] = None) -> Dict[str, Any]:
    obj = _read()
    schools = obj.setdefault('schools', [])
    new_id = (max((s.get('id', 0) for s in schools), default=0) + 1)
    rec = {'id': new_id, 'name': name, 'slug': slug or f'school-{new_id}', 'metadata': metadata or {}, 'created_at': None}
    schools.append(rec)
    _write(obj)
    return rec

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
