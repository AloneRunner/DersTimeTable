import type { TimetableData, SchoolHours, SolveResult } from '../types';

const META: any = import.meta as any;

// --- New debug code ---
console.log("Vite Mode:", META.env?.MODE);
console.log("Vite PROD:", META.env?.PROD);

let baseUrl = META.env?.VITE_CP_SOLVER_URL ?? META.env?.VITE_CP_SAT_BASE_URL ?? 'http://localhost:8000';

// If in production, override with the production URL
if (META.env?.MODE === 'production') {
  baseUrl = 'https://derstimetable-production.up.railway.app';
}

const BASE_URL = baseUrl;
console.log("Using base URL:", BASE_URL); // Final check

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
