import type { Assignment, Classroom, Schedule, SchoolHours, Subject, TimetableData } from '../types';

/**
 * Elle sürükle-bırak için hamle doğrulama ve uygulama.
 *
 * Çözücülerin uyguladığı kuralların aynısını kullanır: sınıfın ders saati
 * penceresi, sabit (kilitli) dersler, öğretmen müsaitliği / nöbeti / başka
 * sınıfta derste olması, mekan doluluğu, ardışık saat sınırı, dersin gün
 * içinde bölünmemesi ve "aynı güne gelmesin" eşleşmeleri.
 *
 * Bloklar nesne kimliğiyle değil içerikle tanınır: yan yana duran ve aynı
 * ders + aynı öğretmenlere ait hücreler tek blok sayılır. Sunucudan gelen
 * program JSON olduğu için kimlik paylaşımı zaten yoktur.
 */

export type MoveSource = { classroomId: string; dayIndex: number; hourIndex: number };
export type MoveTarget = { classroomId: string; dayIndex: number; hourIndex: number };

export type MovePlan =
  | { ok: true; schedule: Schedule; swapped: boolean }
  | { ok: false; reason: string };

type Ctx = {
  data: TimetableData;
  schoolHours: SchoolHours;
  defaultMaxConsec?: number;
};

const sameTeachers = (a: string[] | undefined, b: string[] | undefined): boolean => {
  const x = [...(a ?? [])].sort();
  const y = [...(b ?? [])].sort();
  return x.length === y.length && x.every((id, i) => id === y[i]);
};

export const sameLesson = (a: Assignment | null | undefined, b: Assignment | null | undefined): boolean =>
  !!a && !!b && a.subjectId === b.subjectId && a.classroomId === b.classroomId && sameTeachers(a.teacherIds, b.teacherIds);

/** Verilen hücrenin ait olduğu bloğun başlangıcı ve uzunluğu. */
export const getBlockAt = (schedule: Schedule, classroomId: string, day: number, hour: number): { start: number; span: number } => {
  const row = schedule[classroomId]?.[day];
  const a = row?.[hour];
  if (!row || !a) return { start: hour, span: 1 };
  let start = hour;
  while (start > 0 && sameLesson(row[start - 1], a)) start--;
  let end = hour;
  while (end + 1 < row.length && sameLesson(row[end + 1], a)) end++;
  return { start, span: end - start + 1 };
};

export const allowedWindow = (classroom: Classroom, schoolHours: SchoolHours, day: number): { start: number; end: number } => {
  const daily = (schoolHours[classroom.level] || [])[day] || 0;
  const split = Math.floor(daily / 2);
  switch (classroom.sessionType || 'full') {
    case 'morning': return { start: 0, end: split };
    case 'afternoon': return { start: split, end: daily };
    default: return { start: 0, end: daily };
  }
};

const runLimitFor = (subject: Subject, classroom: Classroom, defaultMaxConsec?: number): number => {
  if (typeof subject.maxConsec === 'number') return subject.maxConsec;
  const fallback = defaultMaxConsec || (classroom.level === 'Lise' ? 3 : 2);
  if ((subject.tripleBlockHours ?? 0) >= 3) return 3;
  if ((subject.blockHours ?? 0) >= 2) return Math.max(2, fallback);
  return fallback;
};

/** Hücre hücre kopya. Bloklar içerikle tanındığı için kimlik paylaşımı gerekmez. */
const cloneSchedule = (schedule: Schedule): Schedule =>
  Object.fromEntries(
    Object.entries(schedule).map(([cid, days]) => [cid, days.map(row => row.map(a => (a ? { ...a } : null)))]),
  ) as Schedule;

const clearBlock = (grid: Schedule, classroomId: string, day: number, start: number, span: number) => {
  for (let k = 0; k < span; k++) grid[classroomId][day][start + k] = null;
};

const placeBlock = (grid: Schedule, classroomId: string, day: number, start: number, span: number, a: Assignment) => {
  for (let k = 0; k < span; k++) grid[classroomId][day][start + k] = { ...a };
};

