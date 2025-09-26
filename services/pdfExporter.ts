
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Schedule, TimetableData, SchoolHours } from '../types';
import { ViewType, SchoolLevel } from '../types';

type PrintScope = 'selected' | 'classes' | 'teachers';
type ViewMode = 'single' | 'master';

type SectionRow = {
  startHour: number;
  span: number;
  hourLabel: string;
  primary: string;
  secondary?: string;
  location?: string;
  note?: string;
};

type DaySection = {
  dayLabel: string;
  rows: SectionRow[];
};

type Target = {
  id: string;
  name: string;
  kind: 'class' | 'teacher';
};

interface ExportOptions {
  schedule: Schedule;
  data: TimetableData;
  schoolHours: SchoolHours;
  maxDailyHours: number;
  mode: PrintScope;
  viewType: ViewType;
  selectedHeaderId: string | null;
  viewMode: ViewMode;
}

const DAY_LABELS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma'];

const formatHourLabel = (startHour: number, span: number): string => {
  if (span <= 1) return `${startHour}. ders`;
  const endHour = startHour + span - 1;
  return `${startHour}-${endHour}. ders`;
};

const teacherNamesForAssignment = (assignment: any, data: TimetableData): string => {
  if (!assignment || !Array.isArray(assignment.teacherIds)) return '';
  return assignment.teacherIds
    .map((id: string) => data.teachers.find((teacher) => teacher.id === id)?.name)
    .filter((name): name is string => Boolean(name))
    .join(', ');
};

const collectClassSections = (
  classroomId: string,
  schedule: Schedule,
  data: TimetableData,
  schoolHours: SchoolHours,
  maxDailyHours: number,
): DaySection[] => {
  const classroom = data.classrooms.find((c) => c.id === classroomId);
  if (!classroom) return [];

  const classDays = schedule[classroomId] ?? [];
  const dailyLimits = schoolHours[classroom.level as SchoolLevel] ?? [];

  return DAY_LABELS.map((dayLabel, dayIndex) => {
    const rows: SectionRow[] = [];
    const dayLessons = classDays[dayIndex] ?? [];
    const dayLimit = Math.max(dailyLimits[dayIndex] ?? 0, maxDailyHours);

    let hourIndex = 0;
    while (hourIndex < dayLimit) {
      const assignment = dayLessons[hourIndex];
      if (!assignment) {
        hourIndex += 1;
        continue;
      }

      let span = 1;
      while (
        hourIndex + span < dayLessons.length &&
        dayLessons[hourIndex + span] === assignment
      ) {
        span += 1;
      }

      const startHour = hourIndex + 1;
      const subjectName = data.subjects.find((subject) => subject.id === assignment.subjectId)?.name ?? 'Ders';
      const teacherNames = teacherNamesForAssignment(assignment, data);
      const locationName = assignment.locationId
        ? data.locations.find((location) => location.id === assignment.locationId)?.name
        : undefined;

      rows.push({
        startHour,
        span,
        hourLabel: formatHourLabel(startHour, span),
        primary: subjectName,
        secondary: teacherNames || undefined,
        location: locationName,
      });

      hourIndex += span;
    }

    if (rows.length === 0) {
      rows.push({
        startHour: 0,
        span: 0,
        hourLabel: '-',
        primary: 'Ders yok',
        note: 'Bu gün için atanan ders bulunmuyor.',
      });
    }

    rows.sort((a, b) => a.startHour - b.startHour);
    return { dayLabel, rows };
  });
};

const collectTeacherSections = (
  teacherId: string,
  schedule: Schedule,
  data: TimetableData,
  maxDailyHours: number,
): DaySection[] => {
  const teacher = data.teachers.find((t) => t.id === teacherId);
  if (!teacher) return [];

  const processedAssignments = new WeakMap<object, Set<string>>();
  const limit = Number.isFinite(maxDailyHours) && maxDailyHours > 0 ? maxDailyHours : 12;

  return DAY_LABELS.map((dayLabel, dayIndex) => {
    const rows: SectionRow[] = [];

    for (const [classroomId, classroomDays] of Object.entries(schedule)) {
      const daySchedule = classroomDays?.[dayIndex] ?? [];
      let hourIndex = 0;

      while (hourIndex < limit && hourIndex < daySchedule.length) {
        const assignment = daySchedule[hourIndex];
        if (
          !assignment ||
          !Array.isArray(assignment.teacherIds) ||
          !assignment.teacherIds.includes(teacherId)
        ) {
          hourIndex += 1;
          continue;
        }

        const processedForTeacher = processedAssignments.get(assignment) ?? new Set<string>();
        if (processedForTeacher.has(teacherId)) {
          hourIndex += 1;
          continue;
        }

        let span = 1;
        while (
          hourIndex + span < daySchedule.length &&
          daySchedule[hourIndex + span] === assignment
        ) {
          span += 1;
        }

        processedForTeacher.add(teacherId);
        processedAssignments.set(assignment, processedForTeacher);

        const startHour = hourIndex + 1;
        const subjectName = data.subjects.find((subject) => subject.id === assignment.subjectId)?.name ?? 'Ders';
        const classroomName = data.classrooms.find((c) => c.id === (assignment.classroomId ?? classroomId))?.name ?? 'Sınıf';
        const locationName = assignment.locationId
          ? data.locations.find((location) => location.id === assignment.locationId)?.name
          : undefined;
        const coTeachers = assignment.teacherIds
          .filter((id: string) => id !== teacherId)
          .map((id: string) => data.teachers.find((t) => t.id === id)?.name)
          .filter((name): name is string => Boolean(name))
          .join(', ');

        rows.push({
          startHour,
          span,
          hourLabel: formatHourLabel(startHour, span),
          primary: subjectName,
          secondary: classroomName,
          location: locationName,
          note: coTeachers ? `Diğer öğretmenler: ${coTeachers}` : undefined,
        });

        hourIndex += span;
      }
    }

    data.duties
      .filter((duty) => duty.teacherId === teacherId && duty.dayIndex === dayIndex)
      .forEach((duty) => {
        const span = (duty as any).span ?? 1;
        const locationName = (duty as any).locationId
          ? data.locations.find((location) => location.id === (duty as any).locationId)?.name
          : undefined;
        const note = (duty as any).note ?? undefined;

        rows.push({
          startHour: duty.hourIndex + 1,
          span,
          hourLabel: formatHourLabel(duty.hourIndex + 1, span),
          primary: duty.name,
          secondary: locationName ?? 'Nöbet',
          note,
        });
      });

    if (rows.length === 0) {
      rows.push({
        startHour: 0,
        span: 0,
        hourLabel: '-',
        primary: 'Ders yok',
        note: 'Bu gün için ders veya görev bulunmuyor.',
      });
    }

    rows.sort((a, b) => a.startHour - b.startHour);
    return { dayLabel, rows };
  });
};

