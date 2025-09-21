import React, { useState } from 'react';
import type { Classroom, TimetableData } from '../../types';
import { SchoolLevel, ClassGroup } from '../../types';

export const ClassroomForm: React.FC<{
  item: Classroom | null;
  data: TimetableData;
  onSave: (data: Omit<Classroom, 'id'> | Classroom) => void;
  onCancel: () => void;
}> = ({ item, data, onSave, onCancel }) => {
  const [classroom, setClassroom] = useState<Omit<Classroom, 'id'> | Classroom>(
    item || { name: '', level: SchoolLevel.High, group: ClassGroup.None, homeroomTeacherId: '', sessionType: 'full' }
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setClassroom((prev) => {
      const updated = { ...prev } as any;
      updated[name] = value;
      return updated as typeof prev;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const dataToSave = { ...classroom, homeroomTeacherId: (classroom as any).homeroomTeacherId || undefined };
    onSave(dataToSave);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700">Sınıf Adı (örn: 9-A)</label>
        <input
          type="text"
          name="name"
          value={(classroom as any).name}
          onChange={handleChange}
          className="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700">Seviye</label>
        <select
          name="level"
          value={(classroom as any).level}
          onChange={handleChange}
          className="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500"
        >
          {Object.values(SchoolLevel).map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700">Ders Zamanı</label>
        <select
          name="sessionType"
          value={(classroom as any).sessionType}
          onChange={handleChange}
          className="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500"
        >
          <option value="full">Tam Gün</option>
          <option value="morning">Sabahçı</option>
          <option value="afternoon">Öğlenci</option>
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700">Grup</label>
        <select
          name="group"
          value={(classroom as any).group}
          onChange={handleChange}
          className="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500"
        >
          {Object.values(ClassGroup).map((group) => (
            <option key={group} value={group}>
              {group}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700">Sınıf Öğretmeni (İsteğe bağlı)</label>
        <select
          name="homeroomTeacherId"
          value={(classroom as any).homeroomTeacherId || ''}
          onChange={handleChange}
          className="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500"
        >
          <option value="">Yok</option>
          {data.teachers.map((teacher) => (
            <option key={teacher.id} value={teacher.id}>
              {teacher.name}
            </option>
          ))}
        </select>
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

