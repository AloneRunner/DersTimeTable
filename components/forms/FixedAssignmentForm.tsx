import React, { useMemo, useState } from 'react';
import type { FixedAssignment, TimetableData } from '../../types';

const DAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma"];

export const FixedAssignmentForm: React.FC<{
  item: FixedAssignment | null;
  data: TimetableData;
  onSave: (data: Omit<FixedAssignment, 'id'> | FixedAssignment) => void;
  onCancel: () => void;
  maxDailyHours: number;
}> = ({ item, data, onSave, onCancel, maxDailyHours }) => {
  const [assignment, setAssignment] = useState<FixedAssignment | Omit<FixedAssignment, 'id'>>(
    item || { classroomId: '', subjectId: '', dayIndex: 0, hourIndex: 0 }
  );

  const availableSubjects = useMemo(() => {
    if (!assignment.classroomId) return [];
    return data.subjects.filter((s) => s.assignedClassIds.includes(assignment.classroomId));
  }, [assignment.classroomId, data.subjects]);
  const HOURS = useMemo(() => Array.from({ length: maxDailyHours }, (_, i) => `${i + 1}`), [maxDailyHours]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const { name, value } = e.target;
    const isNumeric = ['dayIndex', 'hourIndex'].includes(name);
    setAssignment((prev: any) => {
      const updated: any = { ...prev, [name]: isNumeric ? parseInt(value) : value };
      if (name === 'classroomId' && prev.classroomId !== value) updated.subjectId = '';
      return updated;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignment.classroomId || !assignment.subjectId) {
      alert('Lütfen sınıf ve ders seçin.');
      return;
    }
    onSave(assignment);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700">Sınıf</label>
          <select name="classroomId" value={(assignment as any).classroomId} onChange={handleChange} className="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500" required>
            <option value="">Sınıf Seçin</option>
            {data.classrooms.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Ders</label>
          <select name="subjectId" value={(assignment as any).subjectId} onChange={handleChange} className="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500" required disabled={!(assignment as any).classroomId}>
            <option value="">Ders Seçin</option>
            {availableSubjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700">Gün</label>
          <select name="dayIndex" value={(assignment as any).dayIndex} onChange={handleChange} className="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500" required>
            {DAYS.map((day, index) => (
              <option key={index} value={index}>
                {day}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Saat</label>
          <select name="hourIndex" value={(assignment as any).hourIndex} onChange={handleChange} className="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500" required>
            {HOURS.map((hour, index) => (
              <option key={index} value={index}>
                {hour}. Ders
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700">
          İptal
        </button>
        <button type="submit" className="px-4 py-2 rounded-md bg-sky-500 hover:bg-sky-600 text-white">Kaydet</button>
      </div>
    </form>
  );
};

