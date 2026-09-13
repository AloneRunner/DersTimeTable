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

const PASSWORD_LOGIN_ERRORS: Record<string, string> = {
  'invalid-credentials': 'E-posta veya şifre hatalı.',
  'no-school-memberships': 'Bu hesaba bağlı bir okul yok.',
};

/** E-posta + şifre girişi. Yalnız admin panelinden oluşturulan inceleme hesabı içindir. */
export async function loginWithReviewPassword(email: string, password: string): Promise<SessionInfo> {
  const response = await fetch(`${API_BASE}/api/auth/login-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw await failure(response, PASSWORD_LOGIN_ERRORS, 'Giriş başarısız');
  return (await response.json()) as SessionInfo;
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
