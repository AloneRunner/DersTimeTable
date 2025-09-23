import React, { useState } from 'react';
import type { TimetableData, Teacher } from '../../types';
import { TeacherForm } from '../forms/TeacherForm';
import { Modal } from '../Modal';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  data: TimetableData;
  updateTeacher: (t: Teacher) => void;
}

const TeacherMobileView: React.FC<Props> = ({ isOpen, onClose, data, updateTeacher }) => {
  const [editing, setEditing] = useState<Teacher | null>(null);

  return (
    <Modal isOpen={isOpen} onClose={() => { setEditing(null); onClose(); }} title={editing ? 'Öğretmeni Düzenle' : 'Öğretmenler'}>
      <div className="space-y-3">
        {!editing && (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {data.teachers.map(t => (
              <div key={t.id} className="p-3 border rounded-md flex items-center justify-between">
                <div>
                  <div className="font-semibold">{t.name}</div>
                  <div className="text-xs text-slate-500">{t.branches.join(', ')}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setEditing(t)} className="px-2 py-1 text-xs bg-sky-500 text-white rounded">Düzenle</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {editing && (
          <TeacherForm item={editing} onSave={(payload) => { updateTeacher({ ...editing, ...payload }); setEditing(null); onClose(); }} onCancel={() => setEditing(null)} data={data} maxDailyHours={12} />
        )}
      </div>
    </Modal>
  );
};

export default TeacherMobileView;
