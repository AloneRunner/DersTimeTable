BEGIN;

ALTER TABLE school_teachers
  ADD COLUMN IF NOT EXISTS max_weekly_hours INTEGER;

ALTER TABLE school_teachers
  DROP CONSTRAINT IF EXISTS school_teachers_max_weekly_hours_check;

ALTER TABLE school_teachers
  ADD CONSTRAINT school_teachers_max_weekly_hours_check
  CHECK (max_weekly_hours IS NULL OR max_weekly_hours BETWEEN 1 AND 80);

COMMIT;
