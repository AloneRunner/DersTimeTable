
import { useState } from 'react';
import type { TimetableData, Teacher, Classroom, Subject, Location, FixedAssignment, LessonGroup, Duty } from '../types';
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


export const useTimetableData = () => {
  const [data, setData] = useState<TimetableData>(() => createSimpleInitialData());

  const addOrUpdateItem = <T extends { id: string }>(itemType: keyof TimetableData, item: T) => {
    setData(prevData => {
      // FIX: Cast to 'unknown' first to resolve the overly strict TypeScript error.
      // This is safe because the calling functions ensure the itemType and item's type match.
      const items = prevData[itemType] as unknown as T[];
      const existingIndex = items.findIndex(i => i.id === item.id);
      let newItems;
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
        const items = prevData[itemType] as {id: string}[];
        return {
            ...prevData,
            [itemType]: items.filter(item => item.id !== id)
        };
    });
  };

  const dedupeById = <T extends {id:string}>(arr: T[]|undefined) =>
    Array.from(new Map((arr||[]).map(x => [x.id, x])).values());

  const unique = <T>(arr: T[]|undefined) =>
    Array.from(new Set(arr || []));

  const sanitizeSubjects = (subjects: Subject[], classrooms: Classroom[]) => {
    const classIds = new Set(classrooms.map(c => c.id));
    return subjects.map(s => ({
      ...s,
      assignedClassIds: unique((s.assignedClassIds||[]).filter(id => classIds.has(id))),
      tripleBlockHours: s.tripleBlockHours || 0,
      pinnedTeacherByClassroom: Object.fromEntries(
        Object.entries(s.pinnedTeacherByClassroom || {}).filter(([cid]) => classIds.has(cid))
      )
    }));
  };

  const importData = (jsonData: string) => {
    const imported = JSON.parse(jsonData);
    if (!imported.data || !imported.data.teachers || !imported.data.classrooms || !imported.data.subjects) {
      throw new Error("GeÃ§ersiz dosya formatÄ±. LÃ¼tfen uygulamadan dÄ±ÅŸa aktarÄ±lan bir JSON dosyasÄ± kullanÄ±n.");
    }

    // --- MIGRATION LOGIC for multi-teacher pinning ---
    if (imported.data.subjects) {
      imported.data.subjects.forEach((s: Subject) => {
        if (s.pinnedTeacherByClassroom) {
          for (const classId in s.pinnedTeacherByClassroom) {
            const val = (s.pinnedTeacherByClassroom as any)[classId];
            if (val && !Array.isArray(val)) {
              (s.pinnedTeacherByClassroom as any)[classId] = [val];
            }
          }
        }
      });
    }
    // --- END MIGRATION LOGIC ---

    // FIX: Add explicit generic types to `dedupeById` calls to ensure correct type inference.
    // The `imported` object from `JSON.parse` is of type `any`, so TypeScript infers the most
    // generic type `({id: string})` for the arrays, causing assignment errors.
    const teachers = dedupeById<Teacher>(imported.data.teachers);
    const classrooms= dedupeById<Classroom>(imported.data.classrooms);
    const locations = dedupeById<Location>(imported.data.locations||[]);
    const fixed = dedupeById<FixedAssignment>(imported.data.fixedAssignments||[]);
    const groups = dedupeById<LessonGroup>(imported.data.lessonGroups||[]);
    const duties = dedupeById<Duty>(imported.data.duties||[]);
    const subjects0 = dedupeById<Subject>(imported.data.subjects);
    const subjects  = sanitizeSubjects(subjects0, classrooms);
    
    const newTimetableData: TimetableData = { 
        teachers, 
        classrooms, 
        subjects, 
        locations, 
        fixedAssignments: fixed, 
        lessonGroups: groups, 
        duties 
    };

    setData(newTimetableData);
  };

  const clearData = () => {
    setData(createSimpleInitialData());
  };

  const addTeacher = (teacher: Omit<Teacher, 'id'>) => addOrUpdateItem('teachers', { ...teacher, id: `t${Date.now()}` });
  const updateTeacher = (teacher: Teacher) => addOrUpdateItem('teachers', teacher);
  const removeTeacher = (id: string) => removeItem('teachers', id);

  const addClassroom = (classroom: Omit<Classroom, 'id'>) => addOrUpdateItem('classrooms', { ...classroom, id: `c${Date.now()}` });
  const updateClassroom = (classroom: Classroom) => addOrUpdateItem('classrooms', classroom);
  const removeClassroom = (id: string) => removeItem('classrooms', id);

  const addSubject = (subject: Omit<Subject, 'id'>) => addOrUpdateItem('subjects', { ...subject, id: `s${Date.now()}` });
  const updateSubject = (subject: Subject) => addOrUpdateItem('subjects', subject);
  const removeSubject = (id: string) => removeItem('subjects', id);
  
  const addLocation = (location: Omit<Location, 'id'>) => addOrUpdateItem('locations', { ...location, id: `l${Date.now()}` });
  const updateLocation = (location: Location) => addOrUpdateItem('locations', location);
  const removeLocation = (id: string) => removeItem('locations', id);
  
  const addFixedAssignment = (assignment: Omit<FixedAssignment, 'id'>) => addOrUpdateItem('fixedAssignments', { ...assignment, id: `fa${Date.now()}` });
  const removeFixedAssignment = (id: string) => removeItem('fixedAssignments', id);

  const addLessonGroup = (group: Omit<LessonGroup, 'id'>) => addOrUpdateItem('lessonGroups', { ...group, id: `lg${Date.now()}` });
  const updateLessonGroup = (group: LessonGroup) => addOrUpdateItem('lessonGroups', group);
  const removeLessonGroup = (id: string) => removeItem('lessonGroups', id);

  const addDuty = (duty: Omit<Duty, 'id'>) => addOrUpdateItem('duties', { ...duty, id: `d${Date.now()}` });
  const updateDuty = (duty: Duty) => addOrUpdateItem('duties', duty);
  const removeDuty = (id: string) => removeItem('duties', id);

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
  };
};


