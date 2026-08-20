import fs from 'node:fs/promises';
import path from 'node:path';
import { buildSchedulePdf } from '../services/pdfExporter';
import { SchoolLevel, ViewType } from '../types';

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input);
  if (url.endsWith('/assets/fonts/AtkinsonHyperlegibleNext.ttf')) {
    const font = await fs.readFile(path.resolve('public/assets/fonts/AtkinsonHyperlegibleNext.ttf'));
    return new Response(font, { status: 200 });
  }
  return originalFetch(input);
}) as typeof fetch;

const sample = JSON.parse(await fs.readFile(path.resolve('public/sample-data/sonuc.json'), 'utf8'));
const common = {
  data: sample.data,
  schedule: sample.schedule,
  schoolHours: {
    [SchoolLevel.Middle]: [8, 8, 8, 8, 8],
    [SchoolLevel.High]: [8, 8, 8, 8, 8],
  },
  maxDailyHours: 8,
  selectedHeaderId: null,
  viewMode: 'master',
} as const;

const { doc } = await buildSchedulePdf({ ...common, mode: 'classes', viewType: ViewType.Class });
const { doc: teacherDoc } = await buildSchedulePdf({ ...common, mode: 'teachers', viewType: ViewType.Teacher });

const bytes = Buffer.from(doc.output('arraybuffer'));
const result = {
  classPages: doc.getNumberOfPages(),
  expectedClassPages: sample.data.classrooms.length,
  teacherPages: teacherDoc.getNumberOfPages(),
  expectedTeacherPages: sample.data.teachers.length,
  bytes: bytes.length,
};
console.log(JSON.stringify(result));
if (
  result.classPages !== result.expectedClassPages
  || result.teacherPages !== result.expectedTeacherPages
  || result.bytes < 100_000
) process.exit(1);
