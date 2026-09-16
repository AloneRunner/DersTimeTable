import type { TimetableData, SchoolHours, SolveResult } from '../types';

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
): Promise<SolveResult> {
  const res = await fetch(`${BASE_URL}/solve/cpsat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, schoolHours, timeLimitSeconds, defaults, preferences, stopAtFirst, diagnose })
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`CP-SAT servis hatası: ${res.status} ${txt}`);
  }
  const json = await res.json();
  return json as SolveResult;
}
