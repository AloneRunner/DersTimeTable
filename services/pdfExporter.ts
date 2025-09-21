import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Schedule, TimetableData, SchoolHours } from '../types';
import { ViewType, SchoolLevel } from '../types';

type PrintScope = 'selected' | 'classes' | 'teachers';

type ViewMode = 'single' | 'master';

type SectionRow = {
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

const DAYS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma'];

const hourLabel = (hourIndex: number) => `${hourIndex + 1}. Ders`;

const buildClassSections = (
  classroomId: string,
  schedule: Schedule,
  data: TimetableData,
  schoolHours: SchoolHours,
  maxDailyHours: number
): DaySection[] => {
  const classroom = data.classrooms.find(c => c.id === classroomId);
  if (!classroom) return [];

  const classDays = schedule[classroomId] ?? [];
  const dailyLimits = schoolHours[classroom.level as SchoolLevel] ?? [];

  return DAYS.map((dayLabel, dayIndex) => {
    const rows: SectionRow[] = [];
    const dayLessons = classDays[dayIndex] ?? [];
    const baseCount = Math.max(dayLessons.length, dailyLimits[dayIndex] ?? 0);
    const limit = baseCount > 0 ? baseCount : Math.max(maxDailyHours, 1);

    for (let hourIndex = 0; hourIndex < limit; hourIndex++) {
      const assignment = dayLessons[hourIndex];
      if (!assignment) {
        rows.push({ hourLabel: hourLabel(hourIndex), primary: '-', secondary: undefined, location: undefined });
        continue;
      }

      const subject = data.subjects.find(s => s.id === assignment.subjectId);
      const teacher = data.teachers.find(t => t.id === assignment.teacherId);
      const location = assignment.locationId ? data.locations.find(l => l.id === assignment.locationId) : undefined;

      rows.push({
        hourLabel: hourLabel(hourIndex),
        primary: subject?.name ?? 'Ders',
        secondary: teacher?.name ?? undefined,
        location: location?.name ?? undefined,
      });
    }

    return { dayLabel, rows };
  });
};

const buildTeacherSections = (
  teacherId: string,
  schedule: Schedule,
  data: TimetableData,
  maxDailyHours: number
): DaySection[] => {
  const teacher = data.teachers.find(t => t.id === teacherId);
  if (!teacher) return [];

  const limit = Number.isFinite(maxDailyHours) && maxDailyHours > 0 ? maxDailyHours : 12;

  return DAYS.map((dayLabel, dayIndex) => {
    const rows: SectionRow[] = [];

    for (let hourIndex = 0; hourIndex < limit; hourIndex++) {
      let assignmentRow: SectionRow | null = null;

      for (const [classroomId, days] of Object.entries(schedule)) {
        const slot = days?.[dayIndex]?.[hourIndex] ?? null;
        if (slot && slot.teacherId === teacherId) {
          const subject = data.subjects.find(s => s.id === slot.subjectId);
          const classroom = data.classrooms.find(c => c.id === slot.classroomId);
          const location = slot.locationId ? data.locations.find(l => l.id === slot.locationId) : undefined;

          assignmentRow = {
            hourLabel: hourLabel(hourIndex),
            primary: subject?.name ?? 'Ders',
            secondary: classroom?.name,
            location: location?.name,
          };
          break;
        }
      }

      const duty = data.duties.find(d => d.teacherId === teacherId && d.dayIndex === dayIndex && d.hourIndex === hourIndex);
      if (duty) {
        if (assignmentRow) { // Duty and lesson at the same time?
            assignmentRow.note = (assignmentRow.note ? assignmentRow.note + ', ' : '') + duty.name;
        } else {
            assignmentRow = {
                hourLabel: hourLabel(hourIndex),
                primary: duty.name,
                secondary: 'Nöbet',
                note: 'Görev',
            };
        }
      }

      if (assignmentRow) {
        rows.push(assignmentRow);
      } else {
        rows.push({ hourLabel: hourLabel(hourIndex), primary: '-', secondary: undefined, location: undefined });
      }
    }

    return { dayLabel, rows };
  });
};

const resolveTargets = (options: ExportOptions): Target[] => {
  const { mode, data, viewType, selectedHeaderId, viewMode } = options;

  if (mode === 'selected') {
    if (viewMode !== 'single') {
      throw new Error('PDF almak için "Sade Görünüm" modunu seçin.');
    }
    if (!selectedHeaderId) {
      throw new Error('Lütfen önce listeden bir kayıt seçin.');
    }
    if (viewType === ViewType.Class) {
      const classroom = data.classrooms.find(c => c.id === selectedHeaderId);
      if (!classroom) {
        throw new Error('Seçili sınıf bulunamadı.');
      }
      return [{ id: classroom.id, name: classroom.name, kind: 'class' }];
    }
    const teacher = data.teachers.find(t => t.id === selectedHeaderId);
    if (!teacher) {
      throw new Error('Seçili öğretmen bulunamadı.');
    }
    return [{ id: teacher.id, name: teacher.name, kind: 'teacher' }];
  }

  if (mode === 'classes') {
    if (data.classrooms.length === 0) {
      throw new Error('Tanımlı sınıf bulunmuyor.');
    }
    return data.classrooms.map(classroom => ({ id: classroom.id, name: classroom.name, kind: 'class' as const }));
  }

  if (data.teachers.length === 0) {
    throw new Error('Tanımlı öğretmen bulunmuyor.');
  }
  return data.teachers.map(teacher => ({ id: teacher.id, name: teacher.name, kind: 'teacher' as const }));
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

    const sections = target.kind === 'class'
      ? buildClassSections(target.id, schedule, data, schoolHours, maxDailyHours)
      : buildTeacherSections(target.id, schedule, data, maxDailyHours);

    const tableBody: (string | { content: string; colSpan: number; styles: { halign: 'center', fillColor: number[] } })[][] = [];
    sections.forEach(section => {
      if (section.rows.length > 0) {
        tableBody.push([
          {
            content: section.dayLabel,
            colSpan: 4,
            styles: { halign: 'center', fillColor: [226, 232, 240] },
          },
        ]);
        section.rows.forEach(row => {
          tableBody.push([
            row.hourLabel,
            row.primary,
            row.secondary ? (row.note ? `${row.secondary} (${row.note})` : row.secondary) : (row.note ?? ''),
            row.location ?? '-',
          ]);
        });
      }
    });
    
    const title = target.kind === 'class' ? 'Haftalık Ders Programı' : 'Öğretmen Ders Programı';
    const descriptor = target.kind === 'class' ? 'Sınıf' : 'Öğretmen';
    const headerText = `${descriptor}: ${target.name}`;

    autoTable(doc, {
      head: [['Saat', 'Ders', target.kind === 'class' ? 'Öğretmen' : 'Sınıf', 'Yer']],
      body: tableBody,
      startY: 80,
      margin: { top: 80, left: 40, right: 40 },
      styles: { fontSize: 9, cellPadding: 4, textColor: 55, overflow: 'linebreak' },
      headStyles: { fillColor: [14, 116, 144], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [243, 244, 246] },
      tableWidth: 'auto',
      didDrawPage: (data) => {
        // Header on each page
        doc.setFontSize(16);
        doc.setTextColor(17, 24, 39);
        doc.text(title, 40, 40);

        doc.setFontSize(12);
        doc.setTextColor(55, 65, 81);
        doc.text(headerText, 40, 60);
      },
    });
  });

  const fileName = makeFileName(mode);
  return { doc, fileName };
};