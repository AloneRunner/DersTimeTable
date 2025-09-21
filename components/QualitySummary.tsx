import React, { useMemo } from 'react';
import type { TimetableData, Schedule, SchoolHours } from '../types';

type Props = {
  data: TimetableData;
  schedule: Schedule | null;
  schoolHours: SchoolHours;
  gapThreshold?: number; // e.g., 2 means count gaps > 2
};

export const QualitySummary: React.FC<Props> = ({ data, schedule, schoolHours, gapThreshold = 2 }) => {
  const metrics = useMemo(() => {
    if (!schedule) return null;

    const days = 5;
    const dayMax: number[] = [0, 0, 0, 0, 0];
    for (const cid of Object.keys(schedule)) {
      const per = schedule[cid];
      for (let d = 0; d < days; d++) {
        const len = per[d]?.length ?? 0;
        if (len > dayMax[d]) dayMax[d] = len;
      }
    }

    const teacherIds = new Set<string>();
    for (const t of data.teachers) teacherIds.add(t.id);

    // Build occupancy per teacher/day/hour
    const occ: Record<string, boolean[][]> = {};
    for (const tid of teacherIds) {
      occ[tid] = Array.from({ length: days }, (_, d) => Array.from({ length: dayMax[d] }, () => false));
    }
    for (const cid of Object.keys(schedule)) {
      const per = schedule[cid];
      for (let d = 0; d < days; d++) {
        const arr = per[d] || [];
        for (let h = 0; h < arr.length; h++) {
          const a = arr[h] as any;
          const tid = a?.teacherId as string | undefined;
          if (tid && occ[tid]) occ[tid][d][h] = true;
        }
      }
    }

    let teachersActive = 0;
    let firstUses = 0;
    let lastUses = 0;
    let daysWithLongGap = 0;
    let teacherMaxGapSum = 0;
    let teacherCountWithAny = 0;

    for (const t of data.teachers) {
      const tid = t.id;
      if (!occ[tid]) continue;
      let anyDay = 0;
      let maxGapThisTeacher = 0;
      let longGapDaysThisTeacher = 0;
      for (let d = 0; d < days; d++) {
        const row = occ[tid][d] || [];
        if (!row.length) continue;
        const used = row.some(Boolean);
        if (!used) continue;
        anyDay++;
        if (row[0]) firstUses++;
        if (row[row.length - 1]) lastUses++;
        const idx: number[] = [];
        for (let h = 0; h < row.length; h++) if (row[h]) idx.push(h);
        if (idx.length > 1) {
          const gaps: number[] = [];
          for (let k = 1; k < idx.length; k++) gaps.push(idx[k] - idx[k - 1] - 1);
          const mx = gaps.reduce((m, v) => (v > m ? v : m), 0);
          if (mx > maxGapThisTeacher) maxGapThisTeacher = mx;
          if (gaps.some((g) => g > gapThreshold)) longGapDaysThisTeacher++;
        }
      }
      if (anyDay > 0) {
        teacherCountWithAny++;
        teacherMaxGapSum += maxGapThisTeacher;
        if (longGapDaysThisTeacher > 0) daysWithLongGap += longGapDaysThisTeacher;
      }
    }

    const activeDays = (() => {
      // Total number of active teacher-days (for edge rate denominator)
      let total = 0;
      for (const t of data.teachers) {
        const tid = t.id;
        for (let d = 0; d < days; d++) {
          const row = occ[tid]?.[d] || [];
          if (row.some(Boolean)) total++;
        }
      }
      return total;
    })();

    const avgMaxGap = teacherCountWithAny ? teacherMaxGapSum / teacherCountWithAny : 0;
    const firstRate = activeDays ? Math.round((100 * firstUses) / activeDays) : 0;
    const lastRate = activeDays ? Math.round((100 * lastUses) / activeDays) : 0;

    return { avgMaxGap, firstRate, lastRate, daysWithLongGap };
  }, [data, schedule, schoolHours, gapThreshold]);

  if (!schedule || !metrics) return null;

  return (
    <div className="bg-white p-4 rounded-lg shadow no-print">
      <h3 className="text-sm font-semibold text-slate-700 mb-2">Kalite Özeti</h3>
      <div className="flex flex-wrap gap-4 text-sm text-slate-700">
        <div>
          <span className="font-medium">Öğretmen başına ort. max gap:</span> {metrics.avgMaxGap.toFixed(2)} saat
        </div>
        <div>
          <span className="font-medium">İlk saat kullanımı:</span> %{metrics.firstRate}
        </div>
        <div>
          <span className="font-medium">Son saat kullanımı:</span> %{metrics.lastRate}
        </div>
        <div>
          <span className="font-medium">Uzun gap günleri (&gt; {gapThreshold} saat):</span> {metrics.daysWithLongGap}
        </div>
      </div>
    </div>
  );
};

