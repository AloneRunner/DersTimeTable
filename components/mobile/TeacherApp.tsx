import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Schedule, TimetableData, SubstitutionAssignment, Duty } from '../../types';
import {
  loginWithPassword,
  extractTeacherMembership,
  loadTeacherSession,
  persistTeacherSession,
  type TeacherSessionSnapshot,
} from '../../services/authClient';
import { fetchTeacherSchedule, type TeacherScheduleResponse } from '../../services/scheduleClient';

const DAY_LABELS = ['Pazartesi', 'Sali', 'Carsamba', 'Persembe', 'Cuma'];
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
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(STORAGE_KEY) ?? '';
  });
  const [teacherSession, setTeacherSession] = useState<TeacherSessionSnapshot | null>(() => loadTeacherSession());
  const [teacherSchedule, setTeacherSchedule] = useState<TeacherScheduleResponse | null>(null);
  const [loginEmail, setLoginEmail] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [showLoginPassword, setShowLoginPassword] = useState<boolean>(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [isFetchingSchedule, setIsFetchingSchedule] = useState<boolean>(false);
  const lastFetchedTokenRef = useRef<string | null>(null);

  const isPreviewMode = Boolean(publishedData && publishedSchedule);

  const liveTeacherData = useMemo(
    () =>
      teacherSchedule
        ? {
            teacherId: teacherSchedule.teacher_id,
            teacherName: teacherSchedule.teacher_name ?? '',
            data: teacherSchedule.data,
            schedule: teacherSchedule.schedule,
            publishedAt: teacherSchedule.published_at,
            maxDailyHours: teacherSchedule.max_daily_hours,
          }
        : null,
    [teacherSchedule],
  );

  const effectiveData = liveTeacherData ? liveTeacherData.data : publishedData;
  const effectiveSchedule = liveTeacherData ? liveTeacherData.schedule : publishedSchedule;
  const effectiveAssignments = liveTeacherData ? liveTeacherData.assignments : assignments;
  const effectivePublishedAt = liveTeacherData ? liveTeacherData.publishedAt : publishedAt;

  const effectiveMaxDailyHours = useMemo(() => {
    if (liveTeacherData) {
      return liveTeacherData.maxDailyHours;
    }

    let maxHourIndex = 0;

    if (effectiveSchedule && selectedTeacherId) {
      Object.values(effectiveSchedule).forEach((days) => {
        days?.forEach((day) => {
          day?.forEach((assignment, hourIndex) => {
            if (!assignment) return;
            if (!assignment.teacherIds || !assignment.teacherIds.includes(selectedTeacherId)) return;
            if (hourIndex + 1 > maxHourIndex) {
              maxHourIndex = hourIndex + 1;
            }
          });
        });
      });
    }

    if (!liveTeacherData && selectedTeacherId) {
      effectiveAssignments
        .filter((assignment) => assignment.substituteTeacherId === selectedTeacherId)
        .forEach((assignment) => {
          if (typeof assignment.hourIndex === 'number') {
            const candidate = assignment.hourIndex + 1;
            if (candidate > maxHourIndex) {
              maxHourIndex = candidate;
            }
          }
        });
    }

    if (maxHourIndex === 0 && effectiveData && selectedTeacherId) {
      const teacher = effectiveData.teachers?.find((t) => t.id === selectedTeacherId);
      if (teacher?.availability?.length) {
        const availabilityMax = teacher.availability.reduce(
          (acc, row) => Math.max(acc, row?.length ?? 0),
          0,
        );
        if (availabilityMax > maxHourIndex) {
          maxHourIndex = availabilityMax;
        }
      }
    }

    if (maxHourIndex > 0) {
      return Math.min(maxDailyHours, maxHourIndex);
    }

    return maxDailyHours;
  }, [effectiveAssignments, effectiveData, effectiveSchedule, liveTeacherData, maxDailyHours, selectedTeacherId]);

  const teacherOptions = useMemo(() => {
    if (liveTeacherData) {
      return [
        {
          id: liveTeacherData.teacherId,
          name: liveTeacherData.teacherName || 'Programim',
        },
      ];
    }
    return effectiveData ? effectiveData.teachers.map((teacher) => ({ id: teacher.id, name: teacher.name })) : [];
  }, [effectiveData, liveTeacherData]);

  useEffect(() => {
    if (liveTeacherData) {
      setSelectedTeacherId(liveTeacherData.teacherId);
      return;
    }
    if (teacherOptions.length === 0) {
      setSelectedTeacherId('');
      return;
    }
    if (!selectedTeacherId || !teacherOptions.some((option) => option.id === selectedTeacherId)) {
      setSelectedTeacherId(teacherOptions[0].id);
    }
  }, [teacherOptions, selectedTeacherId, liveTeacherData]);

  useEffect(() => {
    if (liveTeacherData) return;
    if (typeof window === 'undefined') return;
    if (!selectedTeacherId) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, selectedTeacherId);
  }, [selectedTeacherId, liveTeacherData]);

  const subjectMap = useMemo(
    () => new Map((effectiveData?.subjects ?? []).map((subject) => [subject.id, subject.name])),
    [effectiveData?.subjects],
  );

  const classroomMap = useMemo(
    () => new Map((effectiveData?.classrooms ?? []).map((cls) => [cls.id, cls.name])),
    [effectiveData?.classrooms],
  );

  const hasPublication = Boolean(
    effectiveData && effectiveSchedule && Object.keys(effectiveSchedule).length > 0 && selectedTeacherId,
  );

  const lessonsByDay = useMemo(() => {
    const base: Record<number, LessonEntry[]> = {};
    if (!hasPublication || !effectiveSchedule || !selectedTeacherId) {
      return base;
    }

    Object.entries(effectiveSchedule).forEach(([classroomId, days]) => {
      const classroomName = classroomMap.get(classroomId) ?? 'Sinif';
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

    effectiveAssignments
      .filter((assignment) => assignment.substituteTeacherId === selectedTeacherId)
      .forEach((assignment) => {
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
      ]),
    );
  }, [classroomMap, effectiveAssignments, effectiveSchedule, hasPublication, selectedTeacherId, subjectMap]);

  const dutyMap = useMemo(() => {
    const map = new Map<string, Duty>();
    if (!effectiveData?.duties || !selectedTeacherId) return map;

    effectiveData.duties
      .filter((duty) => duty.teacherId === selectedTeacherId)
      .forEach((duty) => {
        if (typeof duty.hourIndex !== 'number' || duty.hourIndex < 0) {
          // hourIndex -1 veya eksik ise tüm gün boyunca geçerli say
          for (let hourIndex = 0; hourIndex < effectiveMaxDailyHours; hourIndex += 1) {
            const key = `${duty.dayIndex}-${hourIndex}`;
            if (!map.has(key)) {
              map.set(key, { ...duty, hourIndex });
            }
          }
        } else {
          map.set(`${duty.dayIndex}-${duty.hourIndex}`, duty);
        }
      });
    return map;
  }, [effectiveData?.duties, selectedTeacherId, effectiveMaxDailyHours]);

  const currentSlot = useMemo(() => getCurrentSlot(effectiveMaxDailyHours), [effectiveMaxDailyHours]);

  const weekMatrix = useMemo(() => {
    return DAY_LABELS.map((_, dayIndex) => {
      const dayLessons = lessonsByDay[dayIndex] ?? [];
      const lessonMap = new Map<string, LessonEntry>();
      dayLessons.forEach((lesson) => {
        lessonMap.set(`${dayIndex}-${lesson.hourIndex}`, lesson);
      });

      return Array.from({ length: effectiveMaxDailyHours }, (_, hourIndex): SlotCell => {
        const key = `${dayIndex}-${hourIndex}`;
        const isCurrent = Boolean(
          currentSlot && currentSlot.dayIndex === dayIndex && currentSlot.hourIndex === hourIndex,
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
  }, [currentSlot, dutyMap, effectiveMaxDailyHours, lessonsByDay]);

  const clearTeacherSession = useCallback(() => {
    persistTeacherSession(null);
    setTeacherSession(null);
    setTeacherSchedule(null);
    setScheduleError(null);
    lastFetchedTokenRef.current = null;
  }, []);

  const loadTeacherScheduleData = useCallback(
    async (snapshot: TeacherSessionSnapshot) => {
      setIsFetchingSchedule(true);
      setScheduleError(null);
      try {
        const response = await fetchTeacherSchedule(snapshot.token, { schoolId: snapshot.school.id });
        setTeacherSchedule(response);
      } catch (err: any) {
        const message = err instanceof Error ? err.message : 'Program yuklenemedi.';
        if (err?.code === 'unauthorized') {
          clearTeacherSession();
          setLoginError('Oturumunuzun suresi doldu. Lutfen tekrar giris yapin.');
        } else {
          setScheduleError(message);
        }
      } finally {
        setIsFetchingSchedule(false);
      }
    },
    [clearTeacherSession],
  );

  const handleTeacherLogin = useCallback(async () => {
    const email = loginEmail.trim().toLowerCase();
    const password = loginPassword.trim();
    if (!email || !password) {
      setLoginError('E-posta ve sifre girin.');
      return;
    }
    setIsVerifying(true);
    setLoginError(null);
    try {
      const session = await loginWithPassword({ email, password });
      const snapshot = extractTeacherMembership(session);
      if (!snapshot) {
        throw new Error('Bu hesap icin ogretmen yetkisi bulunamadi.');
      }
      persistTeacherSession(snapshot);
      setTeacherSession(snapshot);
      setTeacherSchedule(null);
      setScheduleError(null);
      lastFetchedTokenRef.current = snapshot.token;
      setLoginEmail('');
      setLoginPassword('');
      await loadTeacherScheduleData(snapshot);
    } catch (err: any) {
      const message = err instanceof Error ? err.message : 'Giris basarisiz. Bilgileri kontrol edin.';
      setLoginError(message);
    } finally {
      setIsVerifying(false);
    }
  }, [loginEmail, loginPassword, loadTeacherScheduleData]);

  const handleRefresh = useCallback(() => {
    if (!teacherSession || isPreviewMode) return;
    loadTeacherScheduleData(teacherSession);
  }, [isPreviewMode, loadTeacherScheduleData, teacherSession]);

  const handleLogout = useCallback(() => {
    clearTeacherSession();
    setLoginEmail('');
    setLoginPassword('');
    setShowLoginPassword(false);
    setLoginError(null);
  }, [clearTeacherSession]);

  const handleRetrySchedule = useCallback(() => {
    if (!teacherSession) return;
    loadTeacherScheduleData(teacherSession);
  }, [loadTeacherScheduleData, teacherSession]);

  useEffect(() => {
    if (isPreviewMode || !teacherSession) return;
    const intervalId = window.setInterval(() => {
      loadTeacherScheduleData(teacherSession);
    }, 60000);
    return () => window.clearInterval(intervalId);
  }, [isPreviewMode, teacherSession, loadTeacherScheduleData]);

  useEffect(() => {
    if (isPreviewMode) return;
    if (!teacherSession) {
      setTeacherSchedule(null);
      return;
    }
    if (lastFetchedTokenRef.current === teacherSession.token && teacherSchedule) {
      return;
    }
    lastFetchedTokenRef.current = teacherSession.token;
    loadTeacherScheduleData(teacherSession);
  }, [isPreviewMode, loadTeacherScheduleData, teacherSchedule, teacherSession]);

  if (!isOpen) {
    return null;
  }

  const publishedAtText = effectivePublishedAt
    ? (() => {
        try {
          return new Date(effectivePublishedAt).toLocaleString('tr-TR');
        } catch {
          return effectivePublishedAt;
        }
      })()
    : null;

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
    { label: 'Bos', className: 'border-slate-200 bg-slate-50' },
    { label: 'Nobet', className: 'border-indigo-300 bg-indigo-50' },
    { label: 'Nobette ders', className: 'border-amber-300 bg-amber-50' },
    { label: 'Simdiki ders', className: 'border-sky-400 bg-sky-50' },
  ];

  const showSchedule = hasPublication && (isPreviewMode || (!!teacherSession && !!teacherSchedule));

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-screen-lg items-center justify-between px-4 py-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Ogretmen Paneli</h2>
            <p className="text-xs text-slate-500">Haftalik ders programini, nobet gorevlerini ve bos saatlerini izle.</p>
            {!isPreviewMode && teacherSession && (
              <p className="mt-1 text-[11px] text-slate-500">
                {teacherSession.user.name || teacherSession.user.email} ·{' '}
                {teacherSession.school.name || `Okul #${teacherSession.school.id}`}
              </p>
            )}
            {publishedAtText && (
              <p className="mt-1 text-[11px] text-slate-400">Son paylasim: {publishedAtText}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!isPreviewMode && teacherSession && (
              <>
                <button
                  type="button"
                  onClick={handleRefresh}
                  className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
                >
                  Yenile
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
                >
                  Cikis
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-200 p-2 text-slate-500 hover:bg-slate-100"
              aria-label="Kapat"
            >
              ×
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        <div className="mx-auto flex h-full w-full max-w-screen-lg flex-col overflow-hidden px-4 pb-6">
          <div className="space-y-4 overflow-y-auto py-4">
            {!isPreviewMode && !teacherSession && (
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600 shadow">
                <h3 className="text-base font-semibold text-slate-900">Oturum ac</h3>
                <p className="mt-2 text-xs text-slate-500">
                  Idarecinin paylastigi e-posta ve sifre ile giris yap.
                </p>
                <div className="mt-4 flex flex-col gap-3">
                  <input
                    type="email"
                    value={loginEmail}
                    onChange={(event) => setLoginEmail(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        handleTeacherLogin();
                      }
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="ogretmen@example.com"
                    autoComplete="email"
                  />
                  <div className="flex items-center gap-2">
                    <input
                      type={showLoginPassword ? 'text' : 'password'}
                      value={loginPassword}
                      onChange={(event) => setLoginPassword(event.target.value.replace(/\s+/g, ''))}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          handleTeacherLogin();
                        }
                      }}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Sifre"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLoginPassword((prev) => !prev)}
                      className="rounded border border-slate-300 px-3 py-2 text-xs text-slate-600 hover:bg-slate-100"
                    >
                      {showLoginPassword ? 'Gizle' : 'Goster'}
                    </button>
                  </div>
                  {loginError && <p className="text-xs text-red-600">{loginError}</p>}
                  <button
                    type="button"
                    onClick={handleTeacherLogin}
                    disabled={isVerifying}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-700 disabled:opacity-60"
                  >
                    {isVerifying ? 'Giris yapiliyor...' : 'Giris yap'}
                  </button>
                </div>
                <p className="mt-3 text-[11px] text-slate-400">
                  Sifreniz yoksa idareci panelinden yeni sifre isteyin.
                </p>
              </div>
            )}

            {!isPreviewMode && teacherSession && !teacherSchedule && (
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600 shadow">
                {isFetchingSchedule ? (
                  <p>Program yukleniyor, lutfen bekleyin...</p>
                ) : scheduleError ? (
                  <div className="space-y-3">
                    <p className="text-red-600">{scheduleError}</p>
                    <button
                      type="button"
                      onClick={handleRetrySchedule}
                      className="rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                    >
                      Tekrar dene
                    </button>
                  </div>
                ) : (
                  <p>Program bilgisi bulunamadi. Lutfen daha sonra tekrar deneyin.</p>
                )}
              </div>
            )}

            {showSchedule ? (
              <>
                <div className="space-y-2">
                  {teacherOptions.length > 1 && (
                    <>
                      <label className="text-xs font-medium text-slate-600" htmlFor="teacher-select">
                        Ogretmen sec
                      </label>
                      <select
                        id="teacher-select"
                        value={selectedTeacherId}
                        onChange={(event) => setSelectedTeacherId(event.target.value)}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        {teacherOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                  {teacherOptions.length === 1 && (
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 shadow-sm">
                      {teacherOptions[0].name}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-3 text-[11px] text-slate-500">
                  {legendItems.map((item) => (
                    <span key={item.label} className="inline-flex items-center gap-1">
                      <span className={`inline-block h-3 w-3 rounded border ${item.className}`} />
                      {item.label}
                    </span>
                  ))}
                </div>

                <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-5">
                  {DAY_LABELS.map((dayName, dayIndex) => (
                    <div key={dayName} className="flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
                      <div className="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">
                        {dayName}
                      </div>
                      <div className="flex flex-col gap-2 px-3 py-3">
                        {weekMatrix[dayIndex]?.map((slot) => (
                          <div key={`${slot.dayIndex}-${slot.hourIndex}`} className={slotClassNames(slot)}>
                            <div className="flex items-center justify-between text-[10px] font-semibold uppercase text-slate-500">
                              <span>{slot.hourIndex + 1}. saat</span>
                              {slot.isCurrent && <span className="text-sky-600">Simdi</span>}
                            </div>
                            <div className="mt-1 text-[12px] font-semibold text-slate-900">
                              {slot.type === 'free' ? 'Bos' : slot.subjectName}
                            </div>
                            {slot.classroomName && (
                              <div className="text-[11px] text-slate-600">{slot.classroomName}</div>
                            )}
                            {slot.type === 'duty' && (
                              <div className="text-[11px] text-indigo-700">Nobet {slot.subjectName ?? ''}</div>
                            )}
                            {slot.type === 'cover' && (
                              <div className="text-[11px] text-amber-800">
                                {slot.absentTeacherName
                                  ? `${slot.absentTeacherName} yerine derse gireceksin`
                                  : 'Vekil ders'}
                                {slot.dutyName ? ` · ${slot.dutyName}` : ''}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              isPreviewMode && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
                  Yayimlanmis ders programi bulunmuyor. Idareci panelinden program paylasildiginda burada gosterilecek.
                </div>
              )
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default TeacherApp;
