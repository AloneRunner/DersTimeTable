import { jsPDF } from 'jspdf';
import * as autoTableModule from 'jspdf-autotable';
import type { Assignment, PrintInfo, Schedule, SchoolHours, TimetableData } from '../types';
import { SchoolLevel, ViewType } from '../types';

export type PrintScope = 'selected' | 'classes' | 'teachers' | 'classMatrix' | 'teacherMatrix';
type ViewMode = 'single' | 'master';
type RGB = [number, number, number];
type MatrixKind = 'class' | 'teacher';

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

type MatrixPdfCell = {
  text: string;
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
  printInfo?: PrintInfo | null;
}

const DAY_LABELS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma'];

// Resmi cerceve: ustte "okul adi · egitim-ogretim yili", sag altta mudur adi.
// Alanlar bos ise hicbir sey cizilmez ve sayfa duzeni eskisi gibi kalir.
const trim = (value: string | undefined | null) => (value ?? '').trim();

const officialHeaderText = (printInfo?: PrintInfo | null): string => {
  const school = trim(printInfo?.schoolName).toLocaleUpperCase('tr-TR');
  const year = trim(printInfo?.academicYear);
  const yearText = year ? `${year} Eğitim-Öğretim Yılı` : '';
  return [school, yearText].filter(Boolean).join('  •  ');
};

const officialPrincipalText = (printInfo?: PrintInfo | null): string => trim(printInfo?.principalName);

type OfficialFrame = {
  headerText: string;
  principalText: string;
  headerHeight: number; // Baslik satirinin ustteki icerigi ne kadar asagi ittigi (mm)
  footerHeight: number; // Mudur blogunun alttan ayirdigi yer (mm)
};

const officialFrame = (printInfo: PrintInfo | null | undefined, headerFontSize: number): OfficialFrame => {
  const headerText = officialHeaderText(printInfo);
  const principalText = officialPrincipalText(printInfo);
  return {
    headerText,
    principalText,
    headerHeight: headerText ? headerFontSize * 0.55 : 0,
    footerHeight: principalText ? 7 : 0,
  };
};

const drawOfficialFrame = (
  doc: jsPDF,
  frame: OfficialFrame,
  options: { headerFontSize: number; footerFontSize: number; margin: number; footerBaseline: number },
) => {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFont(FONT_NAME, 'normal');
  if (frame.headerText) {
    doc.setFontSize(options.headerFontSize);
    doc.setTextColor(15, 23, 42);
    doc.text(frame.headerText, pageWidth / 2, options.headerFontSize * 0.45 + 1.5, { align: 'center' });
  }
  if (frame.principalText) {
    const lineGap = options.footerFontSize * 0.42;
    doc.setFontSize(options.footerFontSize);
    doc.setTextColor(15, 23, 42);
    doc.text(frame.principalText, pageWidth - options.margin, options.footerBaseline - lineGap, { align: 'right' });
    doc.setTextColor(71, 85, 105);
    doc.setFontSize(options.footerFontSize * 0.85);
    doc.text('Okul Müdürü', pageWidth - options.margin, options.footerBaseline, { align: 'right' });
  }
};
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

