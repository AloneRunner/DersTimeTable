import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useTimetableData } from './hooks/useTimetableData';
import type { Schedule, TimetableData, SavedSchedule, SchoolHours, SolverStats } from './types';
import { SchoolLevel, ViewType } from './types';
import { solveTimetableLocally } from './services/localSolver';
import { buildSchedulePdf } from './services/pdfExporter';
import { TimetableView } from './components/TimetableView';
import { MobileSchedule } from './components/MobileSchedule';
import { DownloadIcon, PrintIcon, SaveIcon, TrashIcon, UploadIcon, WarningIcon } from './components/icons';
import { QrTools } from './components/QrTools';
import { useDataValidation } from './hooks/useDataValidation';
import { useLoadCalculation } from './hooks/useLoadCalculation';
import { Modal } from './components/Modal';
import { solveTimetableCP } from './services/cpSatClient';
import { TeacherForm } from './components/forms/TeacherForm';
import { ClassroomForm } from './components/forms/ClassroomForm';
import { SubjectForm } from './components/forms/SubjectForm';
import { LocationForm } from './components/forms/LocationForm';
import { FixedAssignmentForm } from './components/forms/FixedAssignmentForm';
import { LessonGroupForm } from './components/forms/LessonGroupForm';
import { DutyForm } from './components/forms/DutyForm';
import TeacherLoadAnalysis from './components/TeacherLoadAnalysis';
import TeacherActualLoadPanel from './components/TeacherActualLoadPanel';
import TeacherAvailabilityHeatmap from './components/TeacherAvailabilityHeatmap';
import DutyCoveragePanel from './components/DutyCoveragePanel';
import SolverReport from './components/SolverReport';
import DataEntryScreen from './components/DataEntryScreen';
import SavedSchedules from './components/SavedSchedules';
import SolverControls from './components/SolverControls';
import { AuthScreen } from './components/AuthScreen';

type Tab = 'teachers' | 'classrooms' | 'subjects' | 'locations' | 'fixedAssignments' | 'lessonGroups' | 'duties';
type ModalState = { type: Tab; item: any | null } | { type: null; item: null };
type ViewMode = 'single' | 'master';

const DAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma"];
const BASE_API_URL = "https://derstimetable-production.up.railway.app";

