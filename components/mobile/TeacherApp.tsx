import React, { useEffect, useMemo, useState } from 'react';
import type { Schedule, TimetableData, SubstitutionAssignment } from '../../types';

const DAY_LABELS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma'];
const FIRST_LESSON_HOUR = 8;
const LESSON_DURATION_HOURS = 1;

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
  const weekday = now.getDay(); // 0 = Sunday, 1 = Monday, ...
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
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>('');
  const currentSlot = useMemo(() => getCurrentSlot(maxDailyHours), [maxDailyHours]);
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
    if (!selectedTeacherId || !teacherOptions.some(option => option.id === selectedTeacherId)) {
      setSelectedTeacherId(teacherOptions[0].id);
    }
  }, [teacherOptions, selectedTeacherId]);

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

    Object.keys(base).forEach(key => {
      const idx = Number(key);
      base[idx].sort((a, b) => a.hourIndex - b.hourIndex);
    });

    return base;
  }, [assignments, classroomMap, currentSlot, hasPublication, publishedSchedule, selectedTeacherId, subjectMap]);

  const todayCoverTasks = useMemo(() => {
    if (!currentSlot || !selectedTeacherId) return [] as SubstitutionAssignment[];
    return assignments
      .filter(assignment => assignment.substituteTeacherId === selectedTeacherId && assignment.dayIndex === currentSlot.dayIndex)
      .sort((a, b) => a.hourIndex - b.hourIndex);
  }, [assignments, currentSlot, selectedTeacherId]);

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
      <div className="mt-auto max-h-[90vh] overflow-hidden rounded-t-3xl bg-white shadow-xl">
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
          {!hasPublication ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
              İdare henüz ders programı yayınlamadı. Program paylaşıldığında burada göreceksin.
            </div>
          ) : (
            <>
              <div className="space-y-3">
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

              {!selectedTeacherId && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  Programı görüntülemek için öğretmen seç.
                </div>
              )}

              {selectedTeacherId && (
                <div className="space-y-4">
                  {DAY_LABELS.map((dayName, dayIndex) => {
                    const lessons = lessonsByDay[dayIndex] ?? [];
                    return (
                      <div key={dayName} className="rounded-xl border border-slate-200 bg-white shadow-sm">
                        <div className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">
                          {dayName}
                        </div>
                        <div className="divide-y divide-slate-100">
                          {lessons.length === 0 ? (
                            <div className="px-3 py-3 text-xs text-slate-400">Bu gün için ders veya nöbet görevi yok.</div>
                          ) : (
                            lessons.map((lesson) => (
                              <div
                                key={`${lesson.dayIndex}-${lesson.hourIndex}-${lesson.type}-${lesson.classroomName}`}
                                className={`px-3 py-3 text-sm transition-colors ${lesson.isCurrent ? 'bg-emerald-50' : 'bg-white'}`}
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
                                    Şu anda bu saattesin.
                                  </div>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {selectedTeacherId && todayCoverTasks.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                  <h3 className="text-sm font-semibold">Bugünkü nöbet görevlerin</h3>
                  <ul className="mt-2 space-y-1 text-xs">
                    {todayCoverTasks.map(task => (
                      <li key={task.id}>
                        {task.hourIndex + 1}. saat • {task.classroomName} – {task.subjectName}
                        {task.absentTeacherName ? ` (yerine: ${task.absentTeacherName})` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default TeacherApp;
