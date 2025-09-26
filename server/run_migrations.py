"""Simple migration runner for Railway Postgres.

Usage:
  DATABASE_URL=postgresql://... python server/run_migrations.py

It creates a small tracking table (app_migrations) so the same SQL files
won't be executed twice.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import psycopg

MIGRATIONS_DIR = Path(__file__).parent / "migrations"
TRACK_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS app_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


def iter_migration_files():
    return sorted(MIGRATIONS_DIR.glob("*.sql"))


def main() -> int:
    url = os.getenv("DATABASE_URL")
    if not url:
        print("DATABASE_URL environment variable is missing", file=sys.stderr)
        return 1

    files = iter_migration_files()
    if not files:
        print("No migration files found in", MIGRATIONS_DIR)
        return 0

    print(f"Connecting to database using DATABASE_URL...")
    with psycopg.connect(url, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(TRACK_TABLE_SQL)

        for path in files:
            name = path.name
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT 1 FROM app_migrations WHERE filename = %s",
                    (name,),
                )
                if cur.fetchone():
                    print(f"- Skipping {name} (already applied)")
                    continue

            sql_text = path.read_text(encoding="utf-8")
            print(f"- Applying {name}...")
            try:
                with conn.cursor() as cur:
                    cur.execute(sql_text)
                with conn.cursor() as cur:
                    cur.execute(
                        "INSERT INTO app_migrations (filename) VALUES (%s) ON CONFLICT DO NOTHING",
                        (name,),
                    )
            except Exception as exc:  # pylint: disable=broad-except
                print(f"! Migration {name} failed: {exc}", file=sys.stderr)
                return 1

    print("All migrations applied successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
