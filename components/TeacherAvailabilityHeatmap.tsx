import React, { useMemo } from 'react';
import type { Teacher } from '../types';

interface TeacherAvailabilityHeatmapProps {
    teachers: Teacher[];
    dayNames: string[];
    maxDailyHours: number;
}

const colorForPercent = (percent: number) => {
    const clamped = Math.max(0, Math.min(100, percent));
    const hue = (clamped / 100) * 120;
    const lightness = Math.max(25, 65 - clamped * 0.25);
    return `hsl(${Math.round(hue)}, 70%, ${Math.round(lightness)}%)`;
};

const TeacherAvailabilityHeatmap: React.FC<TeacherAvailabilityHeatmapProps> = ({ teachers, dayNames, maxDailyHours }) => {
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

export default TeacherAvailabilityHeatmap;
