import type {
  TimetableData,
  Teacher,
  Classroom,
  Subject,
  Location,
  FixedAssignment,
  LessonGroup,
  Duty,
  SchoolHours,
} from '../types';
import { getApiBaseUrl } from './authClient';

const API_BASE = getApiBaseUrl();

type CatalogTeacher = {
  id: string;
  name: string;
  branches?: string[] | null;
  availability?: boolean[][] | null;
  canTeachMiddleSchool?: boolean | null;
  canTeachHighSchool?: boolean | null;
};

type CatalogClassroom = {
  id: string;
  name: string;
  level: string;
  group?: string | null;
  homeroomTeacherId?: string | null;
  sessionType?: string | null;
};

type CatalogLocation = {
  id: string;
  name: string;
};

type CatalogSubject = {
  id: string;
  name: string;
  weeklyHours: number;
  blockHours?: number | null;
  tripleBlockHours?: number | null;
  maxConsec?: number | null;
  locationId?: string | null;
  requiredTeacherCount?: number | null;
  assignedClassIds?: string[] | null;
  pinnedTeacherByClassroom?: Record<string, string[]> | null;
};

type CatalogFixedAssignment = {
  id: string;
  classroomId: string;
  subjectId: string;
  dayIndex: number;
  hourIndex: number;
};

type CatalogLessonGroup = {
  id: string;
  name: string;
  subjectId: string;
  classroomIds?: string[] | null;
  weeklyHours: number;
  isBlock?: boolean | null;
};

type CatalogDuty = {
  id: string;
  teacherId: string;
  name: string;
  dayIndex: number;
  hourIndex: number;
};

type CatalogExportResponse = {
  teachers?: CatalogTeacher[];
  classrooms?: CatalogClassroom[];
  locations?: CatalogLocation[];
  subjects?: CatalogSubject[];
  fixedAssignments?: CatalogFixedAssignment[];
  lessonGroups?: CatalogLessonGroup[];
  duties?: CatalogDuty[];
  settings?: {
    schoolHours?: Record<string, number[]>;
    preferences?: Record<string, unknown> | null;
  } | null;
};

type CatalogReplacePayload = {
  teachers: CatalogTeacher[];
  classrooms: CatalogClassroom[];
  locations: CatalogLocation[];
  subjects: CatalogSubject[];
  fixedAssignments: CatalogFixedAssignment[];
  lessonGroups: CatalogLessonGroup[];
  duties: CatalogDuty[];
};

const DEFAULT_AVAILABILITY = Array.from({ length: 5 }, () => Array(16).fill(true));

const toTeacher = (raw: CatalogTeacher): Teacher => ({
  id: raw.id,
  name: raw.name,
  branches: raw.branches ? [...raw.branches] : [],
  availability: (raw.availability && raw.availability.length > 0)
    ? raw.availability.map(day => Array.isArray(day) ? day.map(Boolean) : Array(16).fill(true))
    : DEFAULT_AVAILABILITY.map(day => [...day]),
  canTeachMiddleSchool: raw.canTeachMiddleSchool ?? true,
  canTeachHighSchool: raw.canTeachHighSchool ?? false,
});

const toClassroom = (raw: CatalogClassroom): Classroom => ({
  id: raw.id,
  name: raw.name,
  level: raw.level,
  group: raw.group ?? undefined,
  homeroomTeacherId: raw.homeroomTeacherId ?? undefined,
  sessionType: raw.sessionType ?? 'full',
});

const toLocation = (raw: CatalogLocation): Location => ({
  id: raw.id,
  name: raw.name,
});

const toSubject = (raw: CatalogSubject): Subject => ({
  id: raw.id,
  name: raw.name,
  weeklyHours: raw.weeklyHours ?? 0,
  blockHours: raw.blockHours ?? 0,
  tripleBlockHours: raw.tripleBlockHours ?? 0,
  maxConsec: raw.maxConsec ?? undefined,
  locationId: raw.locationId ?? undefined,
  requiredTeacherCount: raw.requiredTeacherCount ?? 1,
  assignedClassIds: raw.assignedClassIds ? [...raw.assignedClassIds] : [],
  pinnedTeacherByClassroom: raw.pinnedTeacherByClassroom
    ? Object.fromEntries(
        Object.entries(raw.pinnedTeacherByClassroom).map(([key, value]) => [
          key,
          Array.isArray(value) ? value.map(String) : [],
        ]),
      )
    : {},
});

const toFixedAssignment = (raw: CatalogFixedAssignment): FixedAssignment => ({
  id: raw.id,
  classroomId: raw.classroomId,
  subjectId: raw.subjectId,
  dayIndex: Number(raw.dayIndex ?? 0),
  hourIndex: Number(raw.hourIndex ?? 0),
});

const toLessonGroup = (raw: CatalogLessonGroup): LessonGroup => ({
  id: raw.id,
  name: raw.name,
  subjectId: raw.subjectId,
  classroomIds: raw.classroomIds ? [...raw.classroomIds] : [],
  weeklyHours: Number(raw.weeklyHours ?? 0),
  isBlock: Boolean(raw.isBlock),
});

