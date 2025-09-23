import { Teacher } from '../types';

interface DayInfo {
  dayIndex: number;
  available: number;
}

/**
 * Assigns random rest days to a teacher based on their availability.
 * @param teacher - The teacher object.
 * @param restCount - Number of rest days to assign.
 * @param maxDailyHours - Maximum daily hours for the school.
 * @returns Updated availability array for the teacher.
 */
export function assignRandomRestDays(
  teacher: Teacher,
  restCount: number,
  maxDailyHours: number
): boolean {
  if (restCount <= 0) return false;

  const availability = teacher.availability.map(day => [...day]);
  const dayInfos: DayInfo[] = [];

  for (let d = 0; d < Math.min(5, availability.length); d++) {
    const row = availability[d] || [];
    const limit = maxDailyHours > 0 ? Math.min(maxDailyHours, row.length) : row.length;
    let available = 0;
    for (let h = 0; h < limit; h++) {
      if (row[h]) {
        available += 1;
      }
    }
    if (available > 0) {
      dayInfos.push({ dayIndex: d, available });
    }
  }

  if (dayInfos.length === 0 || dayInfos.length <= restCount) {
    return false;
  }

  const pool = [...dayInfos];
  const chosen: number[] = [];
  const target = Math.min(restCount, pool.length - 1);
  while (chosen.length < target && pool.length > 0) {
    const totalWeight = pool.reduce((sum, info) => sum + info.available, 0);
    let r = Math.random() * totalWeight;
    let idx = 0;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].available;
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    const [selected] = pool.splice(idx, 1);
    chosen.push(selected.dayIndex);
  }

  if (chosen.length === 0) {
    return false;
  }

  chosen.forEach(dayIndex => {
    const row = availability[dayIndex] || [];
    for (let h = 0; h < row.length; h++) {
      row[h] = false;
    }
  });

  teacher.availability = availability;
  return true;
}