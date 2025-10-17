import React, { useEffect, useMemo, useState } from 'react';
import type { Schedule, TimetableData, SubstitutionAssignment, Duty } from '../../types';

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
};

type SlotCell = {
  dayIndex: number;
  hourIndex: number;
  type: 'lesson' | 'cover' | 'duty' | 'free';
  subjectName?: string;
  classroomName?: string;
  dutyName?: string;
  absentTeacherName?: string;
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
          const entry: LessonEntry = {
            dayIndex,
            hourIndex,
            subjectName,
            classroomName,
            type: 'lesson',
          };
          base[dayIndex] = base[dayIndex] ? [...base[dayIndex], entry] : [entry];
        });
      });
    });

    assignments
      .filter(assignment => assignment.substituteTeacherId === selectedTeacherId)
      .forEach(assignment => {
        const entry: LessonEntry = {
          dayIndex: assignment.dayIndex,
          hourIndex: assignment.hourIndex,
          subjectName: assignment.subjectName,
          classroomName: assignment.classroomName,
          type: 'cover',
          absentTeacherName: assignment.absentTeacherName,
          dutyName: assignment.dutyName,
        };
        base[assignment.dayIndex] = base[assignment.dayIndex] ? [...base[assignment.dayIndex], entry] : [entry];
      });

    return Object.fromEntries(
      Object.entries(base).map(([key, list]) => [
        Number(key),
        list.sort((a, b) => a.hourIndex - b.hourIndex),
      ])
    );
  }, [assignments, classroomMap, hasPublication, publishedSchedule, selectedTeacherId, subjectMap]);

  const dutyMap = useMemo(() => {
    const map = new Map<string, Duty>();
    if (!publishedData?.duties || !selectedTeacherId) return map;
    publishedData.duties
      .filter(duty => duty.teacherId === selectedTeacherId)
      .forEach(duty => {
        map.set(`${duty.dayIndex}-${duty.hourIndex}`, duty);
      });
    return map;
  }, [publishedData, selectedTeacherId]);

  const weekMatrix = useMemo(() => {
    return DAY_LABELS.map((_, dayIndex) => {
      const dayLessons = lessonsByDay[dayIndex] ?? [];
      const lessonMap = new Map<string, LessonEntry>();
      dayLessons.forEach(lesson => {
        lessonMap.set(`${dayIndex}-${lesson.hourIndex}`, lesson);
      });

      return Array.from({ length: maxDailyHours }, (_, hourIndex): SlotCell => {
        const key = `${dayIndex}-${hourIndex}`;
        const isCurrent = Boolean(
          currentSlot &&
          currentSlot.dayIndex === dayIndex &&
          currentSlot.hourIndex === hourIndex
        );

        const lesson = lessonMap.get(key);
        if (lesson) {
          return {
            dayIndex,
            hourIndex,
            type: lesson.type,
            subjectName: lesson.subjectName,
            classroomName: lesson.classroomName,
            absentTeacherName: lesson.absentTeacherName,
            dutyName: lesson.dutyName,
            isCurrent,
          };
        }

        const duty = dutyMap.get(key);
        if (duty) {
          return {
            dayIndex,
            hourIndex,
            type: 'duty',
            subjectName: duty.name,
            dutyName: duty.name,
            isCurrent,
          };
        }

        return {
          dayIndex,
          hourIndex,
          type: 'free',
          isCurrent,
        };
      });
    });
  }, [currentSlot, dutyMap, lessonsByDay, maxDailyHours]);

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

  const slotClassNames = (slot: SlotCell) => {
    const base = 'rounded-md border px-2 py-2 text-[11px] leading-tight transition';
    if (slot.type === 'cover') {
      return `${base} border-amber-300 bg-amber-50 text-amber-900 ${slot.isCurrent ? 'ring-2 ring-amber-400' : ''}`;
    }
    if (slot.type === 'duty') {
      return `${base} border-indigo-300 bg-indigo-50 text-indigo-900 ${slot.isCurrent ? 'ring-2 ring-indigo-400' : ''}`;
    }
    if (slot.type === 'lesson') {
      return `${base} border-slate-200 bg-white text-slate-800 ${slot.isCurrent ? 'ring-2 ring-sky-400 shadow-sm' : ''}`;
    }
    return `${base} border-slate-200 bg-slate-50 text-slate-600 ${slot.isCurrent ? 'ring-2 ring-sky-300' : ''}`;
  };

  const legendItems = [
    { label: 'Ders', className: 'border-slate-200 bg-white' },
    { label: 'Boş', className: 'border-slate-200 bg-slate-50' },
    { label: 'Nöbet', className: 'border-indigo-300 bg-indigo-50' },
    { label: 'Nöbette ders', className: 'border-amber-300 bg-amber-50' },
    { label: 'Şu anki ders', className: 'border-sky-400 bg-sky-50' },
  ];

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-screen-lg items-center justify-between px-4 py-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Öğretmen Paneli</h2>
            <p className="text-xs text-slate-500">Haftalık ders programını, nöbet görevlerini ve boş saatlerini gör.</p>
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
      </header>

      <main className="flex-1 overflow-hidden">
        <div className="mx-auto flex h-full w-full max-w-screen-lg flex-col overflow-hidden px-4 pb-6">
          <div className="space-y-4 overflow-y-auto">
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

            <div className="flex flex-wrap gap-3 text-[11px] text-slate-500">
              {legendItems.map(item => (
                <span key={item.label} className="inline-flex items-center gap-1">
                  <span className={`inline-block h-3 w-3 rounded border ${item.className}`} />
                  {item.label}
                </span>
              ))}
            </div>

            {!hasPublication ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
                İdare henüz ders programı yayınlamadı. Program paylaşıldığında burada göreceksin.
              </div>
            ) : selectedTeacherId ? (
              <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-5">
                {DAY_LABELS.map((dayName, dayIndex) => (
                  <div key={dayName} className="flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">
                      {dayName}
                    </div>
                    <div className="flex flex-col gap-2 px-3 py-3">
                      {weekMatrix[dayIndex]?.map(slot => (
                        <div key={`${slot.dayIndex}-${slot.hourIndex}`} className={slotClassNames(slot)}>
                          <div className="flex items-center justify-between text-[10px] font-semibold uppercase text-slate-500">
                            <span>{slot.hourIndex + 1}. saat</span>
                            {slot.isCurrent && <span className="text-sky-600">Şimdi</span>}
                          </div>
                          <div className="mt-1 text-[12px] font-semibold text-slate-900">
                            {slot.type === 'free' ? 'Boş' : slot.subjectName}
                          </div>
                          {slot.classroomName && (
                            <div className="text-[11px] text-slate-600">{slot.classroomName}</div>
                          )}
                          {slot.type === 'duty' && (
                            <div className="text-[11px] text-indigo-700">
                              Nöbet {slot.subjectName ? `• ${slot.subjectName}` : ''}
                            </div>
                          )}
                          {slot.type === 'cover' && (
                            <div className="text-[11px] text-amber-800">
                              {slot.absentTeacherName} yerine derse gireceksin{slot.dutyName ? ` • ${slot.dutyName}` : ''}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
                Programı görmek için yukarıdan öğretmen seç.
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default TeacherApp;
