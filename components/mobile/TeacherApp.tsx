import React, { useEffect, useMemo, useState } from 'react';
import type { Schedule, TimetableData, SubstitutionAssignment } from '../../types';

const DAY_LABELS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma'];
const FIRST_LESSON_HOUR = 8;
const LESSON_DURATION_HOURS = 1;
const STORAGE_KEY = 'teacher-app:last-teacher';

export type TeacherAppProps = {
  publishedData: TimetableData | null;
  publishedSchedule: Schedule | null;
  assignments: SubstitutionAssignment[];
  maxDailyHours: number;
  isOpen: boolean;
  onClose: () => void;
  publishedAt?: string | null;
};

type LessonEntry = {
  dayIndex: number;
  hourIndex: number;
  subjectName: string;
  classroomName: string;
  type: 'lesson' | 'cover';
  absentTeacherName?: string;
  dutyName?: string;
  isCurrent: boolean;
};

const getCurrentSlot = (maxDailyHours: number) => {
  const now = new Date();
  const weekday = now.getDay(); // 0 = Sunday, 1 = Monday ...
  const dayIndex = weekday >= 1 && weekday <= 5 ? weekday - 1 : -1;
  if (dayIndex < 0) return null;
  const hour = now.getHours() + now.getMinutes() / 60;
  const rawIndex = Math.floor((hour - FIRST_LESSON_HOUR) / LESSON_DURATION_HOURS);
  if (rawIndex < 0 || rawIndex >= maxDailyHours) return null;
  return { dayIndex, hourIndex: rawIndex };
};