const normalizeForCode = (value: string): string => value
  .trim()
  .toLocaleUpperCase('tr-TR')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const SUBJECT_CODE_RULES: Array<[RegExp, string]> = [
  [/^TÜRK DİLİ VE EDEBİYATI$/u, 'TDE'],
  [/^T C İNKILAP TARİHİ/u, 'İNK'],
  [/^DİN KÜLTÜRÜ/u, 'DİN'],
  [/^REHBERLİK/u, 'RHB'],
  [/^BEDEN EĞİTİMİ/u, 'BED'],
  [/^BİLİŞİM TEKNOLOJİLERİ/u, 'BİL'],
  [/^BİLİM UYGULAMALARI$/u, 'BLM'],
  [/^GÖRSEL SANATLAR$/u, 'GRS'],
  [/^SOSYAL BİLGİLER$/u, 'SOS'],
  [/^FEN BİLİMLERİ$/u, 'FEN'],
  [/^YABANCI DİL$/u, 'İNG'],
  [/^İNGİLİZCE$/u, 'İNG'],
  [/^TEMEL MATEMATİK$/u, 'TMT'],
  [/^MATEMATİK$/u, 'MAT'],
  [/^TÜRKÇE$/u, 'TRK'],
  [/^KUR AN I KERİM$/u, 'KUR'],
  [/^PEYGAMBERİMİZİN HAYATI$/u, 'PEY'],
  [/^TEMEL DİNİ BİLGİLER$/u, 'TDB'],
  [/^TEKNOLOJİ VE TASARIM$/u, 'TET'],
  [/^OKUL TEMELLİ SOSYAL SORUMLULUK/u, 'OTS'],
  [/^SAĞLIK BİLGİSİ/u, 'SBT'],
  [/^ARAPÇA$/u, 'ARP'],
  [/^BİYOLOJİ$/u, 'BİY'],
  [/^COĞRAFYA$/u, 'COĞ'],
  [/^FELSEFE$/u, 'FEL'],
  [/^FİZİK$/u, 'FİZ'],
  [/^KİMYA$/u, 'KİM'],
  [/^MÜZİK$/u, 'MÜZ'],
  [/^TARİH$/u, 'TRH'],
];

const makeSubjectCode = (name: string): string => {
  const normalized = normalizeForCode(name);
  const matchingRule = SUBJECT_CODE_RULES.find(([pattern]) => pattern.test(normalized));
  if (matchingRule) return matchingRule[1];

  const words = normalized.split(' ').filter((word) => word && word !== 'VE' && word !== 'İLE');
  const trailingDigits = normalized.match(/\d+$/)?.[0] ?? '';
  const letters = words.length <= 1
    ? (words[0] ?? 'DERS').replace(/\d+/g, '').slice(0, 4)
    : words.map((word) => word[0]).join('').slice(0, 4);
  return `${letters || 'DRS'}${trailingDigits}`.slice(0, 5);
};

const makeTeacherCode = (name: string): string => {
  const words = normalizeForCode(name).split(' ').filter(Boolean);
  if (words.length <= 1) return (words[0] ?? 'ÖĞR').slice(0, 5);
  const firstName = words[0];
  const surname = words[words.length - 1];
  return `${firstName[0]}.${surname.slice(0, 3)}`;
};

const createUniqueCodeMap = (
  entries: Array<{ id: string; label: string }>,
  baseCode: (label: string) => string,
  maxLength: number,
  shareCodeForSameLabel: boolean,
): Map<string, string> => {
  const result = new Map<string, string>();
  const labelCodes = new Map<string, string>();
  const usedCodes = new Set<string>();
  const sorted = [...entries].sort((left, right) => (
    left.label.localeCompare(right.label, 'tr-TR', { numeric: true }) || left.id.localeCompare(right.id)
  ));

  sorted.forEach(({ id, label }) => {
    const normalizedLabel = normalizeForCode(label);
    const sharedCode = shareCodeForSameLabel ? labelCodes.get(normalizedLabel) : undefined;
    if (sharedCode) {
      result.set(id, sharedCode);
      return;
    }

    const rawBase = normalizeForCode(baseCode(label)).replace(/\s/g, '') || 'KOD';
    let candidate = rawBase.slice(0, maxLength);
    let suffix = 2;
    while (usedCodes.has(candidate)) {
      const suffixText = String(suffix);
      candidate = `${rawBase.slice(0, Math.max(1, maxLength - suffixText.length))}${suffixText}`;
      suffix += 1;
    }
    usedCodes.add(candidate);
    labelCodes.set(normalizedLabel, candidate);
    result.set(id, candidate);
  });

  return result;
};

const compactCodes = (codes: string[], maxLength: number): string => {
  const unique = [...new Set(codes.filter(Boolean))];
  if (unique.length === 0) return '';
  const joined = unique.join('/');
  if (joined.length <= maxLength) return joined;
  if (unique.length === 1) return unique[0].slice(0, maxLength);
  const suffix = `+${unique.length - 1}`;
  return `${unique[0].slice(0, Math.max(1, maxLength - suffix.length))}${suffix}`;
};

