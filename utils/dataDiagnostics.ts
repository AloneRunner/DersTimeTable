import type { Classroom, LessonGroup, SchoolHours, Subject, TimetableData } from '../types';

export const normalizeLabel = (value: string): string =>
  value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr-TR');

export interface ClassroomLessonEntry {
  key: string;
  kind: 'subject' | 'group';
  name: string;
  weeklyHours: number;
  subject?: Subject;
  group?: LessonGroup;
}

export interface ClassroomSummary {
  classroom: Classroom;
  capacity: number;
  demand: number;
  difference: number;
  lessons: ClassroomLessonEntry[];
}

export interface DuplicateClassSubject {
  classroomId: string;
  classroomName: string;
  normalizedSubjectName: string;
  subjectName: string;
  subjectIds: string[];
  totalHours: number;
}

export const buildClassroomSummaries = (data: TimetableData, schoolHours: SchoolHours): ClassroomSummary[] =>
  data.classrooms.map(classroom => {
    const subjectLessons: ClassroomLessonEntry[] = data.subjects
      .filter(subject => subject.assignedClassIds.includes(classroom.id))
      .map(subject => ({
        key: `subject:${subject.id}`,
        kind: 'subject' as const,
        name: subject.name,
        weeklyHours: subject.weeklyHours,
        subject,
      }));
    const groupLessons: ClassroomLessonEntry[] = data.lessonGroups
      .filter(group => group.classroomIds.includes(classroom.id))
      .map(group => ({
        key: `group:${group.id}`,
        kind: 'group' as const,
        name: group.name,
        weeklyHours: group.weeklyHours,
        group,
      }));
    const lessons = [...subjectLessons, ...groupLessons].sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    const demand = lessons.reduce((sum, lesson) => sum + lesson.weeklyHours, 0);
    const capacity = (schoolHours[classroom.level] || []).reduce((sum, hours) => sum + hours, 0);
    return { classroom, capacity, demand, difference: demand - capacity, lessons };
  });

export const findDuplicateClassSubjects = (data: TimetableData): DuplicateClassSubject[] => {
  const groups = new Map<string, { classroomId: string; normalizedName: string; subjects: Subject[] }>();
  data.subjects.forEach(subject => {
    const normalizedName = normalizeLabel(subject.name);
    subject.assignedClassIds.forEach(classroomId => {
      const key = `${classroomId}::${normalizedName}`;
      const current = groups.get(key) || { classroomId, normalizedName, subjects: [] };
      current.subjects.push(subject);
      groups.set(key, current);
    });
  });

  return Array.from(groups.values())
    .filter(group => group.subjects.length > 1)
    .map(group => ({
      classroomId: group.classroomId,
      classroomName: data.classrooms.find(classroom => classroom.id === group.classroomId)?.name || group.classroomId,
      normalizedSubjectName: group.normalizedName,
      subjectName: group.subjects[0].name,
      subjectIds: group.subjects.map(subject => subject.id),
      totalHours: group.subjects.reduce((sum, subject) => sum + subject.weeklyHours, 0),
    }));
};
