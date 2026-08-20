import { jsPDF } from 'jspdf';
import * as autoTableModule from 'jspdf-autotable';
import type { Assignment, Schedule, SchoolHours, TimetableData } from '../types';
import { SchoolLevel, ViewType } from '../types';

type PrintScope = 'selected' | 'classes' | 'teachers';
type ViewMode = 'single' | 'master';
type RGB = [number, number, number];

type Target = {
  id: string;
  name: string;
  kind: 'class' | 'teacher';
};

type PdfCell = {
  text: string;
  subjectName?: string;
  duty?: boolean;
  unavailable?: boolean;
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
const FONT_NAME = 'Atkinson';
const FONT_FILE_NAME = 'AtkinsonHyperlegibleNext.ttf';
const FONT_URL = '/assets/fonts/AtkinsonHyperlegibleNext.ttf';
let fontBase64Promise: Promise<string> | null = null;
const autoTable = (
  (autoTableModule as any).autoTable
  ?? (autoTableModule as any).default?.default
  ?? (autoTableModule as any).default
) as (doc: jsPDF, options: any) => void;

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

const loadPdfFont = async (): Promise<string> => {
  if (!fontBase64Promise) {
    fontBase64Promise = fetch(FONT_URL).then(async (response) => {
      if (!response.ok) throw new Error(`PDF yazı tipi yüklenemedi (${response.status}).`);
      return arrayBufferToBase64(await response.arrayBuffer());
    });
  }
  return fontBase64Promise;
};

const addTurkishFont = async (doc: jsPDF): Promise<void> => {
  const fontBase64 = await loadPdfFont();
  doc.addFileToVFS(FONT_FILE_NAME, fontBase64);
  doc.addFont(FONT_FILE_NAME, FONT_NAME, 'normal');
  doc.setFont(FONT_NAME, 'normal');
};

const resolveTargets = (options: ExportOptions): Target[] => {
  const { mode, data, viewType, selectedHeaderId, viewMode } = options;
  if (mode === 'selected') {
    if (viewMode !== 'single') throw new Error('PDF almak için önce "Sade görünüm" moduna geçin.');
    if (!selectedHeaderId) throw new Error('Lütfen listeden bir sınıf veya öğretmen seçin.');
    if (viewType === ViewType.Class) {
      const classroom = data.classrooms.find((item) => item.id === selectedHeaderId);
      if (!classroom) throw new Error('Seçili sınıf bulunamadı.');
      return [{ id: classroom.id, name: classroom.name, kind: 'class' }];
    }
    const teacher = data.teachers.find((item) => item.id === selectedHeaderId);
    if (!teacher) throw new Error('Seçili öğretmen bulunamadı.');
    return [{ id: teacher.id, name: teacher.name, kind: 'teacher' }];
  }
  if (mode === 'classes') {
    if (data.classrooms.length === 0) throw new Error('Tanımlı sınıf bulunmuyor.');
    return data.classrooms.map((item) => ({ id: item.id, name: item.name, kind: 'class' as const }));
  }
  if (data.teachers.length === 0) throw new Error('Tanımlı öğretmen bulunmuyor.');
  return data.teachers.map((item) => ({ id: item.id, name: item.name, kind: 'teacher' as const }));
};

const assignmentText = (
  assignment: Assignment,
  targetKind: Target['kind'],
  data: TimetableData,
  fallbackClassroomId?: string,
): PdfCell => {
  const subjectName = data.subjects.find((item) => item.id === assignment.subjectId)?.name ?? 'Ders';
  const locationName = assignment.locationId
    ? data.locations.find((item) => item.id === assignment.locationId)?.name
    : undefined;
  const secondary = targetKind === 'class'
    ? (assignment.teacherIds ?? ((assignment as any).teacherId ? [(assignment as any).teacherId] : []))
      .map((id) => data.teachers.find((teacher) => teacher.id === id)?.name)
      .filter((name): name is string => Boolean(name))
      .join(', ')
    : data.classrooms.find((item) => item.id === (assignment.classroomId ?? fallbackClassroomId))?.name ?? 'Sınıf';
  return { subjectName, text: [subjectName, secondary, locationName].filter(Boolean).join('\n') };
};

const findTeacherAssignment = (
  teacherId: string,
  dayIndex: number,
  hourIndex: number,
  schedule: Schedule,
): { assignment: Assignment; classroomId: string } | null => {
  for (const [classroomId, classroomDays] of Object.entries(schedule)) {
    const assignment = classroomDays?.[dayIndex]?.[hourIndex];
    const teacherIds = assignment
      ? (assignment.teacherIds ?? ((assignment as any).teacherId ? [(assignment as any).teacherId] : []))
      : [];
    if (assignment && teacherIds.includes(teacherId)) return { assignment, classroomId };
  }
  return null;
};

const createWeeklyGrid = (
  target: Target,
  schedule: Schedule,
  data: TimetableData,
  schoolHours: SchoolHours,
  maxDailyHours: number,
): PdfCell[][] => {
  const classroom = target.kind === 'class' ? data.classrooms.find((item) => item.id === target.id) : undefined;
  const classDailyLimits = classroom ? schoolHours[classroom.level as SchoolLevel] ?? [] : [];
  const hourCount = target.kind === 'class'
    ? Math.max(1, ...classDailyLimits, maxDailyHours)
    : Math.max(1, maxDailyHours);

  return Array.from({ length: hourCount }, (_, hourIndex) => DAY_LABELS.map((_, dayIndex) => {
    if (target.kind === 'class') {
      const dailyLimit = classDailyLimits[dayIndex] ?? maxDailyHours;
      if (hourIndex >= dailyLimit) return { text: '', unavailable: true };
      const assignment = schedule[target.id]?.[dayIndex]?.[hourIndex];
      return assignment ? assignmentText(assignment, target.kind, data, target.id) : { text: '' };
    }

    const found = findTeacherAssignment(target.id, dayIndex, hourIndex, schedule);
    const duty = data.duties.find((item) => {
      const span = Number((item as any).span ?? 1);
      return item.teacherId === target.id
        && item.dayIndex === dayIndex
        && hourIndex >= item.hourIndex
        && hourIndex < item.hourIndex + span;
    });
    if (found) {
      const cell = assignmentText(found.assignment, target.kind, data, found.classroomId);
      if (duty) cell.text += `\nGörev: ${duty.name}`;
      return cell;
    }
    if (duty) {
      const locationName = (duty as any).locationId
        ? data.locations.find((item) => item.id === (duty as any).locationId)?.name
        : undefined;
      return { text: [duty.name, locationName ?? 'Nöbet / görev'].filter(Boolean).join('\n'), duty: true };
    }
    return { text: '' };
  }));
};

const hslToRgb = (hue: number, saturation: number, lightness: number): RGB => {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const section = hue / 60;
  const x = chroma * (1 - Math.abs((section % 2) - 1));
  let rgb: [number, number, number] = [0, 0, 0];
  if (section < 1) rgb = [chroma, x, 0];
  else if (section < 2) rgb = [x, chroma, 0];
  else if (section < 3) rgb = [0, chroma, x];
  else if (section < 4) rgb = [0, x, chroma];
  else if (section < 5) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];
  const match = l - chroma / 2;
  return rgb.map((value) => Math.round((value + match) * 255)) as RGB;
};

