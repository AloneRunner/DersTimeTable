

import React, { useMemo } from 'react';
// FIX: Corrected typo from TimetabeData to TimetableData
import type { Schedule, TimetableData, ViewType, Assignment, Duty, SchoolHours, Teacher } from '../types';
import { ViewType as ViewTypeEnum, SchoolLevel } from '../types';

interface TimetableViewProps {
  schedule: Schedule | null;
  data: TimetableData;
  viewType: ViewType;
  schoolHours: SchoolHours;
  maxDailyHours: number;
  selectedHeaderId: string;
  viewMode: 'single' | 'master';
  onCellDrop: (sourceInfo: any, targetInfo: any) => void;
  onIsMoveValid: (sourceInfo: any, targetInfo: any) => boolean;
}

const DAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma"];

const subjectColors: { [key: string]: string } = {};
const getColorForSubject = (subjectId: string) => {
  if (!subjectColors[subjectId]) {
    const colors = [
      'bg-red-200 border-red-300', 'bg-blue-200 border-blue-300',
      'bg-green-200 border-green-300', 'bg-yellow-200 border-yellow-300',
      'bg-purple-200 border-purple-300', 'bg-pink-200 border-pink-300',
      'bg-indigo-200 border-indigo-300', 'bg-teal-200 border-teal-300'
    ];
    subjectColors[subjectId] = colors[Object.keys(subjectColors).length % colors.length];
  }
  return subjectColors[subjectId];
};

const ScheduleCell: React.FC<{ 
    assignment: Assignment | null; 
    duty: Duty | null; 
    data: TimetableData; 
    viewType: ViewType;
    viewMode: 'single' | 'master';
    isDisabled: boolean;
    onDragStart: (e: React.DragEvent<HTMLDivElement>) => void;
    onDragEnd: (e: React.DragEvent<HTMLDivElement>) => void;
}> = ({ assignment, duty, data, viewType, viewMode, isDisabled, onDragStart, onDragEnd }) => {
  const isDraggable = viewMode === 'master' && viewType === ViewTypeEnum.Class && !!assignment && !isDisabled;

  if(isDisabled) {
    return <div className="h-24 border-slate-200 border bg-slate-100"></div>;
  }
  
  if (!assignment && !duty) {
    return <div className="h-24 border-slate-200 border"></div>;
  }

  if(duty) {
      return (
        <div className={`h-24 border p-1.5 text-xs flex flex-col justify-center items-center text-center bg-slate-200 border-slate-300`}>
          <p className="font-bold text-slate-700">{duty.name}</p>
        </div>
      );
  }
  
  const subject = data.subjects.find(s => s.id === assignment!.subjectId);
  const teachers = (assignment!.teacherIds || []).map(tid => data.teachers.find(t => t.id === tid)).filter(Boolean) as Teacher[];
  const classroom = data.classrooms.find(c => c.id === assignment!.classroomId);
  const location = data.locations.find(l => l.id === assignment!.locationId);

  if (!subject || teachers.length === 0 || !classroom) {
    return <div className="h-24 border-slate-200 border bg-red-100 p-1 text-xs">Hatalı Atama</div>;
  }
  
  const color = getColorForSubject(subject.id);

  return (
    <div 
      draggable={isDraggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`h-24 border p-1.5 text-xs flex flex-col justify-between ${color} ${isDraggable ? 'cursor-move' : ''}`}>
      <div>
        <p className="font-bold text-slate-800">{subject.name}</p>
        <p className="text-slate-600">{viewType === ViewTypeEnum.Class ? teachers.map(t => t.name).join(' + ') : classroom.name}</p>
      </div>
      {location && <p className="text-slate-500 text-[10px] self-end">{location.name}</p>}
    </div>
  );
};


