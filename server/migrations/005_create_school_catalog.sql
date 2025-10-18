BEGIN;

CREATE TABLE IF NOT EXISTS school_teachers (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  teacher_key TEXT NOT NULL,
  name TEXT NOT NULL,
  branches TEXT[] NOT NULL DEFAULT '{}',
  availability JSONB,
  can_teach_middle BOOLEAN NOT NULL DEFAULT TRUE,
  can_teach_high BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, teacher_key)
);

CREATE TABLE IF NOT EXISTS school_classrooms (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  classroom_key TEXT NOT NULL,
  name TEXT NOT NULL,
  level TEXT NOT NULL,
  class_group TEXT,
  homeroom_teacher_key TEXT,
  session_type TEXT NOT NULL DEFAULT 'full',
  metadata JSONB,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, classroom_key)
);

CREATE TABLE IF NOT EXISTS school_locations (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  location_key TEXT NOT NULL,
  name TEXT NOT NULL,
  metadata JSONB,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, location_key)
);

CREATE TABLE IF NOT EXISTS school_subjects (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  subject_key TEXT NOT NULL,
  name TEXT NOT NULL,
  weekly_hours INTEGER NOT NULL,
  block_hours INTEGER NOT NULL DEFAULT 0,
  triple_block_hours INTEGER NOT NULL DEFAULT 0,
  max_consec INTEGER,
  location_key TEXT,
  required_teacher_count INTEGER NOT NULL DEFAULT 1,
  assigned_class_keys TEXT[] NOT NULL DEFAULT '{}',
  pinned_teacher_map JSONB,
  metadata JSONB,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, subject_key)
);

CREATE TABLE IF NOT EXISTS school_fixed_assignments (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  assignment_key TEXT NOT NULL,
  classroom_key TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  day_index INTEGER NOT NULL,
  hour_index INTEGER NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, assignment_key)
);

CREATE INDEX IF NOT EXISTS idx_school_fixed_assignments_school_day
  ON school_fixed_assignments (school_id, day_index, hour_index);

CREATE TABLE IF NOT EXISTS school_lesson_groups (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  lesson_group_key TEXT NOT NULL,
  name TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  classroom_keys TEXT[] NOT NULL DEFAULT '{}',
  weekly_hours INTEGER NOT NULL,
  is_block BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, lesson_group_key)
);

CREATE TABLE IF NOT EXISTS school_duties (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  duty_key TEXT NOT NULL,
  teacher_key TEXT NOT NULL,
  name TEXT NOT NULL,
  day_index INTEGER NOT NULL,
  hour_index INTEGER NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, duty_key)
);

CREATE INDEX IF NOT EXISTS idx_school_duties_teacher
  ON school_duties (school_id, teacher_key);

CREATE TABLE IF NOT EXISTS school_settings (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL UNIQUE REFERENCES schools(id) ON DELETE CASCADE,
  school_hours JSONB,
  preferences JSONB,
  metadata JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
