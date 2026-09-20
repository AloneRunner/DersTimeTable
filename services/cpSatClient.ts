import type { TimetableData, SchoolHours, SolveResult } from '../types';
import { getDeviceId } from './usageClient';

const SESSION_KEY = 'ozarik.session';

// Sunucu kişi başına kota tutuyor (server/solve_quota.py). Kimlik: oturum varsa
// hesap, yoksa cihaz kimliği. Okul/öğretmen verisi dışında ek bir şey gönderilmez.
const identityHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {};
  try {
    headers['X-Device-Id'] = getDeviceId();
    const token = window.localStorage.getItem(SESSION_KEY);
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    // Depolama kapalıysa sunucu IP'ye göre sayar.
  }
  return headers;
};

// LAST RESORT: Hardcode the production URL directly.
const BASE_URL = 'https://derstimetable-production.up.railway.app';

// Süren çözüm isteğinin kimliği: beklerken sunucuya "sırada mıyım?" diye sorabilmek için.
let activeRequestId: string | null = null;

const newRequestId = (): string => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // aşağıdaki yedeğe düş
  }
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

export type SolveServerStatus = { capacity: number; running: number; waiting: number; queueWaitSeconds: number; you: 'waiting' | 'running' | 'unknown' };

/** Süren isteğin sunucudaki durumu. İstek yoksa ya da sunucuya ulaşılamazsa null. */
export async function fetchSolveStatus(): Promise<SolveServerStatus | null> {
  if (!activeRequestId) return null;
  try {
    const res = await fetch(`${BASE_URL}/solve/status?id=${encodeURIComponent(activeRequestId)}`);
    if (!res.ok) return null;
    const json = await res.json();
    return typeof json?.capacity === 'number' ? (json as SolveServerStatus) : null;
  } catch {
    return null;
  }
}

export async function solveTimetableCP(
  data: TimetableData,
  schoolHours: SchoolHours,
  timeLimitSeconds: number,
  defaults?: { maxConsec?: number },
  preferences?: { edgeWeight?: number; nogapWeight?: number },
  stopAtFirst?: boolean,
  // Çözüm çıkmazsa sunucu sebebini arasın mı. Yalnızca SON denemede true
  // gönderilir; blok esnetmeli ikinci deneme varsa teşhis orada çalışır.
  diagnose?: boolean,
  // Aynı tıklamanın ikinci (blok esnetmeli) isteği; kotada ayrı deneme sayılmaz.
  followUp?: boolean,
): Promise<SolveResult> {
  const requestId = newRequestId();
  activeRequestId = requestId;
  const res = await fetch(`${BASE_URL}/solve/cpsat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Solve-Request-Id': requestId, ...identityHeaders() },
    body: JSON.stringify({ data, schoolHours, timeLimitSeconds, defaults, preferences, stopAtFirst, diagnose, followUp })
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`CP-SAT servis hatası: ${res.status} ${txt}`);
  }
  const json = await res.json();
  return json as SolveResult;
}

export type SolveQuota = {
  /** Temel bütçeden kalan sunucu çözücü süresi (saniye). */
  secondsLeft: number;
  /** Yöneticinin verdiği ek süre (saniye). */
  bonusSeconds: number;
  starterSeconds: number;
  monthlySeconds: number;
  /** Bütçeden muaf hesap (uygulama sahibi, mağaza inceleme hesabı). */
  exempt?: boolean;
};

/** Limit artışı isteğini yöneticiye iletir. Hesapsız/kimliksiz istekte false döner. */
export async function requestQuotaIncrease(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/solve/quota/request`, { method: 'POST', headers: identityHeaders() });
    if (!res.ok) return false;
    const json = await res.json();
    return Boolean(json?.ok);
  } catch {
    return false;
  }
}

/** Kalan sunucu deneme hakkı. Ulaşılamazsa null döner; gösterim isteğe bağlıdır. */
export async function fetchSolveQuota(): Promise<SolveQuota | null> {
  try {
    const res = await fetch(`${BASE_URL}/solve/quota`, { headers: identityHeaders() });
    if (!res.ok) return null;
    const json = await res.json();
    return typeof json?.secondsLeft === 'number' ? (json as SolveQuota) : null;
  } catch {
    return null;
  }
}
