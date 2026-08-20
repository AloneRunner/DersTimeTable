import { useCallback, useState } from 'react';
import type {
  TimetableData,
  Teacher,
  Classroom,
  Subject,
  Location,
  FixedAssignment,
  LessonGroup,
  Duty,
} from '../types';
import { SchoolLevel, ClassGroup } from '../types';

const createSimpleInitialData = (): TimetableData => {
  const teachers: Teacher[] = [{
    id: 't1',
    name: 'Ali Yılmaz',
    branches: ['Türkçe'],
    availability: Array(5).fill(null).map(() => Array(16).fill(true)),
    canTeachHighSchool: false,
    canTeachMiddleSchool: true,
  }];

  const classrooms: Classroom[] = [{
    id: 'c1',
    name: '5-A',
    level: SchoolLevel.Middle,
    group: ClassGroup.None,
    sessionType: 'full',
  }];

  const subjects: Subject[] = [{
    id: 's1',
    name: 'Türkçe',
    weeklyHours: 6,
    blockHours: 0,
    assignedClassIds: ['c1'],
  }];

  return {
    teachers,
    classrooms,
    subjects,
    locations: [],
    fixedAssignments: [],
    lessonGroups: [],
    duties: [],
  };
};

const dedupeById = <T extends { id: string }>(arr: T[] | undefined) =>
  Array.from(new Map((arr || []).map(x => [x.id, x])).values());

const unique = <T>(arr: T[] | undefined) => Array.from(new Set(arr || []));

/** Eski JSON verisini güncel modele taşır; dışa aktarma kökü `{ data }` olarak kalır. */
export const normalizeTimetableData = (input: unknown): TimetableData => {
  const imported = input as Partial<TimetableData> | null;
  if (!imported || !Array.isArray(imported.teachers) || !Array.isArray(imported.classrooms) || !Array.isArray(imported.subjects)) {
    throw new Error('Geçersiz dosya formatı. Lütfen uygulamadan dışa aktarılmış bir JSON dosyası kullanın.');
  }

  const teachers = dedupeById<Teacher>(imported.teachers).map(teacher => ({
    ...teacher,
    maxWeeklyHours: Number.isFinite(Number(teacher.maxWeeklyHours)) && Number(teacher.maxWeeklyHours) > 0
      ? Number(teacher.maxWeeklyHours)
      : undefined,
  }));
  const classrooms = dedupeById<Classroom>(imported.classrooms);
  const classIds = new Set(classrooms.map(classroom => classroom.id));
  const subjects = dedupeById<Subject>(imported.subjects).map(subject => ({
    ...subject,
    assignedClassIds: unique((subject.assignedClassIds || []).filter(id => classIds.has(id))),
    tripleBlockHours: subject.tripleBlockHours || 0,
    pinnedTeacherByClassroom: Object.fromEntries(
      Object.entries(subject.pinnedTeacherByClassroom || {})
        .filter(([classroomId]) => classIds.has(classroomId))
        .map(([classroomId, value]) => [
          classroomId,
          unique(Array.isArray(value) ? value : value ? [value as unknown as string] : []),
        ])
    ),
  }));

  return {
    teachers,
    classrooms,
    subjects,
    locations: dedupeById<Location>(imported.locations || []),
    fixedAssignments: dedupeById<FixedAssignment>(imported.fixedAssignments || []),
    lessonGroups: dedupeById<LessonGroup>(imported.lessonGroups || []),
    duties: dedupeById<Duty>(imported.duties || []),
  };
};