const resolveTargets = (options: ExportOptions): Target[] => {
  const { mode, data, viewType, selectedHeaderId, viewMode } = options;

  if (mode === 'selected') {
    if (viewMode !== 'single') {
      throw new Error('PDF almak için önce "Sade görünüm" moduna geçin.');
    }
    if (!selectedHeaderId) {
      throw new Error('Lütfen listeden bir kayıt seçin.');
    }
    if (viewType === ViewType.Class) {
      const classroom = data.classrooms.find((c) => c.id === selectedHeaderId);
      if (!classroom) {
        throw new Error('Seçili sınıf bulunamadı.');
      }
      return [{ id: classroom.id, name: classroom.name, kind: 'class' }];
    }
    const teacher = data.teachers.find((t) => t.id === selectedHeaderId);
    if (!teacher) {
      throw new Error('Seçili öğretmen bulunamadı.');
    }
    return [{ id: teacher.id, name: teacher.name, kind: 'teacher' }];
  }

  if (mode === 'classes') {
    if (data.classrooms.length === 0) {
      throw new Error('Tanımlı sınıf bulunmuyor.');
    }
    return data.classrooms.map((classroom) => ({ id: classroom.id, name: classroom.name, kind: 'class' as const }));
  }

  if (data.teachers.length === 0) {
    throw new Error('Tanımlı öğretmen bulunmuyor.');
  }
  return data.teachers.map((teacher) => ({ id: teacher.id, name: teacher.name, kind: 'teacher' as const }));
};

const makeFileName = (mode: PrintScope) => {
  const today = new Date();
  const iso = today.toISOString().split('T')[0];
  const suffix = mode === 'selected' ? 'secili' : mode === 'classes' ? 'siniflar' : 'ogretmenler';
  return `ders-programi-${suffix}-${iso}.pdf`;
};

export const buildSchedulePdf = (options: ExportOptions) => {
  const { schedule, data, schoolHours, maxDailyHours, mode } = options;

  const targets = resolveTargets(options);
  if (targets.length === 0) {
    throw new Error('PDF oluşturmak için uygun kayıt bulunamadı.');
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });

  targets.forEach((target, targetIndex) => {
    if (targetIndex > 0) {
      doc.addPage();
    }

    const title = target.kind === 'class' ? 'Haftalık Ders Programı' : 'Öğretmen Ders Programı';
    doc.setFontSize(16);
    doc.setTextColor(17, 24, 39);
    doc.text(title, 40, 50);

    doc.setFontSize(12);
    doc.setTextColor(55, 65, 81);
    const descriptor = target.kind === 'class' ? 'Sınıf' : 'Öğretmen';
    doc.text(`${descriptor}: ${target.name}`, 40, 70);

    const sections = target.kind === 'class'
      ? collectClassSections(target.id, schedule, data, schoolHours, maxDailyHours)
      : collectTeacherSections(target.id, schedule, data, maxDailyHours);

    let cursor = 100;

    sections.forEach((section) => {
      if (cursor > 720) {
        doc.addPage();
        cursor = 60;
      }

      doc.setFontSize(12);
      doc.setTextColor(30, 64, 175);
      doc.text(section.dayLabel, 40, cursor);
      cursor += 14;

      if (section.rows.length === 0) {
        doc.setFontSize(10);
        doc.setTextColor(75, 85, 99);
        doc.text('Bu gün için kayıt bulunamadı.', 40, cursor);
        cursor += 20;
        return;
      }

      const body = section.rows.map((row) => [
        row.hourLabel,
        row.primary,
        row.secondary ? (row.note ? `${row.secondary} (${row.note})` : row.secondary) : (row.note ?? ''),
        row.location ?? '-',
      ]);

      autoTable(doc, {
        head: [[
          'Saat',
          'Ders',
          target.kind === 'class' ? 'Öğretmen' : 'Sınıf',
          'Yer',
        ]],
        body,
        startY: cursor,
        margin: { left: 40, right: 40 },
        styles: { fontSize: 9, cellPadding: 4, textColor: 55, overflow: 'linebreak' },
        headStyles: { fillColor: [14, 116, 144], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [243, 244, 246] },
        tableWidth: 'auto',
      });

      const lastTable: any = (doc as any).lastAutoTable;
      cursor = lastTable?.finalY ? lastTable.finalY + 20 : cursor + 40;
      doc.setTextColor(55, 65, 81);
    });
  });

  const fileName = makeFileName(mode);
  return { doc, fileName };
};