const isFixedSlot = (data: TimetableData, classroomId: string, day: number, hour: number, subjectId?: string): boolean =>
  data.fixedAssignments.some(f =>
    f.classroomId === classroomId && f.dayIndex === day && f.hourIndex === hour && (subjectId === undefined || f.subjectId === subjectId),
  );

/**
 * `grid` içinde (taşınan dersler çıkarılmış hali) `a`'yı verilen konuma `span`
 * saat yerleştirmenin geçerli olup olmadığını döndürür; geçersizse nedeni.
 */
const validatePlacement = (ctx: Ctx, grid: Schedule, classroomId: string, day: number, start: number, span: number, a: Assignment): string | null => {
  const { data, schoolHours } = ctx;
  const classroom = data.classrooms.find(c => c.id === classroomId);
  const subject = data.subjects.find(s => s.id === a.subjectId);
  if (!classroom) return 'Sınıf bulunamadı.';
  if (!subject) return 'Ders tanımı bulunamadı.';

  const win = allowedWindow(classroom, schoolHours, day);
  if (start < win.start || start + span > win.end) {
    return `${classroom.name} için bu saat ders saatleri dışında.`;
  }

  const teachers = (a.teacherIds ?? [])
    .map(id => data.teachers.find(t => t.id === id))
    .filter(Boolean) as TimetableData['teachers'];
  if (teachers.length === 0) return 'Dersin öğretmeni bulunamadı.';

  for (let k = 0; k < span; k++) {
    const h = start + k;
    const hourLabel = `${h + 1}. saat`;
    if (isFixedSlot(data, classroomId, day, h)) return `${hourLabel}te sabit (kilitli) ders var.`;
    if (grid[classroomId][day][h]) return `${hourLabel} dolu.`;

    for (const t of teachers) {
      if (!t.availability?.[day]?.[h]) return `${t.name} ${hourLabel}te müsait değil.`;
      if (data.duties.some(d => d.teacherId === t.id && d.dayIndex === day && d.hourIndex === h)) {
        return `${t.name} ${hourLabel}te nöbetçi.`;
      }
      for (const otherId of Object.keys(grid)) {
        if (otherId === classroomId) continue;
        const other = grid[otherId]?.[day]?.[h];
        if (other && (other.teacherIds ?? []).includes(t.id)) {
          const otherName = data.classrooms.find(c => c.id === otherId)?.name ?? otherId;
          return `${t.name} ${hourLabel}te ${otherName} sınıfında derste.`;
        }
      }
    }

    if (subject.locationId) {
      for (const otherId of Object.keys(grid)) {
        if (otherId === classroomId) continue;
        const other = grid[otherId]?.[day]?.[h];
        if (other && other.locationId === subject.locationId) {
          const locName = data.locations.find(l => l.id === subject.locationId)?.name ?? 'Mekan';
          return `${locName} ${hourLabel}te dolu.`;
        }
      }
    }
  }

  // Ardışık saat sınırı: sol ve sağdaki aynı-ders koşuları + bu blok
  const row = grid[classroomId][day];
  let left = 0;
  for (let i = start - 1; i >= win.start; i--) { if (row[i]?.subjectId === subject.id) left++; else break; }
  let right = 0;
  for (let i = start + span; i < win.end; i++) { if (row[i]?.subjectId === subject.id) right++; else break; }
  const limit = runLimitFor(subject, classroom, ctx.defaultMaxConsec);
  if (left + span + right > limit) return `${subject.name} için ardışık saat sınırı (${limit}) aşılıyor.`;

  // Gün içinde bölünme: mevcut aynı-ders saatleri bu bloğa bitişik olmalı
  let minH = -1;
  let maxH = -1;
  for (let i = 0; i < row.length; i++) {
    if (row[i]?.subjectId === subject.id) { if (minH < 0) minH = i; maxH = i; }
  }
  if (minH >= 0 && !(maxH === start - 1 || minH === start + span)) {
    return `${subject.name} aynı gün içinde bölünmüş olurdu (araya başka ders giriyor).`;
  }

  // "Aynı güne gelmesin" eşleşmeleri (simetrik)
  const partners = new Set<string>(subject.notSameDayWith ?? []);
  for (const s of data.subjects) if (s.notSameDayWith?.includes(subject.id)) partners.add(s.id);
  for (let i = 0; i < row.length; i++) {
    const sid = row[i]?.subjectId;
    if (sid && partners.has(sid)) {
      const partnerName = data.subjects.find(s => s.id === sid)?.name ?? sid;
      return `${subject.name}, ${partnerName} ile aynı güne gelmemeli (ders ayarı).`;
    }
  }

  return null;
};

