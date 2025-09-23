from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import os
from typing import Any
from datetime import datetime, timedelta

router = APIRouter(prefix='/api')

USE_DB = bool(os.environ.get('DATABASE_URL'))

class CreateTrial(BaseModel):
    user_id: str

if not USE_DB:
    import storage as db


@router.post('/subscriptions/trial')
def create_trial(payload: CreateTrial) -> Any:
    # create a 14-day trial entry in storage
    trial_days = 14
    if USE_DB:
        raise HTTPException(status_code=501, detail='DB-backed subscriptions not implemented')
    # store in storage.json under 'subscriptions' key
    obj = db._read()
    subs = obj.setdefault('subscriptions', [])
    now = datetime.utcnow()
    rec = {
        'id': len(subs) + 1,
        'user_id': payload.user_id,
        'provider': 'trial',
        'start_at': now.isoformat() + 'Z',
        'expires_at': (now + timedelta(days=trial_days)).isoformat() + 'Z',
        'status': 'active',
        'raw_receipt': None,
    }
    subs.append(rec)
    db._write(obj)
    return {'ok': True, 'subscription': rec}


@router.get('/subscriptions/status/{user_id}')
def subscription_status(user_id: str):
    if USE_DB:
        raise HTTPException(status_code=501, detail='DB-backed subscriptions not implemented')
    obj = db._read()
    subs = obj.get('subscriptions', [])
    for s in subs:
        if s.get('user_id') == user_id:
            return s
    return {'ok': False, 'reason': 'no-subscription'}
