"""Anonim kullanım sayımı ve yalnız uygulama sahibine açık istatistikler.

Kaydedilenler: rastgele üretilmiş cihaz kimliği, olay türü (uygulama açıldı /
program oluşturuldu), platform, derleme tarihi; program oluşturmada ayrıca
sınıf/öğretmen sayısı ve hangi çözücünün kullanıldığı.

Kaydedilmeyenler: IP adresi, okul/öğretmen/ders verisi, isim ve e-posta.
Oturum açık bir istekte yalnız kullanıcı kimliği (user_id) cihazla eşleştirilir;
böylece ileride "kaç anonim cihaz hesaba dönüştü" görülebilir.
"""

from __future__ import annotations

import hmac
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import psycopg
from fastapi import APIRouter, Header, HTTPException, Request, Response
from psycopg.rows import dict_row
from psycopg.types.json import Json
from pydantic import BaseModel, Field

DATABASE_URL = os.environ.get('DATABASE_URL')
USE_DB = bool(DATABASE_URL)
REPORT_TZ = 'Europe/Istanbul'

router = APIRouter(prefix='/api')
logger = logging.getLogger(__name__)

_DEVICE_RE = re.compile(r'^[A-Za-z0-9-]{8,64}$')
_BUILD_RE = re.compile(r'^[0-9A-Za-z.\-]{1,32}$')
_EVENTS = {'app_open', 'solve'}
_PLATFORMS = {'web', 'windows', 'android'}
_SOLVERS = {'cpsat', 'local'}
# Program olusmadiginda tesihsin bulabilecegi engel turleri (server/diagnose.py).
_FAIL_REASONS = {
    'availability_teacher', 'availability', 'blocks', 'fixed', 'pinned_teacher',
    'daily_max', 'max_consec', 'weekly_max', 'not_same_day', 'same_day_split',
    'gap_limit', 'unknown',
}


class ActivityPayload(BaseModel):
    deviceId: str = Field(min_length=8, max_length=64)
    event: str = Field(max_length=32)
    platform: Optional[str] = Field(default=None, max_length=16)
    appBuild: Optional[str] = Field(default=None, max_length=32)
    solver: Optional[str] = Field(default=None, max_length=16)
    success: Optional[bool] = None
    # Basarisiz denemede engelin turu (kural etiketi). Okul/ogretmen/ders adi
    # tasimaz; hangi kuralin kullanicilari en cok tikadigini gormek icin.
    reason: Optional[str] = Field(default=None, max_length=32)
    classrooms: Optional[int] = Field(default=None, ge=0, le=5000)
    teachers: Optional[int] = Field(default=None, ge=0, le=5000)


def _admin_key() -> str:
    # Her istekte okunur; Railway'de değişken eklenince yeniden dağıtım yeterli.
    return os.environ.get('ADMIN_STATS_KEY', '')


def _session_user_id(request: Request) -> Optional[int]:
    header = request.headers.get('authorization') or ''
    if not header.lower().startswith('bearer '):
        return None
    try:
        from auth import _find_session  # yerel içe aktarma: döngüsel bağımlılığı önler

        record = _find_session(header.split(' ', 1)[1].strip())
    except Exception:  # pylint: disable=broad-except
        return None
    if not record:
        return None
    try:
        return int(record.get('user_id'))
    except (TypeError, ValueError):
        return None


# --- Kayıt -------------------------------------------------------------------


@router.post('/app/activity', status_code=204)
def record_activity(payload: ActivityPayload, request: Request) -> Response:
    if not _DEVICE_RE.match(payload.deviceId) or payload.event not in _EVENTS:
        raise HTTPException(status_code=422, detail='invalid-activity')

    platform = payload.platform if payload.platform in _PLATFORMS else 'web'
    app_build = payload.appBuild if payload.appBuild and _BUILD_RE.match(payload.appBuild) else None

    detail: Dict[str, Any] = {}
    if payload.event == 'solve':
        if payload.solver in _SOLVERS:
            detail['solver'] = payload.solver
        if payload.success is not None:
            detail['success'] = bool(payload.success)
        if payload.classrooms is not None:
            detail['classrooms'] = payload.classrooms
        if payload.teachers is not None:
            detail['teachers'] = payload.teachers
        # Engel turu yalnizca BILINEN etiketlerden biriyse yazilir; serbest metin
        # kabul edilmez ki sayimlar temiz kalsin ve kazara veri sizmasin.
        if payload.reason in _FAIL_REASONS:
            detail['reason'] = payload.reason

    user_id = _session_user_id(request)

    try:
        if USE_DB:
            _db_record(payload.deviceId, user_id, payload.event, platform, app_build, detail)
        else:
            _storage_record(payload.deviceId, user_id, payload.event, platform, app_build, detail)
    except Exception:  # pylint: disable=broad-except
        # Sayım hiçbir zaman kullanıcının işini bozmamalı.
        logger.exception('usage-activity-record-failed')
    return Response(status_code=204)


