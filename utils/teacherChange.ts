import type { Assignment, Schedule, SchoolHours, Teacher, TimetableData } from '../types';
import { SchoolLevel } from '../types';

/**
 * Var olan programda bir dersin öğretmenini değiştirmek.
 *
 * Neden var: dönem ortasında bir dersin öğretmeni değişiyor (atama, görevlendirme,
 * rapor) ve idareci programı yeniden oluşturmak istemiyor — yerleşim aynen
 * kalsın, sadece o dersin öğretmeni yeni kişi olsun, onun programında görünsün.
 * Bir kullanıcı tam bu sözlerle istedi (12 Kasım 2026).
 *
 * Yerleşime dokunmadığımız için gün/saat kuralları değişmez; tek kontrol, yeni
 * öğretmenin o saatlerde gerçekten boş olup olmadığı. Kurallar çözücüyle aynı:
 * müsaitlik, nöbet, başka sınıfta derste olmamak, okul kademesi, haftalık üst sınır.
 */

export type TeacherChangeScope = 'all' | 'single';

export type TeacherChangeTarget = {
  classroomId: string;
  dayIndex: number;
  hourIndex: number;
};

export type SlotRef = { dayIndex: number; hourIndex: number };

export type CandidateReport = {
  teacher: Teacher;
  /** Boşsa öğretmen bu saatlerin hepsinde uygun. */
  conflicts: string[];
  /** Branşı dersle eşleşiyor mu; eşleşmemesi engel değil, sadece bilgi. */
  branchMatches: boolean;
};

type Ctx = { data: TimetableData; schoolHours: SchoolHours };

const DAY_NAMES = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma'];

export const slotLabel = (s: SlotRef): string => `${DAY_NAMES[s.dayIndex] ?? `${s.dayIndex + 1}. gün`} ${s.hourIndex + 1}. saat`;

const normalize = (s: string): string => s.trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');

/**
 * Değişecek hücreler. `all`: sınıfta aynı dersin, aynı öğretmen kadrosuyla
 * verilen bütün saatleri (dönem ortası öğretmen değişikliğinin doğal kapsamı).
 * `single`: yalnız tıklanan saat.
 */
export const changeSlots = (schedule: Schedule, target: TeacherChangeTarget, scope: TeacherChangeScope): SlotRef[] => {
  const days = schedule[target.classroomId];
  const origin = days?.[target.dayIndex]?.[target.hourIndex];
  if (!days || !origin) return [];
  if (scope === 'single') return [{ dayIndex: target.dayIndex, hourIndex: target.hourIndex }];
  const key = [...origin.teacherIds].sort().join('|');
  const out: SlotRef[] = [];
  days.forEach((row, dayIndex) => {
    row.forEach((cell, hourIndex) => {
      if (cell && cell.subjectId === origin.subjectId && [...cell.teacherIds].sort().join('|') === key) {
        out.push({ dayIndex, hourIndex });
      }
    });
  });
  return out;
};

/** Öğretmenin programdaki haftalık ders saati (nöbet hariç). */
const weeklyLoad = (schedule: Schedule, teacherId: string): number => {
  let n = 0;
  for (const days of Object.values(schedule)) {
    for (const row of days) for (const cell of row) if (cell?.teacherIds.includes(teacherId)) n++;
  }
  return n;
};

/**
 * Her aday öğretmen için, verilen saatlerde neden uygun olmadığını listeler.
 * Mevcut öğretmen(ler) listeye alınmaz.
 */