const toDuty = (raw: CatalogDuty): Duty => ({
  id: raw.id,
  teacherId: raw.teacherId,
  name: raw.name,
  dayIndex: Number(raw.dayIndex ?? 0),
  hourIndex: Number(raw.hourIndex ?? 0),
});

const toCatalogTeacher = (teacher: Teacher): CatalogTeacher => ({
  id: teacher.id,
  name: teacher.name,
  branches: teacher.branches ?? [],
  availability: teacher.availability ?? DEFAULT_AVAILABILITY,
  canTeachMiddleSchool: teacher.canTeachMiddleSchool,
  canTeachHighSchool: teacher.canTeachHighSchool,
});

const toCatalogClassroom = (classroom: Classroom): CatalogClassroom => ({
  id: classroom.id,
  name: classroom.name,
  level: classroom.level,
  group: classroom.group ?? null,
  homeroomTeacherId: classroom.homeroomTeacherId ?? null,
  sessionType: classroom.sessionType ?? 'full',
});

const toCatalogLocation = (location: Location): CatalogLocation => ({
  id: location.id,
  name: location.name,
});

const toCatalogSubject = (subject: Subject): CatalogSubject => ({
  id: subject.id,
  name: subject.name,
  weeklyHours: subject.weeklyHours,
  blockHours: subject.blockHours ?? 0,
  tripleBlockHours: subject.tripleBlockHours ?? 0,
  maxConsec: subject.maxConsec ?? null,
  locationId: subject.locationId ?? null,
  requiredTeacherCount: subject.requiredTeacherCount ?? 1,
  assignedClassIds: subject.assignedClassIds ?? [],
  pinnedTeacherByClassroom: subject.pinnedTeacherByClassroom ?? {},
});

const toCatalogFixedAssignment = (assignment: FixedAssignment): CatalogFixedAssignment => ({
  id: assignment.id,
  classroomId: assignment.classroomId,
  subjectId: assignment.subjectId,
  dayIndex: assignment.dayIndex,
  hourIndex: assignment.hourIndex,
});

const toCatalogLessonGroup = (group: LessonGroup): CatalogLessonGroup => ({
  id: group.id,
  name: group.name,
  subjectId: group.subjectId,
  classroomIds: group.classroomIds ?? [],
  weeklyHours: group.weeklyHours,
  isBlock: group.isBlock ?? false,
});

const toCatalogDuty = (duty: Duty): CatalogDuty => ({
  id: duty.id,
  teacherId: duty.teacherId,
  name: duty.name,
  dayIndex: duty.dayIndex,
  hourIndex: duty.hourIndex,
});

const defaultSchoolHours = (): SchoolHours => ({
  Ortaokul: [8, 8, 8, 8, 8],
  Lise: [8, 8, 8, 8, 8],
});

export type CatalogFetchResult = {
  data: TimetableData;
  schoolHours: SchoolHours;
};

const parseSchoolHours = (raw: Record<string, number[]> | undefined | null): SchoolHours => {
  const defaults = defaultSchoolHours();
  if (!raw) {
    return defaults;
  }
  return {
    Ortaokul: Array.isArray(raw.Ortaokul) && raw.Ortaokul.length === 5 ? raw.Ortaokul.map(Number) : defaults.Ortaokul,
    Lise: Array.isArray(raw.Lise) && raw.Lise.length === 5 ? raw.Lise.map(Number) : defaults.Lise,
  };
};

export async function fetchCatalog(token: string, schoolId: number): Promise<CatalogFetchResult> {
  const response = await fetch(`${API_BASE}/api/catalog/${schoolId}/export`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Katalog verisi okunamadı');
  }
  const body = (await response.json()) as CatalogExportResponse;
  const data: TimetableData = {
    teachers: (body.teachers ?? []).map(toTeacher),
    classrooms: (body.classrooms ?? []).map(toClassroom),
    locations: (body.locations ?? []).map(toLocation),
    subjects: (body.subjects ?? []).map(toSubject),
    fixedAssignments: (body.fixedAssignments ?? []).map(toFixedAssignment),
    lessonGroups: (body.lessonGroups ?? []).map(toLessonGroup),
    duties: (body.duties ?? []).map(toDuty),
  };
  const schoolHours = parseSchoolHours(body.settings?.schoolHours);
  return { data, schoolHours };
}

export async function replaceCatalog(
  token: string,
  schoolId: number,
  data: TimetableData,
): Promise<void> {
  const payload: CatalogReplacePayload = {
    teachers: data.teachers.map(toCatalogTeacher),
    classrooms: data.classrooms.map(toCatalogClassroom),
    locations: data.locations.map(toCatalogLocation),
    subjects: data.subjects.map(toCatalogSubject),
    fixedAssignments: data.fixedAssignments.map(toCatalogFixedAssignment),
    lessonGroups: data.lessonGroups.map(toCatalogLessonGroup),
    duties: data.duties.map(toCatalogDuty),
  };
  const response = await fetch(`${API_BASE}/api/catalog/${schoolId}/replace`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Katalog kaydedilemedi');
  }
}

export async function updateSchoolSettings(
  token: string,
  schoolId: number,
  settings: SchoolHours,
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/catalog/${schoolId}/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      schoolHours: settings,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Okul ayarları güncellenemedi');
  }
}
