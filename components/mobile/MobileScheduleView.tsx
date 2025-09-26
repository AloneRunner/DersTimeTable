import React, { useMemo } from 'react';
import type { Schedule, TimetableData } from '../../types';
import { ViewType } from '../../types';

const DAY_LABELS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma'];

interface LessonInfo {
  hourLabel: string;
  subjectName: string;
  teacherNames?: string;
  classroomName?: string;
  locationName?: string;
  coTeachers?: string;
}

interface ProcessedSchedule {
  title: string;
  subtitle?: string;
  days: Array<{ dayName: string; lessons: LessonInfo[] }>;
}

interface MobileScheduleViewProps {
  schedule: Schedule;
  data: TimetableData;
  viewType: ViewType;
  selectedHeaderId: string;
  maxDailyHours: number;
}

const MobileScheduleView: React.FC<MobileScheduleViewProps> = ({
  schedule,
  data,
  viewType,
  selectedHeaderId,
  maxDailyHours,
}) => {
  const processed = useMemo<ProcessedSchedule | null>(() => {
    if (!selectedHeaderId || !schedule) {
      return null;
    }

    const teacherMap = new Map(data.teachers.map((teacher) => [teacher.id, teacher.name]));
    const subjectMap = new Map(data.subjects.map((subject) => [subject.id, subject.name]));
    const classroomMap = new Map(data.classrooms.map((classroom) => [classroom.id, classroom.name]));
    const locationMap = new Map(data.locations.map((location) => [location.id, location.name]));

    if (viewType === ViewType.Class) {
      const classroomSchedule = schedule[selectedHeaderId];
      if (!classroomSchedule) {
        return null;
      }

      const classroomName = classroomMap.get(selectedHeaderId) || 'Sınıf';
      const days = DAY_LABELS.map((dayName, dayIndex) => {
        const lessons: LessonInfo[] = [];
        const daySchedule = classroomSchedule[dayIndex] || [];

        for (let hourIndex = 0; hourIndex < maxDailyHours; hourIndex += 1) {
          const assignment = daySchedule[hourIndex];
          if (!assignment) continue;

          let span = 1;
          while (
            hourIndex + span < maxDailyHours &&
            daySchedule[hourIndex + span] === assignment
          ) {
            span += 1;
          }

          const startHour = hourIndex + 1;
          const endHour = startHour + span - 1;
          const hourLabel = span > 1 ? `${startHour}-${endHour}. saat` : `${startHour}. saat`;
          const teacherNames = assignment.teacherIds
            .map((id) => teacherMap.get(id))
            .filter(Boolean)
            .join(', ');

          lessons.push({
            hourLabel,
            subjectName: subjectMap.get(assignment.subjectId) || 'Ders',
            teacherNames,
            locationName: assignment.locationId ? locationMap.get(assignment.locationId) : undefined,
          });

          hourIndex += span - 1;
        }

        return { dayName, lessons };
      });

      return {
        title: classroomName,
        subtitle: 'Sınıf programı',
        days,
      };
    }

    // Teacher view
    const teacherName = teacherMap.get(selectedHeaderId);
    if (!teacherName) {
      return null;
    }

    const lessonsByDay: Array<{ dayName: string; lessons: LessonInfo[] }> = DAY_LABELS.map((dayName) => ({
      dayName,
      lessons: [],
    }));

    Object.entries(schedule).forEach(([classroomId, classroomSchedule]) => {
      const classroomName = classroomMap.get(classroomId) || 'Sınıf';
      classroomSchedule.forEach((daySchedule, dayIndex) => {
        for (let hourIndex = 0; hourIndex < maxDailyHours; hourIndex += 1) {
          const assignment = daySchedule?.[hourIndex];
          if (!assignment || !assignment.teacherIds.includes(selectedHeaderId)) continue;

          let span = 1;
          while (
            hourIndex + span < maxDailyHours &&
            daySchedule[hourIndex + span] === assignment
          ) {
            span += 1;
          }

          const startHour = hourIndex + 1;
          const endHour = startHour + span - 1;
          const hourLabel = span > 1 ? `${startHour}-${endHour}. saat` : `${startHour}. saat`;
          const coTeachers = assignment.teacherIds
            .filter((id) => id !== selectedHeaderId)
            .map((id) => teacherMap.get(id))
            .filter(Boolean)
            .join(', ');

          lessonsByDay[dayIndex].lessons.push({
            hourLabel,
            subjectName: subjectMap.get(assignment.subjectId) || 'Ders',
            classroomName,
            locationName: assignment.locationId ? locationMap.get(assignment.locationId) : undefined,
            coTeachers: coTeachers || undefined,
          });

          hourIndex += span - 1;
        }
      });
    });

    return {
      title: teacherName,
      subtitle: 'Öğretmen programı',
      days: lessonsByDay,
    };
  }, [schedule, data, viewType, selectedHeaderId, maxDailyHours]);

  if (!processed) {
    return (
      <div className="md:hidden no-print rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
        Seçilen kayıt için mobil program özeti bulunamadı.
      </div>
    );
  }

  const totalLessons = processed.days.reduce((sum, day) => sum + day.lessons.length, 0);

  return (
    <div className="md:hidden no-print space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
        <h3 className="text-lg font-semibold text-slate-800">{processed.title}</h3>
        {processed.subtitle && <p className="text-sm text-slate-500">{processed.subtitle}</p>}
        <p className="mt-1 text-xs text-slate-500">
          {totalLessons > 0
            ? `${totalLessons} ders listelendi. Günlere dokunarak detayları görebilirsiniz.`
            : 'Henüz bu seçim için tanımlı ders bulunmuyor.'}
        </p>
      </div>
      {processed.days.map(({ dayName, lessons }) => (
        <div key={dayName} className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
            {dayName}
          </div>
          <div className="divide-y divide-slate-200">
            {lessons.length > 0 ? (
              lessons.map((lesson, index) => (
                <div key={`${dayName}-${index}`} className="flex flex-col gap-1 px-4 py-3 text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wide text-sky-600">
                    {lesson.hourLabel}
                  </span>
                  <span className="text-base font-semibold text-slate-800">{lesson.subjectName}</span>
                  {lesson.teacherNames && (
                    <span className="text-sm text-slate-600">{lesson.teacherNames}</span>
                  )}
                  {lesson.classroomName && (
                    <span className="text-sm text-slate-600">{lesson.classroomName}</span>
                  )}
                  {lesson.coTeachers && (
                    <span className="text-xs text-slate-500">Diğer öğretmenler: {lesson.coTeachers}</span>
                  )}
                  {lesson.locationName && (
                    <span className="text-xs text-slate-500">Mekan: {lesson.locationName}</span>
                  )}
                </div>
              ))
            ) : (
              <div className="px-4 py-3 text-sm text-slate-500 italic">Bu güne ait ders yok.</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default MobileScheduleView;
