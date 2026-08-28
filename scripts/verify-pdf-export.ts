import fs from 'node:fs/promises';
import path from 'node:path';
import { buildSchedulePdf } from '../services/pdfExporter';
import { SchoolLevel, ViewType, type SchoolHours } from '../types';

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
const schoolHours: SchoolHours = {
  [SchoolLevel.Middle]: [8, 8, 8, 8, 8],
  [SchoolLevel.High]: [8, 8, 8, 8, 8],
};
const common = {
  data: sample.data,
  schedule: sample.schedule,
  schoolHours,
  maxDailyHours: 8,
  selectedHeaderId: null,
  viewMode: 'master' as const,
};

const { doc } = await buildSchedulePdf({ ...common, mode: 'classes', viewType: ViewType.Class });
const { doc: teacherDoc } = await buildSchedulePdf({ ...common, mode: 'teachers', viewType: ViewType.Teacher });
const { doc: classMatrixDoc } = await buildSchedulePdf({ ...common, mode: 'classMatrix', viewType: ViewType.Class });
const { doc: teacherMatrixDoc } = await buildSchedulePdf({ ...common, mode: 'teacherMatrix', viewType: ViewType.Teacher });

const bytes = Buffer.from(doc.output('arraybuffer'));
const classMatrixBytes = Buffer.from(classMatrixDoc.output('arraybuffer'));
const teacherMatrixBytes = Buffer.from(teacherMatrixDoc.output('arraybuffer'));
const previewDir = process.env.PDF_PREVIEW_DIR;
if (previewDir) {
  await fs.mkdir(previewDir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(previewDir, 'toplu-sinif.pdf'), classMatrixBytes),
    fs.writeFile(path.join(previewDir, 'toplu-ogretmen.pdf'), teacherMatrixBytes),
  ]);
}
const result = {
  classPages: doc.getNumberOfPages(),
  expectedClassPages: sample.data.classrooms.length,
  teacherPages: teacherDoc.getNumberOfPages(),
  expectedTeacherPages: sample.data.teachers.length,
  classMatrixPages: classMatrixDoc.getNumberOfPages(),
  teacherMatrixPages: teacherMatrixDoc.getNumberOfPages(),
  bytes: bytes.length,
  classMatrixBytes: classMatrixBytes.length,
  teacherMatrixBytes: teacherMatrixBytes.length,
};
console.log(JSON.stringify(result));
if (
  result.classPages !== result.expectedClassPages
  || result.teacherPages !== result.expectedTeacherPages
  || result.bytes < 100_000
  || result.classMatrixPages < 1
  || result.teacherMatrixPages < 1
  || result.classMatrixBytes < 20_000
  || result.teacherMatrixBytes < 20_000
) process.exit(1);