export const TimetableView: React.FC<TimetableViewProps> = ({ schedule, data, viewType, schoolHours, maxDailyHours, selectedHeaderId, viewMode, onCellDrop, onIsMoveValid }) => {
  const [draggedItemInfo, setDraggedItemInfo] = React.useState<any | null>(null);
  const [draggedOverCell, setDraggedOverCell] = React.useState<{ dayIndex: number; hourIndex: number; headerId: string } | null>(null);

  if (!schedule) {
    return (
      <div className="flex items-center justify-center h-96 bg-slate-100 rounded-lg">
        <p className="text-slate-500">Program oluşturulduktan sonra burada görüntülenecektir.</p>
      </div>
    );
  }
  
  const HOURS = Array.from({ length: maxDailyHours }, (_, i) => `${i + 1}. Ders`);
  
  const headersToRender = useMemo(() => {
    const allHeaders = viewType === ViewTypeEnum.Class ? data.classrooms : data.teachers;
    if (viewMode === 'master') {
      return allHeaders;
    }
    // Single mode
    return allHeaders.filter(h => h.id === selectedHeaderId);
  }, [viewMode, viewType, selectedHeaderId, data.classrooms, data.teachers]);

  if (headersToRender.length === 0 && viewMode === 'single') {
      return (
        <div className="flex items-center justify-center h-96 bg-slate-100 rounded-lg">
            <p className="text-slate-500">Lütfen görüntülemek için bir {viewType === ViewTypeEnum.Class ? 'sınıf' : 'öğretmen'} seçin.</p>
        </div>
      );
  }
  
  const getAssignmentFor = (headerId: string, dayIndex: number, hourIndex: number): Assignment | null => {
     if (viewType === ViewTypeEnum.Class) {
        const classroomId = headerId;
        if(!schedule[classroomId]) return null;
        return schedule[classroomId]?.[dayIndex]?.[hourIndex] ?? null;
     } else {
        const teacherId = headerId;
        if(!teacherId) return null;
        
        for (const classId in schedule) {
            const assignment = schedule[classId]?.[dayIndex]?.[hourIndex] as Assignment | null;
            if(assignment && assignment.teacherIds.includes(teacherId)) {
                return assignment;
            }
        }
        return null;
     }
  }
  
  const getDutyFor = (headerId: string, dayIndex: number, hourIndex: number): Duty | null => {
      if(viewType === ViewTypeEnum.Teacher) {
          const teacherId = headerId;
          return data.duties.find(d => d.teacherId === teacherId && d.dayIndex === dayIndex && d.hourIndex === hourIndex) || null;
      }
      return null;
  }

  const measureBlockSpan = (classroomId: string, dayIndex: number, hourIndex: number) => {
    if (!schedule?.[classroomId]) return 1;
    const row = schedule[classroomId][dayIndex];
    const a = row?.[hourIndex];
    if (!a) return 1;
    let span = 1;
    // Count how many consecutive cells to the right have the same assignment object reference
    for (let k = hourIndex + 1; k < row.length && row[k] === a; k++) {
        span++;
    }
    return span;
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, assignment: Assignment, dayIndex: number, hourIndex: number, headerId: string) => {
    if (viewMode !== 'master' || viewType !== ViewTypeEnum.Class || !assignment) return;
    
    const span = measureBlockSpan(headerId, dayIndex, hourIndex);

    const sourceInfo = {
      classroomId: headerId,
      dayIndex,
      hourIndex,
      subjectId: assignment.subjectId,
      blockSpan: span,
    };
    e.dataTransfer.setData('application/json', JSON.stringify(sourceInfo));
    setDraggedItemInfo(sourceInfo);
    e.currentTarget.style.opacity = '0.5';
  };

  const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
      e.currentTarget.style.opacity = '1';
      setDraggedItemInfo(null);
      setDraggedOverCell(null);
  };

  const handleDrop = (e: React.DragEvent, dayIndex: number, hourIndex: number, headerId: string) => {
    e.preventDefault();
    if (viewMode !== 'master' || viewType !== ViewTypeEnum.Class) return;
    try {
        const sourceInfo = JSON.parse(e.dataTransfer.getData('application/json'));
        const targetInfo = {
            classroomId: headerId,
            dayIndex,
            hourIndex,
        };
        if (onIsMoveValid(sourceInfo, targetInfo)) {
          onCellDrop(sourceInfo, targetInfo);
        }
    } catch (error) {
        console.error("Drop failed:", error)
    } finally {
        setDraggedItemInfo(null);
        setDraggedOverCell(null);
    }
  };


  return (
      <>
       {viewMode === 'master' && viewType === ViewTypeEnum.Class && <p className="text-xs text-slate-500 mb-2 no-print text-center">İpucu: Dersleri sınıflar arasında boş saatlere sürükleyerek programı manuel olarak düzenleyebilirsiniz.</p>}
        <div id="timetable-view" className="w-full overflow-x-auto bg-white p-4 rounded-lg shadow-lg">
        <div className="grid grid-flow-col auto-cols-fr min-w-[800px]">
            <div className="sticky left-0 bg-white z-10 w-32">
            <div className="h-12 border-b border-slate-300 flex items-center justify-center font-bold">Saatler</div>
            {HOURS.map(hour => (
                <div key={hour} className="h-24 flex items-center justify-center font-semibold text-slate-600 border-r border-b border-slate-300 text-sm">
                {hour}
                </div>
            ))}
            </div>
            {DAYS.map((day, dayIndex) => (
            <div key={day} className="flex flex-col min-w-[12rem] flex-1">
                <div className="h-12 flex flex-col items-center justify-center font-bold text-slate-700 border-b-2 border-slate-400">
                <span>{day}</span>
                </div>
                 <div className={`grid grid-cols-${headersToRender.length || 1} divide-x divide-slate-200`}>
                    {headersToRender.map((header) => (
                        <div key={header.id} className="flex flex-col">
                             {viewMode === 'master' && (
                                <div className="h-8 flex items-center justify-center font-semibold bg-slate-50 border-b text-xs">
                                    {header.name}
                                </div>
                             )}
                            <div className="grid grid-cols-1 divide-y divide-slate-200">
                                {HOURS.map((_, hourIndex) => {
                                    const assignment = getAssignmentFor(header.id, dayIndex, hourIndex);
                                    const duty = getDutyFor(header.id, dayIndex, hourIndex);
                                    
                                    const isDraggedOver = draggedOverCell?.headerId === header.id && draggedOverCell?.dayIndex === dayIndex && draggedOverCell?.hourIndex === hourIndex;
                                    
                                    let dropTargetState = 'neutral';
                                    let isDisabled = false;

                                    const classroomLevel = (viewType === ViewTypeEnum.Class ? data.classrooms.find(c => c.id === header.id)?.level : null) 
                                      || (viewType === ViewTypeEnum.Teacher && assignment ? data.classrooms.find(c => c.id === assignment.classroomId)?.level : null);

                                    if(classroomLevel) {
                                      isDisabled = hourIndex >= schoolHours[classroomLevel][dayIndex];
                                    }

                                    if (viewMode === 'master' && isDraggedOver && draggedItemInfo && !assignment && !isDisabled) {
                                        const targetInfo = { classroomId: header.id, dayIndex, hourIndex };
                                        dropTargetState = onIsMoveValid(draggedItemInfo, targetInfo) ? 'valid' : 'invalid';
                                    }

                                    return (
                                        <div 
                                        key={hourIndex}
                                        onDragOver={(e) => {
                                            if (viewMode === 'master' && draggedItemInfo) e.preventDefault();
                                        }}
                                        onDrop={(e) => handleDrop(e, dayIndex, hourIndex, header.id)}
                                        onDragEnter={() => viewMode === 'master' && !assignment && !isDisabled && setDraggedOverCell({ dayIndex, hourIndex, headerId: header.id })}
                                        onDragLeave={() => viewMode === 'master' && setDraggedOverCell(null)}
                                        className={`
                                          ${dropTargetState === 'valid' ? 'bg-sky-100' : ''}
                                          ${dropTargetState === 'invalid' ? 'bg-red-200' : ''}
                                          transition-colors duration-150`}
                                        >
                                        <ScheduleCell
                                            assignment={assignment}
                                            duty={duty}
                                            data={data}
                                            viewType={viewType}
                                            viewMode={viewMode}
                                            isDisabled={isDisabled}
                                            onDragStart={(e) => assignment && handleDragStart(e, assignment, dayIndex, hourIndex, header.id)}
                                            onDragEnd={handleDragEnd}
                                        />
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
            ))}
        </div>
        </div>
      </>
  );
};