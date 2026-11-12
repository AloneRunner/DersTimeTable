import React, { useEffect, useMemo, useState } from 'react';
import type { Schedule, SchoolHours, TimetableData } from '../types';
import { Modal } from './Modal';
import {
  applyTeacherChange,
  changeSlots,
  evaluateCandidates,
  slotLabel,
  type SlotRef,
  type TeacherChangeScope,
  type TeacherChangeTarget,
} from '../utils/teacherChange';

export type TeacherChangePayload = {
  schedule: Schedule;
  slots: SlotRef[];
  classroomId: string;
  subjectId: string;
  replacedTeacherId: string;
  newTeacherId: string;
  scope: TeacherChangeScope;
  /** Veride de sabitle: bir sonraki "Program Oluştur" da aynı öğretmeni kullansın. */
  pinInData: boolean;
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  schedule: Schedule | null;
  data: TimetableData;
  schoolHours: SchoolHours;
  target: TeacherChangeTarget | null;
  onApply: (payload: TeacherChangePayload) => void;
}

/**
 * Var olan programda bir dersin öğretmenini değiştirme penceresi.
 * Yerleşim aynen kalır; yalnız öğretmen adı değişir ve yeni öğretmenin
 * programında görünür. Aday listesi, o saatlerde boş olmayanları sebebiyle
 * birlikte gösterir.
 */
