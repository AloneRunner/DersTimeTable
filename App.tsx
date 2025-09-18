
import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useTimetableData } from './hooks/useTimetableData';
import type { Schedule, Teacher, Classroom, Subject, Location, TimetableData, FixedAssignment, LessonGroup, Duty, SavedSchedule, SchoolHours, SolverStats } from './types';
import { SchoolLevel, ClassGroup, ViewType } from './types';
import { solveTimetableLocally } from './services/localSolver';
import { TimetableView } from './components/TimetableView';
import { AutocompleteInput } from './components/AutocompleteInput';
import { subjectSuggestions } from './data/suggestions';
import { PlusIcon, TrashIcon, PencilIcon, DownloadIcon, PrintIcon, UploadIcon, SaveIcon, WarningIcon } from './components/icons';
import { QrTools } from './components/QrTools';
import { useDataValidation } from './hooks/useDataValidation';
import { useLoadCalculation } from './hooks/useLoadCalculation';
import type { TeacherLoad } from './hooks/useLoadCalculation';
import { ConflictAnalyzer } from './components/ConflictAnalyzer';
import { Modal } from './components/Modal';
import { solveTimetableCP } from './services/cpSatClient';
import { TeacherForm } from './components/forms/TeacherForm';
import { ClassroomForm } from './components/forms/ClassroomForm';
import { SubjectForm } from './components/forms/SubjectForm';
import { LocationForm } from './components/forms/LocationForm';
import { FixedAssignmentForm } from './components/forms/FixedAssignmentForm';
import { LessonGroupForm } from './components/forms/LessonGroupForm';
import { DutyForm } from './components/forms/DutyForm';
import { QualitySummary } from './components/QualitySummary';

type Tab = 'teachers' | 'classrooms' | 'subjects' | 'locations' | 'fixedAssignments' | 'lessonGroups' | 'duties';
type ModalState = { type: Tab; item: any | null } | { type: null; item: null };
type ViewMode = 'single' | 'master';

const DAYS = ["Pazartesi", "Sal\u0131", "\u00C7ar\u015Famba", "Per\u015Fembe", "Cuma"];
 // Normalize Turkish characters in DAYS to avoid encoding artifacts
 const __DAYS_FIX = ["Pazartesi", "Sal\u0131", "\u00C7ar\u015Famba", "Per\u015Fembe", "Cuma"];
 try {
   // Mutate array in place; binding is const but contents are mutable
   if (typeof DAYS !== 'undefined' && Array.isArray(DAYS)) {
     for (let i = 0; i < Math.min(DAYS.length, __DAYS_FIX.length); i++) {
       DAYS[i] = __DAYS_FIX[i];
     }
   }
 } catch {}
 
 // --- Modal Component --- (moved to components/Modal)

