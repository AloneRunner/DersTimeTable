import React, { useState, useCallback, useMemo, useEffect } from 'react';
import type { Schedule, TimetableData } from '../types';

interface DutyCoveragePanelProps {
    data: TimetableData;
    schedule: Schedule | null;
    dayNames: string[];
}

const DutyCoveragePanel: React.FC<DutyCoveragePanelProps> = ({ data, schedule, dayNames }) => {
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
                <p className="mt-4 text-xs text-amber-600">Henüz nöbet verisi eklenmemiş. Önce Öğretmen > Ek Görevler sekmesinden nöbet listesi oluştur.</p>
            )}
        </div>
    );
};

export default DutyCoveragePanel;
