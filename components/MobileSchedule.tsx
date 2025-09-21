import React, { useMemo } from 'react';
import type { Schedule, TimetableData, ViewType, SchoolHours } from '../types';
import { ViewType as ViewTypeEnum, SchoolLevel } from '../types';
import { UserIcon, LocationMarkerIcon } from './icons';

type ViewMode = 'single' | 'master';

type SectionRow = {
  hourLabel: string;
  primary: string;
  secondary?: string;
  location?: string;
  note?: string;
};

type DaySection = {
  dayLabel: string;
  rows: SectionRow[];
};

interface MobileScheduleProps {
  schedule: Schedule | null;
  data: TimetableData;
  viewType: ViewType;
  viewMode: ViewMode;
  selectedHeaderId: string;
  schoolHours: SchoolHours;
  maxDailyHours: number;
}

const DAYS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma'];

const hourLabel = (hourIndex: number) => `${hourIndex + 1}. Ders`;

const buildClassSections = (
  classroomId: string,
  schedule: Schedule,
  data: TimetableData,
  schoolHours: SchoolHours,
  maxDailyHours: number
): DaySection[] => {
  const classroom = data.classrooms.find(c => c.id === classroomId);
  if (!classroom) return [];

  const classDays = schedule[classroomId] ?? [];
  const dailyLimits = schoolHours[classroom.level as SchoolLevel] ?? [];

  return DAYS.map((dayLabel, dayIndex) => {
    const rows: SectionRow[] = [];
    const dayLessons = classDays[dayIndex] ?? [];
    const baseCount = Math.max(dayLessons.length, dailyLimits[dayIndex] ?? 0);
    const limit = baseCount > 0 ? baseCount : Math.max(maxDailyHours, 1);

    for (let hourIndex = 0; hourIndex < limit; hourIndex++) {
      const assignment = dayLessons[hourIndex];
      if (!assignment) {
        rows.push({ hourLabel: hourLabel(hourIndex), primary: '-', secondary: undefined, location: undefined });
        continue;
      }

      const subject = data.subjects.find(s => s.id === assignment.subjectId);
      const teacher = data.teachers.find(t => t.id === assignment.teacherId);
      const location = assignment.locationId ? data.locations.find(l => l.id === assignment.locationId) : undefined;

      rows.push({
        hourLabel: hourLabel(hourIndex),
        primary: subject?.name ?? 'Ders',
        secondary: teacher?.name ?? undefined,
        location: location?.name ?? undefined,
      });
    }

    return { dayLabel, rows };
  });
};

const buildTeacherSections = (
  teacherId: string,
  schedule: Schedule,
  data: TimetableData,
  maxDailyHours: number
): DaySection[] => {
  const teacher = data.teachers.find(t => t.id === teacherId);
  if (!teacher) return [];

  const limit = Number.isFinite(maxDailyHours) && maxDailyHours > 0 ? maxDailyHours : 12;

  return DAYS.map((dayLabel, dayIndex) => {
    const rows: SectionRow[] = [];

    for (let hourIndex = 0; hourIndex < limit; hourIndex++) {
      let assignmentRow: SectionRow | null = null;

      for (const [classroomId, days] of Object.entries(schedule)) {
        const slot = days?.[dayIndex]?.[hourIndex] ?? null;
        if (slot && slot.teacherId === teacherId) {
          const subject = data.subjects.find(s => s.id === slot.subjectId);
          const classroom = data.classrooms.find(c => c.id === slot.classroomId);
          const location = slot.locationId ? data.locations.find(l => l.id === slot.locationId) : undefined;

          assignmentRow = {
            hourLabel: hourLabel(hourIndex),
            primary: subject?.name ?? 'Ders',
            secondary: classroom?.name,
            location: location?.name,
          };
          break;
        }
      }

      const duty = data.duties.find(d => d.teacherId === teacherId && d.dayIndex === dayIndex && d.hourIndex === hourIndex);
      if (duty) {
        if (assignmentRow) {
            assignmentRow.note = (assignmentRow.note ? assignmentRow.note + ', ' : '') + duty.name;
        } else {
            assignmentRow = {
                hourLabel: hourLabel(hourIndex),
                primary: duty.name,
                secondary: 'Nöbet',
                note: 'Görev',
            };
        }
      }

      if (assignmentRow) {
        rows.push(assignmentRow);
      } else {
        rows.push({ hourLabel: hourLabel(hourIndex), primary: '-', secondary: undefined, location: undefined });
      }
    }

    return { dayLabel, rows };
  });
};

export const MobileSchedule: React.FC<MobileScheduleProps> = ({
  schedule,
  data,
  viewType,
  viewMode,
  selectedHeaderId,
  schoolHours,
  maxDailyHours,
}) => {
  const isTeacherView = viewType === ViewTypeEnum.Teacher;

  const sections = useMemo(() => {
    if (!schedule) return [];
    if (!selectedHeaderId) return [];

    if (viewType === ViewTypeEnum.Class) {
      return buildClassSections(selectedHeaderId, schedule, data, schoolHours, maxDailyHours);
    }
    return buildTeacherSections(selectedHeaderId, schedule, data, maxDailyHours);
  }, [schedule, selectedHeaderId, viewType, data, schoolHours, maxDailyHours]);

  if (!schedule) {
    return null;
  }

  if (viewMode === 'master') {
    return (
      <div className="md:hidden rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        "Tümünü Gör" modu mobil listede desteklenmiyor. Lütfen üstten "Sade Görünüm" seçeneğini kullanın.
      </div>
    );
  }

  if (!selectedHeaderId) {
    return (
      <div className="md:hidden rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        Lütfen {isTeacherView ? 'bir öğretmen' : 'bir sınıf'} seçin.
      </div>
    );
  }

  if (sections.length === 0) {
    return (
      <div className="md:hidden rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        Bu kayıt için gösterilecek ders bulunamadı.
      </div>
    );
  }

  return (
    <div className="md:hidden space-y-6">
      {sections.map(section => (
        <div key={section.dayLabel} className="rounded-xl overflow-hidden border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-base font-bold text-slate-800">
            {section.dayLabel}
          </div>
          <ul className="divide-y divide-slate-100">
            {section.rows.map((row, index) => (
              <li key={`${section.dayLabel}-${row.hourLabel}-${index}`} className={`flex items-center gap-4 px-4 py-3 ${row.primary === '-' ? 'bg-slate-50' : ''}`}>
                <div className="flex-shrink-0 w-16 h-16 flex flex-col items-center justify-center bg-sky-50 rounded-lg text-sky-800">
                    <span className="text-xs font-medium">DERS</span>
                    <span className="text-2xl font-bold">{row.hourLabel.split('.')[0]}</span>
                </div>
                <div className="flex-grow">
                  {row.primary === '-' ? (
                    <div className="text-sm text-slate-400">Boş ders</div>
                  ) : (
                    <>
                      <div className="text-base font-bold text-slate-800">
                        {row.primary}
                      </div>
                      {row.secondary && (
                        <div className="flex items-center gap-2 text-sm text-slate-600 mt-1">
                          <UserIcon className="w-4 h-4 text-slate-400" />
                          <span>{row.secondary}</span>
                        </div>
                      )}
                      {row.location && (
                        <div className="flex items-center gap-2 text-sm text-slate-500 mt-1">
                          <LocationMarkerIcon className="w-4 h-4 text-slate-400" />
                          <span>{row.location}</span>
                        </div>
                      )}
                      {row.note && (
                        <div className="mt-2 text-xs text-amber-700 bg-amber-100 border border-amber-200 rounded-md px-2 py-1">
                          {row.note}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
};