
import { useMemo } from 'react';
import type { TimetableData, SchoolHours } from '../types';

export interface ValidationError {
  id: string;
  message: string;
}

export const useDataValidation = (data: TimetableData, schoolHours: SchoolHours) => {
  const validationResult = useMemo(() => {
    const unassignedSubjects: ValidationError[] = [];
    const overflowingClasses: ValidationError[] = [];
    const teacherSubjectMap = new Map<string, string[]>();

    // Build teacher-subject map
    data.teachers.forEach(teacher => {
      teacher.branches.forEach(branch => {
        if (!teacherSubjectMap.has(branch)) {
          teacherSubjectMap.set(branch, []);
        }
        teacherSubjectMap.get(branch)!.push(teacher.id);
      });
    });

    // 1. Check for subjects that have no available teacher
    data.subjects.forEach(subject => {
      if (subject.assignedClassIds.length > 0) {
        const teachersForSubject = teacherSubjectMap.get(subject.name) || [];
        if (teachersForSubject.length === 0) {
          unassignedSubjects.push({
            id: subject.id,
            message: `Ders: "${subject.name}" - Bu derse atanabilecek hiçbir öğretmen bulunamadı. Lütfen öğretmenlerin branşlarını kontrol edin.`,
          });
        }
      }
    });

    // 2. Check for classrooms where demand exceeds capacity
    const classDemand = new Map<string, number>();
    data.subjects.forEach(subject => {
      subject.assignedClassIds.forEach(classroomId => {
        classDemand.set(classroomId, (classDemand.get(classroomId) || 0) + subject.weeklyHours);
      });
    });
    data.lessonGroups.forEach(group => {
        group.classroomIds.forEach(classroomId => {
            classDemand.set(classroomId, (classDemand.get(classroomId) || 0) + group.weeklyHours);
        });
    });

    data.classrooms.forEach(classroom => {
      const demand = classDemand.get(classroom.id) || 0;
      const capacity = schoolHours[classroom.level].reduce((acc, hours) => acc + hours, 0);
      if (demand > capacity) {
        overflowingClasses.push({
          id: classroom.id,
          message: `Sınıf: "${classroom.name}" - Bu sınıfın haftalık ders talebi (${demand} saat), yapılandırılmış kapasitesini (${capacity} saat) aşıyor.`,
        });
      }
    });

    const allErrors = [...unassignedSubjects, ...overflowingClasses];
    const isValid = allErrors.length === 0;

    return {
      isValid,
      unassignedSubjects,
      overflowingClasses,
      allErrors,
    };
  }, [data, schoolHours]);

  return validationResult;
};