/**
 * Bir hamleyi planlar. Hedef boşsa taşır; hedefte başka ders varsa iki bloğu
 * takas eder. Geçersizse nedenini döndürür ve programı değiştirmez.
 */
export const planMove = (schedule: Schedule, ctx: Ctx, source: MoveSource, target: MoveTarget): MovePlan => {
  const src = schedule[source.classroomId]?.[source.dayIndex]?.[source.hourIndex];
  if (!src) return { ok: false, reason: 'Taşınacak ders bulunamadı.' };

  if (source.classroomId !== target.classroomId) {
    return { ok: false, reason: 'Dersler yalnız kendi sınıfının sütunu içinde taşınabilir.' };
  }
  const cid = source.classroomId;

  const srcBlock = getBlockAt(schedule, cid, source.dayIndex, source.hourIndex);
  for (let k = 0; k < srcBlock.span; k++) {
    if (isFixedSlot(ctx.data, cid, source.dayIndex, srcBlock.start + k, src.subjectId)) {
      return { ok: false, reason: 'Bu ders sabit ders olarak kilitli, taşınamaz.' };
    }
  }

  const tgtCell = schedule[cid]?.[target.dayIndex]?.[target.hourIndex];
  const targetInsideSource =
    target.dayIndex === source.dayIndex &&
    target.hourIndex >= srcBlock.start &&
    target.hourIndex < srcBlock.start + srcBlock.span;
  if (targetInsideSource) return { ok: false, reason: 'Ders zaten bu saatte.' };

  const grid = cloneSchedule(schedule);
  clearBlock(grid, cid, source.dayIndex, srcBlock.start, srcBlock.span);

  if (!tgtCell) {
    const reason = validatePlacement(ctx, grid, cid, target.dayIndex, target.hourIndex, srcBlock.span, src);
    if (reason) return { ok: false, reason };
    placeBlock(grid, cid, target.dayIndex, target.hourIndex, srcBlock.span, src);
    return { ok: true, schedule: grid, swapped: false };
  }

  // Takas: hedef bloğu da çıkar, ikisini karşılıklı yerleştir
  const tgtBlock = getBlockAt(schedule, cid, target.dayIndex, target.hourIndex);
  clearBlock(grid, cid, target.dayIndex, tgtBlock.start, tgtBlock.span);

  const reasonA = validatePlacement(ctx, grid, cid, target.dayIndex, tgtBlock.start, srcBlock.span, src);
  if (reasonA) return { ok: false, reason: reasonA };
  placeBlock(grid, cid, target.dayIndex, tgtBlock.start, srcBlock.span, src);

  const reasonB = validatePlacement(ctx, grid, cid, source.dayIndex, srcBlock.start, tgtBlock.span, tgtCell);
  if (reasonB) {
    const tgtName = ctx.data.subjects.find(s => s.id === tgtCell.subjectId)?.name ?? 'Diğer ders';
    return { ok: false, reason: `Takas olmuyor — ${tgtName} eski yerine taşınamıyor: ${reasonB}` };
  }
  placeBlock(grid, cid, source.dayIndex, srcBlock.start, tgtBlock.span, tgtCell);

  return { ok: true, schedule: grid, swapped: true };
};