export const evaluateCandidates = (
  schedule: Schedule,
  ctx: Ctx,
  target: TeacherChangeTarget,
  scope: TeacherChangeScope,
): CandidateReport[] => {
  const { data } = ctx;
  const origin = schedule[target.classroomId]?.[target.dayIndex]?.[target.hourIndex];
  if (!origin) return [];
  const slots = changeSlots(schedule, target, scope);
  const subject = data.subjects.find(s => s.id === origin.subjectId);
  const classroom = data.classrooms.find(c => c.id === target.classroomId);
  const subjectKey = subject ? normalize(subject.name) : '';
  const slotKey = new Set(slots.map(s => `${s.dayIndex}:${s.hourIndex}`));

  return data.teachers
    .filter(t => !origin.teacherIds.includes(t.id))
    .map(teacher => {
      const conflicts: string[] = [];

      if (classroom) {
        if (classroom.level === SchoolLevel.Middle && teacher.canTeachMiddleSchool === false) conflicts.push('Ortaokulda ders veremiyor (öğretmen ayarı).');
        if (classroom.level === SchoolLevel.High && teacher.canTeachHighSchool === false) conflicts.push('Lisede ders veremiyor (öğretmen ayarı).');
      }

      for (const s of slots) {
        const label = slotLabel(s);
        if (teacher.availability?.[s.dayIndex]?.[s.hourIndex] === false) conflicts.push(`${label}: müsait değil.`);
        if (data.duties.some(d => d.teacherId === teacher.id && d.dayIndex === s.dayIndex && d.hourIndex === s.hourIndex)) {
          conflicts.push(`${label}: nöbetçi.`);
        }
        for (const [otherId, days] of Object.entries(schedule)) {
          const cell = days?.[s.dayIndex]?.[s.hourIndex];
          if (!cell || !cell.teacherIds.includes(teacher.id)) continue;
          // Değişecek hücrenin kendisi değilse (ortak ders olabilir) çakışmadır.
          if (otherId === target.classroomId && slotKey.has(`${s.dayIndex}:${s.hourIndex}`)) continue;
          const name = data.classrooms.find(c => c.id === otherId)?.name ?? otherId;
          conflicts.push(`${label}: ${name} sınıfında derste.`);
        }
      }

      if (typeof teacher.maxWeeklyHours === 'number') {
        const after = weeklyLoad(schedule, teacher.id) + slots.length;
        if (after > teacher.maxWeeklyHours) {
          conflicts.push(`Haftalık üst sınırı aşılır (${after} / ${teacher.maxWeeklyHours} saat).`);
        }
      }

      const branchMatches = !!subjectKey && (teacher.branches ?? []).some(b => normalize(b) === subjectKey);
      return { teacher, conflicts, branchMatches };
    })
    .sort((a, b) => {
      // Uygun ve branşı tutanlar en üste; sonra uygun olanlar; sonra ada göre.
      const ka = (a.conflicts.length ? 2 : 0) + (a.branchMatches ? 0 : 1);
      const kb = (b.conflicts.length ? 2 : 0) + (b.branchMatches ? 0 : 1);
      return ka - kb || a.teacher.name.localeCompare(b.teacher.name, 'tr-TR');
    });
};

/**
 * Değişikliği uygular: verilen saatlerde `replacedTeacherId` yerine
 * `newTeacherId` yazılı yeni bir program döndürür. Çakışma kontrolü
 * `evaluateCandidates` ile önceden yapılmış olmalı; burada yalnız kopyalama var.
 */
export const applyTeacherChange = (
  schedule: Schedule,
  target: TeacherChangeTarget,
  scope: TeacherChangeScope,
  replacedTeacherId: string,
  newTeacherId: string,
): { schedule: Schedule; slots: SlotRef[] } => {
  const slots = changeSlots(schedule, target, scope);
  const slotKey = new Set(slots.map(s => `${s.dayIndex}:${s.hourIndex}`));
  const next: Schedule = Object.fromEntries(
    Object.entries(schedule).map(([cid, days]) => [
      cid,
      days.map((row, dayIndex) =>
        row.map((cell, hourIndex): Assignment | null => {
          if (!cell || cid !== target.classroomId || !slotKey.has(`${dayIndex}:${hourIndex}`)) return cell;
          const teacherIds = cell.teacherIds.map(id => (id === replacedTeacherId ? newTeacherId : id));
          return { ...cell, teacherIds };
        }),
      ),
    ]),
  ) as Schedule;
  return { schedule: next, slots };
};
