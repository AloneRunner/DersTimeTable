import React, { useEffect, useMemo, useState } from 'react';
import type { Classroom, SchoolHours, Subject, Teacher, TimetableData } from '../types';
import { buildClassroomSummaries, findDuplicateClassSubjects, normalizeLabel } from '../utils/dataDiagnostics';

type OverviewTab = 'classrooms' | 'teachers' | 'subjects';

const classroomNameCollator = new Intl.Collator('tr-TR', {
  numeric: true,
  sensitivity: 'base',
});

interface Props {
  data: TimetableData;
  schoolHours: SchoolHours;
  onEditClassroom: (classroom: Classroom) => void;
  onEditTeacher: (teacher: Teacher) => void;
  onEditSubject: (subject: Subject) => void;
}

const statusClasses = (difference: number) => {
  if (difference === 0) return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  return difference < 0
    ? 'bg-amber-100 text-amber-800 border-amber-200'
    : 'bg-red-100 text-red-800 border-red-200';
};

const differenceText = (difference: number) => {
  if (difference === 0) return 'Saatler tamam';
  return difference < 0 ? `${Math.abs(difference)} saat eksik` : `${difference} saat fazla`;
};

export const PreflightOverview: React.FC<Props> = ({
  data,
  schoolHours,
  onEditClassroom,
  onEditTeacher,
  onEditSubject,
}) => {
  const [activeTab, setActiveTab] = useState<OverviewTab>('classrooms');
  const [query, setQuery] = useState('');
  const [selectedClassroomId, setSelectedClassroomId] = useState('');
  const [selectedTeacherId, setSelectedTeacherId] = useState('');
  const [selectedSubjectKey, setSelectedSubjectKey] = useState('');

  const classroomSummaries = useMemo(
    () => buildClassroomSummaries(data, schoolHours).sort((a, b) => classroomNameCollator.compare(a.classroom.name, b.classroom.name)),
    [data, schoolHours]
  );
  const duplicates = useMemo(() => findDuplicateClassSubjects(data), [data]);
  const duplicateKeys = useMemo(
    () => new Set(duplicates.map(item => `${item.classroomId}::${item.normalizedSubjectName}`)),
    [duplicates]
  );
  const subjectGroups = useMemo(() => {
    const groups = new Map<string, Subject[]>();
    data.subjects.forEach(subject => {
      const key = normalizeLabel(subject.name);
      groups.set(key, [...(groups.get(key) || []), subject]);
    });
    return Array.from(groups.entries())
      .map(([key, subjects]) => ({ key, name: subjects[0].name, subjects }))
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  }, [data.subjects]);

  const teacherBranchMap = useMemo(() => {
    const map = new Map<string, Teacher[]>();
    data.teachers.forEach(teacher => {
      teacher.branches.forEach(branch => {
        const key = normalizeLabel(branch);
        map.set(key, [...(map.get(key) || []), teacher]);
      });
    });
    return map;
  }, [data.teachers]);

  const unstaffedSubjects = useMemo(
    () => data.subjects.filter(subject =>
      subject.assignedClassIds.length > 0 && !(teacherBranchMap.get(normalizeLabel(subject.name))?.length)
    ),
    [data.subjects, teacherBranchMap]
  );

  useEffect(() => {
    if (!classroomSummaries.some(item => item.classroom.id === selectedClassroomId)) {
      setSelectedClassroomId(classroomSummaries[0]?.classroom.id || '');
    }
  }, [classroomSummaries, selectedClassroomId]);

  useEffect(() => {
    if (!data.teachers.some(item => item.id === selectedTeacherId)) {
      setSelectedTeacherId(data.teachers[0]?.id || '');
    }
  }, [data.teachers, selectedTeacherId]);

  useEffect(() => {
    if (!subjectGroups.some(item => item.key === selectedSubjectKey)) {
      setSelectedSubjectKey(subjectGroups[0]?.key || '');
    }
  }, [subjectGroups, selectedSubjectKey]);

  const normalizedQuery = normalizeLabel(query);
  const selectedClassroom = classroomSummaries.find(item => item.classroom.id === selectedClassroomId);
  const selectedTeacher = data.teachers.find(item => item.id === selectedTeacherId);
  const selectedSubjectGroup = subjectGroups.find(item => item.key === selectedSubjectKey);
  const filteredClassrooms = classroomSummaries.filter(item => normalizeLabel(item.classroom.name).includes(normalizedQuery));
  const filteredTeachers = data.teachers
    .filter(item => normalizeLabel(`${item.name} ${item.branches.join(' ')}`).includes(normalizedQuery))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  const filteredSubjects = subjectGroups.filter(item => normalizeLabel(item.name).includes(normalizedQuery));

  const incompleteCount = classroomSummaries.filter(item => item.difference < 0).length;
  const overflowCount = classroomSummaries.filter(item => item.difference > 0).length;

  const openFirstClassIssue = (kind: 'incomplete' | 'overflow' | 'duplicate') => {
    const classroomId = kind === 'duplicate'
      ? duplicates[0]?.classroomId
      : classroomSummaries.find(item => kind === 'incomplete' ? item.difference < 0 : item.difference > 0)?.classroom.id;
    setActiveTab('classrooms');
    setQuery('');
    if (classroomId) setSelectedClassroomId(classroomId);
  };

  const selectedTeacherSubjects = useMemo(() => {
    if (!selectedTeacher) return [];
    const branchKeys = new Set(selectedTeacher.branches.map(normalizeLabel));
    return data.subjects.filter(subject => {
      const pinned = Object.values(subject.pinnedTeacherByClassroom || {}).some(ids => ids.includes(selectedTeacher.id));
      return pinned || branchKeys.has(normalizeLabel(subject.name));
    }).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  }, [data.subjects, selectedTeacher]);

  const renderPicker = () => {
    const commonClass = 'w-full rounded-md px-3 py-2 text-left text-sm transition-colors';
    if (activeTab === 'classrooms') {
      return filteredClassrooms.map(item => (
        <button key={item.classroom.id} onClick={() => setSelectedClassroomId(item.classroom.id)} className={`${commonClass} ${selectedClassroomId === item.classroom.id ? 'bg-sky-100 text-sky-900' : 'hover:bg-slate-100 text-slate-700'}`}>
          <span className="flex items-center justify-between gap-2">
            <span className="font-medium">{item.classroom.name}</span>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClasses(item.difference)}`}>{item.demand}/{item.capacity}</span>
          </span>
        </button>
      ));
    }
    if (activeTab === 'teachers') {
      return filteredTeachers.map(teacher => (
        <button key={teacher.id} onClick={() => setSelectedTeacherId(teacher.id)} className={`${commonClass} ${selectedTeacherId === teacher.id ? 'bg-sky-100 text-sky-900' : 'hover:bg-slate-100 text-slate-700'}`}>
          <span className="font-medium">{teacher.name}</span>
          <span className="mt-0.5 block truncate text-xs text-slate-500">{teacher.branches.join(', ') || 'Branş yok'}</span>
        </button>
      ));
    }
    return filteredSubjects.map(group => (
      <button key={group.key} onClick={() => setSelectedSubjectKey(group.key)} className={`${commonClass} ${selectedSubjectKey === group.key ? 'bg-sky-100 text-sky-900' : 'hover:bg-slate-100 text-slate-700'}`}>
        <span className="flex items-center justify-between gap-2">
          <span className="font-medium">{group.name}</span>
          <span className="text-xs text-slate-500">{group.subjects.length} kayıt</span>
        </span>
      </button>
    ));
  };

  const renderClassroomDetail = () => {
    if (!selectedClassroom) return <p className="text-sm text-slate-500">Sınıf bulunamadı.</p>;
    const { classroom, lessons, demand, capacity, difference } = selectedClassroom;
    return (
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900">{classroom.name}</h3>
            <p className="mt-1 text-sm text-slate-500">{classroom.level} · {lessons.length} ders tanımı</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClasses(difference)}`}>{differenceText(difference)}</span>
            <button onClick={() => onEditClassroom(classroom)} className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50">Sınıfı düzenle</button>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
          <div className="rounded-lg bg-slate-50 p-3"><span className="block text-xs text-slate-500">Tanımlı</span><strong>{demand} saat</strong></div>
          <div className="rounded-lg bg-slate-50 p-3"><span className="block text-xs text-slate-500">Gerekli</span><strong>{capacity} saat</strong></div>
          <div className={`rounded-lg border p-3 ${statusClasses(difference)}`}><span className="block text-xs">Durum</span><strong>{differenceText(difference)}</strong></div>
        </div>
        <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
          {lessons.map(lesson => {
            const duplicate = lesson.kind === 'subject' && duplicateKeys.has(`${classroom.id}::${normalizeLabel(lesson.name)}`);
            const pinnedNames = lesson.subject
              ? (lesson.subject.pinnedTeacherByClassroom?.[classroom.id] || []).map(id => data.teachers.find(teacher => teacher.id === id)?.name).filter(Boolean)
              : [];
            return (
              <div key={lesson.key} className={`flex items-center justify-between gap-3 p-3 ${duplicate ? 'bg-red-50' : ''}`}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-800">{lesson.name}</span>
                    {lesson.kind === 'group' && <span className="rounded bg-violet-100 px-2 py-0.5 text-[10px] text-violet-700">Grup dersi</span>}
                    {duplicate && <span className="rounded bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">Bu sınıfa iki kez girilmiş</span>}
                  </div>
                  {pinnedNames.length > 0 && <p className="mt-0.5 text-xs text-slate-500">Sabit öğretmen: {pinnedNames.join(', ')}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <strong className="text-sm text-slate-700">{lesson.weeklyHours} saat</strong>
                  {lesson.subject && <button onClick={() => onEditSubject(lesson.subject!)} className="text-xs text-sky-600 hover:underline">Düzenle</button>}
                </div>
              </div>
            );
          })}
          {lessons.length === 0 && <p className="p-4 text-sm text-slate-500">Bu sınıfa henüz ders tanımlanmamış.</p>}
        </div>
      </div>
    );
  };

  const renderTeacherDetail = () => {
    if (!selectedTeacher) return <p className="text-sm text-slate-500">Öğretmen bulunamadı.</p>;
    return (
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900">{selectedTeacher.name}</h3>
            <div className="mt-2 flex flex-wrap gap-1">{selectedTeacher.branches.map(branch => <span key={branch} className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">{branch}</span>)}</div>
            <p className="mt-2 text-xs font-medium text-slate-600">
              Haftalık ders sınırı: {selectedTeacher.maxWeeklyHours ? `${selectedTeacher.maxWeeklyHours} saat` : 'Özel sınır yok'}
            </p>
          </div>
          <button onClick={() => onEditTeacher(selectedTeacher)} className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50">Öğretmeni düzenle</button>
        </div>
        <p className="mt-4 text-xs text-slate-500">Branşına uyan veya bu öğretmene sabitlenmiş ders kayıtları:</p>
        <div className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
          {selectedTeacherSubjects.map(subject => {
            const classNames = subject.assignedClassIds.map(id => data.classrooms.find(classroom => classroom.id === id)?.name || id);
            const pinnedClassNames = subject.assignedClassIds
              .filter(classroomId => subject.pinnedTeacherByClassroom?.[classroomId]?.includes(selectedTeacher.id))
              .map(id => data.classrooms.find(classroom => classroom.id === id)?.name || id);
            return (
              <div key={subject.id} className="flex items-start justify-between gap-3 p-3">
                <div>
                  <p className="font-medium text-slate-800">{subject.name} <span className="text-sm font-normal text-slate-500">· {subject.weeklyHours} saat</span></p>
                  <p className="mt-1 text-xs text-slate-500">Sınıflar: {classNames.join(', ') || 'Sınıf seçilmemiş'}</p>
                  {pinnedClassNames.length > 0 && <p className="mt-1 text-xs font-medium text-emerald-700">Sabitlendiği sınıflar: {pinnedClassNames.join(', ')}</p>}
                </div>
                <button onClick={() => onEditSubject(subject)} className="shrink-0 text-xs text-sky-600 hover:underline">Düzenle</button>
              </div>
            );
          })}
          {selectedTeacherSubjects.length === 0 && <p className="p-4 text-sm text-amber-700">Bu öğretmenin branşıyla eşleşen ders tanımı yok.</p>}
        </div>
      </div>
    );
  };

  const renderSubjectDetail = () => {
    if (!selectedSubjectGroup) return <p className="text-sm text-slate-500">Ders bulunamadı.</p>;
    const affectedDuplicates = duplicates.filter(item => item.normalizedSubjectName === selectedSubjectGroup.key);
    return (
      <div>
        <div className="border-b border-slate-200 pb-4">
          <h3 className="text-lg font-bold text-slate-900">{selectedSubjectGroup.name}</h3>
          <p className="mt-1 text-sm text-slate-500">{selectedSubjectGroup.subjects.length} ayrı saat/sınıf kaydı</p>
          {affectedDuplicates.length > 0 && <p className="mt-2 rounded-md bg-red-50 p-2 text-xs font-medium text-red-700">Çift giriş: {affectedDuplicates.map(item => item.classroomName).join(', ')}</p>}
        </div>
        <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
          {selectedSubjectGroup.subjects.map(subject => {
            const classNames = subject.assignedClassIds.map(id => data.classrooms.find(classroom => classroom.id === id)?.name || id);
            const teachers = teacherBranchMap.get(normalizeLabel(subject.name)) || [];
            return (
              <div key={subject.id} className="p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-800">{subject.weeklyHours} saatlik kayıt</p>
                    <p className="mt-1 text-xs text-slate-500">Sınıflar: {classNames.join(', ') || 'Sınıf seçilmemiş'}</p>
                    <p className={`mt-1 text-xs ${teachers.length ? 'text-slate-500' : 'font-medium text-red-600'}`}>Öğretmenler: {teachers.map(teacher => teacher.name).join(', ') || 'Eşleşen öğretmen yok'}</p>
                  </div>
                  <button onClick={() => onEditSubject(subject)} className="shrink-0 rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50">Düzenle</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <section className="rounded-lg bg-white p-5 shadow-lg no-print">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Program Öncesi Kontrol</h2>
          <p className="mt-1 text-sm text-slate-500">Programı oluşturmadan sınıf, öğretmen ve ders tanımlarını tek yerden inceleyin.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <button onClick={() => openFirstClassIssue('incomplete')} className={`rounded-full border px-3 py-1 ${incompleteCount ? 'border-amber-200 bg-amber-100 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{incompleteCount} eksik sınıf</button>
          <button onClick={() => openFirstClassIssue('overflow')} className={`rounded-full border px-3 py-1 ${overflowCount ? 'border-red-200 bg-red-100 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{overflowCount} fazla saat</button>
          <button onClick={() => openFirstClassIssue('duplicate')} className={`rounded-full border px-3 py-1 ${duplicates.length ? 'border-red-200 bg-red-100 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{duplicates.length} çift giriş</button>
          <button onClick={() => { setActiveTab('subjects'); setQuery(''); if (unstaffedSubjects[0]) setSelectedSubjectKey(normalizeLabel(unstaffedSubjects[0].name)); }} className={`rounded-full border px-3 py-1 ${unstaffedSubjects.length ? 'border-red-200 bg-red-100 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{unstaffedSubjects.length} öğretmensiz ders</button>
        </div>
      </div>

      <div className="mt-5 flex overflow-x-auto border-b border-slate-200">
        {([
          ['classrooms', 'Sınıfa göre'],
          ['teachers', 'Öğretmene göre'],
          ['subjects', 'Derse göre'],
        ] as [OverviewTab, string][]).map(([tab, label]) => (
          <button key={tab} onClick={() => { setActiveTab(tab); setQuery(''); }} className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${activeTab === tab ? 'border-sky-500 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>{label}</button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Listede ara..." className="mb-3 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none" />
          <div className="max-h-80 space-y-1 overflow-y-auto">{renderPicker()}</div>
        </aside>
        <div className="min-w-0 rounded-lg border border-slate-200 p-4">
          {activeTab === 'classrooms' ? renderClassroomDetail() : activeTab === 'teachers' ? renderTeacherDetail() : renderSubjectDetail()}
        </div>
      </div>
    </section>
  );
};
