import React, { useMemo } from 'react';
import type { Schedule, TimetableData } from '../types';

interface MultiTeacherWarningsProps {
    data: TimetableData;
    schedule: Schedule | null;
}

const MultiTeacherWarnings: React.FC<MultiTeacherWarningsProps> = ({ data, schedule }) => {
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

export default MultiTeacherWarnings;