def _db_record(
    device_id: str,
    user_id: Optional[int],
    event: str,
    platform: str,
    app_build: Optional[str],
    detail: Dict[str, Any],
) -> None:
    with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
        with conn.cursor() as cur:
            skip = False
            if event == 'app_open':
                # İstemci zaten günde en fazla bir kez gönderir; tekrarı sunucuda da ele.
                cur.execute(
                    """SELECT 1 FROM usage_events
                       WHERE device_id = %s AND event = 'app_open'
                         AND created_at > now() - interval '12 hours'
                       LIMIT 1""",
                    (device_id,),
                )
                skip = cur.fetchone() is not None
            if not skip:
                cur.execute(
                    """INSERT INTO usage_events (device_id, user_id, event, platform, app_version, detail)
                       VALUES (%s, %s, %s, %s, %s, %s)""",
                    (device_id, user_id, event, platform, app_build, Json(detail) if detail else None),
                )
            if user_id is not None:
                cur.execute(
                    "UPDATE usage_events SET user_id = %s WHERE device_id = %s AND user_id IS NULL",
                    (user_id, device_id),
                )


def _storage_record(
    device_id: str,
    user_id: Optional[int],
    event: str,
    platform: str,
    app_build: Optional[str],
    detail: Dict[str, Any],
) -> None:
    import storage  # yalnız veritabanı yokken (yerel geliştirme)

    obj = storage._read()  # pylint: disable=protected-access
    events = obj.setdefault('usage_events', [])
    events.append({
        'device_id': device_id,
        'user_id': user_id,
        'event': event,
        'platform': platform,
        'app_version': app_build,
        'detail': detail or None,
        'created_at': datetime.now(timezone.utc).isoformat(),
    })
    obj['usage_events'] = events[-5000:]
    storage._write(obj)  # pylint: disable=protected-access


# --- İstatistik (yalnız sahibine) -------------------------------------------


def _require_admin(x_admin_key: Optional[str]) -> None:
    expected = _admin_key()
    if not expected:
        raise HTTPException(status_code=503, detail='admin-stats-key-not-configured')
    if not x_admin_key or not hmac.compare_digest(x_admin_key.encode('utf-8'), expected.encode('utf-8')):
        raise HTTPException(status_code=401, detail='invalid-admin-key')
    if not USE_DB:
        raise HTTPException(status_code=503, detail='stats-require-database')


@router.get('/admin/stats')
def admin_stats(x_admin_key: Optional[str] = Header(default=None)) -> Dict[str, Any]:
    _require_admin(x_admin_key)
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            return _collect_stats(cur)


REVIEW_ROLE = 'reviewer'
REVIEW_SCHOOL_NAME = 'İnceleme Demo Okulu'
_EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$')


class ReviewAccountPayload(BaseModel):
    email: str = Field(min_length=6, max_length=120)
    password: str = Field(min_length=12, max_length=64)


@router.post('/admin/review-account')
def admin_review_account(payload: ReviewAccountPayload, x_admin_key: Optional[str] = Header(default=None)) -> Dict[str, Any]:
    """Magaza incelemecileri icin e-posta + sifreli hesap olusturur veya sifresini yeniler.

    Incelemeciler Google hesabi olusturamaz ve kendi hesaplarini kullanamaz; bu hesap
    Google'siz girer ve yalniz kendi demo okuluna baglidir. Gercek bir kullaniciya ait
    e-posta reddedilir; aksi halde o hesaba sifreyle girilebilir hale gelirdi.
    """
    _require_admin(x_admin_key)
    import auth  # yerel içe aktarma: döngüsel bağımlılığı önler

    email = payload.email.strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail='invalid-email')

    existing = auth._db_query('SELECT id, role FROM users WHERE email = %s', (email,))
    if existing and (existing[0].get('role') or '').lower() != REVIEW_ROLE:
        raise HTTPException(status_code=409, detail='email-in-use')

    user = auth._upsert_user(email, 'App Review', default_role=REVIEW_ROLE)
    auth._db_update_user_password(user['id'], auth._hash_password(payload.password))

    memberships = auth._get_school_memberships(user['id'])
    if memberships:
        school_id = int(memberships[0]['id'])
        school_name = memberships[0].get('name') or REVIEW_SCHOOL_NAME
    else:
        created = auth._db_execute(
            'INSERT INTO schools (name) VALUES (%s) RETURNING id', (REVIEW_SCHOOL_NAME,), returning=True
        )
        if not created:
            raise HTTPException(status_code=500, detail='school-create-failed')
        school_id = int(created['id'])
        school_name = REVIEW_SCHOOL_NAME
        auth._attach_school(user['id'], school_id, role='admin')

    # Sifre degisince onceki inceleme oturumlari da gecersiz olsun.
    auth._db_execute('DELETE FROM login_tokens WHERE user_id = %s', (user['id'],))
    logger.warning('admin-review-account-set user_id=%s school_id=%s', user['id'], school_id)
    return {'ok': True, 'email': email, 'userId': user['id'], 'schoolId': school_id, 'schoolName': school_name}


