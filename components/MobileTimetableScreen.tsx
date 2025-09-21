import React from 'react';
import MobileSchedule from '../MobileSchedule';
import { Schedule, SchoolHour, Day, ViewType } from '../../types'; // types.ts dosyasından gerekli tipleri import edin

interface MobileTimetableScreenProps {
  schedule: Schedule | null;
  data: any; // Tüm uygulama verileri (öğretmenler, sınıflar vb.)
  viewType: ViewType; // 'Class' veya 'Teacher'
  setViewType: (type: ViewType) => void;
  selectedHeaderId: string | null;
  setSelectedHeaderId: (id: string | null) => void;
  schoolHours: SchoolHour[];
  maxDailyHours: number;
  DAYS: Day[];
}

const MobileTimetableScreen: React.FC<MobileTimetableScreenProps> = ({
  schedule,
  data,
  viewType,
  setViewType,
  selectedHeaderId,
  setSelectedHeaderId,
  schoolHours,
  maxDailyHours,
  DAYS,
}) => {
  // Görünüm türü seçicileri (Sınıfa Göre, Öğretmene Göre)
  const renderViewTypeSelectors = () => (
    <div className="flex justify-center gap-4 p-2 bg-white shadow-sm rounded-lg mx-2 mt-2">
      <button
        className={`px-4 py-2 rounded-md text-sm font-medium ${
          viewType === 'Class' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'
        }`}
        onClick={() => setViewType('Class')}
      >
        Sınıfa Göre
      </button>
      <button
        className={`px-4 py-2 rounded-md text-sm font-medium ${
          viewType === 'Teacher' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'
        }`}
        onClick={() => setViewType('Teacher')}
      >
        Öğretmene Göre
      </button>
    </div>
  );

  // Seçilen başlığa göre filtreleme (öğretmen/sınıf)
  const renderHeaderSelector = () => {
    const headers = viewType === 'Class' ? data.classrooms : data.teachers;
    return (
      <div className="p-2 mx-2 mt-2 bg-white shadow-sm rounded-lg">
        <select
          className="w-full p-2 border border-gray-300 rounded-md"
          value={selectedHeaderId || ''}
          onChange={(e) => setSelectedHeaderId(e.target.value)}
        >
          <option value="">Tüm {viewType === 'Class' ? 'Sınıflar' : 'Öğretmenler'}</option>
          {headers.map((header: any) => (
            <option key={header.id} value={header.id}>
              {header.name}
            </option>
          ))}
        </select>
      </div>
    );
  };

  return (
    <div className="mobile-timetable-screen">
      {renderViewTypeSelectors()}
      {renderHeaderSelector()}
      <div className="p-2">
        <MobileSchedule
          schedule={schedule}
          data={data}
          viewType={viewType}
          viewMode="single" // Mobil için her zaman 'single'
          selectedHeaderId={selectedHeaderId}
          schoolHours={schoolHours}
          maxDailyHours={maxDailyHours}
          DAYS={DAYS}
        />
      </div>
    </div>
  );
};

export default MobileTimetableScreen;