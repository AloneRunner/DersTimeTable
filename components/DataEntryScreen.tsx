import React from 'react';
import { TimetableData } from '../types';
import { PlusIcon, PencilIcon, TrashIcon, WarningIcon } from './icons';

interface DataEntryScreenProps {
  data: TimetableData;
  activeTab: any;
  setActiveTab: (tab: any) => void;
  handleOpenModal: (tab: any, item?: any) => void;
  removeTeacher: (id: string) => void;
  removeClassroom: (id: string) => void;
  removeSubject: (id: string) => void;
  removeLocation: (id: string) => void;
  removeFixedAssignment: (id: string) => void;
  removeLessonGroup: (id: string) => void;
  removeDuty: (id: string) => void;
  handleAssignRandomRestDays: (id: string, count: number) => void;
  teacherLoads: Map<string, { demand: number; capacity: number; }>;
  classroomLoads: Map<string, { demand: number; capacity: number; }>;
  validation: { overflowingClasses: any[]; unassignedSubjects: any[]; };
  DAYS: string[];
  isSmallScreen: boolean;
}

const DataEntryScreen: React.FC<DataEntryScreenProps> = ({
  data,
  activeTab,
  setActiveTab,
  handleOpenModal,
  removeTeacher,
  removeClassroom,
  removeSubject,
  removeLocation,
  removeFixedAssignment,
  removeLessonGroup,
  removeDuty,
  handleAssignRandomRestDays,
  teacherLoads,
  classroomLoads,
  validation,
  DAYS,
  isSmallScreen,
}) => {

  const renderTabs = () => (
    <div className="flex border-b border-slate-200 overflow-x-auto">
      {(['teachers', 'classrooms', 'subjects', 'locations', 'fixedAssignments', 'lessonGroups', 'duties'] as any[]).map(tab => (
        <button
          key={tab}
          onClick={() => setActiveTab(tab)}
          className={`px-4 py-3 text-sm font-medium capitalize -mb-px border-b-2 whitespace-nowrap ${activeTab === tab ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}
        >
          {
            {
              teachers: 'Öğretmenler',
              classrooms: 'Sınıflar',
              subjects: 'Dersler',
              locations: 'Mekanlar',
              fixedAssignments: 'Sabit Atamalar',
              lessonGroups: 'Grup Dersleri',
              duties: 'Ek Görevler'
            }[tab]
          }
        </button>
      ))}
    </div>
  );

  const getTitle = (tab: any) => ({
    teachers: "Yeni Öğretmen Ekle",
    classrooms: "Yeni Sınıf Ekle",
    subjects: "Yeni Ders Ekle",
    locations: "Yeni Mekan Ekle",
    fixedAssignments: "Yeni Sabit Atama Ekle",
    lessonGroups: "Yeni Grup Dersi Ekle",
    duties: "Yeni Ek Görev Ekle",
  }[tab]);

  const renderTable = () => {
    let headers: string[] = [];
    let rows: React.ReactNode[] = [];
    let onRemove: (id: string) => void = () => {};

    const classroomErrors = validation.overflowingClasses.reduce((acc, err) => ({...acc, [err.id]: err.message}), {} as Record<string, string>);
    const subjectErrors = validation.unassignedSubjects.reduce((acc, err) => ({...acc, [err.id]: err.message}), {} as Record<string, string>);

    switch (activeTab) {
        case 'teachers':
            headers = ["Ad Soyad", "Branşlar", "Okul Türü", "Haftalık Yük", "Eylemler"];
            onRemove = removeTeacher;
            rows = data.teachers.map(item => {
                const load = teacherLoads.get(item.id) || { demand: 0, capacity: 0 };
                return (
                <tr key={item.id}>
                    <td className="px-4 py-3 whitespace-nowrap">{item.name}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{item.branches.join(', ')}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                        {item.canTeachMiddleSchool && <span className="text-xs font-medium mr-2 px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800">Ortaokul</span>}
                        {item.canTeachHighSchool && <span className="text-xs font-medium mr-2 px-2.5 py-0.5 rounded-full bg-green-100 text-green-800">Lise</span>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-medium text-slate-600">{Math.round(load.demand)} saat</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex flex-wrap items-center gap-1">
                            <button onClick={() => handleAssignRandomRestDays(item.id, 1)} className="px-2 py-1 text-xs font-medium rounded border border-slate-200 text-slate-600 hover:bg-slate-100" title="Bu öğretmene rastgele 1 tam gün izin ayarla">1 Gün</button>
                            <button onClick={() => handleAssignRandomRestDays(item.id, 2)} className="px-2 py-1 text-xs font-medium rounded border border-slate-200 text-slate-600 hover:bg-slate-100" title="Bu öğretmene rastgele 2 tam gün izin ayarla">2 Gün</button>
                            <button onClick={() => handleOpenModal(activeTab, item)} className="p-1 text-slate-500 hover:text-sky-600"><PencilIcon className="w-4 h-4" /></button>
                            <button onClick={() => onRemove(item.id)} className="p-1 text-slate-500 hover:text-red-600"><TrashIcon className="w-4 h-4" /></button>
                        </div>
                    </td>
                </tr>
            )});
            break;
        case 'classrooms':
            headers = ["Sınıf Adı", "Seviye", "Grup", "Sınıf Öğretmeni", "Haftalık Yük", "Eylemler"];
            onRemove = removeClassroom;
            rows = data.classrooms.map(item => {
                const load = classroomLoads.get(item.id) || { demand: 0, capacity: 0 };
                const isOverloaded = load.demand > load.capacity;
                return (
                <tr key={item.id}>
                    <td className="px-4 py-3 whitespace-nowrap">
                       <div className="flex items-center gap-2">
                           <span>{item.name}</span>
                           {classroomErrors[item.id] && (
                               <div className="group relative">
                                   <WarningIcon className="w-5 h-5 text-yellow-500" />
                                   <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-2 bg-slate-700 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                                       {classroomErrors[item.id]}
                                   </span>
                               </div>
                           )}
                       </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{item.level}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{item.group}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{data.teachers.find(t => t.id === item.homeroomTeacherId)?.name || '-'}</td>
                    <td className={`px-4 py-3 whitespace-nowrap font-medium ${isOverloaded ? 'text-red-600' : 'text-slate-600'}`}>
                        {load.demand} / {load.capacity} saat
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                        <button onClick={() => handleOpenModal(activeTab, item)} className="p-1 text-slate-500 hover:text-sky-600"><PencilIcon className="w-4 h-4" /></button>
                        <button onClick={() => onRemove(item.id)} className="p-1 text-slate-500 hover:text-red-600"><TrashIcon className="w-4 h-4" /></button>
                    </td>
                </tr>
            )});
            break;
        case 'subjects':
             headers = ["Ders Adı", "Haftalık Saat", "Atanan Sınıflar", "Mekan", "Eylemler"];
             onRemove = removeSubject;
             rows = data.subjects.map(item => (
                <tr key={item.id}>
                    <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                            <span>
                                {item.name} 
                                {item.blockHours > 0 && <span className="text-xs font-medium ml-1 px-2 py-0.5 rounded-full bg-purple-100 text-purple-800">Blok ({item.blockHours}s)</span>}
                                {item.tripleBlockHours > 0 && <span className="text-xs font-medium ml-1 px-2 py-0.5 rounded-full bg-orange-100 text-orange-800">3'lü Blok ({item.tripleBlockHours}s)</span>}
                            </span>
                            {subjectErrors[item.id] && (
                               <div className="group relative">
                                   <WarningIcon className="w-5 h-5 text-yellow-500" />
                                   <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-2 bg-slate-700 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                                       {subjectErrors[item.id]}
                                   </span>
                               </div>
                            )}
                        </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{item.weeklyHours}</td>
                    <td className="px-4 py-3 text-xs">{item.assignedClassIds.map(id => data.classrooms.find(c=>c.id === id)?.name).join(', ')}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{data.locations.find(l => l.id === item.locationId)?.name || '-'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                        <button onClick={() => handleOpenModal(activeTab, item)} className="p-1 text-slate-500 hover:text-sky-600"><PencilIcon className="w-4 h-4" /></button>
                        <button onClick={() => onRemove(item.id)} className="p-1 text-slate-500 hover:text-red-600"><TrashIcon className="w-4 h-4" /></button>
                    </td>
                </tr>
             ));
             break;
        case 'locations':
            headers = ["Mekan Adı", "Eylemler"];
            onRemove = removeLocation;
            rows = data.locations.map(item => (
                <tr key={item.id}>
                    <td className="px-4 py-3 whitespace-nowrap">{item.name}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                        <button onClick={() => handleOpenModal(activeTab, item)} className="p-1 text-slate-500 hover:text-sky-600"><PencilIcon className="w-4 h-4" /></button>
                        <button onClick={() => onRemove(item.id)} className="p-1 text-slate-500 hover:text-red-600"><TrashIcon className="w-4 h-4" /></button>
                    </td>
                </tr>
            ));
            break;
        case 'fixedAssignments':
            headers = ["Sınıf", "Ders", "Zaman", "Eylemler"];
            onRemove = removeFixedAssignment;
            rows = data.fixedAssignments.map(item => (
                 <tr key={item.id}>
                    <td className="px-4 py-3 whitespace-nowrap">{data.classrooms.find(c => c.id === item.classroomId)?.name}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{data.subjects.find(s => s.id === item.subjectId)?.name}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{item.hourIndex === -1 ? `${DAYS[item.dayIndex]}, Tüm Gün` : `${DAYS[item.dayIndex]}, ${item.hourIndex + 1}. Ders`}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                       <button onClick={() => onRemove(item.id)} className="p-1 text-slate-500 hover:text-red-600"><TrashIcon className="w-4 h-4" /></button>
                    </td>
                </tr>
            ));
            break;
        case 'lessonGroups':
            headers = ["Grup Adı", "Ders", "Sınıflar", "Haftalık Saat", "Eylemler"];
            onRemove = removeLessonGroup;
            rows = data.lessonGroups.map(item => (
                 <tr key={item.id}>
                    <td className="px-4 py-3 whitespace-nowrap">{item.name} {item.isBlock && <span className="text-xs font-medium ml-1 px-2 py-0.5 rounded-full bg-purple-100 text-purple-800">Blok</span>}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{data.subjects.find(s => s.id === item.subjectId)?.name}</td>
                    <td className="px-4 py-3 text-xs">{item.classroomIds.map(id => data.classrooms.find(c=>c.id === id)?.name).join(', ')}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{item.weeklyHours}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                       <button onClick={() => handleOpenModal(activeTab, item)} className="p-1 text-slate-500 hover:text-sky-600"><PencilIcon className="w-4 h-4" /></button>
                       <button onClick={() => onRemove(item.id)} className="p-1 text-slate-500 hover:text-red-600"><TrashIcon className="w-4 h-4" /></button>
                    </td>
                </tr>
            ));
            break;
        case 'duties':
            headers = ["Görev Adı", "Öğretmen", "Zaman", "Eylemler"];
            onRemove = removeDuty;
            rows = data.duties.map(item => (
                 <tr key={item.id}>
                    <td className="px-4 py-3 whitespace-nowrap">{item.name}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{data.teachers.find(t => t.id === item.teacherId)?.name}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{DAYS[item.dayIndex]}, {item.hourIndex + 1}. Ders</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                       <button onClick={() => handleOpenModal(activeTab, item)} className="p-1 text-slate-500 hover:text-sky-600"><PencilIcon className="w-4 h-4" /></button>
                       <button onClick={() => onRemove(item.id)} className="p-1 text-slate-500 hover:text-red-600"><TrashIcon className="w-4 h-4" /></button>
                    </td>
                </tr>
            ));
            break;
    }

    return (
        <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                    <tr>
                        {headers.map(h => <th key={h} className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{h}</th>)}
                    </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-200 text-sm text-slate-700">
                    {rows}
                </tbody>
            </table>
        </div>
    )
  };

  const renderMobileList = () => {
    let items: any[] = [];
    let onRemove: (id: string) => void = () => {};

    switch (activeTab) {
        case 'teachers':
            items = data.teachers;
            onRemove = removeTeacher;
            break;
        case 'classrooms':
            items = data.classrooms;
            onRemove = removeClassroom;
            break;
        case 'subjects':
            items = data.subjects;
            onRemove = removeSubject;
            break;
        case 'locations':
            items = data.locations;
            onRemove = removeLocation;
            break;
        case 'fixedAssignments':
            items = data.fixedAssignments;
            onRemove = removeFixedAssignment;
            break;
        case 'lessonGroups':
            items = data.lessonGroups;
            onRemove = removeLessonGroup;
            break;
        case 'duties':
            items = data.duties;
            onRemove = removeDuty;
            break;
    }

    return (
        <div className="space-y-2">
            {items.map(item => (
                <div key={item.id} className="bg-slate-50 p-3 rounded-lg flex justify-between items-center">
                    <div onClick={() => handleOpenModal(activeTab, item)} className="flex-grow">
                        <p className="font-semibold text-slate-800">{item.name}</p>
                        {/* Add more details based on the active tab */}
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={() => handleOpenModal(activeTab, item)} className="p-1 text-slate-500 hover:text-sky-600"><PencilIcon className="w-4 h-4" /></button>
                        <button onClick={() => onRemove(item.id)} className="p-1 text-slate-500 hover:text-red-600"><TrashIcon className="w-4 h-4" /></button>
                    </div>
                </div>
            ))}
        </div>
    );
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg no-print">
        <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold">Veri Girişi</h2>
            <button onClick={() => handleOpenModal(activeTab)} className="px-3 py-1.5 bg-sky-500 text-white rounded-md text-sm font-medium hover:bg-sky-600 flex items-center gap-1">
                <PlusIcon className="w-4 h-4" /> {getTitle(activeTab)}
            </button>
        </div>
        {renderTabs()}
        {activeTab === 'duties' && (
          <div className="my-4 p-3 bg-sky-50 text-sky-800 border border-sky-200 rounded-md text-sm">
            <strong>Bilgi:</strong> Eklediğiniz görevler (nöbet vb.), program oluşturulduktan sonra **"Öğretmene Göre"** görünümünde ilgili öğretmenin zaman çizelgesinde gösterilir.
          </div>
        )}
        <div className="mt-4">
            {isSmallScreen ? renderMobileList() : renderTable()}
        </div>
    </div>
  );
};

export default DataEntryScreen;
