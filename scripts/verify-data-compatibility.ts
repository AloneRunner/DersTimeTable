import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SchoolLevel } from '../types';
import { normalizeTimetableData } from '../hooks/useTimetableData';
import { buildClassroomSummaries, buildTeacherCapacitySummaries, findDuplicateClassSubjects } from '../utils/dataDiagnostics';

const filePath = resolve(process.argv[2] || 'ders-programi-verileri (5).json');
const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
if (!parsed?.data) throw new Error('Kök data alanı bulunamadı.');

const normalized = normalizeTimetableData(parsed.data);
const schoolHours = {
  [SchoolLevel.Middle]: [8, 8, 8, 8, 8],
  [SchoolLevel.High]: [8, 8, 8, 8, 8],
};
const summaries = buildClassroomSummaries(normalized, schoolHours);
const duplicates = findDuplicateClassSubjects(normalized);

if (normalized.teachers.length !== parsed.data.teachers.length) throw new Error('Öğretmen sayısı değişti.');
if (normalized.classrooms.length !== parsed.data.classrooms.length) throw new Error('Sınıf sayısı değişti.');
if (normalized.subjects.length !== parsed.data.subjects.length) throw new Error('Ders sayısı değişti.');
if (summaries.some(summary => summary.demand !== summary.capacity)) {
  throw new Error(`Eksik/fazla sınıf bulundu: ${summaries.filter(summary => summary.demand !== summary.capacity).map(summary => `${summary.classroom.name}:${summary.demand}/${summary.capacity}`).join(', ')}`);
}
if (duplicates.length > 0) {
  throw new Error(`Çift sınıf-ders girişi bulundu: ${duplicates.map(item => `${item.classroomName}/${item.subjectName}`).join(', ')}`);
}

const firstAssignedSubject = normalized.subjects.find(subject => subject.assignedClassIds.length > 0);
if (firstAssignedSubject) {
  const duplicateProbe = {
    ...normalized,
    subjects: [...normalized.subjects, { ...firstAssignedSubject, id: `${firstAssignedSubject.id}-duplicate-probe` }],
  };
  if (findDuplicateClassSubjects(duplicateProbe).length === 0) {
    throw new Error('Çift sınıf-ders denetimi yapay hatayı yakalayamadı.');
  }
}

// Older saves used a scalar teacher id; the migration must keep accepting it.
const legacyCopy = JSON.parse(JSON.stringify(parsed.data));
const legacySubject = legacyCopy.subjects.find((subject: any) => Object.keys(subject.pinnedTeacherByClassroom || {}).length > 0);
if (legacySubject) {
  const classroomId = Object.keys(legacySubject.pinnedTeacherByClassroom)[0];
  const teacherIds = legacySubject.pinnedTeacherByClassroom[classroomId];
  legacySubject.pinnedTeacherByClassroom[classroomId] = Array.isArray(teacherIds) ? teacherIds[0] : teacherIds;
  const migrated = normalizeTimetableData(legacyCopy);
  const migratedValue = migrated.subjects.find(subject => subject.id === legacySubject.id)?.pinnedTeacherByClassroom?.[classroomId];
  if (!Array.isArray(migratedValue)) throw new Error('Eski tek-öğretmen sabitleme biçimi dönüştürülemedi.');
}

const capacityProbeData = {
  teachers: [{
    id: 'capacity-probe-teacher',
    name: 'Kapasite Denemesi',
    branches: ['Fen Bilimleri'],
    availability: Array.from({ length: 5 }, (_, dayIndex) => Array.from({ length: 16 }, (_, hourIndex) => dayIndex > 0 && hourIndex < 5)),
    canTeachMiddleSchool: true,
    canTeachHighSchool: false,
  }],
  classrooms: [{ id: 'capacity-probe-class', name: '5-A', level: SchoolLevel.Middle, group: 'Yok' as any, sessionType: 'full' as const }],
  subjects: [{
    id: 'capacity-probe-subject',
    name: 'Fen Bilimleri',
    blockHours: 0,
    weeklyHours: 24,
    assignedClassIds: ['capacity-probe-class'],
    requiredTeacherCount: 1,
    pinnedTeacherByClassroom: {},
  }],
  locations: [],
  fixedAssignments: [],
  lessonGroups: [],
  duties: [],
};
const capacityProbe = buildTeacherCapacitySummaries(capacityProbeData, schoolHours)[0];
if (capacityProbe.definiteDemand !== 24 || capacityProbe.capacity !== 20 || capacityProbe.shortage !== 4) {
  throw new Error(`Öğretmen kapasite denetimi başarısız: ${JSON.stringify(capacityProbe)}`);
}
const flexibleProbeData = {
  ...capacityProbeData,
  teachers: [
    ...capacityProbeData.teachers,
    { ...capacityProbeData.teachers[0], id: 'capacity-probe-alternative', name: 'Alternatif Öğretmen' },
  ],
};
const flexibleProbe = buildTeacherCapacitySummaries(flexibleProbeData, schoolHours);
if (flexibleProbe.some(summary => summary.definiteDemand > 0)) {
  throw new Error('Alternatif öğretmen bulunan ders yanlış biçimde kesin yük sayıldı.');
}

console.log(JSON.stringify({
  file: filePath,
  teachers: normalized.teachers.length,
  classrooms: normalized.classrooms.length,
  subjects: normalized.subjects.length,
  classHours: summaries.map(summary => `${summary.classroom.name}:${summary.demand}/${summary.capacity}`),
  duplicateClassSubjects: duplicates.length,
  duplicateDetectionProbe: 'ok',
  legacyPinMigration: 'ok',
  teacherCapacityProbe: `${capacityProbe.definiteDemand}/${capacityProbe.capacity} (shortage ${capacityProbe.shortage})`,
  flexibleTeacherProbe: 'ok',
}, null, 2));
