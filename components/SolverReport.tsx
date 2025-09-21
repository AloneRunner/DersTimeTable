import React from 'react';
import type { SolverStats } from '../types';

interface SolverReportProps {
    stats: SolverStats;
}

const SolverReport: React.FC<SolverReportProps> = ({ stats }) => {
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

export default SolverReport;