export const TeacherChangeModal: React.FC<Props> = ({ isOpen, onClose, schedule, data, schoolHours, target, onApply }) => {
  const origin = target && schedule ? schedule[target.classroomId]?.[target.dayIndex]?.[target.hourIndex] ?? null : null;
  const subject = origin ? data.subjects.find(s => s.id === origin.subjectId) : undefined;
  const classroom = target ? data.classrooms.find(c => c.id === target.classroomId) : undefined;

  const [scope, setScope] = useState<TeacherChangeScope>('all');
  const [replacedTeacherId, setReplacedTeacherId] = useState<string>('');
  const [newTeacherId, setNewTeacherId] = useState<string>('');
  const [pinInData, setPinInData] = useState<boolean>(false);
  const [openDetails, setOpenDetails] = useState<string | null>(null);

  // Pencere her açılışta hedefe göre sıfırlanır.
  useEffect(() => {
    if (!isOpen || !origin || !target) return;
    const first = origin.teacherIds[0] ?? '';
    setScope('all');
    setReplacedTeacherId(first);
    setNewTeacherId('');
    setOpenDetails(null);
    // Veride bu sınıf için bu ders zaten eski öğretmene sabitlenmişse, sabiti de
    // taşımak varsayılan; yoksa veriye dokunmamak varsayılan.
    const pinned = subject?.pinnedTeacherByClassroom?.[target.classroomId] ?? [];
    setPinInData(pinned.includes(first));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, target?.classroomId, target?.dayIndex, target?.hourIndex]);

  const slots = useMemo(
    () => (schedule && target ? changeSlots(schedule, target, scope) : []),
    [schedule, target, scope],
  );
  const candidates = useMemo(
    () => (schedule && target ? evaluateCandidates(schedule, { data, schoolHours }, target, scope) : []),
    [schedule, data, schoolHours, target, scope],
  );

  if (!isOpen || !target || !origin || !subject || !classroom) return null;

  const currentTeachers = origin.teacherIds
    .map(id => data.teachers.find(t => t.id === id))
    .filter(Boolean) as TimetableData['teachers'];
  const chosen = candidates.find(c => c.teacher.id === newTeacherId);
  const canApply = !!chosen && chosen.conflicts.length === 0 && !!replacedTeacherId;

  const handleApply = () => {
    if (!schedule || !canApply) return;
    const result = applyTeacherChange(schedule, target, scope, replacedTeacherId, newTeacherId);
    onApply({
      schedule: result.schedule,
      slots: result.slots,
      classroomId: target.classroomId,
      subjectId: subject.id,
      replacedTeacherId,
      newTeacherId,
      scope,
      pinInData,
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Dersin öğretmenini değiştir">
      <div className="space-y-5 text-sm">
        <div className="rounded-md bg-slate-50 border border-slate-200 p-3">
          <p>
            <span className="font-semibold">{classroom.name}</span> · <span className="font-semibold">{subject.name}</span>
          </p>
          <p className="text-slate-600 mt-1">
            Şu anki öğretmen: {currentTeachers.map(t => t.name).join(', ') || '—'}
          </p>
          <p className="text-slate-500 text-xs mt-1">
            Program yerleşimi değişmez; yalnız öğretmen adı değişir ve ders yeni öğretmenin programında görünür.
          </p>
        </div>

        {currentTeachers.length > 1 && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Hangi öğretmen ayrılıyor?</label>
            <select
              value={replacedTeacherId}
              onChange={e => setReplacedTeacherId(e.target.value)}
              className="rounded-md border-slate-300 text-sm p-1.5"
            >
              {currentTeachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}

        <div>
          <p className="text-xs font-medium text-slate-600 mb-1">Kapsam</p>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="radio" name="scope" checked={scope === 'all'} onChange={() => setScope('all')} className="mt-0.5" />
            <span>
              Bu sınıftaki <strong>{subject.name}</strong> dersinin bütün saatleri
              <span className="text-slate-500"> — haftada {changeSlots(schedule!, target, 'all').length} saat</span>
            </span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer mt-1">
            <input type="radio" name="scope" checked={scope === 'single'} onChange={() => setScope('single')} className="mt-0.5" />
            <span>
              Yalnız bu saat
              <span className="text-slate-500"> — {slotLabel({ dayIndex: target.dayIndex, hourIndex: target.hourIndex })}</span>
            </span>
          </label>
          {scope === 'all' && slots.length > 0 && (
            <p className="text-xs text-slate-500 mt-1 ml-6">{slots.map(slotLabel).join(' · ')}</p>
          )}
        </div>

        <div>
          <p className="text-xs font-medium text-slate-600 mb-1">Yeni öğretmen</p>
          {candidates.length === 0 && <p className="text-slate-500">Başka öğretmen tanımlı değil.</p>}
          <div className="max-h-64 overflow-y-auto rounded-md border border-slate-200 divide-y divide-slate-100">
            {candidates.map(({ teacher, conflicts, branchMatches }) => {
              const ok = conflicts.length === 0;
              const selected = newTeacherId === teacher.id;
              return (
                <div key={teacher.id} className={`px-3 py-2 ${selected ? 'bg-sky-50' : ''}`}>
                  <label className={`flex items-center gap-2 ${ok ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                    <input
                      type="radio"
                      name="newTeacher"
                      disabled={!ok}
                      checked={selected}
                      onChange={() => setNewTeacherId(teacher.id)}
                    />
                    <span className={`flex-1 ${ok ? '' : 'text-slate-400'}`}>
                      {teacher.name}
                      {teacher.branches?.length ? <span className="text-slate-400 text-xs"> · {teacher.branches.join(', ')}</span> : null}
                    </span>
                    {ok ? (
                      <span className={`text-[11px] rounded px-1.5 py-0.5 ${branchMatches ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                        {branchMatches ? 'uygun · branşı tutuyor' : 'uygun'}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setOpenDetails(openDetails === teacher.id ? null : teacher.id)}
                        className="text-[11px] rounded px-1.5 py-0.5 bg-red-50 text-red-700 underline"
                        title="Neden uygun değil?"
                      >
                        {conflicts.length} çakışma
                      </button>
                    )}
                  </label>
                  {openDetails === teacher.id && (
                    <ul className="mt-1 ml-6 text-xs text-red-700 list-disc space-y-0.5">
                      {conflicts.map((c, i) => <li key={i}>{c}</li>)}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Çakışması olan öğretmen seçilemez: o saatte müsait değil, nöbetçi ya da başka sınıfta derste. Önce onu düzeltin.
          </p>
        </div>

        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" checked={pinInData} onChange={e => setPinInData(e.target.checked)} className="mt-0.5" />
          <span>
            Veride de sabitle
            <span className="block text-xs text-slate-500">
              İşaretliyse {classroom.name} için {subject.name} dersi bundan sonra "Program Oluştur"da da bu öğretmene verilir.
              İşaretli değilse yalnız bu program değişir; yeniden oluşturursanız çözücü öğretmeni kendisi seçer.
            </span>
          </span>
        </label>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50">
            Vazgeç
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!canApply}
            className="px-3 py-1.5 rounded-md bg-sky-600 text-white font-medium hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Öğretmeni değiştir{slots.length ? ` (${slots.length} saat)` : ''}
          </button>
        </div>
      </div>
    </Modal>
  );
};