export const useTimetableData = (initialData?: TimetableData | null) => {
  const [data, setData] = useState<TimetableData>(() => {
    if (!initialData) return createSimpleInitialData();
    try {
      return normalizeTimetableData(initialData);
    } catch {
      return createSimpleInitialData();
    }
  });

  const addOrUpdateItem = <T extends { id: string }>(itemType: keyof TimetableData, item: T) => {
    setData(prevData => {
      const items = prevData[itemType] as unknown as T[];
      const existingIndex = items.findIndex(i => i.id === item.id);
      let newItems: T[];
      if (existingIndex > -1) {
        newItems = [...items];
        newItems[existingIndex] = item;
      } else {
        newItems = [...items, item];
      }
      return { ...prevData, [itemType]: newItems };
    });
  };

  const removeItem = (itemType: keyof TimetableData, id: string) => {
    setData(prevData => {
      const items = prevData[itemType] as { id: string }[];
      return {
        ...prevData,
        [itemType]: items.filter(item => item.id !== id),
      };
    });
  };

  const importData = (jsonData: string) => {
    const imported = JSON.parse(jsonData);
    if (!imported?.data) {
      throw new Error('Geçersiz dosya formatı. Dosyanın kökünde "data" alanı bulunmalıdır.');
    }
    setData(normalizeTimetableData(imported.data));
  };

  const clearData = () => {
    setData(createSimpleInitialData());
  };

  const addTeacher = (teacher: Omit<Teacher, 'id'>) =>
    addOrUpdateItem('teachers', { ...teacher, id: `t${Date.now()}` });
  const updateTeacher = (teacher: Teacher) => addOrUpdateItem('teachers', teacher);
  const removeTeacher = (id: string) => removeItem('teachers', id);

  const addClassroom = (classroom: Omit<Classroom, 'id'>) =>
    addOrUpdateItem('classrooms', { ...classroom, id: `c${Date.now()}` });
  const updateClassroom = (classroom: Classroom) => addOrUpdateItem('classrooms', classroom);
  const removeClassroom = (id: string) => removeItem('classrooms', id);

  const addSubject = (subject: Omit<Subject, 'id'>) =>
    addOrUpdateItem('subjects', { ...subject, id: `s${Date.now()}` });
  const updateSubject = (subject: Subject) => addOrUpdateItem('subjects', subject);
  const removeSubject = (id: string) => removeItem('subjects', id);

  const addLocation = (location: Omit<Location, 'id'>) =>
    addOrUpdateItem('locations', { ...location, id: `l${Date.now()}` });
  const updateLocation = (location: Location) => addOrUpdateItem('locations', location);
  const removeLocation = (id: string) => removeItem('locations', id);

  const addFixedAssignment = (assignment: Omit<FixedAssignment, 'id'>) =>
    addOrUpdateItem('fixedAssignments', { ...assignment, id: `fa${Date.now()}` });
  const removeFixedAssignment = (id: string) => removeItem('fixedAssignments', id);

  const addLessonGroup = (group: Omit<LessonGroup, 'id'>) =>
    addOrUpdateItem('lessonGroups', { ...group, id: `lg${Date.now()}` });
  const updateLessonGroup = (group: LessonGroup) => addOrUpdateItem('lessonGroups', group);
  const removeLessonGroup = (id: string) => removeItem('lessonGroups', id);

  const addDuty = (duty: Omit<Duty, 'id'>) =>
    addOrUpdateItem('duties', { ...duty, id: `d${Date.now()}` });
  const updateDuty = (duty: Duty) => addOrUpdateItem('duties', duty);
  const removeDuty = (id: string) => removeItem('duties', id);

  const replaceData = useCallback((nextData: TimetableData) => {
    setData(nextData);
  }, []);

  return {
    data,
    addTeacher,
    updateTeacher,
    removeTeacher,
    addClassroom,
    updateClassroom,
    removeClassroom,
    addSubject,
    updateSubject,
    removeSubject,
    addLocation,
    updateLocation,
    removeLocation,
    addFixedAssignment,
    removeFixedAssignment,
    addLessonGroup,
    updateLessonGroup,
    removeLessonGroup,
    addDuty,
    updateDuty,
    removeDuty,
    importData,
    clearData,
    replaceData,
  };
};
