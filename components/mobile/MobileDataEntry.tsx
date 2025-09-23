import React, { useState } from 'react';
import { Modal } from '../../components/Modal';
import { TeacherForm } from '../forms/TeacherForm';
import { ClassroomForm } from '../forms/ClassroomForm';
import type { TimetableData } from '../../types';

interface MobileDataEntryProps {
  isOpen: boolean;
  onClose: () => void;
  addTeacher: (t: Omit<Teacher, 'id'>) => void;
  addClassroom: (c: Omit<Classroom, 'id'>) => void;
  data: TimetableData;
  maxDailyHours: number;
}

const MobileDataEntry: React.FC<MobileDataEntryProps> = ({ isOpen, onClose, addTeacher, addClassroom, data, maxDailyHours }) => {
  const [tab, setTab] = useState<'teacher'|'classroom'>('teacher');

  const handleSaveTeacher = (payload: any) => {
    addTeacher(payload);
    onClose();
  };

  const handleSaveClassroom = (payload: any) => {
    addClassroom(payload);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={tab === 'teacher' ? 'Yeni Öğretmen (Mobil)' : 'Yeni Sınıf (Mobil)'}>
      <div className="space-y-3">
        <div className="flex gap-2 mb-2">
          <button onClick={() => setTab('teacher')} className={`px-3 py-1 rounded ${tab === 'teacher' ? 'bg-sky-500 text-white' : 'bg-slate-100 text-slate-700'}`}>Öğretmen</button>
          <button onClick={() => setTab('classroom')} className={`px-3 py-1 rounded ${tab === 'classroom' ? 'bg-sky-500 text-white' : 'bg-slate-100 text-slate-700'}`}>Sınıf</button>
        </div>

        {tab === 'teacher' ? (
          <TeacherForm item={null} onSave={handleSaveTeacher} onCancel={onClose} data={data} maxDailyHours={maxDailyHours} />
        ) : (
          <ClassroomForm item={null} onSave={handleSaveClassroom} onCancel={onClose} data={data} />
        )}
      </div>
    </Modal>
  );
};

export default MobileDataEntry;
