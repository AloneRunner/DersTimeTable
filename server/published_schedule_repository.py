from __future__ import annotations

import os
from typing import Any, Dict, Optional

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Json

from storage import get_published_schedule as storage_get_published_schedule
from storage import upsert_published_schedule as storage_upsert_published_schedule


DATABASE_URL = os.environ.get("DATABASE_URL")
USE_DB = bool(DATABASE_URL)


def upsert_published_schedule(record: Dict[str, Any]) -> Dict[str, Any]:
    if not USE_DB:
        return storage_upsert_published_schedule(record)

    with psycopg.connect(DATABASE_URL) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """INSERT INTO published_schedules (
                       school_id, schedule, data, substitution_assignments,
                       published_by, published_at, updated_at
                   )
                   VALUES (%s, %s, %s, %s, %s, %s, now())
                   ON CONFLICT (school_id) DO UPDATE
                   SET schedule = EXCLUDED.schedule,
                       data = EXCLUDED.data,
                       substitution_assignments = EXCLUDED.substitution_assignments,
                       published_by = EXCLUDED.published_by,
                       published_at = EXCLUDED.published_at,
                       updated_at = now()
                   RETURNING school_id, schedule, data, substitution_assignments,
                             published_by, published_at""",
                (
                    record["school_id"],
                    Json(record.get("schedule") or {}),
                    Json(record.get("data") or {}),
                    Json(record.get("substitution_assignments") or []),
                    Json(record.get("published_by")) if record.get("published_by") is not None else None,
                    record["published_at"],
                ),
            )
            stored = cursor.fetchone()
    if not stored:
        raise RuntimeError("failed-to-publish-schedule")
    return dict(stored)


def get_published_schedule(school_id: int) -> Optional[Dict[str, Any]]:
    if not USE_DB:
        return storage_get_published_schedule(school_id)

    with psycopg.connect(DATABASE_URL) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """SELECT school_id, schedule, data, substitution_assignments,
                          published_by, published_at
                   FROM published_schedules
                   WHERE school_id = %s""",
                (school_id,),
            )
            record = cursor.fetchone()
    if record:
        return dict(record)

    # One-time compatibility path for deployments that previously used storage.json.
    legacy_record = storage_get_published_schedule(school_id)
    if legacy_record:
        return upsert_published_schedule(legacy_record)
    return None