def _school_rows(cur: Any, school_id: Optional[int] = None) -> List[Dict[str, Any]]:
    where = 'WHERE s.id = %(id)s' if school_id is not None else ''
    cur.execute(f"""
        SELECT s.id, s.name, s.created_at,
               COALESCE((
                 SELECT json_agg(json_build_object('email', u.email, 'role', su.role) ORDER BY u.email)
                 FROM school_users su JOIN users u ON u.id = su.user_id
                 WHERE su.school_id = s.id
               ), '[]'::json) AS members,
               (SELECT COUNT(*) FROM school_teachers t WHERE t.school_id = s.id) AS teachers,
               (SELECT COUNT(*) FROM school_classrooms c WHERE c.school_id = s.id) AS classrooms,
               (SELECT COUNT(*) FROM school_subjects x WHERE x.school_id = s.id) AS subjects,
               GREATEST(
                 (SELECT MAX(updated_at) FROM school_teachers WHERE school_id = s.id),
                 (SELECT MAX(updated_at) FROM school_classrooms WHERE school_id = s.id),
                 (SELECT MAX(updated_at) FROM school_subjects WHERE school_id = s.id),
                 (SELECT MAX(updated_at) FROM school_settings WHERE school_id = s.id)
               ) AS data_updated_at,
               EXISTS (SELECT 1 FROM published_schedules p WHERE p.school_id = s.id) AS published
        FROM schools s
        {where}
        ORDER BY s.created_at DESC, s.id DESC
        LIMIT 1000
    """, {'id': school_id})
    return list(cur.fetchall())


@router.delete('/admin/schools/{school_id}')
def admin_delete_school(school_id: int, x_admin_key: Optional[str] = Header(default=None)) -> Dict[str, Any]:
    """Okulu ve okula bagli tum verileri kalici olarak siler (yalniz uygulama sahibine).

    Katalog tablolari, uyelikler, ogretmen baglantilari ve yayinlanan programlar
    ON DELETE CASCADE ile gider. Kullanilmayan students/attendance tablolarinda
    kademeli silme olmadigi icin once onlar temizlenir.
    """
    _require_admin(x_admin_key)
    with psycopg.connect(DATABASE_URL) as conn:  # tek islem: hata olursa hicbir sey silinmez
        with conn.cursor(row_factory=dict_row) as cur:
            rows = _school_rows(cur, school_id)
            if not rows:
                raise HTTPException(status_code=404, detail='school-not-found')
            cur.execute(
                'DELETE FROM attendance WHERE student_id IN (SELECT id FROM students WHERE school_id = %s)',
                (school_id,),
            )
            cur.execute('DELETE FROM students WHERE school_id = %s', (school_id,))
            cur.execute('DELETE FROM schools WHERE id = %s', (school_id,))
    logger.warning('admin-deleted-school id=%s name=%s', school_id, rows[0].get('name'))
    return {'ok': True, 'deleted': rows[0]}


