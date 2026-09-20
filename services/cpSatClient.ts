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
  const res = await fetch(`${BASE_URL}/solve/cpsat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...identityHeaders() },
    body: JSON.stringify({ data, schoolHours, timeLimitSeconds, defaults, preferences, stopAtFirst, diagnose, followUp })
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`CP-SAT servis hatası: ${res.status} ${txt}`);
  }
  const json = await res.json();
  return json as SolveResult;
}

export type SolveQuota = { hourlyLeft: number; hourlyLimit: number; dailyLeft: number; dailyLimit: number };

/** Kalan sunucu deneme hakkı. Ulaşılamazsa null döner; gösterim isteğe bağlıdır. */
export async function fetchSolveQuota(): Promise<SolveQuota | null> {
  try {
    const res = await fetch(`${BASE_URL}/solve/quota`, { headers: identityHeaders() });
    if (!res.ok) return null;
    const json = await res.json();
    return typeof json?.dailyLeft === 'number' && typeof json?.hourlyLeft === 'number' ? (json as SolveQuota) : null;
  } catch {
    return null;
  }
}