const getDayHourCounts = (
  schedule: Schedule,
  schoolHours: SchoolHours,
  maxDailyHours: number,
): number[] => DAY_LABELS.map((_, dayIndex) => {
  const configured = Math.max(
    0,
    ...(Object.values(schoolHours) as number[][]).map((hours) => Number(hours[dayIndex] ?? 0)),
  );
  const scheduled = Math.max(
    0,
    ...Object.values(schedule).map((days) => {
      const row = days?.[dayIndex] ?? [];
      let lastOccupied = 0;
      row.forEach((assignment, hourIndex) => {
        if (assignment) lastOccupied = hourIndex + 1;
      });
      return lastOccupied;
    }),
  );
  return Math.max(1, configured || maxDailyHours, scheduled);
});

const findTeacherAssignments = (
  teacherId: string,
  dayIndex: number,
  hourIndex: number,
  schedule: Schedule,
): Array<{ assignment: Assignment; classroomId: string }> => {
  const found: Array<{ assignment: Assignment; classroomId: string }> = [];
  Object.entries(schedule).forEach(([classroomId, classroomDays]) => {
    const assignment = classroomDays?.[dayIndex]?.[hourIndex];
    if (!assignment) return;
    const teacherIds = assignment.teacherIds ?? ((assignment as any).teacherId ? [(assignment as any).teacherId] : []);
    if (teacherIds.includes(teacherId)) found.push({ assignment, classroomId });
  });
  return found;
};

const buildMatrixCells = (
  kind: MatrixKind,
  targets: Target[],
  dayHourCounts: number[],
  options: ExportOptions,
  subjectCodes: Map<string, string>,
  teacherCodes: Map<string, string>,
): MatrixPdfCell[][] => targets.map((target) => {
  const classroom = kind === 'class'
    ? options.data.classrooms.find((item) => item.id === target.id)
    : undefined;

  return dayHourCounts.flatMap((hourCount, dayIndex) => Array.from({ length: hourCount }, (_, hourIndex) => {
    if (kind === 'class') {
      const assignment = options.schedule[target.id]?.[dayIndex]?.[hourIndex];
      if (assignment) {
        const teacherIds = assignment.teacherIds
          ?? ((assignment as any).teacherId ? [(assignment as any).teacherId] : []);
        return {
          text: [
            subjectCodes.get(assignment.subjectId) ?? 'DRS',
            compactCodes(teacherIds.map((id) => teacherCodes.get(id) ?? ''), 7),
          ].filter(Boolean).join('\n'),
        };
      }

      const dailyLimit = classroom
        ? options.schoolHours[classroom.level as SchoolLevel]?.[dayIndex] ?? hourCount
        : hourCount;
      return { text: '', unavailable: hourIndex >= dailyLimit };
    }

    const assignments = findTeacherAssignments(target.id, dayIndex, hourIndex, options.schedule);
    if (assignments.length > 0) {
      const lessonCodes = assignments.map(({ assignment }) => subjectCodes.get(assignment.subjectId) ?? 'DRS');
      const classroomCodes = assignments.map(({ classroomId }) => (
        options.data.classrooms.find((item) => item.id === classroomId)?.name ?? 'SNF'
      ));
      return {
        text: [compactCodes(lessonCodes, 7), compactCodes(classroomCodes, 7)].filter(Boolean).join('\n'),
      };
    }

    const duty = options.data.duties.find((item) => {
      const span = Number((item as any).span ?? 1);
      return item.teacherId === target.id
        && item.dayIndex === dayIndex
        && hourIndex >= item.hourIndex
        && hourIndex < item.hourIndex + span;
    });
    if (duty) return { text: 'NÖB', duty: true };
    return { text: '' };
  }));
});