// --- Teacher Load Analysis Component ---
const TeacherLoadAnalysis: React.FC<{ teachers: Teacher[], teacherLoads: Map<string, TeacherLoad> }> = ({ teachers, teacherLoads }) => {
    const sortedTeachers = useMemo(() => {
        if (!teachers || !teacherLoads) return [];
        return [...teachers].map(t => {
            const load = teacherLoads.get(t.id) || { demand: 0, capacity: 0 };
            const utilization = load.capacity > 0 ? (load.demand / load.capacity) * 100 : 0;
            return { ...t, load, utilization };
        }).sort((a, b) => b.utilization - a.utilization);
    }, [teachers, teacherLoads]);

    if(sortedTeachers.length === 0) return null;

    return (
        <div className="bg-white p-6 rounded-lg shadow-lg no-print">
            <h2 className="text-xl font-bold mb-4">Öğretmen Yük Analizi</h2>
            <p className="text-sm text-slate-500 mb-4">
                Bu bölüm, öğretmenlerin atanmış ders yüklerinin müsaitliklerine oranını gösterir. %100'ü aşan bir kullanım, programın çözülmesini engelleyebilir.
            </p>
            <div className="space-y-4 max-h-72 overflow-y-auto pr-2">
                {sortedTeachers.map(teacher => {
                    const util = teacher.utilization;
                    let bgColor = 'bg-sky-500';
                    if (util > 100) bgColor = 'bg-red-500';
                    else if (util > 90) bgColor = 'bg-yellow-500';

                    let textColor = 'text-slate-800';
                    if (util > 100) textColor = 'text-red-600';
                    else if (util > 90) textColor = 'text-yellow-600';

                    return (
                        <div key={teacher.id}>
                            <div className="flex justify-between items-center mb-1 text-sm">
                                <span className="font-medium">{teacher.name}</span>
                                <span className={`font-semibold ${textColor}`}>
                                    {Math.round(teacher.load.demand)} / {teacher.load.capacity} saat ({Math.round(util)}%)
                                </span>
                            </div>
                            <div className="w-full bg-slate-200 rounded-full h-2.5">
                                <div 
                                    className={`${bgColor} h-2.5 rounded-full transition-all duration-500`} 
                                    style={{ width: `${Math.min(util, 100)}%` }}
                                ></div>
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    );
};




const TeacherActualLoadPanel: React.FC<{ teachers: Teacher[]; teacherLoads: Map<string, TeacherLoad>; actualLoads: Map<string, number> | null; }> = ({ teachers, teacherLoads, actualLoads }) => {
    const rows = useMemo(() => {
        if (!actualLoads) return null;
        return teachers.map(t => {
            const expected = teacherLoads.get(t.id);
            const actual = actualLoads.get(t.id) || 0;
            const target = expected?.demand ?? 0;
            const delta = actual - target;
            return {
                id: t.id,
                name: t.name,
                actual,
                target,
                delta,
            };
        }).sort((a, b) => b.actual - a.actual);
    }, [teachers, teacherLoads, actualLoads]);

    if (!actualLoads) {
        return (
            <div className="bg-white p-6 rounded-lg shadow-lg no-print">
                <h2 className="text-xl font-bold mb-4">Gerçekleşen Ders Yükleri</h2>
                <p className="text-sm text-slate-500">Henüz program oluşturulmadı.</p>
            </div>
        );
    }

    if (!rows || rows.length === 0) return null;

    return (
        <div className="bg-white p-6 rounded-lg shadow-lg no-print">
            <h2 className="text-xl font-bold mb-4">Gerçekleşen Ders Yükleri</h2>
            <p className="text-sm text-slate-500 mb-4">Aşağıdaki tablo çözülen programdaki ders saatlerini gösterir. “Hedef” sütunu veri girişinden geliyor.</p>
            <div className="space-y-3 max-h-72 overflow-y-auto pr-2">
                {rows.map(row => {
                    const deltaClass = row.delta === 0 ? 'text-slate-600' : row.delta > 0 ? 'text-red-600' : 'text-emerald-600';
                    return (
                        <div key={row.id} className="text-sm">
                            <div className="flex justify-between items-center mb-1">
                                <span className="font-medium text-slate-700">{row.name}</span>
                                <span className="text-slate-500">{row.actual} saat</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                                <span>Hedef: {row.target}</span>
                                <span className={deltaClass}>Δ {row.delta > 0 ? `+${row.delta}` : row.delta}</span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const MultiTeacherWarnings: React.FC<{ data: TimetableData; schedule: Schedule | null; }> = ({ data, schedule }) => {
    const issues = useMemo(() => {
        if (!schedule) return [];
        const subjectById = new Map(data.subjects.map(s => [s.id, s.name]));
        const classById = new Map(data.classrooms.map(c => [c.id, c.name]));
        const teacherById = new Map(data.teachers.map(t => [t.id, t.name]));
        const map = new Map<string, Set<string>>();

        Object.entries(schedule).forEach(([classroomId, days]) => {
            days.forEach(day => {
                day.forEach(slot => {
                    if (!slot) return;
                    const key = `${classroomId}::${slot.subjectId}`;
                    if (!map.has(key)) map.set(key, new Set());
                    map.get(key)!.add(slot.teacherId);
                });
            });
        });

        const result: Array<{ classroom: string; subject: string; teachers: string[] }> = [];

        map.forEach((teachers, key) => {
            if (teachers.size <= 1) return;
            const [classroomId, subjectId] = key.split('::');
            result.push({
                classroom: classById.get(classroomId) || classroomId,
                subject: subjectById.get(subjectId) || subjectId,
                teachers: Array.from(teachers).map(tid => teacherById.get(tid) || tid),
            });
        });

        return result.sort((a, b) => a.classroom.localeCompare(b.classroom, 'tr'));
    }, [schedule, data]);

    if (!schedule || issues.length === 0) return null;

    return (
        <div className="bg-white p-6 rounded-lg shadow-lg no-print">
            <h2 className="text-xl font-bold mb-4">Paylaşılan Ders Uyarıları</h2>
            <p className="text-sm text-slate-500 mb-3">Aynı sınıf ve ders için birden fazla öğretmen görevlendirilmiş. İsterseniz sabit atamalarla düzenleyebilirsiniz.</p>
            <ul className="space-y-2 text-sm text-slate-700">
                {issues.map((issue, idx) => (
                    <li key={idx} className="border border-amber-200 bg-amber-50 rounded-md px-3 py-2">
                        <div className="font-semibold text-amber-800">{issue.classroom} · {issue.subject}</div>
                        <div className="text-amber-700 text-xs">{issue.teachers.join(', ')}</div>
                    </li>
                ))}
            </ul>
        </div>
    );
};

const colorForPercent = (percent: number) => {
    const clamped = Math.max(0, Math.min(100, percent));
    const hue = (clamped / 100) * 120;
    const lightness = Math.max(25, 65 - clamped * 0.25);
    return `hsl(${Math.round(hue)}, 70%, ${Math.round(lightness)}%)`;
};

const TeacherAvailabilityHeatmap: React.FC<{ teachers: Teacher[]; dayNames: string[]; maxDailyHours: number; }> = ({ teachers, dayNames, maxDailyHours }) => {
    const stats = useMemo(() => {
        const totalTeachers = teachers.length;
        const days = 5;
        const hours = Math.max(1, maxDailyHours || 0);
        if (totalTeachers === 0 || hours === 0) {
            return null;
        }

        const perHourCounts: number[][] = Array.from({ length: days }, () => Array(hours).fill(0));
        const perDayTotals: number[] = Array(days).fill(0);
        const dayOffCounts: number[] = Array(days).fill(0);

        teachers.forEach(teacher => {
            for (let d = 0; d < days; d++) {
                const availabilityRow = teacher.availability?.[d] || [];
                let dayAvailable = 0;
                for (let h = 0; h < hours; h++) {
                    if (availabilityRow[h]) {
                        perHourCounts[d][h] += 1;
                        dayAvailable += 1;
                    }
                }
                perDayTotals[d] += dayAvailable;
                if (dayAvailable === 0) {
                    dayOffCounts[d] += 1;
                }
            }
        });

        const perHourPercent = perHourCounts.map(row => row.map(val => (val / totalTeachers) * 100));
        const perDayPercent = perDayTotals.map(total => total > 0 ? (total / (totalTeachers * hours)) * 100 : 0);

        let criticalSlot: { dayIndex: number; hourIndex: number; percent: number } | null = null;
        perHourPercent.forEach((row, dayIndex) => {
            row.forEach((percent, hourIndex) => {
                if (criticalSlot === null || percent < criticalSlot.percent) {
                    criticalSlot = { dayIndex, hourIndex, percent };
                }
            });
        });

        return {
            totalTeachers,
            perHourCounts,
            perHourPercent,
            perDayPercent,
            dayOffCounts,
            hours,
            criticalSlot,
        } as const;
    }, [teachers, maxDailyHours]);

    if (!stats) {
        return null;
    }

    const { totalTeachers, perHourCounts, perHourPercent, perDayPercent, dayOffCounts, hours, criticalSlot } = stats;

    const renderPercentCell = (dayIndex: number, hourIndex: number) => {
        const percent = perHourPercent[dayIndex]?.[hourIndex] ?? 0;
        const count = perHourCounts[dayIndex]?.[hourIndex] ?? 0;
        const backgroundColor = colorForPercent(percent);
        const textColorClass = percent <= 35 ? 'text-white' : 'text-slate-800';
        return (
            <td key={dayIndex} className="p-2 border" style={{ backgroundColor }}>
                <div className="flex flex-col items-center gap-0.5 leading-tight">
                    <span className={`font-semibold text-xs ${textColorClass}`}>{Math.round(percent)}%</span>
                    <span className={`text-[10px] ${textColorClass} opacity-80`}>{count}/{totalTeachers}</span>
                </div>
            </td>
        );
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow-lg no-print">
            <h2 className="text-xl font-bold mb-4">Gün / Saat Yük Analizi</h2>
            <p className="text-sm text-slate-500 mb-4">
                Hangi gün ve saatlerde aktif öğretmen sayısının düştüğünü gösterir. Yüzdeler mevcut öğretmenlerin o slotta uygun olma oranıdır.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-4 text-sm mb-4">
                {dayNames.map((day, index) => {
                    const percent = perDayPercent[index] ?? 0;
                    const dayColor = colorForPercent(percent);
                    return (
                        <div key={day} className="space-y-1">
                            <div className="flex items-center justify-between text-xs text-slate-500">
                                <span className="font-medium text-slate-700">{day}</span>
                                <span className="font-semibold text-slate-600">%{Math.round(percent)}</span>
                            </div>
                            <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${Math.min(percent, 100)}%`, backgroundColor: dayColor }}></div>
                            </div>
                            <div className="text-[11px] text-slate-500">
                                {dayOffCounts[index]} öğretmen tam gün izinli
                            </div>
                        </div>
                    );
                })}
            </div>
            {criticalSlot && criticalSlot.percent < 80 && (
                <div className="text-xs text-amber-600 mb-3">
                    Kritik slot: {dayNames[criticalSlot.dayIndex]} {criticalSlot.hourIndex + 1}. ders için uygunluk %{Math.round(criticalSlot.percent)}.
                </div>
            )}
            <div className="overflow-x-auto">
                <table className="min-w-full border text-center text-xs">
                    <thead>
                        <tr>
                            <th className="p-2 border bg-slate-100 text-slate-600">Saat</th>
                            {dayNames.map(day => (
                                <th key={day} className="p-2 border bg-slate-100 text-slate-600">{day}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {Array.from({ length: hours }).map((_, hourIndex) => (
                            <tr key={hourIndex}>
                                <td className="p-2 border font-medium bg-slate-50 text-slate-600">{hourIndex + 1}. Ders</td>
                                {dayNames.map((_, dayIndex) => renderPercentCell(dayIndex, hourIndex))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="text-[11px] text-slate-500 mt-2">
                Hücrelerdeki değerler uygun öğretmen / toplam öğretmen sayısını ve yüzde karşılığını gösterir.
            </p>
        </div>
    );
};

const DutyCoveragePanel: React.FC<{ data: TimetableData; schedule: Schedule | null; dayNames: string[]; }> = ({ data, schedule, dayNames }) => {
    const [selectedDay, setSelectedDay] = useState<number>(0);
    const [absentTeacherId, setAbsentTeacherId] = useState<string>('');

    const teacherOptions = useMemo(() => data.teachers.map(t => ({ id: t.id, name: t.name })), [data.teachers]);

    useEffect(() => {
        if (teacherOptions.length === 0) {
            setAbsentTeacherId('');
            return;
        }
        if (!absentTeacherId || !teacherOptions.some(opt => opt.id === absentTeacherId)) {
            setAbsentTeacherId(teacherOptions[0].id);
        }
    }, [teacherOptions, absentTeacherId]);

    const suggestions = useMemo(() => {
        if (!schedule || !absentTeacherId) return [] as Array<{
            classroomName: string;
            subjectName: string;
            hourIndex: number;
            options: Array<{ id: string; name: string; note: string; status: 'available' | 'unavailable'; dutyName?: string }>;
        }>;

        const teacherById = new Map(data.teachers.map(t => [t.id, t]));
        const subjectById = new Map(data.subjects.map(s => [s.id, s]));

        const result: Array<{
            classroomName: string;
            subjectName: string;
            hourIndex: number;
            options: Array<{ id: string; name: string; note: string; status: 'available' | 'unavailable'; dutyName?: string }>;
        }> = [];

        const dayIndex = selectedDay;

        const isTeacherBusy = (teacherId: string, hourIndex: number) => {
            for (const classroomId of Object.keys(schedule)) {
                const slot = schedule[classroomId]?.[dayIndex]?.[hourIndex];
                if (slot && slot.teacherId === teacherId) {
                    return true;
                }
            }
            return false;
        };

        data.classrooms.forEach(classroom => {
            const lessonsForDay = schedule[classroom.id]?.[dayIndex] || [];
            lessonsForDay.forEach((assignment, hourIndex) => {
                if (!assignment || assignment.teacherId !== absentTeacherId) return;
                const subjectName = subjectById.get(assignment.subjectId)?.name || 'Ders';

                const dutyCandidates = data.duties.filter(duty => {
                    if (duty.dayIndex !== dayIndex) return false;
                    if (typeof duty.hourIndex !== 'number') return true;
                    if (duty.hourIndex === -1) return true;
                    return duty.hourIndex === hourIndex;
                });

                const uniqueOptions = new Map<string, { id: string; name: string; note: string; status: 'available' | 'unavailable'; dutyName?: string }>();

                dutyCandidates.forEach(duty => {
                    const dutyTeacher = teacherById.get(duty.teacherId);
                    if (!dutyTeacher || duty.teacherId === absentTeacherId) return;
                    const availabilityRow = dutyTeacher.availability?.[dayIndex] || [];
                    const isAvailable = availabilityRow[hourIndex] === true;
                    const busy = isTeacherBusy(duty.teacherId, hourIndex);
                    const status: 'available' | 'unavailable' = (isAvailable && !busy) ? 'available' : 'unavailable';
                    const note = busy
                        ? 'Bu saatte zaten dersi var'
                        : (isAvailable ? 'Müsait' : 'Müsaitlikte kapalı');
                    if (!uniqueOptions.has(duty.teacherId)) {
                        uniqueOptions.set(duty.teacherId, {
                            id: duty.teacherId,
                            name: dutyTeacher.name,
                            note,
                            status,
                            dutyName: duty.name,
                        });
                    }
                });
                const options = Array.from(uniqueOptions.values()).sort((a, b) => {
                    if (a.status === b.status) {
                        return a.name.localeCompare(b.name, 'tr');
                    }
                    return a.status === 'available' ? -1 : 1;
                });

                result.push({
                    classroomName: classroom.name,
                    subjectName,
                    hourIndex,
                    options,
                });
            });
        });

        return result.sort((a, b) => {
            if (a.hourIndex !== b.hourIndex) return a.hourIndex - b.hourIndex;
            return a.classroomName.localeCompare(b.classroomName, 'tr');
        });
    }, [data.classrooms, data.duties, data.subjects, data.teachers, schedule, selectedDay, absentTeacherId]);

    const absentLessonCount = useMemo(() => {
        if (!schedule || !absentTeacherId) return 0;
        const dayIndex = selectedDay;
        let count = 0;
        Object.keys(schedule).forEach(classroomId => {
            const lessons = schedule[classroomId]?.[dayIndex] || [];
            lessons.forEach(assignment => {
                if (assignment?.teacherId === absentTeacherId) count += 1;
            });
        });
        return count;
    }, [schedule, selectedDay, absentTeacherId]);

    return (
        <div className="bg-white p-6 rounded-lg shadow-lg no-print">
            <h2 className="text-xl font-bold mb-3">Nöbetçi Yerine Geçme Yardımcısı</h2>
            <p className="text-sm text-slate-500 mb-4">
                Bir öğretmen devamsız olduğunda, aynı gün ve saatte nöbetçi olarak atanmış öğretmenlerden hangilerinin derse girebileceğini listeler.
            </p>
            <div className="flex flex-wrap items-center gap-3 mb-4 text-sm">
                <label className="flex items-center gap-2">
                    <span className="text-slate-600">Gün</span>
                    <select value={selectedDay} onChange={(e) => setSelectedDay(Number(e.target.value))} className="border rounded px-2 py-1">
                        {dayNames.map((day, index) => (
                            <option key={day} value={index}>{day}</option>
                        ))}
                    </select>
                </label>
                <label className="flex items-center gap-2">
                    <span className="text-slate-600">Devamsız Öğretmen</span>
                    <select value={absentTeacherId} onChange={(e) => setAbsentTeacherId(e.target.value)} className="border rounded px-2 py-1">
                        <option value="">Seçiniz</option>
                        {teacherOptions.map(opt => (
                            <option key={opt.id} value={opt.id}>{opt.name}</option>
                        ))}
                    </select>
                </label>
                {absentLessonCount > 0 && (
                    <span className="text-xs text-slate-500">Seçilen gün için programda {absentLessonCount} ders bulunuyor.</span>
                )}
            </div>
            {!schedule && (
                <div className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-md p-3">
                    Önce bir program oluştur ya da yükle; ardından nöbetçi önerileri burada listelenir.
                </div>
            )}
            {schedule && !absentTeacherId && (
                <div className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-md p-3">
                    Önce devamsız öğretmeni seçin.
                </div>
            )}
            {schedule && absentTeacherId && suggestions.length === 0 && (
                <div className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-md p-3">
                    Seçilen öğretmenin bu gün için programa yazılmış dersi yok.
                </div>
            )}
            {schedule && absentTeacherId && suggestions.length > 0 && (
                <div className="space-y-3">
                    {suggestions.map(item => (
                        <div key={`${item.classroomName}-${item.hourIndex}`} className="border border-slate-200 rounded-md p-3">
                            <div className="flex flex-wrap items-center justify-between text-sm">
                                <span className="font-semibold text-slate-700">{item.hourIndex + 1}. Ders</span>
                                <span className="text-slate-500">{item.classroomName} · {item.subjectName}</span>
                            </div>
                            {item.options.length > 0 ? (
                                <ul className="mt-2 space-y-1 text-sm">
                                    {item.options.map(opt => (
                                        <li key={opt.id} className={`flex flex-wrap items-center gap-2 rounded-md px-2 py-1 ${opt.status === 'available' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                            <span className="font-medium">{opt.name}</span>
                                            {opt.dutyName && (
                                                <span className="text-xs text-slate-500">({opt.dutyName})</span>
                                            )}
                                            <span className="text-xs ml-auto">{opt.note}</span>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="mt-2 text-sm text-slate-500">Bu saat için tanımlı nöbetçi yok.</p>
                            )}
                        </div>
                    ))}
                </div>
            )}
            {schedule && absentTeacherId && data.duties.length === 0 && (
                <p className="mt-4 text-xs text-amber-600">Henüz nöbet verisi eklenmemiş. Önce Öğretmen &gt; Ek Görevler sekmesinden nöbet listesi oluştur.</p>
            )}
        </div>
    );
};
// Basit tooltip yardımcı bileşeni (hover ile küçük açıklama kutusu)
const Tooltip: React.FC<{ text: string; children: React.ReactNode }> = ({ text, children }) => (
  <span className="relative group inline-flex items-center">
    {children}
    <span className="absolute z-50 hidden group-hover:block group-focus-within:block top-full mt-1 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10px] leading-snug px-2 py-1 rounded shadow max-w-[280px] whitespace-normal break-words text-left" role="tooltip">
      {text}
    </span>
  </span>
);

// --- Main App Component ---
const App: React.FC = () => {
    const { data, addTeacher, updateTeacher, removeTeacher, addClassroom, updateClassroom, removeClassroom, addSubject, updateSubject, removeSubject, addLocation, updateLocation, removeLocation, addFixedAssignment, removeFixedAssignment, addLessonGroup, updateLessonGroup, removeLessonGroup, addDuty, updateDuty, removeDuty, importData, clearData } = useTimetableData();
    const [schedule, setSchedule] = useState<Schedule | null>(null);
    const [solverStats, setSolverStats] = useState<SolverStats | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<Tab>('teachers');
    const [viewType, setViewType] = useState<ViewType>(ViewType.Class);
    const [viewMode, setViewMode] = useState<ViewMode>('single');
    const [selectedHeaderId, setSelectedHeaderId] = useState<string>('');
    const [schoolHours, setSchoolHours] = useState<SchoolHours>({
        [SchoolLevel.Middle]: [8, 8, 8, 8, 8],
        [SchoolLevel.High]: [8, 8, 8, 8, 8],
    });
    const [modalState, setModalState] = useState<ModalState>({ type: null, item: null });
    const fileInputRef = useRef<HTMLInputElement>(null);
    const scheduleFileInputRef = useRef<HTMLInputElement>(null);
    
    const [savedSchedules, setSavedSchedules] = useState<SavedSchedule[]>([]);
    const [activeScheduleName, setActiveScheduleName] = useState<string | null>(null);
    
    const maxDailyHours = useMemo(() => {
        const flat = (Object.values(schoolHours).flat() as number[]);
        return Math.max(...flat);
    }, [schoolHours]);
    const validation = useDataValidation(data, schoolHours);
    const { classroomLoads, teacherLoads } = useLoadCalculation(data, schoolHours);
    const actualTeacherLoads = useMemo(() => {
        if (!schedule) return null;
        const counts = new Map<string, number>();
        Object.values(schedule).forEach(days => {
            days.forEach(day => {
                day.forEach(slot => {
                    if (!slot) return;
                    const current = counts.get(slot.teacherId) || 0;
                    counts.set(slot.teacherId, current + 1);
                });
            });
        });
        return counts;
    }, [schedule]);


    useEffect(() => {
        if (viewType === ViewType.Class && data.classrooms.length > 0) {
            setSelectedHeaderId(prev => data.classrooms.some(c => c.id === prev) ? prev : data.classrooms[0].id);
        } else if (viewType === ViewType.Teacher && data.teachers.length > 0) {
            setSelectedHeaderId(prev => data.teachers.some(t => t.id === prev) ? prev : data.teachers[0].id);
        }
    }, [viewType, data.classrooms, data.teachers]);
    
    const handleAssignRandomRestDays = useCallback((teacherId: string, restCount: number) => {
        if (restCount <= 0) return;
        const teacher = data.teachers.find(t => t.id === teacherId);
        if (!teacher) return;

        const availability = teacher.availability.map(day => [...day]);
        const dayInfos: Array<{ dayIndex: number; available: number }> = [];

        for (let d = 0; d < Math.min(5, availability.length); d++) {
            const row = availability[d] || [];
            const limit = maxDailyHours > 0 ? Math.min(maxDailyHours, row.length) : row.length;
            let available = 0;
            for (let h = 0; h < limit; h++) {
                if (row[h]) {
                    available += 1;
                }
            }
            if (available > 0) {
                dayInfos.push({ dayIndex: d, available });
            }
        }

        if (dayInfos.length === 0) {
            window.alert('Bu öğretmenin zaten tüm günleri izinli görünüyor.');
            return;
        }

        if (dayInfos.length <= restCount) {
            window.alert('Bu öğretmenin en az bir günü açık kalmalı. Daha az izin günü seçin veya önce müsaitliği genişletin.');
            return;
        }

        const pool = [...dayInfos];
        const chosen: number[] = [];
        const target = Math.min(restCount, pool.length - 1);
        while (chosen.length < target && pool.length > 0) {
            const totalWeight = pool.reduce((sum, info) => sum + info.available, 0);
            let r = Math.random() * totalWeight;
            let idx = 0;
            for (let i = 0; i < pool.length; i++) {
                r -= pool[i].available;
                if (r <= 0) {
                    idx = i;
                    break;
                }
            }
            const [selected] = pool.splice(idx, 1);
            chosen.push(selected.dayIndex);
        }

        if (chosen.length === 0) {
            window.alert('?zin g?n? ayarlanamad?. Uygun g?n bulunamad?.');
            return;
        }

        chosen.forEach(dayIndex => {
            const row = availability[dayIndex] || [];
            for (let h = 0; h < row.length; h++) {
                row[h] = false;
            }
        });

        updateTeacher({ ...teacher, availability });

        const chosenNames = chosen.map(idx => DAYS[idx] || `${idx + 1}. gün`).join(', ');
        window.alert(`${teacher.name} için ${chosen.length} izin günü ayarlandı: ${chosenNames}.`);
    }, [data.teachers, updateTeacher, maxDailyHours]);

    const handleSchoolHoursChange = (level: SchoolLevel, dayIndex: number, value: string) => {
        const newHours = parseInt(value) || 4;
        const clampedValue = Math.max(4, Math.min(16, newHours));

        setSchoolHours(prev => {
            const newLevelHours = [...prev[level]];
            newLevelHours[dayIndex] = clampedValue;
            return {
                ...prev,
                [level]: newLevelHours
            };
        });
    };
    
    const handleClearAllData = () => {
        if (window.confirm("Mevcut tüm değişiklikleri atıp varsayılan örnek verilere geri dönmek istediğinizden emin misiniz? Kayıtlı versiyonlar da dahil olmak üzere tüm veriler silinecektir. Bu işlem geri alınamaz.")) {
            clearData();
            setSchedule(null);
            setSolverStats(null);
            setActiveScheduleName(null);
            setError(null);
            setSelectedHeaderId('');
            updateSavedSchedules([]);
        }
    };

    useEffect(() => {
        try {
            const saved = localStorage.getItem('timetable_versions');
            if (saved) {
                setSavedSchedules(JSON.parse(saved));
            }
        } catch (e) {
            console.error("Failed to load saved schedules from localStorage", e);
        }
    }, []);

    const updateSavedSchedules = (newSchedules: SavedSchedule[]) => {
        setSavedSchedules(newSchedules);
        try {
            localStorage.setItem('timetable_versions', JSON.stringify(newSchedules));
        } catch (e) {
            console.error("Failed to save schedules to localStorage", e);
        }
    };

    const handleScheduleImportClick = () => {
        scheduleFileInputRef.current?.click();
    };

    const handleScheduleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const text = e.target?.result;
                if (typeof text !== 'string') {
                    throw new Error("Dosya okunamadı.");
                }
                const parsed = JSON.parse(text);
                if (!parsed || !parsed.data || !parsed.schedule) {
                    throw new Error("JSON dosyasında veri ve program birlikte bulunmalıdır.");
                }
                importData(JSON.stringify({ data: parsed.data }));
                setSchedule(parsed.schedule);
                setSolverStats(parsed.stats || null);
                const derivedName = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : file.name.replace(/\.json$/i, '');
                setActiveScheduleName(derivedName || 'Dışarıdan Yüklenen Program');
                setError(null);

                const newSaved: SavedSchedule = {
                    id: `import-${Date.now()}`,
                    name: derivedName || 'Dışarıdan Yüklenen Program',
                    createdAt: new Date().toISOString(),
                    schedule: parsed.schedule,
                    data: parsed.data,
                };
                updateSavedSchedules([...savedSchedules, newSaved]);
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Program dosyası içeri aktarılırken bir hata oluştu.';
                setError(message);
            } finally {
                if (scheduleFileInputRef.current) {
                    scheduleFileInputRef.current.value = '';
                }
            }
        };
        reader.onerror = () => setError('Dosya okunurken bir hata oluştu.');
        reader.readAsText(file, 'UTF-8');
    };

    const [optTime, setOptTime] = useState<number>(150);
    const [optSeedRatio, setOptSeedRatio] = useState<number>(0.15);
    const [optTabuTenure, setOptTabuTenure] = useState<number>(50);
    const [optTabuIter, setOptTabuIter] = useState<number>(2000);
    const [classicMode, setClassicMode] = useState<boolean>(false);
    // String inputs for better typing UX; clamp on blur
    const [timeText, setTimeText] = useState<string>(String(optTime));
    const [seedText, setSeedText] = useState<string>(String(optSeedRatio));
    const [tenureText, setTenureText] = useState<string>(String(optTabuTenure));
    const [iterText, setIterText] = useState<string>(String(optTabuIter));
    const [optStopFirst, setOptStopFirst] = useState<boolean>(true);
    const [useDeterministic, setUseDeterministic] = useState<boolean>(false);
    const [optRngSeed, setOptRngSeed] = useState<number>(1337);
    const [rngText, setRngText] = useState<string>('1337');
    const [optDisableLNS, setOptDisableLNS] = useState<boolean>(true);
    const [solverStrategy, setSolverStrategy] = useState<"repair"|"tabu"|"alns"|"cp">("cp");
    const [optDisableEdge, setOptDisableEdge] = useState<boolean>(true);
    // CP-SAT (server) optional preferences – off by default; enable via simple toggles
    const [cpUseCustom, setCpUseCustom] = useState<boolean>(false);
    const [cpAllowSplit, setCpAllowSplit] = useState<boolean>(false);
    const [cpEdgeReduce, setCpEdgeReduce] = useState<boolean>(false);
    const [cpGapReduce, setCpGapReduce] = useState<boolean>(false);
    const [cpGapLimit, setCpGapLimit] = useState<'default' | '1' | '2'>('default');
    const [cpDailyMaxOn, setCpDailyMaxOn] = useState<boolean>(false);
    const [cpDailyMaxVal, setCpDailyMaxVal] = useState<string>('6');
    const [cpHelpOpen, setCpHelpOpen] = useState<boolean>(false);

    // Load persisted CP-SAT toggles
    useEffect(() => {
        try {
            const raw = localStorage.getItem('cp_prefs');
            if (raw) {
                const p = JSON.parse(raw);
                if (typeof p.useCustom === 'boolean') setCpUseCustom(p.useCustom);
                if (typeof p.allowSplit === 'boolean') setCpAllowSplit(p.allowSplit);
                if (typeof p.edgeReduce === 'boolean') setCpEdgeReduce(p.edgeReduce);
                if (typeof p.gapReduce === 'boolean') setCpGapReduce(p.gapReduce);
                if (p.gapLimit === '1' || p.gapLimit === '2' || p.gapLimit === 'default') setCpGapLimit(p.gapLimit);
                if (typeof p.dailyMaxOn === 'boolean') setCpDailyMaxOn(p.dailyMaxOn);
                if (typeof p.dailyMaxVal === 'string') setCpDailyMaxVal(p.dailyMaxVal);
            }
        } catch {}
    }, []);

    // Persist CP-SAT toggles when changed
    useEffect(() => {
        try {
            const p = {
                useCustom: cpUseCustom,
                allowSplit: cpAllowSplit,
                edgeReduce: cpEdgeReduce,
                gapReduce: cpGapReduce,
                gapLimit: cpGapLimit,
                dailyMaxOn: cpDailyMaxOn,
                dailyMaxVal: cpDailyMaxVal,
            };
            localStorage.setItem('cp_prefs', JSON.stringify(p));
        } catch {}
    }, [cpUseCustom, cpAllowSplit, cpEdgeReduce, cpGapReduce, cpGapLimit, cpDailyMaxOn, cpDailyMaxVal]);
    const [showAnalyzer, setShowAnalyzer] = useState<boolean>(false);
    const [isQrOpen, setIsQrOpen] = useState<boolean>(false);
    const [defaultMaxConsec, setDefaultMaxConsec] = useState<number | undefined>(3);
    const [showTeacherLoadSummary, setShowTeacherLoadSummary] = useState<boolean>(true);
    const [showTeacherActualLoad, setShowTeacherActualLoad] = useState<boolean>(true);
    const [showHeatmapPanel, setShowHeatmapPanel] = useState<boolean>(true);
    const [showDutyWarnings, setShowDutyWarnings] = useState<boolean>(true);
    const [showDutyCoverage, setShowDutyCoverage] = useState<boolean>(true);


    // Load saved settings
    useEffect(() => {
        try {
            const raw = localStorage.getItem('solver_settings');
            if (raw) {
                const s = JSON.parse(raw);
                if (typeof s.time === 'number') { setOptTime(s.time); setTimeText(String(s.time)); }
                if (typeof s.seed === 'number') { setOptSeedRatio(s.seed); setSeedText(String(s.seed)); }
                if (typeof s.tenure === 'number') { setOptTabuTenure(s.tenure); setTenureText(String(s.tenure)); }
                if (typeof s.iter === 'number') { setOptTabuIter(s.iter); setIterText(String(s.iter)); }
                if (typeof s.stopFirst === 'boolean') { setOptStopFirst(s.stopFirst); }
                if (typeof s.disableLNS === 'boolean') { setOptDisableLNS(s.disableLNS); }
                if (typeof s.disableEdge === 'boolean') { setOptDisableEdge(s.disableEdge); }
                if (typeof s.defaultMaxConsec === 'number') { setDefaultMaxConsec(s.defaultMaxConsec); }
                if (typeof s.defaultMaxConsec === 'number') { setDefaultMaxConsec(s.defaultMaxConsec); }
            }
        } catch {}
    }, []);

    const saveSettingsAsDefault = () => {
        const s = { time: optTime, seed: optSeedRatio, tenure: optTabuTenure, iter: optTabuIter, stopFirst: optStopFirst, disableLNS: optDisableLNS, disableEdge: optDisableEdge, defaultMaxConsec };
        try { localStorage.setItem('solver_settings', JSON.stringify(s)); alert('Ayarlar varsayılan olarak kaydedildi.'); } catch {}
    };

    const applyProfile = (p: 'fast'|'balanced'|'max'|'classic') => {
        if (p==='fast') {
            setOptTime(45); setTimeText('45');
            setOptSeedRatio(0.12); setSeedText('0.12');
            setOptTabuTenure(60); setTenureText('60');
            setOptTabuIter(2500); setIterText('2500');
            setOptStopFirst(true);
            setClassicMode(false);
            setSolverStrategy('tabu');
        } else if (p==='balanced') {
            setOptTime(90); setTimeText('90');
            setOptSeedRatio(0.12); setSeedText('0.12');
            setOptTabuTenure(70); setTenureText('70');
            setOptTabuIter(3000); setIterText('3000');
            setOptStopFirst(false);
            setClassicMode(false);
            setSolverStrategy('alns');
        } else if (p==='classic') {
            setOptStopFirst(true);
            setOptDisableLNS(true);
            setOptDisableEdge(true);
            setClassicMode(true);
            setSolverStrategy('repair');
        } else {
            setOptTime(150); setTimeText('150');
            setOptSeedRatio(0.12); setSeedText('0.12');
            setOptTabuTenure(80); setTenureText('80');
            setOptTabuIter(3500); setIterText('3500');
            setOptStopFirst(false);
            setClassicMode(false);
            setSolverStrategy('tabu');
        }
    };

    const loadSampleData = async (name: 'ai'|'school') => {
        try {
            const res = await fetch(`sample-data/${name}.json`);
            if (!res.ok) throw new Error('Örnek dosya bulunamadı.');
            const json = await res.text();
            importData(json);
            setError(null); setSchedule(null); setSolverStats(null); setActiveScheduleName(null);
        } catch (e: any) {
            alert('Örnek veriyi yükleyemedim. Lütfen proje dizinine sample-data/ai.json ve sample-data/school.json ekleyin.');
        }
    };

    const handleGenerate = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        setSchedule(null);
        setSolverStats(null);
        setActiveScheduleName(null);
        try {
            let result;
            if (!classicMode && solverStrategy === 'cp') {
              // Use server-side CP-SAT solver
              let cpPrefs: any | undefined = undefined;
              if (cpUseCustom) {
                cpPrefs = {} as any;
                if (cpAllowSplit) cpPrefs.allowSameDaySplit = true;
                if (cpEdgeReduce) cpPrefs.edgeWeight = 2; // reduce first/last-hour use
                if (cpGapReduce) { cpPrefs.teacherGapWeight = 4; cpPrefs.nogapWeight = 3; }
                if (cpGapLimit !== 'default') cpPrefs.maxTeacherGapHours = Number(cpGapLimit);
                const dm = parseInt(cpDailyMaxVal);
                if (cpDailyMaxOn && Number.isFinite(dm) && dm > 0) cpPrefs.teacherDailyMaxHours = dm;
              }
              result = await solveTimetableCP(
                data,
                schoolHours,
                optTime,
                { maxConsec: defaultMaxConsec },
                cpPrefs,
                optStopFirst
              );
            } else {
              // Use in-browser heuristic solvers
              result = await solveTimetableLocally(data, { 
              schoolHours,
              timeLimitSeconds: optTime,
              strategy: classicMode ? 'repair' : solverStrategy,
              seedRatio: optSeedRatio,
              tabu: { tenure: optTabuTenure, iterations: optTabuIter },
              stopAtFirstSolution: classicMode ? true : optStopFirst,
              randomSeed: useDeterministic ? optRngSeed : undefined,
              disableLNS: classicMode ? true : optDisableLNS,
              disableTeacherEdgePenalty: classicMode ? true : optDisableEdge,
              teacherSpreadWeight: classicMode ? 0 : 1,
              teacherEdgeWeight: classicMode ? 0 : 1,
              allowBlockRelaxation: classicMode ? false : true
              });
            }
            
            setSolverStats(result.stats);

            if (result.schedule) {
                setSchedule(result.schedule);
            } else {
                const errorMsg = result.stats?.notes?.join(' | ') || "Çözüm bulunamadı. Kısıtlar çok sıkı olabilir.";
                setError(errorMsg);
            }
        } catch (err: any) {
            setError(err.message || 'Program oluşturulurken bilinmeyen bir hata oluştu.');
        } finally {
            setIsLoading(false);
        }
    }, [data, schoolHours, optTime, optSeedRatio, optTabuTenure, optTabuIter, optStopFirst, classicMode, solverStrategy, optStopFirst, useDeterministic, optRngSeed, optDisableLNS, optDisableEdge, cpUseCustom, cpAllowSplit, cpEdgeReduce, cpGapReduce, cpGapLimit]);
    
    const handleExportData = () => {
        const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify({ data }, null, 2))}`;
        const link = document.createElement("a");
        link.href = jsonString;
        link.download = "ders-programi-verileri.json";
        link.click();
    };

    const handleExportSchedule = () => {
        if (!schedule) return;
        const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify({ data, schedule }, null, 2))}`;
        const link = document.createElement("a");
        link.href = jsonString;
        link.download = "ders-programi.json";
        link.click();
    };

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const text = e.target?.result;
                if (typeof text !== 'string') {
                    throw new Error("Dosya okunamadı.");
                }
                importData(text);
                setError(null);
                setSchedule(null);
                setSolverStats(null);
                setActiveScheduleName(null);
            } catch (err: any) {
                setError(err.message || "JSON dosyası işlenirken bir hata oluştu.");
            }
        };
        reader.onerror = () => {
             setError("Dosya okunurken bir hata oluştu.");
        }
        reader.readAsText(file, 'UTF-8');
        
        event.target.value = '';
    };

    const handleQrImportText = (text: string) => {
        try {
            const obj = JSON.parse(text);
            if (!obj || !obj.data) throw new Error('Geçersiz QR veri formatı');
            importData(JSON.stringify({ data: obj.data }));
            if (obj.schedule) {
                setSchedule(obj.schedule);
                setActiveScheduleName('QR ile İçe Aktarılan');
            } else {
                setSchedule(null);
                setActiveScheduleName(null);
            }
            setSolverStats(null);
            setError(null);
            alert('QR içeriği başarıyla içe aktarıldı.');
            setIsQrOpen(false);
        } catch (e: any) {
            setError(e?.message || 'QR içeriği çözümlenemedi.');
        }
    };

    const handleIsMoveValid = useCallback((sourceInfo: any, targetInfo: any): boolean => {
        if (!schedule) return false;
        
        const { blockSpan = 1 } = sourceInfo;

        const sourceAssignment = schedule[sourceInfo.classroomId]?.[sourceInfo.dayIndex]?.[sourceInfo.hourIndex];
        const teacher = data.teachers.find(t => t.id === sourceAssignment?.teacherId);
        const targetClassroom = data.classrooms.find(c => c.id === targetInfo.classroomId);

        if (!sourceAssignment || !teacher || !targetClassroom) return false;

        const targetDayHours = schoolHours[targetClassroom.level][targetInfo.dayIndex];
        if (targetInfo.hourIndex + (blockSpan - 1) >= targetDayHours) return false;

        for (let k = 0; k < blockSpan; k++){
            const h = targetInfo.hourIndex + k;
            if (!teacher.availability[targetInfo.dayIndex][h]) return false;
            if (schedule[targetInfo.classroomId]?.[targetInfo.dayIndex]?.[h]) return false;
        }

        return true;
    }, [schedule, data.teachers, data.classrooms, schoolHours]);


    const handleManualDrop = (sourceInfo: any, targetInfo: any) => {
        if (!schedule) return;
        if (sourceInfo.classroomId === targetInfo.classroomId && sourceInfo.dayIndex === targetInfo.dayIndex && sourceInfo.hourIndex === targetInfo.hourIndex) {
            return;
        }

        if (!handleIsMoveValid(sourceInfo, targetInfo)) {
            alert("Bu hamle geçersiz. Öğretmen müsait değil veya hedef konum (sınıfın ders saatleri/blok ders) için uygun değil.");
            return;
        }

        const newSchedule = JSON.parse(JSON.stringify(schedule));
        const sourceAssignment = newSchedule[sourceInfo.classroomId]?.[sourceInfo.dayIndex]?.[sourceInfo.hourIndex];
        const sourceAssignmentRef = schedule[sourceInfo.classroomId]?.[sourceInfo.dayIndex]?.[sourceInfo.hourIndex];
        if (!sourceAssignmentRef) return;
        
        const { blockSpan = 1 } = sourceInfo;

        // Clear all cells related to the source assignment object
        for (let d = 0; d < 5; d++) {
             for (let h = 0; h < maxDailyHours; h++) {
                if (schedule[sourceInfo.classroomId]?.[d]?.[h] === sourceAssignmentRef) {
                   newSchedule[sourceInfo.classroomId][d][h] = null;
                }
            }
        }
        
        // Place the lesson block at the target
        for (let k = 0; k < blockSpan; k++){
            newSchedule[targetInfo.classroomId][targetInfo.dayIndex][targetInfo.hourIndex + k] = sourceAssignment;
        }

        setSchedule(newSchedule);
        setSolverStats(null); // Manual change invalidates the report
        setActiveScheduleName(prev => prev ? `${prev.replace(' (değiştirildi)','')} (değiştirildi)` : 'Yeni Program (değiştirildi)');
    };
    
    const handleSaveSchedule = () => {
        if (!schedule) return;
        const defaultName = activeScheduleName ? activeScheduleName.replace(' (değiştirildi)','') : `Versiyon ${new Date().toLocaleDateString('tr-TR')}`;
        const name = prompt("Program versiyonu için bir isim girin:", defaultName);
        if (name) {
            const newSave: SavedSchedule = {
                id: `sch_${Date.now()}`,
                name,
                createdAt: new Date().toISOString(),
                schedule: JSON.parse(JSON.stringify(schedule)), // Deep copy
                data: JSON.parse(JSON.stringify(data)), // Deep copy data context
            };
            updateSavedSchedules([...savedSchedules, newSave]);
            setActiveScheduleName(name);
            alert(`'${name}' adıyla program kaydedildi.`);
        }
    };

    const handleLoadSchedule = (scheduleId: string) => {
        const toLoad = savedSchedules.find(s => s.id === scheduleId);
        if (toLoad) {
            const dataToImport = { data: toLoad.data };
            importData(JSON.stringify(dataToImport));
            setSchedule(toLoad.schedule);
            setSolverStats(null);
            setActiveScheduleName(toLoad.name);
            setError(null);
            document.getElementById('schedule-container')?.scrollIntoView({ behavior: 'smooth' });
        }
    };
    
    const handleDeleteSchedule = (scheduleId: string) => {
        if (window.confirm("Bu kayıtlı programı silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.")) {
            const toDelete = savedSchedules.find(s => s.id === scheduleId);
            updateSavedSchedules(savedSchedules.filter(s => s.id !== scheduleId));
            
            if (toDelete && schedule && activeScheduleName && activeScheduleName.startsWith(toDelete.name)) {
                setSchedule(null);
                setSolverStats(null);
                setActiveScheduleName(null);
            }
        }
    };

    const handlePrint = () => { window.print(); };
    const handleOpenModal = (type: Tab, item: any | null = null) => setModalState({ type, item });
    const handleCloseModal = () => setModalState({ type: null, item: null });

    const handleSave = (itemData: any) => {
        const { type, item } = modalState;
        switch (type) {
            case 'teachers': item ? updateTeacher({ ...item, ...itemData }) : addTeacher(itemData); break;
            case 'classrooms': item ? updateClassroom({ ...item, ...itemData }) : addClassroom(itemData); break;
            case 'subjects': item ? updateSubject({ ...item, ...itemData }) : addSubject(itemData); break;
            case 'locations': item ? updateLocation({ ...item, ...itemData }) : addLocation(itemData); break;
            case 'fixedAssignments': addFixedAssignment(itemData); break;
            case 'lessonGroups': item ? updateLessonGroup({ ...item, ...itemData }) : addLessonGroup(itemData); break;
            case 'duties': item ? updateDuty({ ...item, ...itemData }) : addDuty(itemData); break;
        }
        handleCloseModal();
    };

    const renderTabs = () => (
      <div className="flex border-b border-slate-200 overflow-x-auto">
        {(['teachers', 'classrooms', 'subjects', 'locations', 'fixedAssignments', 'lessonGroups', 'duties'] as Tab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-3 text-sm font-medium capitalize -mb-px border-b-2 whitespace-nowrap ${activeTab === tab ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}
          >
            {
                {
                    teachers: 'Öğretmenler',
                    classrooms: 'Sınıflar',
                    subjects: 'Dersler',
                    locations: 'Mekanlar',
                    fixedAssignments: 'Sabit Atamalar',
                    lessonGroups: 'Grup Dersleri',
                    duties: 'Ek Görevler'
                }[tab]
            }
          </button>
        ))}
      </div>
    );
    
    const renderContent = () => {
      const getTitle = (tab: Tab) => ({
        teachers: "Yeni Öğretmen Ekle",
        classrooms: "Yeni Sınıf Ekle",
        subjects: "Yeni Ders Ekle",
        locations: "Yeni Mekan Ekle",
        fixedAssignments: "Yeni Sabit Atama Ekle",
        lessonGroups: "Yeni Grup Dersi Ekle",
        duties: "Yeni Ek Görev Ekle",
      }[tab]);

      const renderTable = () => {
        let headers: string[] = [];
        let rows: React.ReactNode[] = [];
        let onRemove: (id: string) => void = () => {};
        
        const classroomErrors = validation.overflowingClasses.reduce((acc, err) => ({...acc, [err.id]: err.message}), {} as Record<string, string>);
        const subjectErrors = validation.unassignedSubjects.reduce((acc, err) => ({...acc, [err.id]: err.message}), {} as Record<string, string>);
        
        switch (activeTab) {
            case 'teachers':
                headers = ["Ad Soyad", "Branşlar", "Okul Türü", "Haftalık Yük", "Eylemler"];
                onRemove = removeTeacher;
                rows = data.teachers.map(item => {
                    const load = teacherLoads.get(item.id) || { demand: 0, capacity: 0 };
                    return (
                    <tr key={item.id}>
                        <td className="px-4 py-3 whitespace-nowrap">{item.name}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{item.branches.join(', ')}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                            {item.canTeachMiddleSchool && <span className="text-xs font-medium mr-2 px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800">Ortaokul</span>}
                            {item.canTeachHighSchool && <span className="text-xs font-medium mr-2 px-2.5 py-0.5 rounded-full bg-green-100 text-green-800">Lise</span>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap font-medium text-slate-600">{Math.round(load.demand)} saat</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex flex-wrap items-center gap-1">
                                <button onClick={() => handleAssignRandomRestDays(item.id, 1)} className="px-2 py-1 text-xs font-medium rounded border border-slate-200 text-slate-600 hover:bg-slate-100" title="Bu öğretmene rastgele 1 tam gün izin ayarla">1 Gün</button>
                                <button onClick={() => handleAssignRandomRestDays(item.id, 2)} className="px-2 py-1 text-xs font-medium rounded border border-slate-200 text-slate-600 hover:bg-slate-100" title="Bu öğretmene rastgele 2 tam gün izin ayarla">2 Gün</button>
                                <button onClick={() => handleOpenModal(activeTab, item)} className="p-1 text-slate-500 hover:text-sky-600"><PencilIcon className="w-4 h-4" /></button>
                                <button onClick={() => onRemove(item.id)} className="p-1 text-slate-500 hover:text-red-600"><TrashIcon className="w-4 h-4" /></button>
                            </div>
                        </td>
                    </tr>
                )});
                break;
            case 'classrooms':
                headers = ["Sınıf Adı", "Seviye", "Grup", "Sınıf Öğretmeni", "Haftalık Yük", "Eylemler"];
                onRemove = removeClassroom;
                rows = data.classrooms.map(item => {
                    const load = classroomLoads.get(item.id) || { demand: 0, capacity: 0 };
                    const isOverloaded = load.demand > load.capacity;
                    return (
                    <tr key={item.id}>
                        <td className="px-4 py-3 whitespace-nowrap">
                           <div className="flex items-center gap-2">
                               <span>{item.name}</span>
                               {classroomErrors[item.id] && (
                                   <div className="group relative">
                                       <WarningIcon className="w-5 h-5 text-yellow-500" />
                                       <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-2 bg-slate-700 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                                           {classroomErrors[item.id]}
                                       </span>
                                   </div>
                               )}
                           </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">{item.level}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{item.group}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{data.teachers.find(t => t.id === item.homeroomTeacherId)?.name || '-'}</td>
                        <td className={`px-4 py-3 whitespace-nowrap font-medium ${isOverloaded ? 'text-red-600' : 'text-slate-600'}`}>
                            {load.demand} / {load.capacity} saat
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                            <button onClick={() => handleOpenModal(activeTab, item)} className="p-1 text-slate-500 hover:text-sky-600"><PencilIcon className="w-4 h-4" /></button>
                            <button onClick={() => onRemove(item.id)} className="p-1 text-slate-500 hover:text-red-600"><TrashIcon className="w-4 h-4" /></button>
                        </td>
                    </tr>
                )});
                break;
            case 'subjects':
                 headers = ["Ders Adı", "Haftalık Saat", "Atanan Sınıflar", "Mekan", "Eylemler"];
                 onRemove = removeSubject;
                 rows = data.subjects.map(item => (
                    <tr key={item.id}>
                        <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                                <span>
                                    {item.name} 
                                    {item.blockHours > 0 && <span className="text-xs font-medium ml-1 px-2 py-0.5 rounded-full bg-purple-100 text-purple-800">Blok ({item.blockHours}s)</span>}
                                    {item.tripleBlockHours > 0 && <span className="text-xs font-medium ml-1 px-2 py-0.5 rounded-full bg-orange-100 text-orange-800">3'lü Blok ({item.tripleBlockHours}s)</span>}
                                </span>
                                {subjectErrors[item.id] && (
                                   <div className="group relative">
                                       <WarningIcon className="w-5 h-5 text-yellow-500" />
                                       <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-2 bg-slate-700 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                                           {subjectErrors[item.id]}
                                       </span>
                                   </div>
                                )}
                            </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">{item.weeklyHours}</td>
                        <td className="px-4 py-3 text-xs">{item.assignedClassIds.map(id => data.classrooms.find(c=>c.id === id)?.name).join(', ')}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{data.locations.find(l => l.id === item.locationId)?.name || '-'}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                            <button onClick={() => handleOpenModal(activeTab, item)} className="p-1 text-slate-500 hover:text-sky-600"><PencilIcon className="w-4 h-4" /></button>
                            <button onClick={() => onRemove(item.id)} className="p-1 text-slate-500 hover:text-red-600"><TrashIcon className="w-4 h-4" /></button>
                        </td>
                    </tr>
                 ));
                 break;
            case 'locations':
                headers = ["Mekan Adı", "Eylemler"];
                onRemove = removeLocation;
                rows = data.locations.map(item => (
                    <tr key={item.id}>
                        <td className="px-4 py-3 whitespace-nowrap">{item.name}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                            <button onClick={() => handleOpenModal(activeTab, item)} className="p-1 text-slate-500 hover:text-sky-600"><PencilIcon className="w-4 h-4" /></button>
                            <button onClick={() => onRemove(item.id)} className="p-1 text-slate-500 hover:text-red-600"><TrashIcon className="w-4 h-4" /></button>
                        </td>
                    </tr>
                ));
                break;
            case 'fixedAssignments':
                headers = ["Sınıf", "Ders", "Zaman", "Eylemler"];
                onRemove = removeFixedAssignment;
                rows = data.fixedAssignments.map(item => (
                     <tr key={item.id}>
                        <td className="px-4 py-3 whitespace-nowrap">{data.classrooms.find(c => c.id === item.classroomId)?.name}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{data.subjects.find(s => s.id === item.subjectId)?.name}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{item.hourIndex === -1 ? `${DAYS[item.dayIndex]}, Tüm Gün` : `${DAYS[item.dayIndex]}, ${item.hourIndex + 1}. Ders`}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                           <button onClick={() => onRemove(item.id)} className="p-1 text-slate-500 hover:text-red-600"><TrashIcon className="w-4 h-4" /></button>
                        </td>
                    </tr>
                ));
                break;
            case 'lessonGroups':
                headers = ["Grup Adı", "Ders", "Sınıflar", "Haftalık Saat", "Eylemler"];
                onRemove = removeLessonGroup;
                rows = data.lessonGroups.map(item => (
                     <tr key={item.id}>
                        <td className="px-4 py-3 whitespace-nowrap">{item.name} {item.isBlock && <span className="text-xs font-medium ml-1 px-2 py-0.5 rounded-full bg-purple-100 text-purple-800">Blok</span>}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{data.subjects.find(s => s.id === item.subjectId)?.name}</td>
                        <td className="px-4 py-3 text-xs">{item.classroomIds.map(id => data.classrooms.find(c=>c.id === id)?.name).join(', ')}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{item.weeklyHours}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                           <button onClick={() => handleOpenModal(activeTab, item)} className="p-1 text-slate-500 hover:text-sky-600"><PencilIcon className="w-4 h-4" /></button>
                           <button onClick={() => onRemove(item.id)} className="p-1 text-slate-500 hover:text-red-600"><TrashIcon className="w-4 h-4" /></button>
                        </td>
                    </tr>
                ));
                break;
            case 'duties':
                headers = ["Görev Adı", "Öğretmen", "Zaman", "Eylemler"];
                onRemove = removeDuty;
                rows = data.duties.map(item => (
                     <tr key={item.id}>
                        <td className="px-4 py-3 whitespace-nowrap">{item.name}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{data.teachers.find(t => t.id === item.teacherId)?.name}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{DAYS[item.dayIndex]}, {item.hourIndex + 1}. Ders</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                           <button onClick={() => handleOpenModal(activeTab, item)} className="p-1 text-slate-500 hover:text-sky-600"><PencilIcon className="w-4 h-4" /></button>
                           <button onClick={() => onRemove(item.id)} className="p-1 text-slate-500 hover:text-red-600"><TrashIcon className="w-4 h-4" /></button>
                        </td>
                    </tr>
                ));
                break;
        }

        return (
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50">
                        <tr>
                            {headers.map(h => <th key={h} className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{h}</th>)}
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-200 text-sm text-slate-700">
                        {rows}
                    </tbody>
                </table>
            </div>
        )
      };

      return (
        <div className="bg-white p-6 rounded-lg shadow-lg no-print">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold">Veri Girişi</h2>
                <button onClick={() => handleOpenModal(activeTab)} className="px-3 py-1.5 bg-sky-500 text-white rounded-md text-sm font-medium hover:bg-sky-600 flex items-center gap-1">
                    <PlusIcon className="w-4 h-4" /> {getTitle(activeTab)}
                </button>
            </div>
            {renderTabs()}
            {activeTab === 'duties' && (
              <div className="my-4 p-3 bg-sky-50 text-sky-800 border border-sky-200 rounded-md text-sm">
                <strong>Bilgi:</strong> Eklediğiniz görevler (nöbet vb.), program oluşturulduktan sonra **"Öğretmene Göre"** görünümünde ilgili öğretmenin zaman çizelgesinde gösterilir.
              </div>
            )}
            <div className="mt-4">{renderTable()}</div>
        </div>
      );
    };
    
    const renderSavedSchedules = () => {
        const hasSaved = savedSchedules.length > 0;

        return (
            <div className="bg-white p-6 rounded-lg shadow-lg no-print">
                <h2 className="text-xl font-bold mb-4">Kayıtlı Program Versiyonları</h2>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <p className="text-sm text-slate-500">Kaydedilmiş bir program dosyasını içeri aktararak eski sonuçları geri yükleyebilirsiniz.</p>
                    <button onClick={handleScheduleImportClick} className="px-3 py-1.5 bg-white text-slate-700 rounded-md border border-slate-300 hover:bg-slate-50 text-sm font-medium">Program Yükle</button>
                </div>
                {hasSaved ? (
                    <div className="space-y-3 max-h-60 overflow-y-auto">
                        {savedSchedules.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(saved => (
                            <div key={saved.id} className="flex justify-between items-center bg-slate-50 p-3 rounded-md border">
                                <div>
                                    <p className="font-semibold text-slate-800">{saved.name}</p>
                                    <p className="text-xs text-slate-500">
                                        {new Date(saved.createdAt).toLocaleString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                     <button onClick={() => handleLoadSchedule(saved.id)} className="px-3 py-1.5 bg-sky-500 text-white rounded-md text-sm font-medium hover:bg-sky-600">
                                        Yükle
                                    </button>
                                    <button onClick={() => handleDeleteSchedule(saved.id)} className="p-2 text-slate-500 hover:text-red-600" title="Bu versiyonu sil">
                                        <TrashIcon className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-sm text-slate-500 bg-slate-50 border border-dashed border-slate-200 rounded-md p-4">Henüz kayıtlı program yok.</div>
                )}
            </div>
        );
    }
    
    const renderModalContent = () => {
        if (!modalState.type) return null;
        const props = { item: modalState.item, onSave: handleSave, onCancel: handleCloseModal, data, maxDailyHours };
        switch(modalState.type) {
            case 'teachers': return <TeacherForm {...props} />;
            case 'classrooms': return <ClassroomForm {...props} />;
            case 'subjects': return <SubjectForm {...props} updateTeacher={updateTeacher} />;
            case 'locations': return <LocationForm {...props} />;
            case 'fixedAssignments': return <FixedAssignmentForm {...props} />;
            case 'lessonGroups': return <LessonGroupForm {...props} />;
            case 'duties': return <DutyForm {...props} />;
            default: return null;
        }
    }
    
    const viewOptions = useMemo(() => {
        if (viewType === ViewType.Class) return data.classrooms;
        return data.teachers;
    }, [viewType, data.classrooms, data.teachers]);

    const SolverReport: React.FC<{ stats: SolverStats }> = ({ stats }) => {
        const reasonLabels: Record<keyof SolverStats['invalidReasons'], string> = {
            levelMismatch: 'Seviye Uyuşmazlığı',
            availability: 'Öğretmen Müsaitliği',
            classBusy: 'Sınıf Meşgul',
            teacherBusy: 'Öğretmen Meşgul',
            locationBusy: 'Mekan Meşgul',
            blockBoundary: 'Blok Ders Sınırı',
        };
    
        const topReasons = (Object.entries(stats.invalidReasons) as Array<[keyof SolverStats['invalidReasons'], number]>)
            .map(([key, value]) => ({ key, value }))
            .filter((item) => item.value > 0)
            .sort((a, b) => b.value - a.value)
            .slice(0, 3);
    
        return (
            <div className="bg-white p-6 rounded-lg shadow-lg no-print">
                <h2 className="text-xl font-bold mb-4 text-slate-800">Çözüm Raporu</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                    <div className="bg-slate-50 p-4 rounded-lg">
                        <p className="text-slate-500 font-medium">Süre</p>
                        <p className="text-2xl font-bold text-sky-600">{stats.elapsedSeconds} s</p>
                        {typeof stats.firstSolutionSeconds === 'number' && stats.firstSolutionSeconds! > 0 && (
                          <p className="text-slate-600">Ilk cozum: {stats.firstSolutionSeconds} s</p>
                        )}
                    </div>
                    <div className="bg-slate-50 p-4 rounded-lg">
                        <p className="text-slate-500 font-medium">Performans</p>
                        <p className="text-slate-700"><span className="font-semibold">{stats.attempts.toLocaleString('tr-TR')}</span> deneme</p>
                        <p className="text-slate-700"><span className="font-semibold">{stats.backtracks.toLocaleString('tr-TR')}</span> geri dönüş</p>
                    </div>
                    <div className="md:col-span-2 bg-slate-50 p-4 rounded-lg">
                        <p className="text-slate-500 font-medium mb-2">En Çok Zorlayan Kısıtlar</p>
                        {topReasons.length > 0 ? (
                            <ul className="space-y-1">
                                {topReasons.map(reason => (
                                    <li key={reason.key} className="flex justify-between items-center">
                                        <span>{reasonLabels[reason.key]}</span>
                                        <span className="font-semibold bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full text-xs">
                                            {reason.value.toLocaleString('tr-TR')}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        ) : <p className="text-slate-600">Belirgin bir zorluk yaşanmadı.</p>}
                    </div>
                     {stats.hardestLessons.length > 0 && (
                        <div className="md:col-span-2 bg-slate-50 p-4 rounded-lg">
                            <p className="text-slate-500 font-medium mb-2">En Zorlu Dersler</p>
                            <ul className="space-y-1">
                                {stats.hardestLessons.map(lesson => (
                                    <li key={lesson.key} className="flex justify-between items-center">
                                        <span className="truncate pr-4">{lesson.key}</span>
                                        <span className="font-semibold bg-yellow-200 text-yellow-800 px-2 py-0.5 rounded-full text-xs">
                                            {lesson.failures} deneme
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {stats.notes.length > 0 && (
                        <div className="md:col-span-2 lg:col-span-4 bg-yellow-50 border border-yellow-200 p-4 rounded-lg">
                             <p className="text-yellow-700 font-medium mb-1">Önemli Notlar</p>
                             <ul className="list-disc list-inside text-yellow-800 space-y-1">
                                {stats.notes.map((note, i) => <li key={i}>{note}</li>)}
                             </ul>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="min-h-screen p-4 sm:p-6 lg:p-8">
            <header className="mb-8 no-print">
                <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900">Ozarik DersTimeTable</h1>
                        <p className="text-slate-500 mt-1">Haftalık ders programınızı saniyeler içinde oluşturun.</p>
                    </div>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full xl:w-auto">
                        <div className="flex-grow grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-100 p-3 rounded-lg border">
                             <div>
                                <label className="text-xs font-medium text-slate-500 block mb-2">Günlük Ders Saatleri</label>
                                <div className="space-y-2">
                                    {[SchoolLevel.Middle, SchoolLevel.High].map(level => (
                                        <div key={level} className="flex items-center gap-2">
                                            <span className="w-20 text-sm font-medium text-slate-600">{level}:</span>
                                            {DAYS.map((day, dayIndex) => (
                                                <input 
                                                    key={dayIndex}
                                                    type="number"
                                                    title={`${level} - ${day}`}
                                                    value={schoolHours[level][dayIndex]}
                                                    onChange={(e) => handleSchoolHoursChange(level, dayIndex, e.target.value)}
                                                    min="4" max="16"
                                                    className="w-12 rounded-md border-slate-300 text-center text-sm p-1"
                                                />
                                            ))}
                                        </div>
                                    ))}
                                </div>
                             </div>
                        </div>
                        <div className='flex items-center gap-3 shrink-0'>
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleFileChange}
                                accept=".json"
                                className="hidden"
                            />
                            <input
                                type="file"
                                ref={scheduleFileInputRef}
                                onChange={handleScheduleFileChange}
                                accept=".json"
                                className="hidden"
                            />
                            <button
                                onClick={handleImportClick}
                                className="p-2 bg-white text-slate-700 rounded-lg border border-slate-300 hover:bg-slate-50"
                                title="Veri dosyasını yükle"
                            >
                                <UploadIcon className="w-5 h-5" />
                            </button>
                            {/* Örnek yükleme butonlarını header'dan kaldırdık */}
                             <button
                                onClick={handleExportData}
                                className="p-2 bg-white text-slate-700 rounded-lg border border-slate-300 hover:bg-slate-50"
                                title="Sadece girilen verileri indir"
                            >
                                <DownloadIcon className="w-5 h-5" />
                            </button>
                            <button
                                onClick={handleClearAllData}
                                className="p-2 bg-white text-slate-700 rounded-lg border border-slate-300 hover:bg-red-50 hover:text-red-600"
                                title="Tüm Verileri Sıfırla"
                            >
                                <TrashIcon className="w-5 h-5" />
                            </button>
                            <button 
                                onClick={handleGenerate}
                                disabled={isLoading || !validation.isValid}
                                className="px-5 py-2 font-medium bg-sky-500 text-white rounded-lg shadow-md hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors"
                            >
                                {isLoading ? 'Oluşturuluyor...' : 'Program Oluştur'}
                            </button>
                            <div className="hidden md:flex md:flex-col md:items-start gap-2 ml-2 text-xs bg-white rounded-md px-3 py-2 shadow-sm max-w-[720px]">
                                <div className="flex flex-wrap items-center gap-2">
                                    <label className="flex items-center gap-1">
                                        <span className="text-slate-600">Strateji</span>
                                        <select value={classicMode ? 'repair' : (solverStrategy || 'cp')} onChange={(e)=>{ const v=e.target.value as any; if (v==='repair') setClassicMode(true); else { setClassicMode(false); setSolverStrategy(v);} }} className="border rounded px-1 py-0.5">
                                            <option value="repair">Repair</option>
                                            <option value="tabu">Tabu</option>
                                            <option value="alns">ALNS</option>
                                            <option value="cp">CP-SAT (Server)</option>
                                        </select>
                                    </label>
                                    {/* CP-SAT quick toggles (simple on/off + small select). Defaults remain unchanged unless enabled. */}
                                    {(!classicMode && solverStrategy==='cp') && (
                                      <div className="flex flex-wrap items-center gap-2 pl-2 ml-2 border-l border-slate-200">
                                        <label className="flex items-center gap-1">
                                          <input type="checkbox" checked={cpUseCustom} onChange={e=>setCpUseCustom(e.target.checked)} />
                                          <Tooltip text="İşaretlersen alttaki ayarlar devreye girer; işaretlemezsen varsayılan davranış korunur."><span className="text-slate-600">CP-SAT Özel Ayarlar</span></Tooltip>
                                        </label>
                                          {cpUseCustom && (
                                            <>
                                            <label className="flex items-center gap-1">
                                              <input type="checkbox" checked={cpAllowSplit} onChange={e=>setCpAllowSplit(e.target.checked)} />
                                              <Tooltip text="Ders aynı gün içinde araya boşluk girerek bölünebilir. Kapalı tutmak blok/bütünlüğü artırır."><span className="text-slate-600">Aynı gün parçalanabilir</span></Tooltip>
                                            </label>
                                            <label className="flex items-center gap-1">
                                              <input type="checkbox" checked={cpEdgeReduce} onChange={e=>setCpEdgeReduce(e.target.checked)} />
                                              <Tooltip text="Öğretmenlerin 1. ve son ders saatlerine yerleşmesini azaltmaya çalışır."><span className="text-slate-600">Kenar saat azalt</span></Tooltip>
                                            </label>
                                            <label className="flex items-center gap-1">
                                              <input type="checkbox" checked={cpGapReduce} onChange={e=>setCpGapReduce(e.target.checked)} />
                                              <Tooltip text="Öğretmenlerin gün içindeki boş saatlerini (gap) azaltmaya çalışır."><span className="text-slate-600">Boşlukları azalt</span></Tooltip>
                                            </label>
                                            <label className="flex items-center gap-1">
                                              <Tooltip text="İki ders arasındaki en fazla boş saat. Aşılırsa ceza uygulanır. 1=sıkı, 2=daha esnek."><span className="text-slate-600">Gap üst sınırı</span></Tooltip>
                                              <select value={cpGapLimit} onChange={e=>setCpGapLimit(e.target.value as any)} className="border rounded px-1 py-0.5">
                                                <option value="default">Varsayılan</option>
                                                <option value="1">1 saat</option>
                                                <option value="2">2 saat</option>
                                              </select>
                                            </label>
                                            <label className="flex items-center gap-1">
                                              <input type="checkbox" checked={cpDailyMaxOn} onChange={e=>setCpDailyMaxOn(e.target.checked)} />
                                              <Tooltip text="Öğretmene bir günde verilebilecek en fazla ders saati (hard kısıt)."><span className="text-slate-600">Günlük max saat</span></Tooltip>
                                              <input type="number" min={1} max={12} value={cpDailyMaxVal} onChange={e=>setCpDailyMaxVal(e.target.value)} className="w-14 border rounded px-1 py-0.5 ml-1" />
                                            </label>
                                            <div className="basis-full text-xs text-slate-500">Not: Bu ayarlar kısıtları yumuşak şekilde yönlendirir. Çok sıkı kombinasyonlar çözümsüzlüğe yol açabilir.</div>
                                          </>
                                        )}
                                      </div>
                                    )}
                                    <Tooltip text="Toplam arama süresi. Daha uzun süre = daha yüksek başarı.">
                                      <span className="font-medium text-slate-600">Süre(s)</span>
                                    </Tooltip>
                                    <input value={timeText} onChange={e=>setTimeText(e.target.value)} onBlur={()=>{ const v = Math.max(10, Math.min(600, parseInt(timeText)||optTime)); setOptTime(v); setTimeText(String(v)); }} inputMode="numeric" pattern="[0-9]*" type="text" className="w-16 border rounded px-1 py-0.5" />
                                    <Tooltip text="Greedy tohumlama oranı. Düşük (0.10–0.15) daha esnek; yüksek daha hızlı fakat kilitlenebilir.">
                                      <span className="font-medium text-slate-600">Seed</span>
                                    </Tooltip>
                                    <input value={seedText} onChange={e=>setSeedText(e.target.value)} onBlur={()=>{ const v = Math.max(0.05, Math.min(0.5, parseFloat(seedText)||optSeedRatio)); setOptSeedRatio(Number(v.toFixed(2))); setSeedText(String(Number(v.toFixed(2)))); }} type="text" inputMode="decimal" className="w-16 border rounded px-1 py-0.5" />
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Tooltip text="Tabu tenure: aynı hamlenin tabu kaldığı iterasyon. 50–80 önerilir.">
                                      <span className="font-medium text-slate-600">Tenure</span>
                                    </Tooltip>
                                    <input value={tenureText} onChange={e=>setTenureText(e.target.value)} onBlur={()=>{ const v = Math.max(5, Math.min(300, parseInt(tenureText)||optTabuTenure)); setOptTabuTenure(v); setTenureText(String(v)); }} type="text" inputMode="numeric" className="w-16 border rounded px-1 py-0.5" />
                                    <Tooltip text="Tabu iterasyon sayısı. 2000–3500 dengeli.">
                                      <span className="font-medium text-slate-600">Iter</span>
                                    </Tooltip>
                                    <input value={iterText} onChange={e=>setIterText(e.target.value)} onBlur={()=>{ const v = Math.max(100, Math.min(10000, parseInt(iterText)||optTabuIter)); setOptTabuIter(v); setIterText(String(v)); }} type="text" inputMode="numeric" className="w-20 border rounded px-1 py-0.5" />
                                    <Tooltip text="Deterministik RNG tohumu. Aynı tohum = aynı arama çizgisi.">
                                      <span className="font-medium text-slate-600">RNG</span>
                                    </Tooltip>
                                    <input value={rngText} onChange={e=>setRngText(e.target.value)} onBlur={()=>{ const v = parseInt(rngText); if (!Number.isNaN(v)) setOptRngSeed(v); setRngText(String(Number.isNaN(v)?(rngText||''):v)); }} placeholder="seed" type="text" inputMode="numeric" className="w-20 border rounded px-1 py-0.5" />
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <label className="flex items-center gap-1">
                                        <input type="checkbox" checked={useDeterministic} onChange={e=>setUseDeterministic(e.target.checked)} />
                                        <Tooltip text="İşaretliyken randomSeed gönderilir; aynı parametrelerle aynı sonuçları üretir.">
                                          <span className="text-slate-600">Deterministik</span>
                                        </Tooltip>
                                    </label>
                                    <label className="flex items-center gap-1">
                                        <input type="checkbox" checked={optStopFirst} onChange={e=>setOptStopFirst(e.target.checked)} />
                                        <Tooltip text="İlk feasible çözüm bulunduğunda hemen durur (hızlı denemeler için)."><span className="text-slate-600">StopFirst</span></Tooltip>
                                    </label>
                                    <label className="flex items-center gap-1">
                                        <input type="checkbox" checked={optDisableLNS} onChange={e=>setOptDisableLNS(e.target.checked)} />
                                        <Tooltip text="Ruin&Recreate iyileştirmesini kapatır; daha klasik/kararlı davranış."><span className="text-slate-600">LNS kapalı</span></Tooltip>
                                    </label>
                                    <label className="flex items-center gap-1">
                                        <input type="checkbox" checked={optDisableEdge} onChange={e=>setOptDisableEdge(e.target.checked)} />
                                        <Tooltip text="Öğretmenin gün başı/sonu ve tekil saat cezalarını kapatır."><span className="text-slate-600">Kenar cezası kapalı</span></Tooltip>
                                    </label>
                                    <label className="flex items-center gap-1 ml-2">
                                        <input type="checkbox" checked={showAnalyzer} onChange={e=>setShowAnalyzer(e.target.checked)} />
                                        <Tooltip text="Uyuşmazlık Analiz Aracı'nı göster/gizle (bazı senaryolarda yer kapladığı için kapalı başlayabilir)"><span className="text-slate-600">Analiz Aracı</span></Tooltip>
                                    </label>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Tooltip text="45s, seed 0.12, tenure 60, iter 2500, StopFirst açık">
                                      <button onClick={()=>applyProfile('fast')} className="px-2 py-1 border rounded text-slate-600 hover:bg-slate-50">Hızlı</button>
                                    </Tooltip>
                                    <Tooltip text="90s, seed 0.12, tenure 70, iter 3000">
                                      <button onClick={()=>applyProfile('balanced')} className="px-2 py-1 border rounded text-slate-600 hover:bg-slate-50">Dengeli</button>
                                    </Tooltip>
                                    <Tooltip text="150s, seed 0.12, tenure 80, iter 3500">
                                      <button onClick={()=>applyProfile('max')} className="px-2 py-1 border rounded text-slate-600 hover:bg-slate-50">Maks</button>
                                    </Tooltip>
                                    <Tooltip text="Klasik: Repair, StopFirst, LNS kapalı, kenar ve yayılım cezası yok">
                                      <button onClick={()=>applyProfile('classic')} className={`px-2 py-1 border rounded ${classicMode ? 'bg-amber-500 text-white border-amber-500' : 'text-slate-600 hover:bg-slate-50'}`}>Klasik</button>
                                    </Tooltip>
                                    <Tooltip text="Bu ayarları başlangıçta otomatik yüklensin diye kaydeder.">
                                      <button onClick={saveSettingsAsDefault} className="px-2 py-1 border rounded text-emerald-600 hover:bg-emerald-50">Varsayılan Yap</button>
                                    </Tooltip>
                                </div>
                                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 mt-2">
                                    <label className="flex items-center gap-1">
                                        <input type="checkbox" checked={showTeacherLoadSummary} onChange={e=>setShowTeacherLoadSummary(e.target.checked)} />
                                        <span>Öğretmen yük analizi</span>
                                    </label>
                                    <label className="flex items-center gap-1">
                                        <input type="checkbox" checked={showTeacherActualLoad} onChange={e=>setShowTeacherActualLoad(e.target.checked)} />
                                        <span>Gerçekleşen yük</span>
                                    </label>
                                    <label className="flex items-center gap-1">
                                        <input type="checkbox" checked={showHeatmapPanel} onChange={e=>setShowHeatmapPanel(e.target.checked)} />
                                        <span>Gün / saat analizi</span>
                                    </label>
                                    <label className="flex items-center gap-1">
                                        <input type="checkbox" checked={showDutyWarnings} onChange={e=>setShowDutyWarnings(e.target.checked)} />
                                        <span>Paylaşılan ders uyarıları</span>
                                    </label>
                                    <label className="flex items-center gap-1">
                                        <input type="checkbox" checked={showDutyCoverage} onChange={e=>setShowDutyCoverage(e.target.checked)} />
                                        <span>Nöbetçi yardımcısı</span>
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            <main className="flex flex-col gap-8">
                
                {!validation.isValid && (
                    <div className="p-4 bg-yellow-50 text-yellow-800 border border-yellow-200 rounded-lg no-print space-y-2">
                        <h3 className="font-bold flex items-center gap-2"><WarningIcon className="w-5 h-5" />Veri Uyuşmazlıkları Tespit Edildi</h3>
                        <ul className="list-disc list-inside text-sm pl-2 space-y-1">
                            {validation.allErrors.map((error, index) => <li key={index}>{error.message}</li>)}
                        </ul>
                        <p className="text-sm font-semibold pt-1">Program oluşturma butonu, tüm bu sorunlar çözülene kadar devre dışı bırakılmıştır.</p>
                    </div>
                )}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {showTeacherLoadSummary && (
                        <TeacherLoadAnalysis teachers={data.teachers} teacherLoads={teacherLoads} />
                    )}
                    {showTeacherActualLoad && (
                        <TeacherActualLoadPanel teachers={data.teachers} teacherLoads={teacherLoads} actualLoads={actualTeacherLoads} />
                    )}
                    {showHeatmapPanel && (
                        <TeacherAvailabilityHeatmap teachers={data.teachers} dayNames={DAYS} maxDailyHours={maxDailyHours} />
                    )}
                    {showAnalyzer && (
                        <ConflictAnalyzer data={data} schoolHours={schoolHours} maxDailyHours={maxDailyHours} />
                    )}
                    {schedule && (
                        <QualitySummary data={data} schedule={schedule} schoolHours={schoolHours} gapThreshold={cpGapLimit==='1'?1:2} />
                    )}
                </div>

                {showDutyWarnings && (
                    <MultiTeacherWarnings data={data} schedule={schedule} />
                )}
                {showDutyCoverage && (
                    <DutyCoveragePanel data={data} schedule={schedule} dayNames={DAYS} />
                )}

                {renderContent()}

                {renderSavedSchedules()}

                {error && <div className="p-4 bg-red-100 text-red-700 border border-red-200 rounded-lg no-print">{error}</div>}
                
                {isLoading && (
                    <div className="flex flex-col items-center justify-center h-96 bg-white rounded-lg shadow-lg">
                        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-sky-500"></div>
                        <p className="mt-4 text-slate-600">Program çözülüyor... Bu işlem verilerinizin karmaşıklığına göre birkaç saniye veya daha uzun sürebilir.</p>
                    </div>
                )}

                {solverStats && (
                    <SolverReport stats={solverStats} />
                )}
                
                {/* Gelişmiş: Örnek veri yükleme (header dışı, küçük bölüm) */}
                <div className="no-print flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <span className="font-medium">Örnek Veriler:</span>
                    <button onClick={()=>loadSampleData('ai')} className="px-2 py-1 border rounded hover:bg-slate-50">AI örnek yükle</button>
                    <button onClick={()=>loadSampleData('school')} className="px-2 py-1 border rounded hover:bg-slate-50">Okul örnek yükle</button>
                </div>

                {schedule && (
                    <div id="schedule-container" className="bg-white p-6 rounded-lg shadow-lg">
                         <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4 no-print">
                            <div className="flex items-center gap-4">
                                <h2 className="text-xl font-bold whitespace-nowrap">
                                    {activeScheduleName ? `${activeScheduleName}` : 'Yeni Program (Kaydedilmedi)'}
                                </h2>
                                <div className="bg-slate-100 p-1 rounded-md">
                                    <button onClick={() => setViewType(ViewType.Class)} className={`px-2 py-1 text-xs rounded ${viewType === ViewType.Class ? 'bg-white shadow' : 'text-slate-500'}`}>Sınıfa Göre</button>
                                    <button onClick={() => setViewType(ViewType.Teacher)} className={`px-2 py-1 text-xs rounded ${viewType === ViewType.Teacher ? 'bg-white shadow' : 'text-slate-500'}`}>Öğretmene Göre</button>
                                </div>
                                <div className="bg-slate-100 p-1 rounded-md">
                                    <button onClick={() => setViewMode('single')} className={`px-2 py-1 text-xs rounded ${viewMode === 'single' ? 'bg-white shadow' : 'text-slate-500'}`}>Sade Görünüm</button>
                                    <button onClick={() => setViewMode('master')} className={`px-2 py-1 text-xs rounded ${viewMode === 'master' ? 'bg-white shadow' : 'text-slate-500'}`}>Tümünü Gör</button>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <select 
                                    value={selectedHeaderId} 
                                    onChange={e => setSelectedHeaderId(e.target.value)}
                                    className={`w-full sm:w-48 rounded-md border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 text-sm p-1.5 ${viewMode === 'master' ? 'hidden' : ''}`}
                                >
                                    {viewOptions.map(opt => <option key={opt.id} value={opt.id}>{opt.name}</option>)}
                                </select>
                                <button onClick={handleSaveSchedule} className="p-2 text-slate-500 hover:text-sky-600 hover:bg-slate-100 rounded-full" title="Programı Kaydet"><SaveIcon className="w-5 h-5" /></button>
                                <button onClick={handleExportSchedule} className="p-2 text-slate-500 hover:text-sky-600 hover:bg-slate-100 rounded-full" title="Programı ve Verileri İndir"><DownloadIcon className="w-5 h-5" /></button>
                                <button onClick={handlePrint} className="p-2 text-slate-500 hover:text-sky-600 hover:bg-slate-100 rounded-full" title="Yazdır"><PrintIcon className="w-5 h-5" /></button>
                            </div>
                        </div>
                        <TimetableView 
                          schedule={schedule} 
                          data={data} 
                          viewType={viewType} 
                          viewMode={viewMode}
                          schoolHours={schoolHours}
                          maxDailyHours={maxDailyHours} 
                          selectedHeaderId={selectedHeaderId}
                          onCellDrop={handleManualDrop} 
                          onIsMoveValid={handleIsMoveValid}
                        />
                    </div>
                )}
                
                 {!isLoading && !schedule && !error && (
                    <div className="flex flex-col items-center justify-center h-96 bg-white rounded-lg shadow-lg text-center p-4 no-print">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-slate-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2-2z" />
                        </svg>
                        <h3 className="text-lg font-medium text-slate-700">Program Bekleniyor</h3>
                        <p className="text-sm text-slate-500 mt-1">Verilerinizi girdikten sonra "Ders Programı Oluştur" butonuna tıklayın.</p>
                    </div>
                 )}
                
                <div className="hidden print:block">
                    {schedule && selectedHeaderId && (
                        <>
                            <h1 className="text-2xl font-bold text-center mb-4">
                                Haftalık Ders Programı - {viewOptions.find(o => o.id === selectedHeaderId)?.name}
                            </h1>
                            <TimetableView 
                                schedule={schedule} 
                                data={data} 
                                viewType={viewType} 
                                viewMode="single"
                                schoolHours={schoolHours}
                                maxDailyHours={maxDailyHours} 
                                selectedHeaderId={selectedHeaderId}
                                onCellDrop={() => {}} 
                                onIsMoveValid={() => false}
                            />
                        </>
                    )}
                </div>
            </main>
            
            <Modal
                isOpen={modalState.type !== null}
                onClose={handleCloseModal}
                title={`${modalState.item ? 'Düzenle' : 'Yeni Ekle'}: ${
                    {
                        teachers: 'Öğretmen',
                        classrooms: 'Sınıf',
                        subjects: 'Ders',
                        locations: 'Mekan',
                        fixedAssignments: 'Sabit Atama',
                        lessonGroups: 'Grup Dersi',
                        duties: 'Ek Görev',
                    }[modalState.type!]
                }`}
            >
                {renderModalContent()}
            </Modal>

            {/* CP-SAT Help Modal */}
            <Modal isOpen={cpHelpOpen} onClose={()=>setCpHelpOpen(false)} title="CP-SAT Ayar Açıklamaları">
              <div className="space-y-3 text-sm text-slate-700">
                <p><span className="font-semibold">Boşlukları azalt</span>: Öğretmenlerin gün içindeki boş saatlerini genel olarak azaltmaya çalışır (ceza ağırlığını artırır).</p>
                <p><span className="font-semibold">Gap üst sınırı</span>: Aynı gün iki ders arasındaki kabul edilebilir en fazla boş saat eşiğidir. Bu eşik aşıldığında ek ceza uygulanır. 1 = daha sıkı, 2 = daha esnek.</p>
                <p><span className="font-semibold">Birlikte kullanım</span>: “Gap üst sınırı” eşiği belirler; “Boşlukları azalt” ise bu boşlukların ne kadar önemli olduğunu (ceza gücünü) artırır. İkisi aynı şeyi değil, birbirini tamamlar.</p>
                <ul className="list-disc list-inside">
                  <li>Hızlı deneme: Sadece “Gap üst sınırı: 2”.</li>
                  <li>Dengeli: “Boşlukları azalt” + “Gap: 2”.</li>
                  <li>Sıkı: “Boşlukları azalt” + “Gap: 1” (çözümsüzlük riski artar).</li>
                </ul>
                <p><span className="font-semibold">Kenar saat azalt</span>: 1. ve son ders saatlerine atamayı azaltmaya çalışır.</p>
                <p><span className="font-semibold">Aynı gün parçalanabilir</span>: Dersi gün içinde araya boşluk girerek bölebilir. Kapalı tutmak blok/bütünlüğü artırır.</p>
              </div>
            </Modal>

            {/* QR floating button (bottom-right) */}
            <button
                onClick={() => setIsQrOpen(true)}
                className="no-print fixed bottom-4 right-4 p-3 rounded-full shadow-lg bg-sky-600 text-white hover:bg-sky-700"
                title="QR Araçları"
            >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                  <path d="M3 3h8v8H3V3zm2 2v4h4V5H5zm6-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm12 0h-2v2h2v-2zm-4 0h2v2h-2v-2zm4 4h-2v2h-2v2h4v-4zm2 0h2v-2h-2v2zm0 2h2v2h-2v-2z" />
                </svg>
            </button>

            {/* QR Tools Modal */}
            <Modal isOpen={isQrOpen} onClose={() => setIsQrOpen(false)} title="QR Araçları">
                <QrTools data={data} schedule={schedule} onImportText={handleQrImportText} />
            </Modal>

        </div>
    );
};
export default App;











