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

const isEmptyData = (d: TimetableData | null | undefined): boolean => {
  if (!d) return true;
  return (
    (d.teachers?.length ?? 0) === 0 &&
    (d.classrooms?.length ?? 0) === 0 &&
    (d.subjects?.length ?? 0) === 0 &&
    (d.locations?.length ?? 0) === 0 &&
    (d.fixedAssignments?.length ?? 0) === 0 &&
    (d.lessonGroups?.length ?? 0) === 0 &&
    (d.duties?.length ?? 0) === 0
  );
};

/**
 * Veri bos mu, ya da yalniz uygulamanin varsayilan baslangic ornegi mi
 * (1 ogretmen "Ali Yilmaz", 1 sinif "5-A", 1 ders "Turkce")? Ornek veri
 * kullanicinin gercek verisi sayilmamali: aksi halde yeni cihazda giris yapan
 * birine "bu cihazda veri var" diye sorulup gercek bulut verisi ornekle ezilebiliyordu.
 */
export const isEmptyOrStarterData = (d: TimetableData | null | undefined): boolean => {
  if (isEmptyData(d)) return true;
  const data = d as TimetableData;
  const onlyOne = <T,>(items: T[] | undefined) => (items?.length ?? 0) === 1;
  const none = (items: unknown[] | undefined) => (items?.length ?? 0) === 0;
  return (
    onlyOne(data.teachers) && data.teachers[0].id === 't1' && data.teachers[0].name === 'Ali Yılmaz' &&
    onlyOne(data.classrooms) && data.classrooms[0].id === 'c1' && data.classrooms[0].name === '5-A' &&
    onlyOne(data.subjects) && data.subjects[0].id === 's1' && data.subjects[0].name === 'Türkçe' &&
    none(data.locations) && none(data.fixedAssignments) && none(data.lessonGroups) && none(data.duties)
  );
};

export const saveLocalWorkspace = (draft: Omit<LocalWorkspaceDraft, 'version'>): void => {
  if (typeof window === 'undefined') return;

  // Guvenlik kilidi: dolu bir yerel yedegin uzerine BOS veri yazma.
  // (Buluta girip cikinca ekran bosaliyordu ve yedek yok oluyordu.)
  if (isEmptyOrStarterData(draft.data)) {
    const existing = loadLocalWorkspace();
    if (existing && !isEmptyOrStarterData(existing.data)) {
      return;
    }
  }

  window.localStorage.setItem(LOCAL_WORKSPACE_KEY, JSON.stringify({ ...draft, version: 1 }));
};
