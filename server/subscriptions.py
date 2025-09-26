from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import os
from typing import Any

import psycopg
from psycopg.rows import dict_row

router = APIRouter(prefix='/api')

DATABASE_URL = os.environ.get('DATABASE_URL')
USE_DB = bool(DATABASE_URL)


class CreateTrial(BaseModel):
    user_id: str


if not USE_DB:
    import storage as db


def _db_execute(query: str, params: tuple = (), returning: bool = False):
    with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(query, params)
            if returning:
                return cur.fetchone()
            return cur.rowcount


def _db_fetchone(query: str, params: tuple = ()):  # returns dict or None
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(query, params)
            return cur.fetchone()


def _mark_expired(rec: dict | None) -> dict | None:
    if not rec:
        return None
    expires_at = rec.get('expires_at')
    if expires_at and expires_at < datetime.now(timezone.utc):
        rec = dict(rec)
        rec['status'] = 'expired'
    return rec


@router.post('/subscriptions/trial')
def create_trial(payload: CreateTrial) -> Any:
    trial_days = 14
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=trial_days)

    if not USE_DB:
        # store in storage.json under 'subscriptions' key
        obj = db._read()
        subs = obj.setdefault('subscriptions', [])
        rec = {
            'id': len(subs) + 1,
            'user_id': payload.user_id,
            'provider': 'trial',
            'start_at': now.isoformat(),
            'expires_at': expires.isoformat(),
            'status': 'active',
            'raw_receipt': None,
        }
        subs.append(rec)
        db._write(obj)
        return {'ok': True, 'subscription': rec}

    rec = _db_execute(
        """INSERT INTO subscriptions (user_id, provider, start_at, expires_at, status)
             VALUES (%s, %s, %s, %s, %s)
             RETURNING id, user_id, provider, start_at, expires_at, status""",
        (payload.user_id, 'trial', now, expires, 'active'),
        returning=True,
    )
    if not rec:
        raise HTTPException(status_code=400, detail='failed-to-create-trial')
    return {'ok': True, 'subscription': rec}


@router.get('/subscriptions/status/{user_id}')
def subscription_status(user_id: str):
    if not USE_DB:
        obj = db._read()
        subs = obj.get('subscriptions', [])
        for s in subs:
            if s.get('user_id') == user_id:
                rec = dict(s)
                if rec.get('expires_at'):
                    expires = datetime.fromisoformat(rec['expires_at'])
                    if expires < datetime.now(timezone.utc):
                        rec['status'] = 'expired'
                return rec
        return {'ok': False, 'reason': 'no-subscription'}

    rec = _db_fetchone(
        """SELECT id, user_id, provider, start_at, expires_at, status
             FROM subscriptions
             WHERE user_id = %s
             ORDER BY COALESCE(expires_at, start_at) DESC
             LIMIT 1""",
        (user_id,),
    )
    rec = _mark_expired(rec)
    if not rec:
        return {'ok': False, 'reason': 'no-subscription'}
    return {'ok': True, 'subscription': rec}
