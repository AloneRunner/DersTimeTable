import React, { useMemo, useState, useEffect } from 'react';
import type { Duty, TimetableData } from '../../types';

const DAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma"];

type DutyFormState = {
  name: string;
  teacherId: string;
  dayIndex: number;
};

const buildInitialState = (item: Duty | null): DutyFormState => {
  if (item) {
    return { name: item.name, teacherId: item.teacherId, dayIndex: item.dayIndex };
  }
  return { name: '', teacherId: '', dayIndex: 0 };
};

export const DutyForm: React.FC<{
  item: Duty | null;
  data: TimetableData;
  onSave: (data: Omit<Duty, 'id'> | Duty) => void;
  onCancel: () => void;
  maxDailyHours: number;
}> = ({ item, data, onSave, onCancel, maxDailyHours }) => {
  const [form, setForm] = useState<DutyFormState>(buildInitialState(item));
  const [allDay, setAllDay] = useState<boolean>(item?.hourIndex === -1);
  const [hourIndex, setHourIndex] = useState<number>(
    item?.hourIndex === -1 ? 0 : item?.hourIndex ?? 0
  );

  useEffect(() => {
    setForm(buildInitialState(item));
    setAllDay(item?.hourIndex === -1);
    setHourIndex(item?.hourIndex === -1 ? 0 : item?.hourIndex ?? 0);
  }, [item]);

  const HOURS = useMemo(
    () => Array.from({ length: maxDailyHours }, (_, i) => `${i + 1}`),
    [maxDailyHours]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'dayIndex') {
      setForm((prev) => ({ ...prev, dayIndex: parseInt(value, 10) }));
    } else if (name === 'name' || name === 'teacherId') {
      setForm((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleHourChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setHourIndex(parseInt(e.target.value, 10));
  };

  const handleAllDayToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAllDay(e.target.checked);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Omit<Duty, 'id'> | Duty = {
      ...form,
      hourIndex: allDay ? -1 : hourIndex,
      name: form.name.trim(),
    };
    onSave(payload);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700">Görev Adı (örn: Nöbet)</label>
        <input
          type="text"
          name="name"
          value={form.name}
          onChange={handleChange}
          className="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700">Öğretmen</label>
        <select
          name="teacherId"
          value={form.teacherId}
          onChange={handleChange}
          className="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500"
          required
        >
          <option value="">Öğretmen Seçin</option>
          {data.teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700">Gün</label>
          <select
            name="dayIndex"
            value={form.dayIndex}
            onChange={handleChange}
            className="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500"
            required
          >
            {DAYS.map((day, index) => (
              <option key={index} value={index}>
                {day}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Saat</label>
          <select
            name="hourIndex"
            value={hourIndex}
            onChange={handleHourChange}
            className="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500"
            disabled={allDay}
          >
            {HOURS.map((hour, index) => (
              <option key={index} value={index}>
                {hour}. Ders
              </option>
            ))}
          </select>
          <label className="mt-2 inline-flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={allDay} onChange={handleAllDayToggle} /> Tüm gün nöbetçi
          </label>
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
