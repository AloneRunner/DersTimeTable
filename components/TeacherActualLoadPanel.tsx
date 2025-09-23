import React, { useMemo } from 'react';
import type { Teacher, TeacherLoad } from '../types';

const TeacherActualLoadPanel: React.FC<{ teachers: Teacher[]; teacherLoads: Map<string, TeacherLoad>; actualLoads: Map<string, number> | null; teacherDailyCounts?: Map<string, { countsPerDay: number[]; busiestDay: { dayIndex: number; count: number } | null }>; }> = ({ teachers, teacherLoads, actualLoads, teacherDailyCounts }) => {
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
            <div className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-md p-3">
                Gerçekleşen yük verisi bulunamadı.
            </div>
        );
    }

    if (!rows || rows.length === 0) return null;

    return (
        <div className="bg-white p-6 rounded-lg shadow-lg no-print">
            <h2 className="text-xl font-bold mb-4">Gerçekleşen Yük</h2>
            <table className="min-w-full text-sm text-left">
                <thead>
                    <tr>
                        <th className="px-4 py-2">Öğretmen</th>
                        <th className="px-4 py-2">Hedef</th>
                        <th className="px-4 py-2">Gerçekleşen</th>
                            <th className="px-4 py-2">Fark</th>
                            <th className="px-4 py-2">Yoğun Gün</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(row => (
                        <tr key={row.id}>
                            <td className="px-4 py-2">{row.name}</td>
                            <td className="px-4 py-2">{row.target}</td>
                            <td className="px-4 py-2">{row.actual}</td>
                            <td className="px-4 py-2">{row.delta}</td>
                                <td className="px-4 py-2">
                                    {teacherDailyCounts?.get(row.id)?.busiestDay ? (
                                        <span>{['Pzt','Sal','Çar','Per','Cum'][teacherDailyCounts.get(row.id)!.busiestDay!.dayIndex]} ({teacherDailyCounts.get(row.id)!.busiestDay!.count})</span>
                                    ) : (
                                        <span className="text-slate-500">-</span>
                                    )}
                                </td>
                            </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default TeacherActualLoadPanel;