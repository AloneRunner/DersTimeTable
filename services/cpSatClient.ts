import type { TimetableData, SchoolHours, SolveResult } from '../types';

const META: any = import.meta as any;
const BASE_URL = META.env?.VITE_CP_SOLVER_URL ?? META.env?.VITE_CP_SAT_BASE_URL ?? 'http://localhost:8000';

export async function solveTimetableCP(
  data: TimetableData,
  schoolHours: SchoolHours,
  timeLimitSeconds: number,
  defaults?: { maxConsec?: number },
  preferences?: { edgeWeight?: number; nogapWeight?: number },
  stopAtFirst?: boolean,
): Promise<SolveResult> {
  const res = await fetch(`${BASE_URL}/solve/cpsat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, schoolHours, timeLimitSeconds, defaults, preferences, stopAtFirst })
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`CP-SAT servis hatası: ${res.status} ${txt}`);
  }
  const json = await res.json();
  return json as SolveResult;
}
