import React, { useState } from 'react';
import type { LessonGroup, TimetableData } from '../../types';

export const LessonGroupForm: React.FC<{
  item: LessonGroup | null;
  data: TimetableData;
  onSave: (data: Omit<LessonGroup, 'id'> | LessonGroup) => void;
  onCancel: () => void;
}> = ({ item, data, onSave, onCancel }) => {
  const [group, setGroup] = useState<LessonGroup | Omit<LessonGroup, 'id'>>(
    item || { name: '', subjectId: '', classroomIds: [], weeklyHours: 1, isBlock: false }
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type, checked } = e.target as HTMLInputElement;
    setGroup((prev: any) => ({ ...prev, [name]: type === 'checkbox' ? checked : name === 'weeklyHours' ? parseInt(value) : value }));
  };

  const handleClassAssignmentChange = (classroomId: string) => {
    setGroup((prev: any) => {
      const newClassroomIds = prev.classroomIds.includes(classroomId)
        ? prev.classroomIds.filter((id: string) => id !== classroomId)
        : [...prev.classroomIds, classroomId];
      return { ...prev, classroomIds: newClassroomIds };
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(group);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700">Grup Adı</label>
        <input
          type="text"
          name="name"
          value={(group as any).name}
          onChange={handleChange}
          className="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700">Ders</label>
        <select name="subjectId" value={(group as any).subjectId} onChange={handleChange} className="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500" required>
          <option value="">Ders Seçin</option>
          {data.subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700">Haftalık Ders Saati</label>
        <input
          type="number"
          name="weeklyHours"
          value={(group as any).weeklyHours}
          onChange={handleChange}
          min={1}
          max={10}
          className="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700">Gruba Dahil Sınıflar</label>
        <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-2 border p-3 rounded-md max-h-40 overflow-y-auto">
          {data.classrooms.map((c) => (
            <label key={c.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={(group as any).classroomIds.includes(c.id)}
                onChange={() => handleClassAssignmentChange(c.id)}
                className="rounded"
              />
              {c.name}
            </label>
          ))}
        </div>
      </div>
      <div className="flex gap-4">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="isBlock" checked={(group as any).isBlock} onChange={handleChange} className="rounded" /> Blok Ders
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

