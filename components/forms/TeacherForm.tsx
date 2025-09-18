import React, { useMemo, useState } from 'react';
import type { Teacher } from '../../types';
import { AutocompleteInput } from '../../components/AutocompleteInput';
import { subjectSuggestions } from '../../data/suggestions';

const DAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma"];

export const TeacherForm: React.FC<{
  item: Teacher | null;
  onSave: (data: Omit<Teacher, 'id'> | Teacher) => void;
  onCancel: () => void;
  maxDailyHours: number;
}> = ({ item, onSave, onCancel, maxDailyHours }) => {
  const [teacher, setTeacher] = useState<Omit<Teacher, 'id'> | Teacher>(
    item || {
      name: '',
      branches: [],
      availability: Array(5)
        .fill(null)
        .map(() => Array(16).fill(true)),
      canTeachHighSchool: true,
      canTeachMiddleSchool: true,
    }
  );
  const [branchesStr, setBranchesStr] = useState(item?.branches.join(', ') || '');
  const HOURS = useMemo(
    () => Array.from({ length: maxDailyHours }, (_, i) => `${i + 1}`),
    [maxDailyHours]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setTeacher((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleAvailabilityToggle = (dayIndex: number, hourIndex: number) => {
    const newAvailability = teacher.availability.map((day) => [...day]);
    newAvailability[dayIndex][hourIndex] = !newAvailability[dayIndex][hourIndex];
    setTeacher((prev) => ({ ...prev, availability: newAvailability }));
  };

  const handleToggleDayAvailability = (dayIndex: number) => {
    const newAvailability = teacher.availability.map((day) => [...day]);
    const areAllChecked = newAvailability[dayIndex]
      .slice(0, maxDailyHours)
      .every((hour) => hour === true);
    for (let i = 0; i < maxDailyHours; i++) {
      newAvailability[dayIndex][i] = !areAllChecked;
    }
    setTeacher((prev) => ({ ...prev, availability: newAvailability }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...teacher,
      branches: branchesStr.split(',').map((b) => b.trim()).filter(Boolean),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700">Ad Soyad</label>
        <input
          type="text"
          name="name"
          value={teacher.name}
          onChange={handleChange}
          className="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700">Branşlar (Virgülle ayırın)</label>
        <AutocompleteInput
          value={branchesStr}
          onChange={(val) => setBranchesStr(val)}
          suggestions={subjectSuggestions}
          placeholder="Örn: Matematik, Fizik"
          className="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500"
          required
          multi
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">Müsaitlik</label>
        <div className="overflow-x-auto border rounded-lg">
          <table className="min-w-full text-center text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="p-2 border-b border-r"></th>
                {DAYS.map((day) => (
                  <th key={day} className="p-2 font-medium text-slate-600 border-b border-r">
                    {day}
                  </th>
                ))}
              </tr>
              <tr className="bg-slate-100">
                <td className="p-1 border-b border-r text-xs font-normal">Tümü</td>
                {DAYS.map((_, dayIndex) => (
                  <td key={dayIndex} className="p-1 border-b border-r">
                    <input
                      type="checkbox"
                      checked={teacher.availability[dayIndex].slice(0, maxDailyHours).every((hour) => hour === true)}
                      onChange={() => handleToggleDayAvailability(dayIndex)}
                      className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500 cursor-pointer"
                      title={`${DAYS[dayIndex]} günü için tüm saatleri seç/bırak`}
                    />
                  </td>
                ))}
              </tr>
            </thead>
            <tbody>
              {HOURS.map((hour, hourIndex) => (
                <tr key={hour}>
                  <td className="p-2 font-medium text-slate-600 border-b border-r bg-slate-50">{hour}. Ders</td>
                  {DAYS.map((_, dayIndex) => (
                    <td key={dayIndex} className="p-2 border-b border-r">
                      <input
                        type="checkbox"
                        checked={teacher.availability[dayIndex][hourIndex]}
                        onChange={() => handleAvailabilityToggle(dayIndex, hourIndex)}
                        className="h-5 w-5 rounded border-slate-300 text-sky-600 focus:ring-sky-500 cursor-pointer"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex gap-4">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="canTeachMiddleSchool" checked={teacher.canTeachMiddleSchool} onChange={handleChange} className="rounded" /> Ortaokul
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="canTeachHighSchool" checked={teacher.canTeachHighSchool} onChange={handleChange} className="rounded" /> Lise
        </label>
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