const colorForSubject = (subjectName: string): { fill: RGB; line: RGB } => {
  let hash = 0;
  const normalized = subjectName.trim().toLocaleLowerCase('tr-TR');
  for (let index = 0; index < normalized.length; index += 1) {
    hash = normalized.charCodeAt(index) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash * 137.508) % 360;
  const saturation = 62 + (Math.abs(hash) % 12);
  const lightness = 84 + (Math.abs(hash >> 4) % 7);
  return {
    fill: hslToRgb(hue, saturation, lightness),
    line: hslToRgb(hue, Math.min(82, saturation + 8), 62),
  };
};

const makeFileName = (mode: PrintScope): string => {
  const date = new Date().toISOString().split('T')[0];
  const suffix = mode === 'selected' ? 'secili' : mode === 'classes' ? 'siniflar' : 'ogretmenler';
  return `ders-programi-${suffix}-${date}.pdf`;
};

export const buildSchedulePdf = async (options: ExportOptions) => {
  const targets = resolveTargets(options);
  if (targets.length === 0) throw new Error('PDF oluşturmak için uygun kayıt bulunamadı.');

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  await addTurkishFont(doc);

  targets.forEach((target, targetIndex) => {
    if (targetIndex > 0) {
      doc.addPage('a4', 'landscape');
      doc.setFont(FONT_NAME, 'normal');
    }

    const grid = createWeeklyGrid(target, options.schedule, options.data, options.schoolHours, options.maxDailyHours);
    const descriptor = target.kind === 'class' ? 'Sınıf' : 'Öğretmen';
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(15);
    doc.text(`${target.name} Haftalık Ders Programı`, 8, 10);
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text(`${descriptor}: ${target.name}  •  Her renk aynı dersi gösterir`, 8, 16);

    const pageHeight = doc.internal.pageSize.getHeight();
    const startY = 21;
    const bottomMargin = 8;
    const headerHeight = 9;
    const minCellHeight = Math.max(8, Math.min(20, (pageHeight - startY - bottomMargin - headerHeight) / grid.length));
    const fontSize = grid.length > 11 ? 6.1 : grid.length > 8 ? 6.7 : 7.3;
    const body = grid.map((row, hourIndex) => [`${hourIndex + 1}. Ders`, ...row.map((cell) => cell.text)]);

    autoTable(doc, {
      head: [['Saatler', ...DAY_LABELS]],
      body,
      startY,
      margin: { left: 8, right: 8, bottom: bottomMargin },
      tableWidth: 281,
      pageBreak: 'avoid',
      rowPageBreak: 'avoid',
      styles: {
        font: FONT_NAME,
        fontStyle: 'normal',
        fontSize,
        minCellHeight,
        cellPadding: 1.6,
        valign: 'top',
        overflow: 'linebreak',
        textColor: [30, 41, 59],
        lineColor: [203, 213, 225],
        lineWidth: 0.25,
      },
      headStyles: {
        fillColor: [241, 245, 249],
        textColor: [30, 41, 59],
        halign: 'center',
        minCellHeight: headerHeight,
      },
      columnStyles: {
        0: { cellWidth: 18, halign: 'center', fillColor: [248, 250, 252] },
        1: { cellWidth: 52.6 },
        2: { cellWidth: 52.6 },
        3: { cellWidth: 52.6 },
        4: { cellWidth: 52.6 },
        5: { cellWidth: 52.6 },
      },
      didParseCell: (hook) => {
        if (hook.section !== 'body' || hook.column.index === 0) return;
        const cell = grid[hook.row.index]?.[hook.column.index - 1];
        if (!cell) return;
        if (cell.unavailable) {
          hook.cell.styles.fillColor = [241, 245, 249];
        } else if (cell.duty) {
          hook.cell.styles.fillColor = [226, 232, 240];
          hook.cell.styles.lineColor = [148, 163, 184];
        } else if (cell.subjectName) {
          const color = colorForSubject(cell.subjectName);
          hook.cell.styles.fillColor = color.fill;
          hook.cell.styles.lineColor = color.line;
        }
      },
    });
  });

  return { doc, fileName: makeFileName(options.mode) };
};
