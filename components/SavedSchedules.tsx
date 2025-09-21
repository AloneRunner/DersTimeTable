import React from 'react';
import { SavedSchedule } from '../types';
import { TrashIcon } from './icons';

interface SavedSchedulesProps {
  savedSchedules: SavedSchedule[];
  handleScheduleImportClick: () => void;
  handleLoadSchedule: (id: string) => void;
  handleDeleteSchedule: (id: string) => void;
}

const SavedSchedules: React.FC<SavedSchedulesProps> = ({
  savedSchedules,
  handleScheduleImportClick,
  handleLoadSchedule,
  handleDeleteSchedule,
}) => {
  const hasSaved = savedSchedules.length > 0;

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg no-print">
      <h2 className="text-xl font-bold mb-4">Kayıtlı Program Versiyonları</h2>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-sm text-slate-500">Kaydedilmiş bir program dosyasını içeri aktararak eski sonuçları geri yükleyebilirsiniz.</p>
        <button onClick={handleScheduleImportClick} className="px-3 py-1.5 bg-white text-slate-700 rounded-md border border-slate-300 hover:bg-slate-50 text-sm font-medium">Program Yükle</button>
      </div>
      {hasSaved ? (
        <div className="space-y-3 max-h-60 overflow-y-auto">
          {savedSchedules.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(saved => (
            <div key={saved.id} className="flex justify-between items-center bg-slate-50 p-3 rounded-md border">
              <div>
                <p className="font-semibold text-slate-800">{saved.name}</p>
                <p className="text-xs text-slate-500">
                  {new Date(saved.createdAt).toLocaleString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleLoadSchedule(saved.id)} className="px-3 py-1.5 bg-sky-500 text-white rounded-md text-sm font-medium hover:bg-sky-600">
                  Yükle
                </button>
                <button onClick={() => handleDeleteSchedule(saved.id)} className="p-2 text-slate-500 hover:text-red-600" title="Bu versiyonu sil">
                  <TrashIcon className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-slate-500 bg-slate-50 border border-dashed border-slate-200 rounded-md p-4">Henüz kayıtlı program yok.</div>
      )}
    </div>
  );
};

export default SavedSchedules;
