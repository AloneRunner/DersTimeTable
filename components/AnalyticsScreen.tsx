import React, { useState } from 'react';
import TeacherLoadAnalysis from '../TeacherLoadAnalysis';
import TeacherActualLoadPanel from '../TeacherActualLoadPanel';
import TeacherAvailabilityHeatmap from '../TeacherAvailabilityHeatmap';
import ConflictAnalyzer from '../ConflictAnalyzer';
import QualitySummary from '../QualitySummary';
import MultiTeacherWarnings from '../MultiTeacherWarnings';
import DutyCoveragePanel from '../DutyCoveragePanel';
import SolverReport from '../SolverReport';

// App.tsx'ten gerekli tipleri import edin
import { Schedule, SchoolHour, Day, TeacherLoad, ValidationResult, SolverStats } from '../../types';

interface AnalyticsScreenProps {
  schedule: Schedule | null;
  data: any; // Tüm uygulama verileri (öğretmenler, sınıflar vb.)
  schoolHours: SchoolHour[];
  maxDailyHours: number;
  teacherLoads: TeacherLoad[];
  actualTeacherLoads: TeacherLoad[];
  validation: ValidationResult;
  solverStats: SolverStats | null;
  cpGapLimit: number;
  DAYS: Day[];
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

const AnalyticsScreen: React.FC<AnalyticsScreenProps> = ({
  schedule,
  data,
  schoolHours,
  maxDailyHours,
  teacherLoads,
  actualTeacherLoads,
  validation,
  solverStats,
  cpGapLimit,
  DAYS,
}) => {
  return (
    <div className="analytics-screen p-2">
      {solverStats && (
        <CollapsiblePanel title="Çözücü Raporu" defaultOpen={true}>
          <SolverReport solverStats={solverStats} cpGapLimit={cpGapLimit} />
        </CollapsiblePanel>
      )}

      <CollapsiblePanel title="Çakışma Analizi">
        <ConflictAnalyzer schedule={schedule} data={data} DAYS={DAYS} schoolHours={schoolHours} />
      </CollapsiblePanel>

      <CollapsiblePanel title="Kalite Özeti">
        <QualitySummary schedule={schedule} data={data} validation={validation} />
      </CollapsiblePanel>

      <CollapsiblePanel title="Öğretmen Yük Analizi">
        <TeacherLoadAnalysis teacherLoads={teacherLoads} />
      </CollapsiblePanel>

      <CollapsiblePanel title="Gerçekleşen Ders Yükleri">
        <TeacherActualLoadPanel actualTeacherLoads={actualTeacherLoads} />
      </CollapsiblePanel>

      <CollapsiblePanel title="Çoklu Öğretmen Uyarıları">
        <MultiTeacherWarnings schedule={schedule} data={data} />
      </CollapsiblePanel>

      <CollapsiblePanel title="Nöbet Kapsamı Paneli">
        <DutyCoveragePanel schedule={schedule} data={data} DAYS={DAYS} schoolHours={schoolHours} />
      </CollapsiblePanel>

      <CollapsiblePanel title="Öğretmen Uygunluk Isı Haritası">
        <TeacherAvailabilityHeatmap teachers={data.teachers} DAYS={DAYS} schoolHours={schoolHours} />
      </CollapsiblePanel>
    </div>
  );
};

export default AnalyticsScreen;
