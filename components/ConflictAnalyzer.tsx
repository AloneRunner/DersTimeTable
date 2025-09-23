import React, { useMemo } from 'react';
import type { TimetableData, SchoolHours, Teacher, Classroom, Subject } from '../types';

interface ConflictAnalyzerProps {
  data: TimetableData;
  schoolHours: SchoolHours;
  maxDailyHours: number;
}

const DAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma"];

export const ConflictAnalyzer: React.FC<ConflictAnalyzerProps> = ({ data, schoolHours, maxDailyHours }) => {
  const [selectedClassId, setSelectedClassId] = React.useState<string>('');
  const [selectedSubjectId, setSelectedSubjectId] = React.useState<string>('');

  const subjectsForSelectedClass = useMemo(() => {
    if (!selectedClassId) return [];
    return data.subjects.filter(s => s.assignedClassIds.includes(selectedClassId));
  }, [selectedClassId, data.subjects]);

  const analysisResult = useMemo(() => {
    if (!selectedClassId || !selectedSubjectId) return null;

    const classroom = data.classrooms.find(c => c.id === selectedClassId);
    const subject = data.subjects.find(s => s.id === selectedSubjectId);
    if (!classroom || !subject) return null;

    const teacherSubjectMap = new Map<string, string[]>();
    data.teachers.forEach(teacher => {
      teacher.branches.forEach(branch => {
        if (!teacherSubjectMap.has(branch)) {
          teacherSubjectMap.set(branch, []);
        }
        teacherSubjectMap.get(branch)!.push(teacher.id);
      });
    });

    // Check for pinned teacher first
    const pinnedTeacherIds = subject.pinnedTeacherByClassroom?.[classroom.id];
    let eligibleTeacherIds: string[] = [];
    if (pinnedTeacherIds && pinnedTeacherIds.length > 0) {
        eligibleTeacherIds = pinnedTeacherIds;
    } else {
        eligibleTeacherIds = teacherSubjectMap.get(subject.name) || [];
    }

    const eligibleTeachers = data.teachers.filter(t => eligibleTeacherIds.includes(t.id));

    if (eligibleTeachers.length === 0) {
      return { classroom, subject, teachersAnalysis: [], error: 'Bu dersi verebilecek uygun öğretmen bulunamadı.' };
    }

    let totalAvailableSlots = 0;
    const teachersAnalysis = eligibleTeachers.map(teacher => {
      const availabilityGrid: { available: boolean; reason: string }[][] = Array(5).fill(null).map(() => Array(maxDailyHours).fill({ available: false, reason: 'Bilinmeyen' }));
      let teacherAvailableSlots = 0;

      const canTeachLevel = (classroom.level === 'Ortaokul' && teacher.canTeachMiddleSchool) || (classroom.level === 'Lise' && teacher.canTeachHighSchool);
      if (!canTeachLevel) {
          return { teacher, availabilityGrid, teacherAvailableSlots, error: `Bu öğretmen sınıfın seviyesinde (${classroom.level}) ders veremez.` };
      }

      for (let day = 0; day < 5; day++) {
        const classHours = schoolHours[classroom.level][day];
        for (let hour = 0; hour < maxDailyHours; hour++) {
          if (hour >= classHours) {
            availabilityGrid[day][hour] = { available: false, reason: 'Sınıf ders saati dışında' };
            continue;
          }
          if (!teacher.availability[day][hour]) {
            availabilityGrid[day][hour] = { available: false, reason: 'Öğretmen müsait değil' };
            continue;
          }
          // Potentially check for duties or fixed assignments here if needed for more detail
          
          availabilityGrid[day][hour] = { available: true, reason: 'Müsait' };
          teacherAvailableSlots++;
        }
      }
      totalAvailableSlots += teacherAvailableSlots;
      return { teacher, availabilityGrid, teacherAvailableSlots, error: null };
    });

    return { classroom, subject, teachersAnalysis, totalAvailableSlots, error: null };

  }, [selectedClassId, selectedSubjectId, data, schoolHours, maxDailyHours]);

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg no-print">
      <h2 className="text-xl font-bold mb-4">Uyuşmazlık Analiz Aracı</h2>
      <p className="text-sm text-slate-500 mb-4">
        Yerleştirilemeyen bir dersin nedenini bulmak için sınıf ve ders seçin. Bu araç, seçilen ders için uygun öğretmenlerin ve sınıfın ortak boş zamanlarını gösterir.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-slate-700">Sınıf Seçin</label>
          <select
            value={selectedClassId}
            onChange={e => {
              setSelectedClassId(e.target.value);
              setSelectedSubjectId('');
            }}
            className="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500"
          >
            <option value="">-- Sınıf --</option>
            {data.classrooms.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Ders Seçin</label>
          <select
            value={selectedSubjectId}
            onChange={e => setSelectedSubjectId(e.target.value)}
            disabled={!selectedClassId}
            className="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 disabled:bg-slate-50"
          >
            <option value="">-- Ders --</option>
            {subjectsForSelectedClass.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {analysisResult && (
        <div className="border-t pt-4">
          <h3 className="text-lg font-semibold">Analiz Sonucu: {analysisResult.classroom.name} - {analysisResult.subject.name}</h3>
          
          {analysisResult.error && <p className="mt-2 text-red-600 bg-red-50 p-3 rounded-md">{analysisResult.error}</p>}

          {analysisResult.totalAvailableSlots !== undefined && (
             <div className={`mt-4 p-3 rounded-md text-sm ${analysisResult.totalAvailableSlots < analysisResult.subject.weeklyHours ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
                Bu ders için gereken haftalık saat: <span className="font-bold">{analysisResult.subject.weeklyHours}</span>.
                Uygun öğretmen(ler) ile toplam ortak boş saat sayısı: <span className="font-bold">{analysisResult.totalAvailableSlots}</span>.
             </div>
          )}

          <div className="space-y-6 mt-4 max-h-[60vh] overflow-y-auto pr-2">
            {analysisResult.teachersAnalysis.map(({ teacher, availabilityGrid, teacherAvailableSlots, error }) => (
              <div key={teacher.id} className="border p-4 rounded-lg">
                <h4 className="font-semibold text-md">{teacher.name}</h4>
                {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
                {!error && <p className="text-sm text-slate-500">Toplam uygun saat: {teacherAvailableSlots}</p>}
                
                <div className="overflow-x-auto mt-3">
                    <table className="min-w-full text-center text-xs border-collapse">
                        <thead>
                            <tr className="bg-slate-50">
                                <th className="p-1.5 border w-12"></th>
                                {DAYS.map(day => <th key={day} className="p-1.5 font-medium text-slate-600 border">{day}</th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {Array.from({length: maxDailyHours}).map((_, hourIndex) => (
                                <tr key={hourIndex}>
                                    <td className="p-1.5 font-medium text-slate-600 border bg-slate-50">{hourIndex + 1}</td>
                                    {DAYS.map((_, dayIndex) => {
                                        const cell = availabilityGrid[dayIndex][hourIndex];
                                        return (
                                            <td 
                                                key={dayIndex} 
                                                className={`p-1.5 border ${cell.available ? 'bg-green-100' : 'bg-slate-200'}`}
                                                title={cell.reason}
                                            ></td>
                                        )
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
