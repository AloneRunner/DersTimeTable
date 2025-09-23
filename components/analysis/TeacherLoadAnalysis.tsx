import React, { useMemo } from 'react';
import type { Teacher } from '../../types';
import type { TeacherLoad } from '../../hooks/useLoadCalculation';

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

export default TeacherLoadAnalysis;