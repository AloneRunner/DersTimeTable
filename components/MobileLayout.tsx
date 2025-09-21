import React, { useState, ReactNode } from 'react';
import { PrintIcon, PencilIcon, WarningIcon, SaveIcon } from './icons'; // Yer tutucu ikonlar

interface MobileLayoutProps {
  timetableScreen: ReactNode;
  dataEntryScreen: ReactNode;
  analyticsScreen: ReactNode;
  settingsScreen: ReactNode;
  // Diğer mobil özel ekranlar buraya eklenebilir
}

type MobileScreen = 'timetable' | 'dataEntry' | 'analytics' | 'settings';

const MobileLayout: React.FC<MobileLayoutProps> = ({
  timetableScreen,
  dataEntryScreen,
  analyticsScreen,
  settingsScreen,
}) => {
  const [activeScreen, setActiveScreen] = useState<MobileScreen>('timetable');

  const renderContent = () => {
    switch (activeScreen) {
      case 'timetable':
        return timetableScreen;
      case 'dataEntry':
        return dataEntryScreen;
      case 'analytics':
        return analyticsScreen;
      case 'settings':
        return settingsScreen;
      default:
        return timetableScreen;
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {/* Header - Basit bir başlık veya hamburger menü buraya gelebilir */}
      <header className="bg-white shadow-sm p-4 flex items-center justify-between md:hidden">
        <h1 className="text-xl font-bold text-gray-800">Ders Programı</h1>
        {/* Hamburger menü veya diğer global eylemler buraya */}
      </header>

      {/* Main Content Area */}
      <main className="flex-grow overflow-y-auto pb-16"> {/* Alt navigasyon için padding */}
        {renderContent()}
      </main>

      {/* Bottom Navigation Bar */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg md:hidden z-50">
        <nav className="flex justify-around items-center h-16">
          <button
            className={`flex flex-col items-center justify-center p-2 text-sm font-medium ${
              activeScreen === 'timetable' ? 'text-blue-600' : 'text-gray-500'
            }`}
            onClick={() => setActiveScreen('timetable')}
          >
            {/* TODO: Daha uygun bir takvim ikonu ile değiştir */}
            <PrintIcon className="w-6 h-6" />
            <span>Program</span>
          </button>
          <button
            className={`flex flex-col items-center justify-center p-2 text-sm font-medium ${
              activeScreen === 'dataEntry' ? 'text-blue-600' : 'text-gray-500'
            }`}
            onClick={() => setActiveScreen('dataEntry')}
          >
            {/* TODO: Daha uygun bir veri girişi/form ikonu ile değiştir */}
            <PencilIcon className="w-6 h-6" />
            <span>Veri Girişi</span>
          </button>
          <button
            className={`flex flex-col items-center justify-center p-2 text-sm font-medium ${
              activeScreen === 'analytics' ? 'text-blue-600' : 'text-gray-500'
            }`}
            onClick={() => setActiveScreen('analytics')}
          >
            {/* TODO: Daha uygun bir analiz/grafik ikonu ile değiştir */}
            <WarningIcon className="w-6 h-6" />
            <span>Analizler</span>
          </button>
          <button
            className={`flex flex-col items-center justify-center p-2 text-sm font-medium ${
              activeScreen === 'settings' ? 'text-blue-600' : 'text-gray-500'
            }`}
            onClick={() => setActiveScreen('settings')}
          >
            {/* TODO: Daha uygun bir ayarlar ikonu ile değiştir */}
            <SaveIcon className="w-6 h-6" />
            <span>Ayarlar</span>
          </button>
        </nav>
      </footer>
    </div>
  );
};

export default MobileLayout;