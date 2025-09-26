const DEFAULT_PROD_BASE = 'https://derstimetable-production.up.railway.app';

function resolveBaseUrl(): string {
  const envBase = typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_API_BASE_URL : undefined;
  if (envBase && typeof envBase === 'string' && envBase.trim().length > 0) {
    return envBase.replace(/\/$/, '');
  }
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
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
  } catch (err) {
    throw new Error(`Sunucu yanýtý çözülemedi: ${text}`);
  }
}

export async function requestBridgeCode(payload: BridgeCodeRequest): Promise<BridgeCodeResponse> {
  const response = await fetch(`${API_BASE}/api/auth/request-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data = await parseJson(response).catch(() => ({}));
    const detail = (data && data.detail) ? data.detail : response.statusText;
    throw new Error(typeof detail === 'string' ? detail : 'Kod oluþturma baþarýsýz');
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
    const detail = (data && data.detail) ? data.detail : response.statusText;
    throw new Error(typeof detail === 'string' ? detail : 'Doðrulama baþarýsýz');
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
    const detail = (data && data.detail) ? data.detail : response.statusText;
    throw new Error(typeof detail === 'string' ? detail : 'Oturum doðrulanamadý');
  }
  return (await response.json()) as SessionInfo;
}

export function getApiBaseUrl(): string {
  return API_BASE;
}
