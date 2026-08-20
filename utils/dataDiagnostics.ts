import type { Classroom, LessonGroup, SchoolHours, Subject, Teacher, TimetableData } from '../types';
import { SchoolLevel } from '../types';

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

export interface TeacherCapacitySummary {
  teacher: Teacher;
  definiteDemand: number;
  availableHours: number;
  capacity: number;
  shortage: number;
}

const teacherCanTeachClass = (teacher: Teacher, classroom: Classroom): boolean =>
  classroom.level === SchoolLevel.Middle
    ? teacher.canTeachMiddleSchool
    : teacher.canTeachHighSchool;

const configuredTeacherAvailability = (
  teacher: Teacher,
  schoolHours: SchoolHours,
): number => {
  const dailyLimits = Array.from({ length: 5 }, (_, dayIndex) => {
    const limits: number[] = [];
    if (teacher.canTeachMiddleSchool) limits.push(schoolHours[SchoolLevel.Middle]?.[dayIndex] ?? 0);
    if (teacher.canTeachHighSchool) limits.push(schoolHours[SchoolLevel.High]?.[dayIndex] ?? 0);
    return limits.length > 0 ? Math.max(...limits) : 0;
  });
  return dailyLimits.reduce((total, dayLimit, dayIndex) => {
    const row = teacher.availability?.[dayIndex] ?? [];
    let available = 0;
    for (let hourIndex = 0; hourIndex < dayLimit; hourIndex += 1) {
      if (row[hourIndex] === true) available += 1;
    }
    return total + available;
  }, 0);
};

export const buildTeacherCapacitySummaries = (
  data: TimetableData,
  schoolHours: SchoolHours,
): TeacherCapacitySummary[] => {
  const demandByTeacher = new Map(data.teachers.map(teacher => [teacher.id, 0]));

  data.subjects.forEach(subject => {
    const normalizedSubject = normalizeLabel(subject.name);
    subject.assignedClassIds.forEach(classroomId => {
      const classroom = data.classrooms.find(item => item.id === classroomId);
      if (!classroom) return;
      const requiredCount = Math.max(1, subject.requiredTeacherCount ?? 1);
      const validPinned = (subject.pinnedTeacherByClassroom?.[classroomId] ?? [])
        .filter(teacherId => demandByTeacher.has(teacherId));
      const candidates = validPinned.length > 0
        ? validPinned
        : data.teachers
          .filter(teacher => teacherCanTeachClass(teacher, classroom))
          .filter(teacher => teacher.branches.some(branch => normalizeLabel(branch) === normalizedSubject))
          .map(teacher => teacher.id);

      // Only count hours that this teacher must receive in every valid solution.
      // When there are more candidates than required teachers, the solver can choose.
      const mandatoryTeachers = candidates.length <= requiredCount ? candidates : [];
      mandatoryTeachers.forEach(teacherId => {
        demandByTeacher.set(teacherId, (demandByTeacher.get(teacherId) ?? 0) + subject.weeklyHours);
      });
    });
  });

  return data.teachers.map(teacher => {
    const availableHours = configuredTeacherAvailability(teacher, schoolHours);
    const capacity = typeof teacher.maxWeeklyHours === 'number'
      ? Math.min(availableHours, teacher.maxWeeklyHours)
      : availableHours;
    const definiteDemand = demandByTeacher.get(teacher.id) ?? 0;
    return {
      teacher,
      definiteDemand,
      availableHours,
      capacity,
      shortage: Math.max(0, definiteDemand - capacity),
    };
  });
};

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
