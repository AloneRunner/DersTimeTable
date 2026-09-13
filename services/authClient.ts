const DEFAULT_PROD_BASE = 'https://derstimetable-production.up.railway.app';

function isNativeCapacitor(): boolean {
  if (typeof window === 'undefined') return false;
  const cap: any = (window as any).Capacitor;
  if (!cap) return false;
  if (typeof cap.isNativePlatform === 'function') {
    try {
      return cap.isNativePlatform();
    } catch {
      return Boolean(cap.isNative);
    }
  }
  if (typeof cap.getPlatform === 'function') {
    const platform = cap.getPlatform();
    return platform === 'ios' || platform === 'android';
  }
  return Boolean(cap.isNative);
}

function resolveBaseUrl(): string {
  const envBase = typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_API_BASE_URL : undefined;
  if (envBase && typeof envBase === 'string' && envBase.trim().length > 0) {
    return envBase.replace(/\/$/, '');
  }
  const runningInNative = isNativeCapacitor();
  if (!runningInNative && typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return 'http://localhost:8000';
  }
  return DEFAULT_PROD_BASE;
}

const API_BASE = resolveBaseUrl();

export type BridgeCodeRequest = {
  email: string;
  name?: string;
  schoolId?: number | null;
};

export type BridgeCodeResponse = {
  ok: boolean;
  code: string;
  token: string;
  expires_at: string;
  user: {
    id: number;
    email: string;
    name?: string | null;
    role?: string;
  };
  schools: Array<{
    id: number;
    role?: string;
    name?: string | null;
    teacher_id?: string | null;
  }>;
};

export type SessionInfo = {
  session_token?: string;
  expires_at?: string;
  user: {
    id: number;
    email: string;
    name?: string | null;
    role?: string;
  };
  schools: Array<{
    id: number;
    role?: string;
    name?: string | null;
    teacher_id?: string | null;
  }>;
  subscription?: {
    id?: number;
    provider?: string;
    status?: string;
    start_at?: string;
    expires_at?: string;
  } | null;
};

export type TeacherSessionSnapshot = {
  token: string;
  expiresAt?: string;
  user: SessionInfo['user'];
  school: {
    id: number;
    name?: string | null;
    teacherId: string;
    role?: string;
  };
};

const TEACHER_SESSION_KEY = 'ozarik.teacher.session';

export type TeacherLinkRecord = {
  school_id: number;
  teacher_id: string;
  user_id?: number | null;
  email: string;
  name?: string | null;
  linked_at?: string | null;
};

export type PasswordLoginRequest = {
  email: string;
  password: string;
  schoolId?: number | null;
};

export type ResetTeacherPasswordRequest = {
  schoolId: number;
  teacherId: string;
  password?: string;
};

export type ResetTeacherPasswordResponse = {
  ok: boolean;
  password: string;
  teacher: {
    school_id: number;
    teacher_id: string;
    user_id: number;
    email?: string | null;
    name?: string | null;
  };
  reset_by: {
    id: number | null;
    email?: string | null;
    name?: string | null;
  };
};

async function parseJson(resp: Response) {
  const text = await resp.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Failed to parse response: ${text}`);
  }
}

export async function requestBridgeCode(payload: BridgeCodeRequest): Promise<BridgeCodeResponse> {
  const body: Record<string, unknown> = { email: payload.email };
  if (payload.name) {
    body.name = payload.name;
  }
  if (payload.schoolId !== undefined && payload.schoolId !== null) {
    body.school_id = payload.schoolId;
  }

  const response = await fetch(`${API_BASE}/api/auth/request-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await parseJson(response).catch(() => ({}));
    const detail = (data as any)?.detail ?? response.statusText;
    throw new Error(typeof detail === 'string' ? detail : 'Kod olusturma basarisiz');
  }
  return (await response.json()) as BridgeCodeResponse;
}

export async function verifyBridgeCode(payload: { code?: string; token?: string }): Promise<SessionInfo> {
  const response = await fetch(`${API_BASE}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data = await parseJson(response).catch(() => ({}));
    const detail = (data as any)?.detail ?? response.statusText;
    throw new Error(typeof detail === 'string' ? detail : 'Dogrulama basarisiz');
  }
  return (await response.json()) as SessionInfo;
}

export async function fetchSessionInfo(token: string): Promise<SessionInfo> {
  const response = await fetch(`${API_BASE}/api/auth/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    const data = await parseJson(response).catch(() => ({}));
    const detail = (data as any)?.detail ?? response.statusText;
    throw new Error(typeof detail === 'string' ? detail : 'Oturum dogrulanamadi');
  }
  return (await response.json()) as SessionInfo;
}

export function getApiBaseUrl(): string {
  return API_BASE;
}

