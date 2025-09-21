import React, { useState } from 'react';
import { SchoolHour, SolverStrategy, SavedSchedule } from '../../types'; // types.ts dosyasından gerekli tipleri import edin

interface SettingsScreenProps {
  optTime: number;
  setOptTime: (time: number) => void;
  solverStrategy: SolverStrategy;
  setSolverStrategy: (strategy: SolverStrategy) => void;
  solverTimeLimit: number;
  setSolverTimeLimit: (limit: number) => void;
  solverSeed: number;
  setSolverSeed: (seed: number) => void;
  handleGenerate: () => void;
  saveSettingsAsDefault: () => void;
  schoolHours: SchoolHour[];
  handleSchoolHoursChange: (index: number, field: keyof SchoolHour, value: string) => void;
  handleImportClick: () => void;
  handleExportData: () => void;
  handleClearAllData: () => void;
  savedSchedules: SavedSchedule[];
  handleLoadSchedule: (schedule: SavedSchedule) => void;
  handleDeleteSchedule: (id: string) => void;
  handleSaveSchedule: () => void;
  // Diğer çözücü ayarları ve genel ayarlar buraya eklenebilir
}

interface CollapsiblePanelProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

const CollapsiblePanel: React.FC<CollapsiblePanelProps> = ({
  title,
  children,
  defaultOpen = false,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="bg-white rounded-lg shadow-sm mb-4">
      <button
        className="w-full flex justify-between items-center p-4 text-lg font-semibold text-gray-800 focus:outline-none"
        onClick={() => setIsOpen(!isOpen)}
      >
        {title}
        <span className="text-gray-500">
          {isOpen ? '▲' : '▼'}
        </span>
      </button>
      {isOpen && <div className="p-4 border-t border-gray-200">{children}</div>}
    </div>
  );
};

const SettingsScreen: React.FC<SettingsScreenProps> = ({
  optTime,
  setOptTime,
  solverStrategy,
  setSolverStrategy,
  solverTimeLimit,
  setSolverTimeLimit,
  solverSeed,
  setSolverSeed,
  handleGenerate,
  saveSettingsAsDefault,
  schoolHours,
  handleSchoolHoursChange,
  handleImportClick,
  handleExportData,
  handleClearAllData,
  savedSchedules,
  handleLoadSchedule,
  handleDeleteSchedule,
  handleSaveSchedule,
}) => {
  return (
    <div className="settings-screen p-2">
      <CollapsiblePanel title="Çözücü Ayarları" defaultOpen={true}>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700">Optimizasyon Süresi (ms)</label>
          <input
            type="number"
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
            value={optTime}
            onChange={(e) => setOptTime(Number(e.target.value))}
          />
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700">Çözücü Stratejisi</label>
          <select
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
            value={solverStrategy}
            onChange={(e) => setSolverStrategy(e.target.value as SolverStrategy)}
          >
            <option value="CP-SAT">CP-SAT</option>
            <option value="Tabu">Tabu</option>
            <option value="ALNS">ALNS</option>
            <option value="Repair">Repair</option>
          </select>
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700">Çözücü Zaman Limiti (s)</label>
          <input
            type="number"
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
            value={solverTimeLimit}
            onChange={(e) => setSolverTimeLimit(Number(e.target.value))}
          />
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700">Çözücü Seed</label>
          <input
            type="number"
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
            value={solverSeed}
            onChange={(e) => setSolverSeed(Number(e.target.value))}
          />
        </div>
        <div className="flex justify-between mt-4">
          <button
            className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50"
            onClick={handleGenerate}
          >
            Program Oluştur
          </button>
          <button
            className="bg-gray-500 text-white px-4 py-2 rounded-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-opacity-50"
            onClick={saveSettingsAsDefault}
          >
            Varsayılanları Kaydet
          </button>
        </div>
      </CollapsiblePanel>

      <CollapsiblePanel title="Okul Saatleri Ayarları">
        {schoolHours.map((hour, index) => (
          <div key={index} className="flex items-center mb-2">
            <span className="w-12 text-sm font-medium text-gray-700">{index + 1}. Saat:</span>
            <input
              type="time"
              className="ml-2 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
              value={hour.start}
              onChange={(e) => handleSchoolHoursChange(index, 'start', e.target.value)}
            />
            <span className="mx-2">-</span>
            <input
              type="time"
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
              value={hour.end}
              onChange={(e) => handleSchoolHoursChange(index, 'end', e.target.value)}
            />
          </div>
        ))}
      </CollapsiblePanel>

      <CollapsiblePanel title="Veri Yönetimi">
        <div className="flex justify-between mb-4">
          <button
            className="bg-green-500 text-white px-4 py-2 rounded-md hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-opacity-50"
            onClick={handleImportClick}
          >
            Veri İçe Aktar
          </button>
          <button
            className="bg-yellow-500 text-white px-4 py-2 rounded-md hover:bg-yellow-600 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-opacity-50"
            onClick={handleExportData}
          >
            Veri Dışa Aktar
          </button>
        </div>
        <button
          className="w-full bg-red-500 text-white px-4 py-2 rounded-md hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-opacity-50"
          onClick={handleClearAllData}
        >
          Tüm Verileri Temizle
        </button>
      </CollapsiblePanel>

      <CollapsiblePanel title="Kaydedilen Programlar">
        <button
          className="w-full bg-purple-500 text-white px-4 py-2 rounded-md hover:bg-purple-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-opacity-50 mb-4"
          onClick={handleSaveSchedule}
        >
          Mevcut Programı Kaydet
        </button>
        {savedSchedules.length === 0 ? (
          <p className="text-gray-600">Henüz kaydedilmiş program yok.</p>
        ) : (
          <ul className="space-y-2">
            {savedSchedules.map((saved) => (
              <li key={saved.id} className="flex justify-between items-center bg-gray-100 p-3 rounded-md">
                <span className="text-gray-800">{saved.name}</span>
                <div>
                  <button
                    className="bg-blue-500 text-white px-3 py-1 rounded-md text-sm mr-2 hover:bg-blue-600"
                    onClick={() => handleLoadSchedule(saved)}
                  >
                    Yükle
                  </button>
                  <button
                    className="bg-red-500 text-white px-3 py-1 rounded-md text-sm hover:bg-red-600"
                    onClick={() => handleDeleteSchedule(saved.id)}
                  >
                    Sil
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CollapsiblePanel>
    </div>
  );
};

export default SettingsScreen;
