import { solveTimetableLocally } from '../services/localSolver';
import type { TimetableData } from '../types';

(async () => {
  // Minimal test data: 2 teachers, 1 classroom, 1 subject that can be taught by both
  const data: TimetableData = {
    teachers: [
      { id: 't1', name: 'T1', branches: ['Math'], availability: Array.from({length:5}, ()=> Array(8).fill(true)), canTeachMiddleSchool: true, canTeachHighSchool: true },
      { id: 't2', name: 'T2', branches: ['Math'], availability: Array.from({length:5}, ()=> Array(8).fill(true)), canTeachMiddleSchool: true, canTeachHighSchool: true },
    ],
    classrooms: [ { id: 'c1', name: 'C1', level: 'Lise' as any, group: 'Yok' as any, sessionType: 'full' } ],
    subjects: [ { id: 's1', name: 'Matematik', blockHours: 0, weeklyHours: 1, assignedClassIds: ['c1'] as string[] } as any ],
    locations: [],
    fixedAssignments: [],
    lessonGroups: [],
    duties: [],
  };

  const res = await solveTimetableLocally(data, { timeLimitSeconds: 2, schoolHours: { Ortaokul: [8,8,8,8,8], Lise: [8,8,8,8,8] } as any });
  console.log('Solver finished. schedule present?', !!res.schedule);
  if (!res.schedule) { console.log('No schedule:', res.stats); process.exit(1); }

  // Inspect schedule: any assignment should have teacherIds array
  const classSched = res.schedule['c1'];
  if (!classSched) { console.error('No class schedule for c1'); process.exit(2); }
  const assn = classSched[0][0];
  console.log('First slot assignment:', assn);
  if (!assn) { console.error('No assignment placed in first slot'); process.exit(3); }
  if (!Array.isArray((assn as any).teacherIds)) { console.error('Assignment does not contain teacherIds'); process.exit(4); }

  console.log('teacherIds:', (assn as any).teacherIds);
  console.log('Smoke test OK');
})();
