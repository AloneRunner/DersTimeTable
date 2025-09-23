import React, { useMemo, useState } from 'react';
import type { Subject, TimetableData, Teacher } from '../../types';
import { AutocompleteInput } from '../../components/AutocompleteInput';
import { subjectSuggestions } from '../../data/suggestions';

const DAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma"];

export const SubjectForm: React.FC<{
  item: Subject | null;
  data: TimetableData;
  onSave: (data: Omit<Subject, 'id'> | Subject) => void;
  onCancel: () => void;
  updateTeacher: (teacher: Teacher) => void;
}> = ({ item, data, onSave, onCancel, updateTeacher }) => {
  const [subject, setSubject] = useState<Subject | Omit<Subject, 'id'>>(
    item || {
      name: '',
      weeklyHours: 1,
      blockHours: 0,
      tripleBlockHours: 0,
      maxConsec: undefined,
      assignedClassIds: [],
      locationId: undefined,
      pinnedTeacherByClassroom: {},
      requiredTeacherCount: 1,
    }
  );

  const eligibleTeachers = useMemo(() => {
    if (!subject.name) return [];
    return data.teachers.filter((teacher) =>
      teacher.branches.some((branch) => branch.trim().toLowerCase() === subject.name.trim().toLowerCase())
    );
  }, [subject.name, data.teachers]);

  const allTeachersForPinning = useMemo(() => {
    const eligibleIds = new Set(eligibleTeachers.map((t) => t.id));
    const others = data.teachers.filter((t) => !eligibleIds.has(t.id));
    return { eligible: eligibleTeachers, others };
  }, [eligibleTeachers, data.teachers]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target as HTMLInputElement;
    setSubject((prev: any) => {
      const numeric = ['weeklyHours', 'blockHours', 'tripleBlockHours', 'maxConsec', 'requiredTeacherCount'];
      const s: any = { ...prev, [name]: numeric.includes(name) ? (value === '' ? undefined : (parseInt(value) || 0)) : value };
      s.blockHours = Math.min(s.blockHours, s.weeklyHours);
      if (s.blockHours % 2 !== 0) s.blockHours = prev.blockHours;
      s.tripleBlockHours = Math.min(s.tripleBlockHours, s.weeklyHours);
      if (s.tripleBlockHours % 3 !== 0) s.tripleBlockHours = prev.tripleBlockHours;
      const totalBlockHours = (s.blockHours || 0) + (s.tripleBlockHours || 0);
      if (totalBlockHours > s.weeklyHours) {
        const overflow = totalBlockHours - s.weeklyHours;
        s.tripleBlockHours = Math.max(0, s.tripleBlockHours - overflow);
        if (s.tripleBlockHours % 3 !== 0) s.tripleBlockHours = Math.floor(s.tripleBlockHours / 3) * 3;
      }
      return s;
    });
  };

  const handleNameChange = (value: string) => {
    setSubject((prev) => ({ ...prev, name: value }));
  };

  const handleClassAssignmentChange = (classroomId: string) => {
    setSubject((prev: any) => {
      const assigned = prev.assignedClassIds.includes(classroomId)
        ? prev.assignedClassIds.filter((id: string) => id !== classroomId)
        : [...prev.assignedClassIds, classroomId];
      const pinned = { ...(prev.pinnedTeacherByClassroom || {}) };
      if (!assigned.includes(classroomId)) delete pinned[classroomId];
      return { ...prev, assignedClassIds: assigned, pinnedTeacherByClassroom: pinned };
    });
  };

  const handlePinTeacher = (classroomId: string, teacherId: string) => {
    setSubject((prev: any) => {
      const newPinned = { ...(prev.pinnedTeacherByClassroom || {}) };
      if (teacherId) newPinned[classroomId] = teacherId;
      else delete newPinned[classroomId];
      return { ...prev, pinnedTeacherByClassroom: newPinned };
    });

    if (teacherId && subject.name) {
      const teacher = data.teachers.find((t) => t.id === teacherId);
      if (teacher) {
        const subjectNameTrimmed = subject.name.trim();
        const subjectNameLower = subjectNameTrimmed.toLowerCase();
        const hasBranch = teacher.branches.some((b) => b.trim().toLowerCase() === subjectNameLower);
        if (!hasBranch) {
          updateTeacher({ ...teacher, branches: [...teacher.branches, subjectNameTrimmed] });
        }
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(subject);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700">Ders Adı</label>
        <AutocompleteInput
          value={subject.name}
          onChange={handleNameChange}
          suggestions={subjectSuggestions}
          placeholder="Ders adı yazın veya seçin"
          className="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500"
          required
        />
      </div>

      {eligibleTeachers.length > 0 && (
        <div className="rounded-md border p-3 bg-slate-50 text-xs text-slate-600">
          Bu ders için önerilen öğretmenler: {eligibleTeachers.map((t) => t.name).join(', ')}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700">Haftalık Saat</label>
          <input
            type="number"
            name="weeklyHours"
            value={(subject as any).weeklyHours}
            onChange={handleChange}
            min={1}
            max={40}
            className="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">2'li Blok Saat</label>
          <input
            type="number"
            name="blockHours"
            value={(subject as any).blockHours}
            onChange={handleChange}
            min={0}
            max={(subject as any).weeklyHours}
            step={2}
            className="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500"
          />
          <p className="text-xs text-slate-500 mt-1">Bu dersin 2'li blok kaç saat olacağı.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">3'lü Blok Saat</label>
          <input
            type="number"
            name="tripleBlockHours"
            value={(subject as any).tripleBlockHours || 0}
            onChange={handleChange}
            min={0}
            max={(subject as any).weeklyHours}
            step={3}
            className="mt-1 block w-full rounded-md border-slate-300 shadow-sm"
          />
          <p className="text-xs text-slate-500 mt-1">3'ün katı olmalı.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700">Maks. Ardışık Saat (opsiyonel)</label>
          <input
            type="number"
            name="maxConsec"
            value={(subject as any).maxConsec ?? ''}
            onChange={handleChange}
            min={1}
            max={(subject as any).weeklyHours}
            className="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500"
            placeholder="Boş bırakabilirsiniz"
          />
          <p className="text-xs text-slate-500 mt-1">Bir günde bu dersten art arda en fazla saat.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Gerekli Öğretmen Sayısı</label>
          <input
            type="number"
            name="requiredTeacherCount"
            value={(subject as any).requiredTeacherCount || 1}
            onChange={handleChange}
            min={1}
            max={5}
            className="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500"
          />
          <p className="text-xs text-slate-500 mt-1">Atölye dersleri için 2 veya daha fazla olabilir.</p>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700">Fiziki Mekan (isteğe bağlı)</label>
        <select
          name="locationId"
          value={(subject as any).locationId || ''}
          onChange={handleChange}
          className="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500"
        >
          <option value="">Yok</option>
          {data.locations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700">Atanacak Sınıflar</label>
        <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-2 border p-3 rounded-md max-h-40 overflow-y-auto">
          {data.classrooms.map((c) => (
            <label key={c.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={(subject as any).assignedClassIds.includes(c.id)}
                onChange={() => handleClassAssignmentChange(c.id)}
                className="rounded"
              />
              {c.name}
            </label>
          ))}
        </div>
      </div>

      {(subject as any).assignedClassIds.length > 0 && data.teachers.length > 0 && (
        <div className="mt-4 border rounded-md p-3">
          <p className="text-sm font-medium text-slate-700 mb-2">Sınıf Bazlı Öğretmen Sabitle (opsiyonel)</p>
          <div className="grid md:grid-cols-2 gap-3">
            {(subject as any).assignedClassIds.map((cid: string) => {
              const className = data.classrooms.find((c) => c.id === cid)?.name || cid;
              const pinned = (subject as any).pinnedTeacherByClassroom?.[cid] || '';
              return (
                <div key={cid} className="flex items-center gap-2">
                  <span className="w-24 text-sm font-medium text-slate-600 truncate">{className}:</span>
                  <select value={pinned} onChange={(e) => handlePinTeacher(cid, e.target.value)} className="flex-1 rounded-md border-slate-300 shadow-sm text-sm p-1.5">
                    <option value="">(Otomatik Seç)</option>
                    <optgroup label="Önerilen Öğretmenler">
                      {allTeachersForPinning.eligible.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </optgroup>
                    {allTeachersForPinning.others.length > 0 && (
                      <optgroup label="Diğer Öğretmenler">
                        {allTeachersForPinning.others.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-slate-500 mt-2">Bir öğretmen seçerseniz ve bu ders branşlarında yoksa, otomatik olarak eklenir.</p>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-4">
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700">
          İptal
        </button>
        <button type="submit" className="px-4 py-2 rounded-md bg-sky-500 hover:bg-sky-600 text-white">Kaydet</button>
      </div>
    </form>
  );
};