def _one(cur: Any, sql: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    cur.execute(sql, params or {})
    return cur.fetchone() or {}


def _all(cur: Any, sql: str, params: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    cur.execute(sql, params or {})
    return list(cur.fetchall())


def _collect_stats(cur: Any) -> Dict[str, Any]:
    tz = {'tz': REPORT_TZ}

    devices = _one(cur, """
        SELECT
          COUNT(DISTINCT device_id) AS total,
          COUNT(DISTINCT device_id) FILTER (WHERE created_at > now() - interval '1 day') AS active_1d,
          COUNT(DISTINCT device_id) FILTER (WHERE created_at > now() - interval '7 days') AS active_7d,
          COUNT(DISTINCT device_id) FILTER (WHERE created_at > now() - interval '30 days') AS active_30d,
          COUNT(DISTINCT device_id) FILTER (WHERE user_id IS NOT NULL) AS linked_to_account
        FROM usage_events
    """)

    new_devices = _one(cur, """
        SELECT
          COUNT(*) FILTER (WHERE first_seen > now() - interval '7 days') AS new_7d,
          COUNT(*) FILTER (WHERE first_seen > now() - interval '30 days') AS new_30d
        FROM (SELECT MIN(created_at) AS first_seen FROM usage_events GROUP BY device_id) AS firsts
    """)

    platforms = _all(cur, """
        SELECT COALESCE(platform, 'web') AS platform, COUNT(DISTINCT device_id) AS devices
        FROM usage_events
        WHERE created_at > now() - interval '30 days'
        GROUP BY 1
        ORDER BY 2 DESC
    """)

    solves = _one(cur, """
        SELECT
          COUNT(*) FILTER (
            WHERE created_at >= (date_trunc('day', now() AT TIME ZONE %(tz)s) AT TIME ZONE %(tz)s)
          ) AS today,
          COUNT(*) FILTER (WHERE created_at > now() - interval '7 days') AS last_7d,
          COUNT(*) FILTER (WHERE created_at > now() - interval '30 days') AS last_30d,
          COUNT(*) AS total,
          COUNT(*) FILTER (
            WHERE created_at > now() - interval '30 days' AND detail->>'solver' = 'local'
          ) AS local_fallback_30d,
          COUNT(*) FILTER (
            WHERE created_at > now() - interval '30 days' AND detail->>'success' = 'false'
          ) AS failed_30d,
          COUNT(DISTINCT device_id) FILTER (WHERE created_at > now() - interval '30 days') AS devices_30d
        FROM usage_events
        WHERE event = 'solve'
    """, tz)

    # Basarisiz denemelerin sebep dagilimi. "Hangi kural kullanicilari en cok
    # tikiyor" sorusunun cevabi; tesihs eklenmeden once bu bilgi hic yoktu.
    fail_reasons = _all(cur, """
        SELECT COALESCE(detail->>'reason', 'kaydedilmemis') AS reason,
               COUNT(*) AS count
        FROM usage_events
        WHERE event = 'solve'
          AND created_at > now() - interval '30 days'
          AND detail->>'success' = 'false'
        GROUP BY 1
        ORDER BY 2 DESC
    """)

    daily = _all(cur, """
        WITH days AS (
          SELECT generate_series(
                   ((now() AT TIME ZONE %(tz)s)::date - 29)::timestamp,
                   (now() AT TIME ZONE %(tz)s)::date::timestamp,
                   interval '1 day'
                 )::date AS day
        ), ev AS (
          SELECT (created_at AT TIME ZONE %(tz)s)::date AS day, device_id, event
          FROM usage_events
          WHERE created_at > now() - interval '31 days'
        )
        SELECT to_char(days.day, 'YYYY-MM-DD') AS day,
               COUNT(DISTINCT ev.device_id) AS devices,
               COUNT(ev.event) FILTER (WHERE ev.event = 'solve') AS solves
        FROM days
        LEFT JOIN ev ON ev.day = days.day
        GROUP BY days.day
        ORDER BY days.day
    """, tz)

    accounts = _one(cur, """
        SELECT
          (SELECT COUNT(*) FROM users) AS users,
          (SELECT COUNT(*) FROM users WHERE created_at > now() - interval '7 days') AS users_7d,
          (SELECT COUNT(*) FROM users WHERE created_at > now() - interval '30 days') AS users_30d,
          (SELECT COUNT(*) FROM users WHERE role = 'teacher') AS teacher_users,
          (SELECT COUNT(*) FROM schools) AS schools,
          (SELECT COUNT(DISTINCT school_id) FROM school_subjects) AS schools_with_cloud_data,
          (SELECT COUNT(*) FROM published_schedules) AS published_schedules,
          (SELECT COUNT(*) FROM teacher_user_links) AS teacher_links
    """)

    recent_users = _all(cur, """
        SELECT u.id, u.email, u.name, u.role, u.created_at,
               COALESCE(string_agg(DISTINCT s.name, ', '), '') AS schools,
               GREATEST(
                 u.last_seen_at,
                 u.last_login_at,
                 (SELECT MAX(e.created_at) FROM usage_events e WHERE e.user_id = u.id)
               ) AS last_seen
        FROM users u
        LEFT JOIN school_users su ON su.user_id = u.id
        LEFT JOIN schools s ON s.id = su.school_id
        GROUP BY u.id
        ORDER BY u.created_at DESC
        LIMIT 25
    """)

    return {
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'timezone': REPORT_TZ,
        'devices': {**devices, **new_devices},
        'platforms': platforms,
        'solves': solves,
        'failReasons': fail_reasons,
        'daily': daily,
        'accounts': accounts,
        'recentUsers': recent_users,
        'schools': _school_rows(cur),
    }
