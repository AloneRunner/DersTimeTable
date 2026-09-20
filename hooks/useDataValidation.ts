
import { useMemo } from 'react';
import type { TimetableData, SchoolHours } from '../types';
import { buildClassroomSummaries, buildDayCapacityShortages, buildTeacherCapacitySummaries, findDuplicateClassSubjects, normalizeLabel } from '../utils/dataDiagnostics';

export interface ValidationError {
  id: string;
  message: string;
}

export const useDataValidation = (data: TimetableData, schoolHours: SchoolHours) => {
  const validationResult = useMemo(() => {
    const unassignedSubjects: ValidationError[] = [];
    const overflowingClasses: ValidationError[] = [];
    const incompleteClasses: ValidationError[] = [];
    const duplicateClassSubjects: ValidationError[] = [];
    const teacherCapacityErrors: ValidationError[] = [];
    const teacherSubjectMap = new Map<string, string[]>();

    // Build teacher-subject map
    data.teachers.forEach(teacher => {
      teacher.branches.forEach(branch => {
        const normalizedBranch = normalizeLabel(branch);
        if (!teacherSubjectMap.has(normalizedBranch)) {
          teacherSubjectMap.set(normalizedBranch, []);
        }
        teacherSubjectMap.get(normalizedBranch)!.push(teacher.id);
      });
    });

    // 1. Check for subjects that have no available teacher
    data.subjects.forEach(subject => {
      if (subject.assignedClassIds.length > 0) {
        const teachersForSubject = teacherSubjectMap.get(normalizeLabel(subject.name)) || [];
        if (teachersForSubject.length === 0) {
          unassignedSubjects.push({
            id: subject.id,
            message: `Ders: "${subject.name}" - Bu derse atanabilecek hiçbir öğretmen bulunamadı. Lütfen öğretmenlerin branşlarını kontrol edin.`,
          });
        }
      }
    });

    // 2. A class should exactly fill its configured weekly capacity.
    buildClassroomSummaries(data, schoolHours).forEach(({ classroom, demand, capacity }) => {
      if (demand > capacity) {
        overflowingClasses.push({
          id: classroom.id,
          message: `Sınıf: "${classroom.name}" - Tanımlı dersler ${demand} saat, haftalık kapasite ${capacity} saat. ${demand - capacity} saat fazla ders var.`,
        });
      } else if (demand < capacity) {
        incompleteClasses.push({
          id: classroom.id,
          message: `Sınıf: "${classroom.name}" - Tanımlı dersler ${demand} saat, haftalık kapasite ${capacity} saat. ${capacity - demand} saat ders eksik.`,
        });
      }
    });

    // 3. Hour variants are allowed, but the same class cannot be in two variants of one lesson.
    findDuplicateClassSubjects(data).forEach(duplicate => {
      duplicateClassSubjects.push({
        id: `${duplicate.classroomId}:${duplicate.normalizedSubjectName}`,
        message: `Çift giriş: "${duplicate.classroomName}" sınıfı, "${duplicate.subjectName}" dersinin ${duplicate.subjectIds.length} ayrı kaydında bulunuyor (${duplicate.totalHours} saat toplam).`,
      });
    });

    // 4. A teacher's unavoidable lesson load cannot exceed usable availability.
    buildTeacherCapacitySummaries(data, schoolHours)
      .filter(summary => summary.shortage > 0)
      .forEach(summary => {
        teacherCapacityErrors.push({
          id: summary.teacher.id,
          message: `Öğretmen: "${summary.teacher.name}" - Kesin ders yükü ${summary.definiteDemand} saat, kullanılabilir zamanı ${summary.capacity} saat. En az ${summary.shortage} saat müsaitlik açın, haftalık üst sınırı yükseltin veya ders atamalarını değiştirin.`,
        });
      });

    // 5. Gün bazında kapasite: haftalık toplam tutsa da tek bir gün imkânsız olabilir.
    //    Sınıf saatleri taşıyorsa (madde 2) bu hesap anlamsızdır; önce o düzeltilmeli.
    const dayCapacityErrors: ValidationError[] = [];
    if (overflowingClasses.length === 0) {
      const dayNames = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma'];
      buildDayCapacityShortages(data, schoolHours).forEach(({ dayIndex, demand, supply, absentTeachers }) => {
        const day = dayNames[dayIndex];
        dayCapacityErrors.push({
          id: `day:${dayIndex}`,
          message: `Gün: ${day} - Sınıfların ${day} günü en az ${demand} ders saati dolu olmak zorunda, ama o gün müsait öğretmenler en fazla ${supply} saat ders verebiliyor (${demand - supply} saat açık).`
            + (absentTeachers.length > 0 ? ` ${day} günü hiç müsait olmayanlar: ${absentTeachers.join(', ')}.` : '')
            + ` Bu öğretmenlerden birine ${day} günü müsaitlik açın ya da bazı dersleri ${day} günü gelebilen öğretmenlere verin.`,
        });
      });
    }

    const allErrors = [...unassignedSubjects, ...incompleteClasses, ...overflowingClasses, ...duplicateClassSubjects, ...teacherCapacityErrors, ...dayCapacityErrors];
    const isValid = allErrors.length === 0;

    return {
      isValid,
      unassignedSubjects,
      incompleteClasses,
      overflowingClasses,
      duplicateClassSubjects,
      teacherCapacityErrors,
      dayCapacityErrors,
      allErrors,
    };
  }, [data, schoolHours]);

  return validationResult;
};