export async function loginWithPassword(payload: PasswordLoginRequest): Promise<SessionInfo> {
  const response = await fetch(`${API_BASE}/api/auth/login-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: payload.email,
      password: payload.password,
      school_id: payload.schoolId ?? undefined,
    }),
  });
  if (!response.ok) {
    const data = await parseJson(response).catch(() => ({}));
    const detail = (data as any)?.detail ?? response.statusText;
    throw new Error(typeof detail === 'string' ? detail : 'Oturum açma başarısız');
  }
  return (await response.json()) as SessionInfo;
}

export async function linkTeacher(
  token: string,
  payload: { schoolId: number; teacherId: string; email: string; name?: string },
): Promise<any> {
  const response = await fetch(`${API_BASE}/api/auth/link-teacher`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      school_id: payload.schoolId,
      teacher_id: payload.teacherId,
      email: payload.email,
      name: payload.name,
    }),
  });
  if (!response.ok) {
    const data = await parseJson(response).catch(() => ({}));
    const detail = (data as any)?.detail ?? response.statusText;
    throw new Error(typeof detail === 'string' ? detail : 'Öğretmen bağlantısı kurulamadı');
  }
  return response.json();
}

export function loadTeacherSession(): TeacherSessionSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(TEACHER_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TeacherSessionSnapshot;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    if (!parsed.token || typeof parsed.token !== 'string') {
      return null;
    }
    if (!parsed.school || typeof parsed.school.id !== 'number' || !parsed.school.teacherId) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function persistTeacherSession(snapshot: TeacherSessionSnapshot | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (snapshot) {
      window.localStorage.setItem(TEACHER_SESSION_KEY, JSON.stringify(snapshot));
    } else {
      window.localStorage.removeItem(TEACHER_SESSION_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function extractTeacherMembership(session: SessionInfo): TeacherSessionSnapshot | null {
  const token = session.session_token;
  if (!token) return null;
  const teacherMembership = session.schools.find(
    (school) => (school.role ?? '').toLowerCase() === 'teacher' && school.teacher_id,
  );
  if (!teacherMembership) return null;
  return {
    token,
    expiresAt: session.expires_at ?? undefined,
    user: session.user,
    school: {
      id: Number(teacherMembership.id),
      name: teacherMembership.name,
      teacherId: teacherMembership.teacher_id!,
      role: teacherMembership.role,
    },
  };
}

export async function fetchTeacherLinks(
  token: string,
  schoolId: number,
): Promise<TeacherLinkRecord[]> {
  const response = await fetch(`${API_BASE}/api/auth/teacher-links?school_id=${encodeURIComponent(schoolId)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Öğretmen bağlantıları yüklenemedi');
  }
  const body = await response.json();
  return Array.isArray(body?.items) ? (body.items as TeacherLinkRecord[]) : [];
}

export async function unlinkTeacher(
  token: string,
  payload: { schoolId: number; teacherId: string },
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/auth/teacher-links`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      school_id: payload.schoolId,
      teacher_id: payload.teacherId,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Öğretmen bağlantısı kaldırılamadı');
  }
}

export async function resetTeacherPassword(
  token: string,
  payload: ResetTeacherPasswordRequest,
): Promise<ResetTeacherPasswordResponse> {
  const response = await fetch(`${API_BASE}/api/auth/teacher-password/reset`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      school_id: payload.schoolId,
      teacher_id: payload.teacherId,
      password: payload.password,
    }),
  });
  if (!response.ok) {
    const data = await parseJson(response).catch(() => ({}));
    const detail = (data as any)?.detail ?? response.statusText;
    throw new Error(typeof detail === 'string' ? detail : 'Şifre güncellenemedi');
  }
  return (await response.json()) as ResetTeacherPasswordResponse;
}


const GOOGLE_LOGIN_ERRORS: Record<string, string> = {
  'invalid-google-credential': 'Google girişi doğrulanamadı. Lütfen tekrar deneyin.',
  'google-email-not-verified': 'Google hesabınızın e-posta adresi doğrulanmamış.',
  'google-account-mismatch': 'Bu e-posta adresi başka bir Google hesabına bağlı. Destek: kaanozarik@gmail.com',
  'google-unreachable': 'Google şu an yanıt vermiyor. Biraz sonra tekrar deneyin.',
};

const SCHOOL_ERRORS: Record<string, string> = {
  'invalid-school-name': 'Okul adı 2 ile 120 karakter arasında olmalı.',
  'teachers-cannot-create-schools': 'Öğretmen hesapları okul oluşturamaz.',
  'too-many-schools': 'Bir hesaba en fazla 10 okul eklenebilir.',
  'invalid-session-token': 'Oturumunuzun süresi doldu. Lütfen tekrar giriş yapın.',
};

async function failure(response: Response, messages: Record<string, string>, fallback: string): Promise<Error> {
  const data = await parseJson(response).catch(() => ({}));
  const detail = (data as any)?.detail;
  if (typeof detail === 'string') return new Error(messages[detail] ?? detail);
  return new Error(fallback);
}

export async function loginWithGoogle(credential: string): Promise<SessionInfo> {
  const response = await fetch(`${API_BASE}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  });
  if (!response.ok) throw await failure(response, GOOGLE_LOGIN_ERRORS, 'Google ile giriş başarısız');
  return (await response.json()) as SessionInfo;
}

/** Oturum sahibi için okul oluşturur ve güncel oturum bilgisini döndürür. */
export async function createSchoolForSession(token: string, name: string): Promise<SessionInfo> {
  const response = await fetch(`${API_BASE}/api/auth/schools`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw await failure(response, SCHOOL_ERRORS, 'Okul kaydedilemedi');
  return (await response.json()) as SessionInfo;
}
