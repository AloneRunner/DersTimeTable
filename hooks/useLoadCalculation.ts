
import { useMemo } from 'react';
import type { TimetableData, SchoolHours } from '../types';

export interface ClassroomLoad {
  demand: number;
  capacity: number;
}

export interface TeacherLoad {
    demand: number;
    capacity: number;
}

export const useLoadCalculation = (data: TimetableData, schoolHours: SchoolHours) => {
  const calculation = useMemo(() => {
    const classroomLoads = new Map<string, ClassroomLoad>();
    const teacherLoads = new Map<string, TeacherLoad>();

    // 1. Initialize maps
    data.classrooms.forEach(c => {
      classroomLoads.set(c.id, {
        demand: 0,
        capacity: schoolHours[c.level]?.reduce((acc, hours) => acc + hours, 0) || 0
      });
    });
    data.teachers.forEach(t => {
      const capacity = t.availability.flat().filter(Boolean).length;
      teacherLoads.set(t.id, { demand: 0, capacity });
    });

    // 2. Calculate classroom demand from subjects and groups
    data.subjects.forEach(subject => {
      subject.assignedClassIds.forEach(classroomId => {
        const load = classroomLoads.get(classroomId);
        if (load) {
          load.demand += subject.weeklyHours;
        }
      });
    });
    data.lessonGroups.forEach(group => {
      group.classroomIds.forEach(classroomId => {
        const load = classroomLoads.get(classroomId);
        if (load) {
          load.demand += group.weeklyHours;
        }
      });
    });

    // 3. Calculate approximate teacher load (pro-rata distribution)
    const subjectNameToTeachers = new Map<string, string[]>();
    data.teachers.forEach(teacher => {
      teacher.branches.forEach(branch => {
        if (!subjectNameToTeachers.has(branch)) {
          subjectNameToTeachers.set(branch, []);
        }
        subjectNameToTeachers.get(branch)!.push(teacher.id);
      });
    });

    // Handle subjects
    data.subjects.forEach(subject => {
      subject.assignedClassIds.forEach(classroomId => {
        const pinnedTeachersForClass = subject.pinnedTeacherByClassroom?.[classroomId];
        let teachersForLoadCalculation: string[] = [];

        if (pinnedTeachersForClass && pinnedTeachersForClass.length > 0) {
          // If teachers are pinned for this specific class, use them
          teachersForLoadCalculation = pinnedTeachersForClass;
        } else {
          // Otherwise, use branch-based eligible teachers
          teachersForLoadCalculation = subjectNameToTeachers.get(subject.name) || [];
        }

        if (teachersForLoadCalculation.length > 0) {
          // The demand for this subject for this specific class
          const demandPerClass = subject.weeklyHours;
          // Distribute this load among the determined teachers
          const perTeacherShare = demandPerClass / teachersForLoadCalculation.length;

          teachersForLoadCalculation.forEach(teacherId => {
            const load = teacherLoads.get(teacherId);
            if (load) {
              load.demand += perTeacherShare;
            }
          });
        }
      });
    });

    // Handle group lessons
    data.lessonGroups.forEach(group => {
      const subject = data.subjects.find(s => s.id === group.subjectId);
      if (subject) {
        const eligibleTeachers = subjectNameToTeachers.get(subject.name) || [];
        if (eligibleTeachers.length > 0) {
          // A group lesson requires one teacher per classroom for the duration.
          // Total teacher work hours is weeklyHours * number of classes in group.
          const totalTeacherHoursForGroup = group.weeklyHours * group.classroomIds.length;
          // Distribute this load among all teachers who can teach that subject.
          const perTeacherShare = totalTeacherHoursForGroup / eligibleTeachers.length;

          eligibleTeachers.forEach(teacherId => {
            const load = teacherLoads.get(teacherId);
            if (load) {
              load.demand += perTeacherShare;
            }
          });
        }
      }
    });
    
    // Add duties to teacher load
    data.duties.forEach(duty => {
        const load = teacherLoads.get(duty.teacherId);
        if(load) {
            load.demand += 1; // Assuming each duty is 1 hour
        }
    });

    return { classroomLoads, teacherLoads };
  }, [data, schoolHours]);

  return calculation;
};