const TeacherApp: React.FC<TeacherAppProps> = ({
  publishedData,
  publishedSchedule,
  assignments,
  maxDailyHours,
  isOpen,
  onClose,
  publishedAt,
}) => {
  const teacherOptions = useMemo(
    () => (publishedData ? publishedData.teachers.map(t => ({ id: t.id, name: t.name })) : []),
    [publishedData]
  );

  const [selectedTeacherId, setSelectedTeacherId] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(STORAGE_KEY) ?? '';
  });

  const currentSlot = useMemo(() => getCurrentSlot(maxDailyHours), [maxDailyHours]);

  const [activeDayIndex, setActiveDayIndex] = useState<number>(() => {
    const slot = getCurrentSlot(maxDailyHours);
    return slot?.dayIndex ?? 0;
  });

  const hasPublication = Boolean(
    publishedData &&
      publishedSchedule &&
      Object.keys(publishedSchedule).length > 0
  );

  useEffect(() => {
    if (teacherOptions.length === 0) {
      setSelectedTeacherId('');
      return;
    }

    if (selectedTeacherId && teacherOptions.some(option => option.id === selectedTeacherId)) {
      return;
    }

    setSelectedTeacherId(teacherOptions[0].id);
  }, [teacherOptions, selectedTeacherId]);

  useEffect(() => {
    if (!selectedTeacherId || typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, selectedTeacherId);
  }, [selectedTeacherId]);

  const subjectMap = useMemo(
    () => new Map((publishedData?.subjects ?? []).map(subject => [subject.id, subject.name])),
    [publishedData]
  );
  const classroomMap = useMemo(
    () => new Map((publishedData?.classrooms ?? []).map(cls => [cls.id, cls.name])),
    [publishedData]
  );

  const lessonsByDay = useMemo(() => {
    const base: Record<number, LessonEntry[]> = {};
    if (!hasPublication || !publishedSchedule || !selectedTeacherId) {
      return base;
    }

    Object.entries(publishedSchedule).forEach(([classroomId, days]) => {
      const classroomName = classroomMap.get(classroomId) ?? 'Sınıf';
      days.forEach((day, dayIndex) => {
        day?.forEach((assignment, hourIndex) => {
          if (!assignment || !assignment.teacherIds.includes(selectedTeacherId)) return;
          const subjectName = subjectMap.get(assignment.subjectId) ?? 'Ders';
          const isCurrent = Boolean(
            currentSlot &&
            currentSlot.dayIndex === dayIndex &&
            currentSlot.hourIndex === hourIndex
          );
          const entry: LessonEntry = {
            dayIndex,
            hourIndex,
            subjectName,
            classroomName,
            type: 'lesson',
            isCurrent,
          };
          base[dayIndex] = base[dayIndex] ? [...base[dayIndex], entry] : [entry];
        });
      });
    });

    assignments
      .filter(assignment => assignment.substituteTeacherId === selectedTeacherId)
      .forEach(assignment => {
        const isCurrent = Boolean(
          currentSlot &&
          currentSlot.dayIndex === assignment.dayIndex &&
          currentSlot.hourIndex === assignment.hourIndex
        );
        const entry: LessonEntry = {
          dayIndex: assignment.dayIndex,
          hourIndex: assignment.hourIndex,
          subjectName: assignment.subjectName,
          classroomName: assignment.classroomName,
          type: 'cover',
          absentTeacherName: assignment.absentTeacherName,
          dutyName: assignment.dutyName,
          isCurrent,
        };
        base[assignment.dayIndex] = base[assignment.dayIndex] ? [...base[assignment.dayIndex], entry] : [entry];
      });

    return Object.fromEntries(
      Object.entries(base).map(([key, list]) => [
        Number(key),
        list.sort((a, b) => a.hourIndex - b.hourIndex),
      ])
    );
  }, [assignments, classroomMap, currentSlot, hasPublication, publishedSchedule, selectedTeacherId, subjectMap]);

  useEffect(() => {
    if (!hasPublication) return;
    const slotDay = currentSlot?.dayIndex;
    if (typeof slotDay === 'number' && (lessonsByDay[slotDay]?.length ?? 0) > 0) {
      setActiveDayIndex(slotDay);
      return;
    }
    const firstDayWithLessons = DAY_LABELS.findIndex((_, idx) => (lessonsByDay[idx]?.length ?? 0) > 0);
    if (firstDayWithLessons >= 0) {
      setActiveDayIndex(firstDayWithLessons);
    } else if (typeof slotDay === 'number') {
      setActiveDayIndex(slotDay);
    } else {
      setActiveDayIndex(0);
    }
  }, [hasPublication, lessonsByDay, currentSlot]);

  const lessonsForActiveDay = lessonsByDay[activeDayIndex] ?? [];

  const upcomingLesson = useMemo(() => {
    if (!currentSlot || !selectedTeacherId) return null;
    const todayLessons = lessonsByDay[currentSlot.dayIndex] ?? [];
    const remainingToday = todayLessons.filter(lesson => lesson.hourIndex >= currentSlot.hourIndex);
    return remainingToday.length > 0 ? remainingToday[0] : null;
  }, [lessonsByDay, currentSlot, selectedTeacherId]);

  const coverTasksForActiveDay = useMemo(
    () => lessonsForActiveDay.filter(lesson => lesson.type === 'cover'),
    [lessonsForActiveDay]
  );

  if (!isOpen) {
    return null;
  }

  const publishedAtText = publishedAt ? (() => {
    try {
      return new Date(publishedAt).toLocaleString('tr-TR');
    } catch {
      return publishedAt;
    }
  })() : null;

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-slate-900/70 backdrop-blur-sm">
      <div className="mt-auto w-full max-w-md mx-auto min-h-[70vh] max-h-[90vh] overflow-hidden rounded-t-3xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Öğretmen Paneli</h2>
            <p className="text-xs text-slate-500">Güncel ders programını ve nöbet görevlerini takip et.</p>
            {publishedAtText && (
              <p className="mt-1 text-[11px] text-slate-400">Son paylaşım: {publishedAtText}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 p-2 text-slate-500 hover:bg-slate-100"
            aria-label="Kapat"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-4 py-4">
          {teacherOptions.length > 0 ? (
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-600" htmlFor="teacher-select">Öğretmen seç</label>
              <select
                id="teacher-select"
                value={selectedTeacherId}
                onChange={(event) => setSelectedTeacherId(event.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {teacherOptions.map(option => (
                  <option key={option.id} value={option.id}>{option.name}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
              Bu okul için kayıtlı öğretmen bulunamadı. İdarecinin öğretmenleri tanımlaması gerekiyor.
            </div>
          )}

          {!hasPublication ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
              İdare henüz ders programı yayınlamadı. Program paylaşıldığında burada göreceksin.
            </div>
          ) : selectedTeacherId ? (
            <>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {DAY_LABELS.map((dayName, dayIndex) => {
                  const isActive = dayIndex === activeDayIndex;
                  const hasLessons = (lessonsByDay[dayIndex]?.length ?? 0) > 0;
                  return (
                    <button
                      key={dayName}
                      type="button"
                      onClick={() => setActiveDayIndex(dayIndex)}
                      className={`whitespace-nowrap rounded-full border px-3 py-1 text-sm transition ${
                        isActive
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-600'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      } ${hasLessons ? '' : 'opacity-60'}`}
                    >
                      {dayName}
                    </button>
                  );
                })}
              </div>

              {upcomingLesson && (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-3 text-sm text-indigo-800">
                  <div className="text-xs uppercase tracking-wide text-indigo-500">Sıradaki ders</div>
                  <div className="mt-1 text-base font-semibold text-indigo-900">
                    {upcomingLesson.hourIndex + 1}. saat • {upcomingLesson.subjectName}
                  </div>
                  <div className="text-xs text-indigo-700">{upcomingLesson.classroomName}</div>
                  {upcomingLesson.type === 'cover' && upcomingLesson.absentTeacherName && (
                    <div className="mt-1 text-xs text-indigo-700">
                      {upcomingLesson.absentTeacherName} yerine derse gireceksin.
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-3 pb-2">
                {lessonsForActiveDay.length === 0 ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                    Bu gün için ders veya nöbet görevi yok.
                  </div>
                ) : (
                  lessonsForActiveDay.map(lesson => (
                    <div
                      key={`${lesson.dayIndex}-${lesson.hourIndex}-${lesson.type}-${lesson.classroomName}`}
                      className={`rounded-xl border px-3 py-3 text-sm transition ${
                        lesson.isCurrent
                          ? 'border-emerald-200 bg-emerald-50 shadow-sm'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {lesson.hourIndex + 1}. saat
                        </span>
                        {lesson.type === 'cover' && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                            Nöbet görevi
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-base font-semibold text-slate-900">
                        {lesson.subjectName}
                      </div>
                      <div className="text-sm text-slate-600">{lesson.classroomName}</div>
                      {lesson.type === 'cover' && lesson.absentTeacherName && (
                        <div className="mt-1 text-xs text-slate-500">
                          {lesson.absentTeacherName} yok. Dersi sen üstleniyorsun{lesson.dutyName ? ` (${lesson.dutyName})` : ''}.
                        </div>
                      )}
                      {lesson.isCurrent && (
                        <div className="mt-2 rounded-md bg-emerald-600/10 px-2 py-1 text-xs font-medium text-emerald-700">
                          Şu anda bu derstesin.
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {coverTasksForActiveDay.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                  <h3 className="text-sm font-semibold">Bu günkü nöbet görevlerin</h3>
                  <ul className="mt-2 space-y-1 text-xs">
                    {coverTasksForActiveDay.map(task => (
                      <li key={`cover-${task.dayIndex}-${task.hourIndex}-${task.classroomName}`}>
                        {task.hourIndex + 1}. saat • {task.classroomName} – {task.subjectName}
                        {task.absentTeacherName ? ` (yerine: ${task.absentTeacherName})` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
              Programı görmek için yukarıdan öğretmen seç.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TeacherApp;
