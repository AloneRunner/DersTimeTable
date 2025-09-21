import React, { useMemo } from 'react';
import type { Teacher } from '../types';
import type { TeacherLoad } from '../hooks/useLoadCalculation';

interface TeacherActualLoadPanelProps {
    teachers: Teacher[];
    teacherLoads: Map<string, TeacherLoad>;
    actualLoads: Map<string, number> | null;
}

const TeacherActualLoadPanel: React.FC<TeacherActualLoadPanelProps> = ({ teachers, teacherLoads, actualLoads }) => {
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

export default TeacherActualLoadPanel;