const buildMatrixSchedulePdf = async (options: ExportOptions) => {
  const kind: MatrixKind = options.mode === 'classMatrix' ? 'class' : 'teacher';
  const sourceTargets: Target[] = kind === 'class'
    ? options.data.classrooms.map((item) => ({ id: item.id, name: item.name, kind: 'class' as const }))
    : options.data.teachers.map((item) => ({ id: item.id, name: item.name, kind: 'teacher' as const }));
  const targets = sourceTargets.sort((left, right) => left.name.localeCompare(right.name, 'tr-TR', { numeric: true }));
  if (targets.length === 0) {
    throw new Error(kind === 'class' ? 'Tanımlı sınıf bulunmuyor.' : 'Tanımlı öğretmen bulunmuyor.');
  }

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  await addTurkishFont(doc);
  const dayHourCounts = getDayHourCounts(options.schedule, options.schoolHours, options.maxDailyHours);
  const totalHourCount = dayHourCounts.reduce((sum, value) => sum + value, 0);
  const subjectCodes = createUniqueCodeMap(
    options.data.subjects.map((item) => ({ id: item.id, label: item.name })),
    makeSubjectCode,
    5,
    true,
  );
  const teacherCodes = createUniqueCodeMap(
    options.data.teachers.map((item) => ({ id: item.id, label: item.name })),
    makeTeacherCode,
    5,
    false,
  );
  const matrix = buildMatrixCells(kind, targets, dayHourCounts, options, subjectCodes, teacherCodes);

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const horizontalMargin = 4;
  const tableWidth = pageWidth - (horizontalMargin * 2);
  const firstColumnWidth = kind === 'class' ? 15 : 25;
  const slotWidth = (tableWidth - firstColumnWidth) / totalHourCount;
  const frame = officialFrame(options.printInfo, 6.5);
  const titleY = 6.5 + frame.headerHeight;
  const startY = 12 + frame.headerHeight;
  const bottomMargin = 6 + frame.footerHeight;
  const availableBodyHeight = pageHeight - startY - bottomMargin - 12;
  const rowHeight = Math.max(4.2, Math.min(8, availableBodyHeight / targets.length));
  const bodyFontSize = totalHourCount > 45 ? 2.7 : totalHourCount > 40 ? 3 : 3.4;
  const rowLabel = kind === 'class' ? 'Sınıf' : 'Öğretmen';
  const title = kind === 'class' ? 'Toplu Sınıf Ders Programı' : 'Toplu Öğretmen Ders Programı';
  const columnStyles: Record<number, any> = {
    0: {
      cellWidth: firstColumnWidth,
      halign: 'left',
      fillColor: [248, 250, 252],
      fontSize: kind === 'class' ? 5 : 4.3,
      cellPadding: { top: 0.4, right: 0.5, bottom: 0.4, left: 0.8 },
    },
  };
  for (let columnIndex = 1; columnIndex <= totalHourCount; columnIndex += 1) {
    columnStyles[columnIndex] = { cellWidth: slotWidth, halign: 'center' };
  }

  const firstHeadRow: any[] = [{ content: rowLabel, rowSpan: 2, styles: { valign: 'middle' } }];
  dayHourCounts.forEach((hourCount, dayIndex) => {
    firstHeadRow.push({ content: DAY_LABELS[dayIndex], colSpan: hourCount });
  });
  const secondHeadRow = dayHourCounts.flatMap((hourCount) => (
    Array.from({ length: hourCount }, (_, hourIndex) => String(hourIndex + 1))
  ));
  const body = targets.map((target, rowIndex) => [target.name, ...matrix[rowIndex].map((cell) => cell.text)]);

  autoTable(doc, {
    head: [firstHeadRow, secondHeadRow],
    body,
    startY,
    margin: { top: startY, left: horizontalMargin, right: horizontalMargin, bottom: bottomMargin },
    tableWidth,
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    styles: {
      font: FONT_NAME,
      fontStyle: 'normal',
      fontSize: bodyFontSize,
      minCellHeight: rowHeight,
      cellPadding: 0.25,
      valign: 'middle',
      halign: 'center',
      overflow: 'linebreak',
      textColor: [15, 23, 42],
      lineColor: [100, 116, 139],
      lineWidth: 0.15,
    },
    headStyles: {
      fillColor: [241, 245, 249],
      textColor: [15, 23, 42],
      halign: 'center',
      valign: 'middle',
      fontSize: totalHourCount > 45 ? 3.4 : 4,
      minCellHeight: 5,
      cellPadding: 0.35,
      lineColor: [71, 85, 105],
      lineWidth: 0.2,
    },
    columnStyles,
    didParseCell: (hook) => {
      if (hook.section !== 'body' || hook.column.index === 0) return;
      const cell = matrix[hook.row.index]?.[hook.column.index - 1];
      if (!cell) return;
      if (cell.unavailable) hook.cell.styles.fillColor = [241, 245, 249];
      if (cell.duty) hook.cell.styles.fillColor = [226, 232, 240];
    },
    didDrawPage: () => {
      doc.setFont(FONT_NAME, 'normal');
      doc.setTextColor(15, 23, 42);
      doc.setFontSize(7.5);
      doc.text(title, horizontalMargin, titleY);
      doc.setTextColor(71, 85, 105);
      doc.setFontSize(4.5);
      doc.text(
        kind === 'class' ? 'Hücre: ders / öğretmen' : 'Hücre: ders / sınıf',
        pageWidth - horizontalMargin,
        titleY,
        { align: 'right' },
      );
      // Mudur adi sag alt koseyi alinca sayfa numarasi sol alta gecer.
      doc.text(
        `Sayfa ${doc.getCurrentPageInfo().pageNumber}`,
        frame.principalText ? horizontalMargin : pageWidth - horizontalMargin,
        pageHeight - 2,
        { align: frame.principalText ? 'left' : 'right' },
      );
      drawOfficialFrame(doc, frame, {
        headerFontSize: 6.5,
        footerFontSize: 5.5,
        margin: horizontalMargin,
        footerBaseline: pageHeight - 2,
      });
    },
  });

  return { doc, fileName: makeFileName(options.mode) };
};

