import type { Schedule, SchoolHours, TimetableData } from '../types';
import { SchoolLevel } from '../types';

export const LOCAL_WORKSPACE_KEY = 'ozarik.timetable.current.v1';

export interface LocalWorkspaceDraft {
  version: 1;
  savedAt: string;
  data: TimetableData;
  schedule: Schedule | null;
  schoolHours: SchoolHours;
  activeScheduleName: string | null;
}

const hasValidSchoolHours = (value: unknown): value is SchoolHours => {
  if (!value || typeof value !== 'object') return false;
  const hours = value as Partial<SchoolHours>;
  return [SchoolLevel.Middle, SchoolLevel.High].every(level =>
    Array.isArray(hours[level]) &&
    hours[level]!.length === 5 &&
    hours[level]!.every(hour => Number.isFinite(hour) && hour >= 1 && hour <= 16)
  );
};

export const loadLocalWorkspace = (): LocalWorkspaceDraft | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_WORKSPACE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalWorkspaceDraft>;
    if (
      !parsed.data ||
      !Array.isArray(parsed.data.teachers) ||
      !Array.isArray(parsed.data.classrooms) ||
      !Array.isArray(parsed.data.subjects) ||
      !hasValidSchoolHours(parsed.schoolHours)
    ) {
      return null;
    }
    return {
      version: 1,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date(0).toISOString(),
      data: parsed.data,
      schedule: parsed.schedule && typeof parsed.schedule === 'object' ? parsed.schedule : null,
      schoolHours: parsed.schoolHours,
      activeScheduleName: typeof parsed.activeScheduleName === 'string' ? parsed.activeScheduleName : null,
    };
  } catch {
    return null;
  }
};

export const saveLocalWorkspace = (draft: Omit<LocalWorkspaceDraft, 'version'>): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LOCAL_WORKSPACE_KEY, JSON.stringify({ ...draft, version: 1 }));
};
