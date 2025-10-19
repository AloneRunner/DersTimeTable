import type { Schedule, TimetableData, SubstitutionAssignment } from '../types';
import { getApiBaseUrl } from './authClient';

const API_BASE = getApiBaseUrl();

type PublishedScheduleResponse = {
  school_id: number;
  schedule: Schedule;
  data: TimetableData;
  published_at: string;
  substitution_assignments?: SubstitutionAssignment[];
  published_by?: {
    user_id?: number;
    name?: string | null;
    email?: string;
  } | null;
};

function parseJson(text: string) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error('Sunucu yanýtý JSON formatýnda deðil.');
  }
}

export async function publishSchedule(
  token: string,
  payload: {
    schoolId: number;
    schedule: Schedule;
    data: TimetableData;
    substitutionAssignments?: SubstitutionAssignment[];
  },
): Promise<PublishedScheduleResponse> {
  const response = await fetch(`${API_BASE}/api/schedules/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      school_id: payload.schoolId,
      schedule: payload.schedule,
      data: payload.data,
      substitution_assignments: payload.substitutionAssignments ?? [],
    }),
  });
  if (!response.ok) {
    const txt = await response.text();
    let detail = response.statusText;
    try {
      const parsed = JSON.parse(txt);
      detail = parsed.detail ?? detail;
    } catch {
      // ignore
    }
    throw new Error(typeof detail === 'string' ? detail : 'Program paylaþýmý baþarýsýz');
  }
  const body = await response.json();
  return body.record as PublishedScheduleResponse;
}

export async function fetchPublishedSchedule(
  token: string,
  schoolId: number,
): Promise<PublishedScheduleResponse> {
  const response = await fetch(`${API_BASE}/api/schedules/published?school_id=${encodeURIComponent(schoolId)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (response.status === 401) {
    const txt = await response.text();
    const parsed = parseJson(txt);
    const detail = parsed.detail ?? 'Oturumunuzun suresi doldu. Lutfen tekrar giris yapin.';
    const error = new Error(typeof detail === 'string' ? detail : 'Oturum dogrulanamadi');
    (error as any).code = 'unauthorized';
    throw error;
  }
  if (response.status === 404) {
    throw Object.assign(new Error('schedule-not-found'), { code: 'schedule-not-found' });
  }
  if (!response.ok) {
    const txt = await response.text();
    const parsed = parseJson(txt);
    const detail = parsed.detail ?? response.statusText;
    throw new Error(typeof detail === 'string' ? detail : 'Program okunamadý');
  }
  return (await response.json()) as PublishedScheduleResponse;
}

export type TeacherScheduleResponse = {
  school_id: number;
  teacher_id: string;
  teacher_name?: string | null;
  data: TimetableData;
  schedule: Schedule;
  published_at: string;
  max_daily_hours: number;
  substitution_assignments?: SubstitutionAssignment[];
};

export async function fetchTeacherSchedule(
  token: string,
  params: { schoolId?: number } = {},
): Promise<TeacherScheduleResponse> {
  const query = params.schoolId !== undefined ? `?school_id=${encodeURIComponent(params.schoolId)}` : '';
  const response = await fetch(`${API_BASE}/api/teacher/schedule${query}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (response.status === 404) {
    const txt = await response.text();
    const parsed = parseJson(txt);
    const detail = parsed.detail ?? 'Öðretmen baðlantýsý bulunamadý';
    throw Object.assign(new Error(detail), { code: parsed.detail });
  }
  if (!response.ok) {
    const txt = await response.text();
    const parsed = parseJson(txt);
    const detail = parsed.detail ?? response.statusText;
    throw new Error(typeof detail === 'string' ? detail : 'Öðretmen programý yüklenemedi');
  }
  return (await response.json()) as TeacherScheduleResponse;
}