const makeFileName = (mode: PrintScope): string => {
  const date = new Date().toISOString().split('T')[0];
  const suffix = mode === 'selected'
    ? 'secili'
    : mode === 'classes'
      ? 'siniflar'
      : mode === 'teachers'
        ? 'ogretmenler'
        : mode === 'classMatrix'
          ? 'toplu-sinif'
          : 'toplu-ogretmen';
  return `ders-programi-${suffix}-${date}.pdf`;
};

export const buildSchedulePdf = async (options: ExportOptions) => {
  if (options.mode === 'classMatrix' || options.mode === 'teacherMatrix') {
    return buildMatrixSchedulePdf(options);
  }
  const targets = resolveTargets(options);
  if (targets.length === 0) throw new Error('PDF oluşturmak için uygun kayıt bulunamadı.');

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  await addTurkishFont(doc);
  const frame = officialFrame(options.printInfo, 9);

  targets.forEach((target, targetIndex) => {
    if (targetIndex > 0) {
      doc.addPage('a4', 'landscape');
      doc.setFont(FONT_NAME, 'normal');
    }

    const grid = createWeeklyGrid(target, options.schedule, options.data, options.schoolHours, options.maxDailyHours);
    const descriptor = target.kind === 'class' ? 'Sınıf' : 'Öğretmen';
    const pageHeight = doc.internal.pageSize.getHeight();
    drawOfficialFrame(doc, frame, {
      headerFontSize: 9,
      footerFontSize: 8,
      margin: 8,
      footerBaseline: pageHeight - 4,
    });
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(15);
    doc.text(`${target.name} Haftalık Ders Programı`, 8, 10 + frame.headerHeight);
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text(`${descriptor}: ${target.name}  •  Her renk aynı dersi gösterir`, 8, 16 + frame.headerHeight);

    const startY = 21 + frame.headerHeight;
    const bottomMargin = 8 + frame.footerHeight;
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