const App: React.FC = () => {
    const [authToken, setAuthToken] = useState<string | null>(() => localStorage.getItem('authToken'));

    const { data, addTeacher, updateTeacher, removeTeacher, addClassroom, updateClassroom, removeClassroom, addSubject, updateSubject, removeSubject, addLocation, updateLocation, removeLocation, addFixedAssignment, removeFixedAssignment, addLessonGroup, updateLessonGroup, removeLessonGroup, addDuty, updateDuty, removeDuty, importData, clearData } = useTimetableData();
    const [schedule, setSchedule] = useState<Schedule | null>(null);
    const [solverStats, setSolverStats] = useState<SolverStats | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<Tab>('teachers');
    const [viewType, setViewType] = useState<ViewType>(ViewType.Class);
    const [viewMode, setViewMode] = useState<ViewMode>('single');
    const [selectedHeaderId, setSelectedHeaderId] = useState<string>('');
    const [schoolHours, setSchoolHours] = useState<SchoolHours>({
        [SchoolLevel.Middle]: [8, 8, 8, 8, 8],
        [SchoolLevel.High]: [8, 8, 8, 8, 8],
    });
    const [modalState, setModalState] = useState<ModalState>({ type: null, item: null });
    const fileInputRef = useRef<HTMLInputElement>(null);
    const scheduleFileInputRef = useRef<HTMLInputElement>(null);
    const printMenuRef = useRef<HTMLDivElement | null>(null);
    
    const [savedSchedules, setSavedSchedules] = useState<SavedSchedule[]>([]);
    const [activeScheduleName, setActiveScheduleName] = useState<string | null>(null);
    
    const maxDailyHours = useMemo(() => {
        const flat = (Object.values(schoolHours).flat() as number[]);
        return Math.max(...flat);
    }, [schoolHours]);
    const validation = useDataValidation(data, schoolHours);
    const { classroomLoads, teacherLoads } = useLoadCalculation(data, schoolHours);
    const actualTeacherLoads = useMemo(() => {
        if (!schedule) return null;
        const counts = new Map<string, number>();
        Object.values(schedule).forEach(classroomSchedule => {
            if (!Array.isArray(classroomSchedule)) return;
            classroomSchedule.forEach(daySlots => {
                if (!Array.isArray(daySlots)) return;
                daySlots.forEach(slot => {
                    if (slot && typeof slot === 'object' && slot.teacherId) {
                        const current = counts.get(slot.teacherId) || 0;
                        counts.set(slot.teacherId, current + 1);
                    }
                });
            });
        });
        return counts;
    }, [schedule]);

    useEffect(() => {
        if (authToken) {
            localStorage.setItem('authToken', authToken);
        } else {
            localStorage.removeItem('authToken');
        }
    }, [authToken]);

    useEffect(() => {
        if (viewType === ViewType.Class && data.classrooms.length > 0) {
            setSelectedHeaderId(prev => data.classrooms.some(c => c.id === prev) ? prev : data.classrooms[0].id);
        } else if (viewType === ViewType.Teacher && data.teachers.length > 0) {
            setSelectedHeaderId(prev => data.teachers.some(t => t.id === prev) ? prev : data.teachers[0].id);
        }
    }, [viewType, data.classrooms, data.teachers]);
    
    const handleSchoolHoursChange = (level: SchoolLevel, dayIndex: number, value: string) => {
        const newHours = parseInt(value) || 4;
        const clampedValue = Math.max(4, Math.min(16, newHours));

        setSchoolHours(prev => {
            const newLevelHours = [...prev[level]];
            newLevelHours[dayIndex] = clampedValue;
            return { ...prev, [level]: newLevelHours };
        });
    };
    
    const handleClearAllData = () => {
        if (window.confirm("Mevcut tüm değişiklikleri atıp varsayılan örnek verilere geri dönmek istediğinizden emin misiniz? Kayıtlı versiyonlar da dahil olmak üzere tüm veriler silinecektir. Bu işlem geri alınamaz.")) {
            clearData();
            setSchedule(null);
            setSolverStats(null);
            setActiveScheduleName(null);
            setError(null);
            setSelectedHeaderId('');
        }
    };

    const [optTime, setOptTime] = useState<number>(150);
    const [solverStrategy, setSolverStrategy] = useState<"cp">("cp");
    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
    const [isSmallScreen, setIsSmallScreen] = useState<boolean>(() => typeof window !== 'undefined' ? window.innerWidth < 768 : false);
    const [printMenuOpen, setPrintMenuOpen] = useState<boolean>(false);
    const [isExportingPdf, setIsExportingPdf] = useState<boolean>(false);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const handler = () => setIsSmallScreen(window.innerWidth < 768);
        handler();
        window.addEventListener('resize', handler);
        return () => window.removeEventListener('resize', handler);
    }, []);

    useEffect(() => {
        if (!printMenuOpen) return;
        const handleOutsideClick = (event: MouseEvent) => {
            if (printMenuRef.current && !printMenuRef.current.contains(event.target as Node)) {
                setPrintMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleOutsideClick);
        return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, [printMenuOpen]);

    const handleGenerate = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        setSchedule(null);
        setSolverStats(null);
        setActiveScheduleName(null);
        try {
            const result = await solveTimetableCP(data, schoolHours, optTime);
            setSolverStats(result.stats);
            if (result.schedule) {
                setSchedule(result.schedule);
            } else {
                const errorMsg = result.stats?.notes?.join(' | ') || "Çözüm bulunamadı. Kısıtlar çok sıkı olabilir.";
                setError(errorMsg);
            }
        } catch (err: any) {
            setError(err.message || 'Program oluşturulurken bilinmeyen bir hata oluştu.');
        } finally {
            setIsLoading(false);
        }
    }, [data, schoolHours, optTime]);
    
    const handlePdfExport = async (mode: 'selected' | 'classes' | 'teachers') => {
        if (!schedule) {
            alert("Önce program oluşturmalısınız.");
            setPrintMenuOpen(false);
            return;
        }
        setIsExportingPdf(true);
        try {
            const { doc, fileName } = buildSchedulePdf({
                schedule, data, schoolHours, maxDailyHours, mode,
                viewType, viewMode,
                selectedHeaderId: viewMode === 'single' ? selectedHeaderId : null,
            });
            const blob = doc.output('blob');
            const nav: any = typeof navigator !== 'undefined' ? navigator : null;
            if (nav?.share) {
                const file = new File([blob], fileName, { type: 'application/pdf' });
                if (nav.canShare && nav.canShare({ files: [file] })) {
                    await nav.share({ files: [file], title: fileName });
                } else {
                    doc.save(fileName);
                }
            } else {
                doc.save(fileName);
            }
        } catch (err: any) {
            alert(err?.message || "PDF hazırlanamadı.");
        } finally {
            setIsExportingPdf(false);
            setPrintMenuOpen(false);
        }
    };

    const handleOpenModal = (type: Tab, item: any | null = null) => setModalState({ type, item });
    const handleCloseModal = () => setModalState({ type: null, item: null });

    const handleSave = (itemData: any) => {
        const { type, item } = modalState;
        switch (type) {
            case 'teachers': item ? updateTeacher({ ...item, ...itemData }) : addTeacher(itemData); break;
            case 'classrooms': item ? updateClassroom({ ...item, ...itemData }) : addClassroom(itemData); break;
            case 'subjects': item ? updateSubject({ ...item, ...itemData }) : addSubject(itemData); break;
            case 'locations': item ? updateLocation({ ...item, ...itemData }) : addLocation(itemData); break;
            case 'fixedAssignments': addFixedAssignment(itemData); break;
            case 'lessonGroups': item ? updateLessonGroup({ ...item, ...itemData }) : addLessonGroup(itemData); break;
            case 'duties': item ? updateDuty({ ...item, ...itemData }) : addDuty(itemData); break;
        }
        handleCloseModal();
    };
    
    const renderModalContent = () => {
        if (!modalState.type) return null;
        const props = { item: modalState.item, onSave: handleSave, onCancel: handleCloseModal, data, maxDailyHours };
        switch(modalState.type) {
            case 'teachers': return <TeacherForm {...props} />;
            case 'classrooms': return <ClassroomForm {...props} />;
            case 'subjects': return <SubjectForm {...props} updateTeacher={updateTeacher} />;
            case 'locations': return <LocationForm {...props} />;
            case 'fixedAssignments': return <FixedAssignmentForm {...props} />;
            case 'lessonGroups': return <LessonGroupForm {...props} />;
            case 'duties': return <DutyForm {...props} />;
            default: return null;
        }
    }
    
    const viewOptions = useMemo(() => {
        if (viewType === ViewType.Class) return data.classrooms;
        return data.teachers;
    }, [viewType, data.classrooms, data.teachers]);

    const resolvedSelectedId = selectedHeaderId || (viewOptions.length > 0 ? viewOptions[0].id : '');

    // --- Auth Handlers ---
    const handleLogin = async (email: string, password: string) => {
        const response = await fetch(`${BASE_API_URL}/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ username: email, password: password })
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ detail: 'Bilinmeyen bir ağ hatası oluştu.' }));
            throw new Error(errorData.detail || 'Giriş başarısız.');
        }
        const data = await response.json();
        setAuthToken(data.access_token);
    };

    const handleRegister = async (schoolName: string, adminEmail: string, adminPassword: string) => {
        // 1. Create the school
        const schoolResponse = await fetch(`${BASE_API_URL}/schools/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: schoolName })
        });
        if (!schoolResponse.ok) {
            const errorData = await schoolResponse.json().catch(() => ({ detail: 'Okul oluşturulamadı.' }));
            throw new Error(errorData.detail || 'Okul oluşturma başarısız.');
        }
        const schoolData = await schoolResponse.json();

        // 2. Create the admin user for that school
        const userResponse = await fetch(`${BASE_API_URL}/users/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: adminEmail,
                password: adminPassword,
                role: 'admin',
                school_id: schoolData.id
            })
        });
        if (!userResponse.ok) {
            const errorData = await userResponse.json().catch(() => ({ detail: 'Yönetici hesabı oluşturulamadı.' }));
            throw new Error(errorData.detail || 'Kullanıcı oluşturma başarısız.');
        }
        
        // 3. Automatically log in the new user
        await handleLogin(adminEmail, adminPassword);
    };

    const handleLogout = () => {
        setAuthToken(null);
    };

    if (!authToken) {
        return <AuthScreen onLogin={handleLogin} onRegister={handleRegister} />;
    }

    return (
        <div className="min-h-screen p-4 sm:p-6 lg:p-8">
            <header className="mb-8 no-print">
                <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900">Ozarik DersTimeTable</h1>
                        <p className="text-slate-500 mt-1">Haftalık ders programınızı saniyeler içinde oluşturun.</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={handleLogout} className="text-sm font-medium text-slate-600 hover:text-sky-600">Çıkış Yap</button>
                        <button 
                            onClick={handleGenerate}
                            disabled={isLoading || !validation.isValid}
                            className="px-5 py-2 font-medium bg-sky-500 text-white rounded-lg shadow-md hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors"
                        >
                            {isLoading ? 'Oluşturuluyor...' : 'Program Oluştur'}
                        </button>
                    </div>
                </div>
            </header>

            <main className="flex flex-col gap-8">
                {!validation.isValid && (
                    <div className="p-4 bg-yellow-50 text-yellow-800 border border-yellow-200 rounded-lg no-print space-y-2">
                        <h3 className="font-bold flex items-center gap-2"><WarningIcon className="w-5 h-5" />Veri Uyuşmazlıkları Tespit Edildi</h3>
                        <ul className="list-disc list-inside text-sm pl-2 space-y-1">
                            {validation.allErrors.map((error, index) => <li key={index}>{error.message}</li>)}
                        </ul>
                    </div>
                )}
                
                <DataEntryScreen {...{ data, activeTab, setActiveTab, handleOpenModal, removeTeacher, removeClassroom, removeSubject, removeLocation, removeFixedAssignment, removeLessonGroup, removeDuty, teacherLoads, classroomLoads, validation, DAYS, isSmallScreen }} />

                {error && <div className="p-4 bg-red-100 text-red-700 border border-red-200 rounded-lg no-print">{error}</div>}
                
                {isLoading && (
                    <div className="flex flex-col items-center justify-center h-96 bg-white rounded-lg shadow-lg">
                        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-sky-500"></div>
                        <p className="mt-4 text-slate-600">Program çözülüyor...</p>
                    </div>
                )}

                {solverStats && <SolverReport stats={solverStats} />}
                
                {schedule && (
                    <div id="schedule-container" className="bg-white p-6 rounded-lg shadow-lg">
                         <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4 no-print">
                            <div className="flex items-center gap-4">
                                <h2 className="text-xl font-bold whitespace-nowrap">
                                    {activeScheduleName || 'Yeni Program'}
                                </h2>
                                <div className="bg-slate-100 p-1 rounded-md">
                                    <button onClick={() => setViewType(ViewType.Class)} className={`px-2 py-1 text-xs rounded ${viewType === ViewType.Class ? 'bg-white shadow' : 'text-slate-500'}`}>Sınıfa Göre</button>
                                    <button onClick={() => setViewType(ViewType.Teacher)} className={`px-2 py-1 text-xs rounded ${viewType === ViewType.Teacher ? 'bg-white shadow' : 'text-slate-500'}`}>Öğretmene Göre</button>
                                </div>
                                <div className="bg-slate-100 p-1 rounded-md">
                                    <button onClick={() => setViewMode('single')} className={`px-2 py-1 text-xs rounded ${viewMode === 'single' ? 'bg-white shadow' : 'text-slate-500'}`}>Sade Görünüm</button>
                                    <button onClick={() => setViewMode('master')} className={`px-2 py-1 text-xs rounded ${viewMode === 'master' ? 'bg-white shadow' : 'text-slate-500'}`}>Tümünü Gör</button>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <select 
                                    value={resolvedSelectedId} 
                                    onChange={e => setSelectedHeaderId(e.target.value)}
                                    className={`w-full sm:w-48 rounded-md border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 text-sm p-1.5 ${viewMode === 'master' ? 'hidden' : ''}`}
                                >
                                    {viewOptions.map(opt => <option key={opt.id} value={opt.id}>{opt.name}</option>)}
                                </select>
                                <div ref={printMenuRef} className="relative">
                                    <button
                                        onClick={() => setPrintMenuOpen(prev => !prev)}
                                        disabled={isExportingPdf}
                                        className="p-2 text-slate-500 hover:text-sky-600 hover:bg-slate-100 rounded-full disabled:cursor-not-allowed disabled:opacity-60"
                                        title="PDF paylaş / indir"
                                    >
                                        <PrintIcon className={`w-5 h-5 ${isExportingPdf ? 'animate-spin text-sky-500' : ''}`} />
                                    </button>
                                    {printMenuOpen && (
                                        <div className="absolute right-0 top-full mt-2 w-56 rounded-lg border border-slate-200 bg-white shadow-xl z-30">
                                            <button onClick={() => handlePdfExport('selected')} disabled={isExportingPdf} className={`flex w-full items-center justify-between px-4 py-2 text-sm hover:bg-slate-50 text-slate-600`}>Seçili görünüm (PDF)</button>
                                            <button onClick={() => handlePdfExport('classes')} disabled={isExportingPdf} className={`flex w-full items-center justify-between px-4 py-2 text-sm hover:bg-slate-50 text-slate-600`}>Tüm sınıflar (PDF)</button>
                                            <button onClick={() => handlePdfExport('teachers')} disabled={isExportingPdf} className={`flex w-full items-center justify-between px-4 py-2 text-sm hover:bg-slate-50 text-slate-600`}>Tüm öğretmenler (PDF)</button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="hidden md:block print:hidden">
                          <TimetableView schedule={schedule} data={data} viewType={viewType} viewMode={viewMode} schoolHours={schoolHours} maxDailyHours={maxDailyHours} selectedHeaderId={resolvedSelectedId} onCellDrop={() => {}} onIsMoveValid={() => false} />
                        </div>
                        <MobileSchedule schedule={schedule} data={data} viewType={viewType} viewMode={viewMode} selectedHeaderId={resolvedSelectedId} schoolHours={schoolHours} maxDailyHours={maxDailyHours} />
                    </div>
                )}
            </main>
            
            <Modal isOpen={modalState.type !== null} onClose={handleCloseModal} title={`${modalState.item ? 'Düzenle' : 'Yeni Ekle'}: ${
                    {
                        teachers: 'Öğretmen',
                        classrooms: 'Sınıf',
                        subjects: 'Ders',
                        locations: 'Mekan',
                        fixedAssignments: 'Sabit Atama',
                        lessonGroups: 'Grup Dersi',
                        duties: 'Ek Görev',
                    }[modalState.type!]
                }`}>
                {renderModalContent()}
            </Modal>
        </div>
    );
};

export default App;
