import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useTimetableData } from './hooks/useTimetableData';
import type { Schedule, Teacher, Classroom, Subject, Location, TimetableData, FixedAssignment, LessonGroup, Duty, SavedSchedule, SchoolHours, SolverStats, Assignment, SubstitutionAssignment, PrintInfo } from './types';
import { SchoolLevel, ClassGroup, ViewType } from './types';
import { solveTimetableLocally } from './services/localSolver';
import { TimetableView } from './components/TimetableView';
import { AutocompleteInput } from './components/AutocompleteInput';
import { QuickCommandBar } from './components/QuickCommandBar';
import { subjectSuggestions } from './data/suggestions';
import { PlusIcon, TrashIcon, PencilIcon, DownloadIcon, PrintIcon, UploadIcon, SaveIcon, WarningIcon } from './components/icons';
import { useDataValidation } from './hooks/useDataValidation';
import { useLoadCalculation } from './hooks/useLoadCalculation';
import type { TeacherLoad } from './hooks/useLoadCalculation';
import { ConflictAnalyzer } from './components/ConflictAnalyzer';
import { Modal } from './components/Modal';
import { solveTimetableCP } from './services/cpSatClient';
import { TeacherForm } from './components/forms/TeacherForm';
import { ClassroomForm } from './components/forms/ClassroomForm';
import { SubjectForm } from './components/forms/SubjectForm';
import { LocationForm } from './components/forms/LocationForm';
import { FixedAssignmentForm } from './components/forms/FixedAssignmentForm';
import { LessonGroupForm } from './components/forms/LessonGroupForm';
import { DutyForm } from './components/forms/DutyForm';
import { QualitySummary } from './components/QualitySummary';
import TeacherLoadAnalysis from './components/TeacherLoadAnalysis';
import { assignRandomRestDays } from './utils/assignRandomRestDays';
import TeacherActualLoadPanel from './components/TeacherActualLoadPanel';
import TeacherAvailabilityHeatmap from './components/analysis/TeacherAvailabilityHeatmap';
import MobileScheduleView from './components/mobile/MobileScheduleView';
import { buildSchedulePdf, type PrintScope } from './services/pdfExporter';
import { saveOrShareFile, saveTextFile, isNativeApp } from './services/fileSaver';
import { requestBridgeCode, verifyBridgeCode, loginWithGoogle, loginWithReviewPassword, createSchoolForSession, fetchSessionInfo, getApiBaseUrl, type SessionInfo as AuthSessionInfo } from './services/authClient';
import { fetchCatalog as fetchCatalogApi, replaceCatalog as replaceCatalogApi, updateSchoolSettings } from './services/catalogClient';
import { PreflightOverview } from './components/PreflightOverview';
import { isEmptyOrStarterData, loadLocalWorkspace, saveLocalWorkspace } from './utils/localWorkspace';
import { planMove } from './utils/moveValidation';
import { recordAppOpen, recordSignIn, recordSolve } from './services/usageClient';
import GoogleSignInButton from './components/GoogleSignInButton';
import { disableGoogleAutoSelect } from './services/googleAuth';

type Tab = 'teachers' | 'classrooms' | 'subjects' | 'locations' | 'fixedAssignments' | 'lessonGroups' | 'duties';
type ModalState = { type: Tab; item: any | null } | { type: null; item: null };
type ViewMode = 'single' | 'master';

const DAYS = ["Pazartesi", "Sal\u0131", "\u00C7ar\u015Famba", "Per\u015Fembe", "Cuma"];
// Normalize Turkish characters in DAYS to avoid encoding artifacts
const __DAYS_FIX = ["Pazartesi", "Sal\u0131", "\u00C7ar\u015Famba", "Per\u015Fembe", "Cuma"];
try {
  // Mutate array in place; binding is const but contents are mutable
  if (typeof DAYS !== 'undefined' && Array.isArray(DAYS)) {
    for (let i = 0; i < Math.min(DAYS.length, __DAYS_FIX.length); i++) {
      DAYS[i] = __DAYS_FIX[i];
    }
  }
} catch {}

const WEB_PORTAL_URL = 'https://idare.ozarik.org';
const WINDOWS_STORE_URL = 'https://apps.microsoft.com/detail/9N5Z8M82FSQ2';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.ozarik.dersprogrami';
const GUEST_WEB_MODE_KEY = 'ozarik.web.guest-mode';
// true: web ve Windows'ta giris zorunlu, "giris yapmadan devam et" gizlenir.
// Android'de giris yerel hesap seciciyle (GoogleSignInPlugin) yapilir.
const REQUIRE_SIGN_IN = true;

/** Katalogda hic anlamli kayit var mi? (bos bulut katalogunu tespit etmek icin) */
const isCatalogEmpty = (d: TimetableData | null | undefined): boolean => {
    if (!d) return true;
    return (
        (d.teachers?.length ?? 0) === 0 &&
        (d.classrooms?.length ?? 0) === 0 &&
        (d.subjects?.length ?? 0) === 0 &&
        (d.locations?.length ?? 0) === 0 &&
        (d.fixedAssignments?.length ?? 0) === 0 &&
        (d.lessonGroups?.length ?? 0) === 0 &&
        (d.duties?.length ?? 0) === 0
    );
};

const createDefaultSchoolHours = (): SchoolHours => ({
    [SchoolLevel.Middle]: [8, 8, 8, 8, 8],
    [SchoolLevel.High]: [8, 8, 8, 8, 8],
});

type SchoolHoursDraft = Record<SchoolLevel, string[]>;

const schoolHoursToDraft = (hours: SchoolHours): SchoolHoursDraft => ({
    [SchoolLevel.Middle]: hours[SchoolLevel.Middle].map(hour => hour.toString()),
    [SchoolLevel.High]: hours[SchoolLevel.High].map(hour => hour.toString()),
});

const clampSchoolHour = (value: number) => Math.max(4, Math.min(16, value));

// Egitim-ogretim yili eylulde baslar: 14 Eylul 2026 -> "2026-2027", Mart 2027 -> "2026-2027".
const currentAcademicYear = (now = new Date()): string => {
    const start = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
    return `${start}-${start + 1}`;
};

const createDefaultPrintInfo = (): PrintInfo => ({
    schoolName: '',
    academicYear: currentAcademicYear(),
    principalName: '',
});

const explainSolverNote = (note: string): string => {
    // Basarili sonuclarin notu da cevrilir. Onceden yalnizca hata durumlari
    // cevriliyordu ve kullanici programi olusunca sari kutuda ham
    // "status=OPTIMAL" goruyordu.
    if (/^status=OPTIMAL$/i.test(note)) {
        return 'Program oluşturuldu. Çözücü verilen kurallara uyan en iyi yerleşimi buldu.';
    }
    if (/^status=FEASIBLE$/i.test(note)) {
        return 'Program oluşturuldu. Süre dolduğu için daha iyisi aranmadı; süreyi artırıp yeniden deneyerek boşlukları azaltabilirsiniz.';
    }
    if (/^status=INFEASIBLE$/i.test(note)) {
        return 'Bu kurallarla program oluşturmak mümkün değil. Program Öncesi Kontrol bölümündeki kırmızı uyarıları düzeltin veya müsaitlik/blok kurallarını esnetin.';
    }
    if (/^status=UNKNOWN$/i.test(note)) {
        return 'Çözücü verilen süre içinde kesin bir sonuç bulamadı. Süreyi artırıp yeniden deneyin.';
    }
    if (/^status=MODEL_INVALID$/i.test(note)) {
        return 'Program kurallarında çözücünün işleyemediği bir tanım var. Veri kontrollerini gözden geçirin.';
    }
    return note;
};
 // --- Modal Component --- (moved to components/Modal)

// Teacher load analysis UI is provided by the extracted `TeacherLoadAnalysis` component in components/TeacherLoadAnalysis.tsx

const colorForPercent = (percent: number) => {
    const clamped = Math.max(0, Math.min(100, percent));
    const hue = (clamped / 100) * 120;
    const lightness = Math.max(25, 65 - clamped * 0.25);
    return `hsl(${Math.round(hue)}, 70%, ${Math.round(lightness)}%)`;
};

const DutyCoveragePanel: React.FC<{
    data: TimetableData;
    schedule: Schedule | null;
    dayNames: string[];
    assignments: SubstitutionAssignment[];
    onAssign: (assignment: SubstitutionAssignment) => void;
    onCancel: (assignmentId: string) => void;
}> = ({ data, schedule, dayNames, assignments, onAssign, onCancel }) => {
    const [selectedDay, setSelectedDay] = useState<number>(0);
    const [absentTeacherId, setAbsentTeacherId] = useState<string>('');

    const teacherOptions = useMemo(() => data.teachers.map(t => ({ id: t.id, name: t.name })), [data.teachers]);
    const assignmentMap = useMemo(() => {
        const map = new Map<string, SubstitutionAssignment>();
        assignments.forEach((assignment) => {
            map.set(`${assignment.dayIndex}:${assignment.hourIndex}:${assignment.classroomId}`, assignment);
        });
        return map;
    }, [assignments]);

    useEffect(() => {
        if (teacherOptions.length === 0) {
            setAbsentTeacherId('');
            return;
        }
        if (!absentTeacherId || !teacherOptions.some(opt => opt.id === absentTeacherId)) {
            setAbsentTeacherId(teacherOptions[0].id);
        }
    }, [teacherOptions, absentTeacherId]);

    const suggestions = useMemo(() => {
        if (!schedule || !absentTeacherId) {
            return [] as Array<{
                slotKey: string;
                classroomId: string;
                classroomName: string;
                subjectName: string;
                hourIndex: number;
                existingAssignment?: SubstitutionAssignment;
                options: Array<{
                    id: string;
                    name: string;
                    note: string;
                    status: 'available' | 'unavailable';
                    dutyName?: string;
                    assigned: boolean;
                }>;
            }>;
        }

        const teacherById = new Map(data.teachers.map(t => [t.id, t]));
        const subjectById = new Map(data.subjects.map(s => [s.id, s]));
        const dayIndex = selectedDay;

        const isTeacherBusy = (teacherId: string, hourIndex: number) => {
            for (const classroomId of Object.keys(schedule)) {
                const slot = schedule[classroomId]?.[dayIndex]?.[hourIndex];
                if (slot && slot.teacherIds.includes(teacherId)) {
                    return true;
                }
            }
            return false;
        };

        const result: Array<{
            slotKey: string;
            classroomId: string;
            classroomName: string;
            subjectName: string;
            hourIndex: number;
            existingAssignment?: SubstitutionAssignment;
            options: Array<{
                id: string;
                name: string;
                note: string;
                status: 'available' | 'unavailable';
                dutyName?: string;
                assigned: boolean;
            }>;
        }> = [];

        data.classrooms.forEach(classroom => {
            const lessonsForDay = schedule[classroom.id]?.[dayIndex] || [];
            lessonsForDay.forEach((assignment, hourIndex) => {
                if (!assignment || !assignment.teacherIds.includes(absentTeacherId)) return;
                const subjectName = (subjectById.get(assignment.subjectId) as { name: string })?.name || 'Ders';
                const slotKey = `${dayIndex}:${hourIndex}:${classroom.id}`;
                const existingAssignment = assignmentMap.get(slotKey);

                const dutyCandidates = data.duties.filter(duty => {
                    if (duty.dayIndex !== dayIndex) return false;
                    if (typeof duty.hourIndex !== 'number') return true;
                    if (duty.hourIndex === -1) return true;
                    return duty.hourIndex === hourIndex;
                });

                const uniqueOptions = new Map<string, {
                    id: string;
                    name: string;
                    note: string;
                    status: 'available' | 'unavailable';
                    dutyName?: string;
                    assigned: boolean;
                }>();

                dutyCandidates.forEach(duty => {
                    const dutyTeacher = teacherById.get(duty.teacherId);
                    if (!dutyTeacher || duty.teacherId === absentTeacherId) return;
                    const availabilityRow = (dutyTeacher as { availability: boolean[][] }).availability?.[dayIndex] || [];
                    const isAvailable = availabilityRow[hourIndex] === true;
                    const busy = isTeacherBusy(duty.teacherId, hourIndex);
                    const status: 'available' | 'unavailable' = (isAvailable && !busy) ? 'available' : 'unavailable';
                    const note = busy
                        ? 'Bu saatte zaten dersi var'
                        : (isAvailable ? 'Müsait' : 'Müsaitlikte kapalı');
                    if (!uniqueOptions.has(duty.teacherId)) {
                        uniqueOptions.set(duty.teacherId, {
                            id: duty.teacherId,
                            name: (dutyTeacher as { name: string }).name,
                            note,
                            status,
                            dutyName: duty.name,
                            assigned: existingAssignment?.substituteTeacherId === duty.teacherId,
                        });
                    }
                });

                const options = Array.from(uniqueOptions.values()).sort((a, b) => {
                    if (a.status === b.status) {
                        return a.name.localeCompare(b.name, 'tr');
                    }
                    return a.status === 'available' ? -1 : 1;
                });

                result.push({
                    slotKey,
                    classroomId: classroom.id,
                    classroomName: classroom.name,
                    subjectName,
                    hourIndex,
                    existingAssignment,
                    options,
                });
            });
        });

        return result.sort((a, b) => {
            if (a.hourIndex !== b.hourIndex) return a.hourIndex - b.hourIndex;
            return a.classroomName.localeCompare(b.classroomName, 'tr');
        });
    }, [assignmentMap, data.classrooms, data.duties, data.subjects, data.teachers, schedule, selectedDay, absentTeacherId]);

    const absentLessonCount = useMemo(() => suggestions.length, [suggestions]);
    const absentTeacherName = teacherOptions.find(opt => opt.id === absentTeacherId)?.name || '';

    return (
        <div className="bg-white p-6 rounded-lg shadow-lg no-print">
            <h2 className="text-xl font-bold mb-3">Nöbetçi Yerine Geçme Yardımcısı</h2>
            <p className="text-sm text-slate-500 mb-4">
                Bir öğretmen devamsız olduğunda, aynı gün ve saatte nöbetçi olarak atanmış öğretmenlerden hangilerinin derse girebileceğini listeler ve görevlendirme yapmanı sağlar.
            </p>
            <div className="flex flex-wrap items-center gap-3 mb-4 text-sm">
                <label className="flex items-center gap-2">
                    <span className="text-slate-600">Gün</span>
                    <select value={selectedDay} onChange={(e) => setSelectedDay(Number(e.target.value))} className="border rounded px-2 py-1">
                        {dayNames.map((day, index) => (
                            <option key={day} value={index}>{day}</option>
                        ))}
                    </select>
                </label>
                <label className="flex items-center gap-2">
                    <span className="text-slate-600">Devamsız Öğretmen</span>
                    <select value={absentTeacherId} onChange={(e) => setAbsentTeacherId(e.target.value)} className="border rounded px-2 py-1">
                        <option value="">Seçiniz</option>
                        {teacherOptions.map(opt => (
                            <option key={opt.id} value={opt.id}>{opt.name}</option>
                        ))}
                    </select>
                </label>
                {absentLessonCount > 0 && (
                    <span className="text-xs text-slate-500">Seçilen gün için programda {absentLessonCount} ders bulunuyor.</span>
                )}
            </div>
            {!schedule && (
                <div className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-md p-3">
                    Önce bir program oluştur ya da yükle; ardından nöbetçi önerileri burada listelenir.
                </div>
            )}
            {schedule && !absentTeacherId && (
                <div className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-md p-3">
                    Önce devamsız öğretmeni seç.
                </div>
            )}
            {schedule && absentTeacherId && suggestions.length === 0 && (
                <div className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-md p-3">
                    Seçilen öğretmenin bu gün için programa yazılmış dersi yok.
                </div>
            )}
            {schedule && absentTeacherId && suggestions.length > 0 && (
                <div className="space-y-3">
                    {suggestions.map(item => {
                        const existing = item.existingAssignment;
                        return (
                            <div key={item.slotKey} className="border border-slate-200 rounded-md p-3">
                                <div className="flex flex-wrap items-center justify-between text-sm">
                                    <span className="font-semibold text-slate-700">{item.hourIndex + 1}. ders</span>
                                    <span className="text-slate-500">{item.classroomName} • {item.subjectName}</span>
                                </div>
                                {item.options.length > 0 ? (
                                    <ul className="mt-2 space-y-2 text-sm">
                                        {item.options.map(opt => (
                                            <li key={opt.id} className={`flex flex-wrap items-center gap-2 rounded-md px-2 py-1 ${opt.assigned ? 'bg-emerald-100 text-emerald-800' : opt.status === 'available' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                                <span className="font-medium">{opt.name}</span>
                                                {opt.dutyName && (
                                                    <span className="text-xs text-slate-500">({opt.dutyName})</span>
                                                )}
                                                <span className="text-xs ml-auto">{opt.note}</span>
                                                {opt.assigned ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => existing && onCancel(existing.id)}
                                                        className="text-xs font-semibold text-rose-600 hover:text-rose-700 underline decoration-dotted"
                                                    >
                                                        Görevi iptal et
                                                    </button>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        disabled={opt.status !== 'available'}
                                                        onClick={() => {
                                                            const substituteTeacher = data.teachers.find(t => t.id === opt.id);
                                                            const absentTeacher = data.teachers.find(t => t.id === absentTeacherId);
                                                            if (!substituteTeacher || !absentTeacher) return;
                                                            onAssign({
                                                                id: item.slotKey,
                                                                dayIndex: selectedDay,
                                                                hourIndex: item.hourIndex,
                                                                classroomId: item.classroomId,
                                                                classroomName: item.classroomName,
                                                                subjectName: item.subjectName,
                                                                absentTeacherId,
                                                                absentTeacherName: absentTeacher.name,
                                                                substituteTeacherId: substituteTeacher.id,
                                                                substituteTeacherName: substituteTeacher.name,
                                                                dutyName: opt.dutyName,
                                                                createdAt: new Date().toISOString(),
                                                            });
                                                        }}
                                                        className={`text-xs font-semibold ${opt.status === 'available' ? 'text-indigo-600 hover:text-indigo-700' : 'text-slate-400 cursor-not-allowed'}`}
                                                    >
                                                        Göreve ata
                                                    </button>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="mt-2 text-sm text-slate-500">Bu saat için tanımlı nöbetçi yok.</p>
                                )}
                                {existing && !item.options.some(opt => opt.assigned) && (
                                    <p className="mt-2 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
                                        Görevde: {existing.substituteTeacherName}
                                    </p>
                                )}
                                {!existing && absentTeacherName && (
                                    <p className="mt-2 text-xs text-slate-500">
                                        {absentTeacherName} yerine derse girecek öğretmeni seç.
                                    </p>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
            {schedule && absentTeacherId && data.duties.length === 0 && (
                <p className="mt-4 text-xs text-amber-600">Henüz nöbet verisi eklenmemiş. Önce Öğretmen &gt; Ek Görevler sekmesinden nöbet listesi oluştur.</p>
            )}
        </div>
    );
};
// Basit tooltip yardımcı bileşeni (hover ile küçük açıklama kutusu)
const Tooltip: React.FC<{ text: string; children: React.ReactNode }> = ({ text, children }) => (
  <span className="relative group inline-flex items-center">
    {children}
    <span className="absolute z-50 hidden group-hover:block group-focus-within:block top-full mt-1 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10px] leading-snug px-2 py-1 rounded shadow max-w-[280px] whitespace-normal break-words text-left" role="tooltip">
      {text}
    </span>
  </span>
);

// --- Main App Component ---
const App: React.FC = () => {
    const [initialSessionToken] = useState<string | null>(() => {
        if (typeof window === 'undefined') return null;
        try {
            return window.localStorage.getItem('ozarik.session');
        } catch {
            return null;
        }
    });
    const [initialLocalWorkspace] = useState(() => loadLocalWorkspace());
    const { data, addTeacher, updateTeacher, removeTeacher, addClassroom, updateClassroom, removeClassroom, addSubject, updateSubject, removeSubject, addLocation, updateLocation, removeLocation, addFixedAssignment, removeFixedAssignment, addLessonGroup, updateLessonGroup, removeLessonGroup, addDuty, updateDuty, removeDuty, importData, clearData, replaceData } = useTimetableData(initialSessionToken ? null : initialLocalWorkspace?.data);
    const [schedule, setSchedule] = useState<Schedule | null>(() => initialSessionToken ? null : initialLocalWorkspace?.schedule || null);
    const [solverStats, setSolverStats] = useState<SolverStats | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<Tab>('teachers');
    const [viewType, setViewType] = useState<ViewType>(ViewType.Class);
    const [viewMode, setViewMode] = useState<ViewMode>('single');
    const [pdfScope, setPdfScope] = useState<PrintScope>('selected');
    const [selectedHeaderId, setSelectedHeaderId] = useState<string>('');
    const [schoolHours, setSchoolHours] = useState<SchoolHours>(() => initialSessionToken ? createDefaultSchoolHours() : initialLocalWorkspace?.schoolHours || createDefaultSchoolHours());
    const [schoolHoursDraft, setSchoolHoursDraft] = useState<SchoolHoursDraft>(() => schoolHoursToDraft(initialSessionToken ? createDefaultSchoolHours() : initialLocalWorkspace?.schoolHours || createDefaultSchoolHours()));
    const [printInfo, setPrintInfo] = useState<PrintInfo>(() => (initialSessionToken ? null : initialLocalWorkspace?.printInfo) || createDefaultPrintInfo());
    const [modalState, setModalState] = useState<ModalState>({ type: null, item: null });
    const [sessionToken, setSessionToken] = useState<string | null>(initialSessionToken);
    const [sessionInfo, setSessionInfo] = useState<AuthSessionInfo | null>(null);
    // Kayitli oturum varsa ilk karede giris penceresi yanip sonmesin.
    const [sessionStatus, setSessionStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(initialSessionToken ? 'loading' : 'idle');
    const [sessionError, setSessionError] = useState<string | null>(null);
    const [codeInput, setCodeInput] = useState<string>('');
    const [verifyLoading, setVerifyLoading] = useState<boolean>(false);
    const [googleLoginLoading, setGoogleLoginLoading] = useState<boolean>(false);
    const [onboardSchoolName, setOnboardSchoolName] = useState<string>('');
    const [onboardLoading, setOnboardLoading] = useState<boolean>(false);
    const [showCodeLogin, setShowCodeLogin] = useState<boolean>(false);
    const [showPasswordLogin, setShowPasswordLogin] = useState<boolean>(false);
    const [passwordLoginEmail, setPasswordLoginEmail] = useState<string>('');
    const [passwordLoginSecret, setPasswordLoginSecret] = useState<string>('');
    const [passwordLoginLoading, setPasswordLoginLoading] = useState<boolean>(false);
    const [guestWebMode, setGuestWebMode] = useState<boolean>(() => {
        if (typeof window === 'undefined') return false;
        try {
            return window.localStorage.getItem(GUEST_WEB_MODE_KEY) === '1';
        } catch {
            return false;
        }
    });
    const [bridgeEmail, setBridgeEmail] = useState<string>('');
    const [bridgeName, setBridgeName] = useState<string>('');
    const [bridgeSchoolId, setBridgeSchoolId] = useState<string>('');
    const [bridgeCodeInfo, setBridgeCodeInfo] = useState<{ code: string; expiresAt: string } | null>(null);
    const [bridgeLoading, setBridgeLoading] = useState<boolean>(false);
    const [bridgeError, setBridgeError] = useState<string | null>(null);
    const [newSchoolName, setNewSchoolName] = useState<string>('');
    const [newSchoolStatus, setNewSchoolStatus] = useState<string>('');
    const [newSchoolLoading, setNewSchoolLoading] = useState<boolean>(false);
    const [webPortalStatus, setWebPortalStatus] = useState<string>('');
    const [activeSchoolId, setActiveSchoolId] = useState<number | null>(null);
    const isRemoteMode = Boolean(sessionToken && activeSchoolId);
    const [catalogStatus, setCatalogStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
    const [catalogError, setCatalogError] = useState<string | null>(null);
    const [catalogSyncStatus, setCatalogSyncStatus] = useState<'idle' | 'saving' | 'error'>('idle');
    const [catalogSyncError, setCatalogSyncError] = useState<string | null>(null);
    const [catalogNotice, setCatalogNotice] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const scheduleFileInputRef = useRef<HTMLInputElement>(null);
    const skipSyncCounterRef = useRef<number>(0);
    const pendingSyncRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const retrySyncRef = useRef<(() => void) | null>(null);
    const dirtyCatalogRef = useRef(false);
    const syncingCatalogRef = useRef(false);
    const dataRef = useRef<TimetableData>(data);
    // "Bu cihazdaki veriyi koru / yukle" yalniz, sayfa girissiz acilip sonra
    // giris yapildiginda ilk acilan okul icin sorulur. Kayitli oturumla acilista
    // (eski yerel taslak) ve okul degistirirken ekrandaki veri hicbir okula yuklenmez.
    const cloudReconciledRef = useRef<boolean>(Boolean(initialSessionToken));
    const justCreatedSchoolIdRef = useRef<number | null>(null);
    const schoolNamesRef = useRef<Record<number, string>>({});
    const schoolHoursRef = useRef<SchoolHours>(schoolHours);
    useEffect(() => {
        setSchoolHoursDraft(schoolHoursToDraft(schoolHours));
    }, [schoolHours]);

    useEffect(() => {
        dataRef.current = data;
    }, [data]);

    useEffect(() => {
        schoolHoursRef.current = schoolHours;
    }, [schoolHours]);

    const printInfoRef = useRef<PrintInfo>(printInfo);
    useEffect(() => {
        printInfoRef.current = printInfo;
    }, [printInfo]);

    useEffect(() => () => {
        if (pendingSyncRef.current) {
            clearTimeout(pendingSyncRef.current);
        }
    }, []);

    useEffect(() => {
        if (!isRemoteMode) {
            if (pendingSyncRef.current) {
                clearTimeout(pendingSyncRef.current);
                pendingSyncRef.current = null;
            }
            dirtyCatalogRef.current = false;
            syncingCatalogRef.current = false;
            skipSyncCounterRef.current = 0;
            return;
        }
    }, [isRemoteMode]);

    const performCatalogSync = useCallback(async () => {
        if (!isRemoteMode || !sessionToken || !activeSchoolId || catalogStatus !== 'ready') {
            return;
        }
        if (syncingCatalogRef.current) {
            return;
        }
        syncingCatalogRef.current = true;
        setCatalogSyncStatus('saving');
        setCatalogSyncError(null);
        try {
            await replaceCatalogApi(sessionToken, activeSchoolId, dataRef.current);
            await updateSchoolSettings(sessionToken, activeSchoolId, schoolHoursRef.current, printInfoRef.current);
            setCatalogSyncStatus('idle');
        } catch (err: any) {
            const message = err instanceof Error ? err.message : 'Bulut kaydi basarisiz';
            setCatalogSyncStatus('error');
            setCatalogSyncError(message);
            dirtyCatalogRef.current = true;
            // Gecici ag hatasi vb.: kullanici yeni degisiklik yapmasa da kendiliginden yeniden dene.
            if (!pendingSyncRef.current) {
                pendingSyncRef.current = setTimeout(() => {
                    pendingSyncRef.current = null;
                    if (!dirtyCatalogRef.current) return;
                    dirtyCatalogRef.current = false;
                    retrySyncRef.current?.();
                }, 5000);
            }
        } finally {
            syncingCatalogRef.current = false;
        }
    }, [isRemoteMode, sessionToken, activeSchoolId, catalogStatus]);
    retrySyncRef.current = performCatalogSync;

    const scheduleCatalogSync = useCallback(() => {
        if (!isRemoteMode || !sessionToken || !activeSchoolId || catalogStatus !== 'ready') {
            return;
        }
        dirtyCatalogRef.current = true;
        if (pendingSyncRef.current) {
            return;
        }
        pendingSyncRef.current = setTimeout(() => {
            pendingSyncRef.current = null;
            if (!dirtyCatalogRef.current) {
                return;
            }
            dirtyCatalogRef.current = false;
            performCatalogSync();
        }, 1000);
    }, [isRemoteMode, sessionToken, activeSchoolId, catalogStatus, performCatalogSync]);

    // Cikista bekleyen (1 sn gecikmeli) ya da basarisiz kalmis kaydi hemen gonderir.
    // Onceden cikis bekleyen kaydi iptal ediyordu ve son degisiklikler buluta hic gitmiyordu.
    const flushCatalogSync = useCallback(async (): Promise<boolean> => {
        if (!isRemoteMode || !sessionToken || !activeSchoolId || catalogStatus !== 'ready') {
            return true;
        }
        for (let i = 0; i < 100 && syncingCatalogRef.current; i++) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (!pendingSyncRef.current && !dirtyCatalogRef.current) {
            return true;
        }
        if (pendingSyncRef.current) {
            clearTimeout(pendingSyncRef.current);
            pendingSyncRef.current = null;
        }
        dirtyCatalogRef.current = false;
        syncingCatalogRef.current = true;
        setCatalogSyncStatus('saving');
        setCatalogSyncError(null);
        try {
            await replaceCatalogApi(sessionToken, activeSchoolId, dataRef.current);
            await updateSchoolSettings(sessionToken, activeSchoolId, schoolHoursRef.current, printInfoRef.current);
            setCatalogSyncStatus('idle');
            return true;
        } catch (err: any) {
            dirtyCatalogRef.current = true;
            setCatalogSyncStatus('error');
            setCatalogSyncError(err instanceof Error ? err.message : 'Bulut kaydi basarisiz');
            return false;
        } finally {
            syncingCatalogRef.current = false;
        }
    }, [isRemoteMode, sessionToken, activeSchoolId, catalogStatus]);

    // Kaydedilmemis degisiklik varken sekme/pencere kapatilirsa tarayici uyarsin.
    const catalogSyncStatusRef = useRef(catalogSyncStatus);
    catalogSyncStatusRef.current = catalogSyncStatus;
    useEffect(() => {
        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            if (pendingSyncRef.current || dirtyCatalogRef.current || catalogSyncStatusRef.current === 'saving') {
                event.preventDefault();
                event.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, []);

    useEffect(() => {
        if (!isRemoteMode) {
            return;
        }
        if (!sessionToken || !activeSchoolId) {
            return;
        }
        if (skipSyncCounterRef.current > 0) {
            skipSyncCounterRef.current = Math.max(0, skipSyncCounterRef.current - 1);
            return;
        }
        scheduleCatalogSync();
    }, [data, isRemoteMode, scheduleCatalogSync]);

    useEffect(() => {
        if (!isRemoteMode) {
            return;
        }
        if (skipSyncCounterRef.current > 0) {
            skipSyncCounterRef.current = Math.max(0, skipSyncCounterRef.current - 1);
            return;
        }
        scheduleCatalogSync();
    }, [schoolHours, isRemoteMode, scheduleCatalogSync]);

    useEffect(() => {
        if (!isRemoteMode) {
            return;
        }
        if (skipSyncCounterRef.current > 0) {
            skipSyncCounterRef.current = Math.max(0, skipSyncCounterRef.current - 1);
            return;
        }
        scheduleCatalogSync();
    }, [printInfo, isRemoteMode, scheduleCatalogSync]);

    useEffect(() => {
        if (!isRemoteMode) {
            setCatalogStatus('idle');
            setCatalogError(null);
            setCatalogSyncStatus('idle');
            setCatalogSyncError(null);
            setCatalogNotice(null);
            return;
        }
        if (!sessionToken || !activeSchoolId) {
            setCatalogStatus('idle');
            return;
        }
        let cancelled = false;
        setCatalogStatus('loading');
        setCatalogError(null);
        (async () => {
            try {
                const result = await fetchCatalogApi(sessionToken, activeSchoolId);
                if (cancelled) return;
                if (pendingSyncRef.current) {
                    clearTimeout(pendingSyncRef.current);
                    pendingSyncRef.current = null;
                }
                dirtyCatalogRef.current = false;

                const firstReconcile = !cloudReconciledRef.current;
                cloudReconciledRef.current = true;
                const justCreated = justCreatedSchoolIdRef.current === activeSchoolId;
                justCreatedSchoolIdRef.current = null;
                // Varsayilan ornek veri (Ali Yilmaz / 5-A / Turkce), var olan bir okul icin
                // "bu cihazdaki veri" sayilmaz; yoksa gercek bulut verisi ornekle ezilebilir.
                // Az once olusturulan bos okula ise yeni kullaniciya ornek olsun diye aktarilir.
                const localHasData = firstReconcile && (
                    justCreated ? !isCatalogEmpty(dataRef.current) : !isEmptyOrStarterData(dataRef.current)
                );
                const schoolName = schoolNamesRef.current[activeSchoolId] || `Okul #${activeSchoolId}`;

                if (localHasData) {
                    const local = dataRef.current;
                    const localSummary = `${local.teachers.length} öğretmen, ${local.classrooms.length} sınıf, ${local.subjects.length} ders`;
                    const cloudEmpty = isCatalogEmpty(result.data);

                    let keepLocal: boolean;
                    if (cloudEmpty && justCreated) {
                        // Kullanici okulu az once "bu cihazdaki veriler aktarilir" diyerek olusturdu.
                        keepLocal = true;
                    } else if (cloudEmpty) {
                        keepLocal = window.confirm([
                            `"${schoolName}" okulunun bulutta kaydı yok.`,
                            '',
                            `Bu cihazdaki verileri (${localSummary}) bu okula yüklemek ister misiniz?`,
                            '',
                            'TAMAM = Bu okula yükle',
                            'İPTAL = Yükleme, okulu boş aç',
                        ].join('\n'));
                    } else {
                        keepLocal = !window.confirm([
                            `Bu cihazda kayıtlı veriler var ve bulutta da "${schoolName}" okuluna ait veriler bulundu.`,
                            '',
                            `Bu cihaz: ${localSummary}`,
                            `Bulut: ${result.data.teachers.length} öğretmen, ${result.data.classrooms.length} sınıf, ${result.data.subjects.length} ders`,
                            '',
                            'TAMAM = Bulut verilerini kullan (bu cihazdakinin yerine geçer)',
                            `İPTAL = Bu cihazdaki verileri koru ve "${schoolName}" okuluna yükle`,
                        ].join('\n'));
                    }

                    if (keepLocal) {
                        setCatalogStatus('ready');
                        setCatalogSyncStatus('saving');
                        setCatalogSyncError(null);
                        setCatalogNotice(`Bu cihazdaki veriler "${schoolName}" okuluna yükleniyor...`);
                        try {
                            await replaceCatalogApi(sessionToken, activeSchoolId, dataRef.current);
                            await updateSchoolSettings(sessionToken, activeSchoolId, schoolHoursRef.current, printInfoRef.current);
                            if (cancelled) return;
                            setCatalogSyncStatus('idle');
                            setCatalogNotice(`Bu cihazdaki veriler "${schoolName}" okuluna yüklendi.`);
                        } catch (uploadErr: any) {
                            if (cancelled) return;
                            setCatalogSyncStatus('error');
                            setCatalogSyncError(
                                uploadErr instanceof Error ? uploadErr.message : 'Veriler buluta yuklenemedi'
                            );
                            setCatalogNotice(null);
                        }
                        return;
                    }
                }

                skipSyncCounterRef.current += 3;
                replaceData(result.data);
                setSchoolHours(result.schoolHours);
                setPrintInfo(result.printInfo || createDefaultPrintInfo());
                setSchedule(null);
                setSolverStats(null);
                setActiveScheduleName(null);
                setCatalogStatus('ready');
                setCatalogSyncStatus('idle');
                setCatalogSyncError(null);
                setCatalogNotice(
                    isCatalogEmpty(result.data)
                        ? 'Bulutta bu okul icin henuz kayit yok. Verileri girin veya telefon uygulamasindan yukleyin.'
                        : null
                );
            } catch (err: any) {
                if (cancelled) return;
                const message = err instanceof Error ? err.message : 'Bulut verileri yuklenemedi';
                setCatalogStatus('error');
                setCatalogError(message);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [isRemoteMode, sessionToken, activeSchoolId, replaceData]);

    useEffect(() => {
        if (!webPortalStatus) return;
        const timeout = setTimeout(() => setWebPortalStatus(''), 4000);
        return () => clearTimeout(timeout);
    }, [webPortalStatus]);

    const persistSessionToken = useCallback((token: string | null) => {
        if (token) {
            setSessionToken(token);
            if (typeof window !== 'undefined') {
                try {
                    localStorage.setItem('ozarik.session', token);
                } catch {
                    // pass
                }
            }
        } else {
            setSessionToken(null);
            if (typeof window !== 'undefined') {
                try {
                    localStorage.removeItem('ozarik.session');
                } catch {
                    // pass
                }
            }
        }
    }, []);

    const persistGuestWebMode = useCallback((next: boolean) => {
        setGuestWebMode(next);
        if (typeof window === 'undefined') return;
        try {
            if (next) {
                window.localStorage.setItem(GUEST_WEB_MODE_KEY, '1');
            } else {
                window.localStorage.removeItem(GUEST_WEB_MODE_KEY);
            }
        } catch {
            // ignore persistence failures
        }
    }, []);

    const clearSession = useCallback(() => {
        disableGoogleAutoSelect();
        persistSessionToken(null);
        setSessionInfo(null);
        setSessionStatus('idle');
        setSessionError(null);
        setActiveSchoolId(null);
    }, [persistSessionToken]);

    const handleSignOut = useCallback(async () => {
        const saved = await flushCatalogSync();
        if (!saved && !window.confirm('Son değişiklikler buluta kaydedilemedi. Yine de çıkış yapılsın mı? (Kaydedilmeyen değişiklikler kaybolur.)')) {
            return;
        }
        clearSession();
    }, [flushCatalogSync, clearSession]);

    const [substitutionAssignments, setSubstitutionAssignments] = useState<SubstitutionAssignment[]>(() => {
        if (typeof window === 'undefined') return [];
        try {
            const stored = localStorage.getItem('ozarik.substitutions');
            return stored ? JSON.parse(stored) as SubstitutionAssignment[] : [];
        } catch {
            return [];
        }
    });

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            localStorage.setItem('ozarik.substitutions', JSON.stringify(substitutionAssignments));
        } catch {
            // ignore persistence errors
        }
    }, [substitutionAssignments]);

    const handleAssignSubstitution = useCallback((assignment: SubstitutionAssignment) => {
        setSubstitutionAssignments((prev) => {
            const filtered = prev.filter(item => !(item.dayIndex === assignment.dayIndex && item.hourIndex === assignment.hourIndex && item.classroomId === assignment.classroomId));
            return [...filtered, assignment];
        });
    }, []);

    const handleCancelSubstitution = useCallback((assignmentId: string) => {
        setSubstitutionAssignments((prev) => prev.filter(item => item.id !== assignmentId));
    }, []);

    useEffect(() => {
        const schools = sessionInfo?.schools;
        if (!schools || schools.length === 0) return;
        const numericIds = schools
            .map((s: any) => Number(s.id))
            .filter((id) => !Number.isNaN(id));
        if (numericIds.length === 0) return;
        if (!activeSchoolId || !numericIds.includes(activeSchoolId)) {
            setActiveSchoolId(numericIds[0]);
        }
    }, [sessionInfo, activeSchoolId]);

    const [savedSchedules, setSavedSchedules] = useState<SavedSchedule[]>([]);
    const [activeScheduleName, setActiveScheduleName] = useState<string | null>(() => initialSessionToken ? null : initialLocalWorkspace?.activeScheduleName || null);
    const [localWorkspaceStatus, setLocalWorkspaceStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>(!initialSessionToken && initialLocalWorkspace ? 'saved' : 'idle');
    const [localWorkspaceSavedAt, setLocalWorkspaceSavedAt] = useState<string | null>(() => initialSessionToken ? null : initialLocalWorkspace?.savedAt || null);

    useEffect(() => {
        // Signed-in schools use the server catalog. Guest/local work is kept automatically.
        if (sessionToken) {
            setLocalWorkspaceStatus('idle');
            return;
        }
        setLocalWorkspaceStatus('saving');
        const timeout = window.setTimeout(() => {
            const savedAt = new Date().toISOString();
            try {
                saveLocalWorkspace({ data, schedule, schoolHours, activeScheduleName, printInfo, savedAt });
                setLocalWorkspaceSavedAt(savedAt);
                setLocalWorkspaceStatus('saved');
            } catch (saveError) {
                console.error('local-workspace-save-failed', saveError);
                setLocalWorkspaceStatus('error');
            }
        }, 400);
        return () => window.clearTimeout(timeout);
    }, [data, schedule, schoolHours, activeScheduleName, printInfo, sessionToken]);
    
    const maxDailyHours = useMemo(() => {
        const flat = (Object.values(schoolHours).flat() as number[]);
        return Math.max(...flat);
    }, [schoolHours]);
    const validation = useDataValidation(data, schoolHours);
    const { classroomLoads, teacherLoads } = useLoadCalculation(data, schoolHours);
    const actualTeacherLoads = useMemo(() => {
        if (!schedule) return null;
        const counts = new Map<string, number>();
        Object.values(schedule).forEach(days => {
            const dayArray = days as (Assignment | null)[][];
            dayArray.forEach(day => {
                day.forEach(slot => {
                    if (!slot) return;
                    slot.teacherIds.forEach(teacherId => {
                      const current = counts.get(teacherId) || 0;
                      counts.set(teacherId, current + 1);
                    });
                });
            });
        });
        return counts;
    }, [schedule]);

    // Per-teacher per-day counts and busiest day
    const teacherDailyCounts = useMemo(() => {
        if (!schedule) return null;
        const map = new Map<string, { countsPerDay: number[]; busiestDay: { dayIndex: number; count: number } | null }>();
        const daysByClass = Object.values(schedule) as (Assignment | null)[][][];
        const DAYS = daysByClass[0]?.length || 5;
        for (const teacher of data.teachers) map.set(teacher.id, { countsPerDay: Array(DAYS).fill(0), busiestDay: null });

        Object.values(schedule).forEach(days => {
            const dayArray = days as (Assignment | null)[][];
            dayArray.forEach((day, dIdx) => {
                day.forEach(slot => {
                    if (!slot) return;
                    slot.teacherIds.forEach(tid => {
                        const entry = map.get(tid);
                        if (entry) entry.countsPerDay[dIdx] = (entry.countsPerDay[dIdx] || 0) + 1;
                    });
                });
            });
        });

        for (const [tid, entry] of map.entries()) {
            let best = -1, idx = -1;
            for (let i = 0; i < entry.countsPerDay.length; i++) {
                if (entry.countsPerDay[i] > best) { best = entry.countsPerDay[i]; idx = i; }
            }
            entry.busiestDay = idx >= 0 ? { dayIndex: idx, count: best } : null;
        }

        return map;
    }, [schedule, data.teachers]);


    useEffect(() => {
        if (viewType === ViewType.Class && data.classrooms.length > 0) {
            setSelectedHeaderId(prev => data.classrooms.some(c => c.id === prev) ? prev : data.classrooms[0].id);
        } else if (viewType === ViewType.Teacher && data.teachers.length > 0) {
            setSelectedHeaderId(prev => data.teachers.some(t => t.id === prev) ? prev : data.teachers[0].id);
        }
    }, [viewType, data.classrooms, data.teachers]);

    useEffect(() => {
        if (!sessionToken) {
            setSessionInfo(null);
            setSessionStatus('idle');
            return;
        }
        let cancelled = false;
        setSessionStatus('loading');
        setSessionError(null);
        fetchSessionInfo(sessionToken)
            .then((info) => {
                if (cancelled) return;
                setSessionInfo(info);
                setSessionStatus('ready');
            })
            .catch((err) => {
                if (cancelled) return;
                console.error('session-check failed', err);
                setSessionError(err instanceof Error ? err.message : 'Oturum doğrulanamadı');
                setSessionStatus('error');
                if (initialLocalWorkspace) {
                    replaceData(initialLocalWorkspace.data);
                    setSchedule(initialLocalWorkspace.schedule);
                    setSchoolHours(initialLocalWorkspace.schoolHours);
                    setPrintInfo(initialLocalWorkspace.printInfo || createDefaultPrintInfo());
                    setActiveScheduleName(initialLocalWorkspace.activeScheduleName);
                }
                persistSessionToken(null);
                setSessionInfo(null);
            });
        return () => {
            cancelled = true;
        };
    }, [sessionToken, persistSessionToken, initialLocalWorkspace, replaceData]);

    useEffect(() => {
        if (sessionInfo?.user?.email && !bridgeEmail) {
            setBridgeEmail(sessionInfo.user.email);
        }
        if (sessionInfo?.user?.name && !bridgeName) {
            setBridgeName(sessionInfo.user.name || '');
        }
    }, [sessionInfo, bridgeEmail, bridgeName]);

    const handleAssignRandomRestDays = useCallback((teacherId: string, restCount: number) => {
        if (restCount <= 0) return;
        const teacher = data.teachers.find(t => t.id === teacherId);
        if (!teacher) return;

        const success = assignRandomRestDays(teacher, restCount, maxDailyHours);

        if (!success) {
            window.alert('İzin günü ayarlanamadı. Uygun gün bulunamadı veya izin günleri sınırı aşıldı.');
            return;
        }

        updateTeacher(teacher);

        const chosenNames = teacher.availability
            .map((day, idx) => day.every(slot => !slot) ? DAYS[idx] : null)
            .filter(Boolean)
            .join(', ');

        window.alert(`${teacher.name} için ${restCount} izin günü ayarlandı: ${chosenNames}.`);
    }, [data.teachers, updateTeacher, maxDailyHours]);

    const handleSchoolHoursChange = (level: SchoolLevel, dayIndex: number, value: string) => {
        const trimmed = value.trim();
        let draftValue = value;
        let numericValue: number | null = null;

        if (trimmed !== '') {
            const parsed = parseInt(trimmed, 10);
            if (!Number.isNaN(parsed)) {
                if (parsed > 16) {
                    numericValue = 16;
                    draftValue = '16';
                } else if (parsed >= 4) {
                    numericValue = parsed;
                }
            }
        }

        setSchoolHoursDraft(prev => {
            const updatedLevel = [...prev[level]];
            updatedLevel[dayIndex] = draftValue;
            return {
                ...prev,
                [level]: updatedLevel,
            };
        });

        if (numericValue !== null) {
            setSchoolHours(prev => {
                const updatedLevel = [...prev[level]];
                updatedLevel[dayIndex] = numericValue as number;
                return {
                    ...prev,
                    [level]: updatedLevel,
                };
            });
        }
    };

    const handleSchoolHoursBlur = (level: SchoolLevel, dayIndex: number) => {
        const draftValue = schoolHoursDraft[level]?.[dayIndex] ?? '';
        const parsed = parseInt(draftValue.trim(), 10);
        const finalValue = Number.isNaN(parsed) ? schoolHours[level][dayIndex] : clampSchoolHour(parsed);

        setSchoolHours(prev => {
            const updatedLevel = [...prev[level]];
            updatedLevel[dayIndex] = finalValue;
            return {
                ...prev,
                [level]: updatedLevel,
            };
        });

        setSchoolHoursDraft(prev => {
            const updatedLevel = [...prev[level]];
            updatedLevel[dayIndex] = finalValue.toString();
            return {
                ...prev,
                [level]: updatedLevel,
            };
        });
    };
    
    const handlePrintInfoChange = (field: keyof PrintInfo, value: string) => {
        setPrintInfo(prev => ({ ...prev, [field]: value }));
    };

    const handleClearAllData = () => {
        if (window.confirm("Mevcut tüm değişiklikleri atıp varsayılan örnek verilere geri dönmek istediğinizden emin misiniz? Kayıtlı versiyonlar da dahil olmak üzere tüm veriler silinecektir. Bu işlem geri alınamaz.")) {
            clearData();
            setSchedule(null);
            setSolverStats(null);
            setActiveScheduleName(null);
            setError(null);
            setSelectedHeaderId('');
            updateSavedSchedules([]);
        }
    };

    useEffect(() => {
        try {
            const saved = localStorage.getItem('timetable_versions');
            if (saved) {
                setSavedSchedules(JSON.parse(saved));
            }
        } catch (e) {
            console.error("Failed to load saved schedules from localStorage", e);
        }
    }, []);

    const updateSavedSchedules = (newSchedules: SavedSchedule[]) => {
        setSavedSchedules(newSchedules);
        try {
            localStorage.setItem('timetable_versions', JSON.stringify(newSchedules));
        } catch (e) {
            console.error("Failed to save schedules to localStorage", e);
        }
    };

    const handleScheduleImportClick = () => {
        scheduleFileInputRef.current?.click();
    };

    const handleScheduleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const text = e.target?.result;
                if (typeof text !== 'string') {
                    throw new Error("Dosya okunamadı.");
                }
                const parsed = JSON.parse(text);
                if (!parsed || !parsed.data || !parsed.schedule) {
                    throw new Error("JSON dosyasında veri ve program birlikte bulunmalıdır.");
                }
                importData(JSON.stringify({ data: parsed.data }));
                setSchedule(parsed.schedule);
                setSolverStats(parsed.stats || null);
                const derivedName = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : file.name.replace(/\.json$/i, '');
                setActiveScheduleName(derivedName || 'Dışarıdan Yüklenen Program');
                setError(null);

                const newSaved: SavedSchedule = {
                    id: `import-${Date.now()}`,
                    name: derivedName || 'Dışarıdan Yüklenen Program',
                    createdAt: new Date().toISOString(),
                    schedule: parsed.schedule,
                    data: parsed.data,
                };
                updateSavedSchedules([...savedSchedules, newSaved]);
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Program dosyası içeri aktarılırken bir hata oluştu.';
                setError(message);
            } finally {
                if (scheduleFileInputRef.current) {
                    scheduleFileInputRef.current.value = '';
                }
            }
        };
        reader.onerror = () => setError('Dosya okunurken bir hata oluştu.');
        reader.readAsText(file, 'UTF-8');
    };

    const handleVerifyBridgeCode = useCallback(async () => {
        const trimmed = codeInput.trim();
        if (trimmed.length < 4) {
            setSessionError('Geçerli bir kod girin');
            return;
        }
        setVerifyLoading(true);
        setSessionError(null);
        try {
            const info = await verifyBridgeCode({ code: trimmed });
            if (info.session_token) {
                persistSessionToken(info.session_token);
            }
            recordSignIn();
            persistGuestWebMode(false);
            setSessionInfo(info);
            setSessionStatus('ready');
            setCodeInput('');
            setBridgeCodeInfo(null);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Doğrulama başarısız';
            setSessionError(message);
            setSessionStatus('error');
        } finally {
            setVerifyLoading(false);
        }
    }, [codeInput, persistSessionToken, persistGuestWebMode]);

    const handleContinueWithoutLogin = useCallback(() => {
        setSessionError(null);
        setSessionStatus('idle');
        persistGuestWebMode(true);
    }, [persistGuestWebMode]);

    const handleGoogleCredential = useCallback(async (credential: string) => {
        setGoogleLoginLoading(true);
        setSessionError(null);
        try {
            const info = await loginWithGoogle(credential);
            if (info.session_token) {
                persistSessionToken(info.session_token);
            }
            recordSignIn();
            persistGuestWebMode(false);
            setSessionInfo(info);
            setSessionStatus('ready');
        } catch (err) {
            setSessionError(err instanceof Error ? err.message : 'Google ile giriş başarısız');
            setSessionStatus('error');
        } finally {
            setGoogleLoginLoading(false);
        }
    }, [persistSessionToken, persistGuestWebMode]);

    // Magaza incelemecileri Google hesabi olusturamadigi icin admin panelinden
    // acilan inceleme hesabiyla e-posta + sifre girisi.
    const handleReviewPasswordLogin = useCallback(async () => {
        const email = passwordLoginEmail.trim().toLowerCase();
        if (!email || !passwordLoginSecret) {
            setSessionError('E-posta ve şifreyi girin');
            return;
        }
        setPasswordLoginLoading(true);
        setSessionError(null);
        try {
            const info = await loginWithReviewPassword(email, passwordLoginSecret);
            if (info.session_token) {
                persistSessionToken(info.session_token);
            }
            recordSignIn();
            persistGuestWebMode(false);
            setSessionInfo(info);
            setSessionStatus('ready');
            setPasswordLoginSecret('');
        } catch (err) {
            setSessionError(err instanceof Error ? err.message : 'Giriş başarısız');
            setSessionStatus('error');
        } finally {
            setPasswordLoginLoading(false);
        }
    }, [passwordLoginEmail, passwordLoginSecret, persistSessionToken, persistGuestWebMode]);

    // Okulu olmayan hesap: okul olusturulup hesaba baglanir; bulut esitlemesi
    // (ve bu cihazdaki verinin yuklenmesi) okul secilince kendiliginden baslar.
    const handleOnboardSchool = useCallback(async () => {
        const name = onboardSchoolName.trim();
        if (name.length < 2) {
            setSessionError('Okulunuzun adını yazın');
            return;
        }
        if (!sessionToken) return;
        setOnboardLoading(true);
        setSessionError(null);
        try {
            const info = await createSchoolForSession(sessionToken, name);
            const createdIds = (info.schools ?? []).map((school) => Number(school.id)).filter((id) => !Number.isNaN(id));
            justCreatedSchoolIdRef.current = createdIds.length ? Math.max(...createdIds) : null;
            setSessionInfo((prev) => ({ ...info, session_token: prev?.session_token ?? info.session_token }));
            setOnboardSchoolName('');
        } catch (err) {
            setSessionError(err instanceof Error ? err.message : 'Okul kaydedilemedi');
        } finally {
            setOnboardLoading(false);
        }
    }, [onboardSchoolName, sessionToken]);

    const handleOpenWebPortal = useCallback(() => {
        if (typeof window !== 'undefined') {
            window.open(WEB_PORTAL_URL, '_blank');
        }
    }, []);

    const handleOpenWindowsStore = useCallback(() => {
        if (typeof window !== 'undefined') {
            window.open(WINDOWS_STORE_URL, '_blank');
        }
    }, []);

    const handleCopyWebPortalLink = useCallback(async () => {
        try {
            if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(WEB_PORTAL_URL);
                setWebPortalStatus('Baglanti panoya kopyalandi.');
            } else {
                setWebPortalStatus('Cihaz kopyalama desteklemiyor, adresi manuel girin.');
            }
        } catch {
            setWebPortalStatus('Baglanti panoya kopyalanamadi.');
        }
    }, []);

    const handleCreateSchool = useCallback(async () => {
        const name = newSchoolName.trim();
        if (!name) {
            setNewSchoolStatus('Okul adi gerekli');
            return;
        }
        setNewSchoolLoading(true);
        setNewSchoolStatus('');
        try {
            const response = await fetch(`${getApiBaseUrl()}/api/schools`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            if (!response.ok) {
                let message = response.statusText || 'Okul kaydedilemedi';
                try {
                    const data = await response.json();
                    if (data && typeof data.detail === 'string') {
                        message = data.detail;
                    }
                } catch {
                    // ignore parse errors
                }
                throw new Error(message);
            }
            const body = await response.json();
            if (body && body.id !== undefined) {
                setBridgeSchoolId(String(body.id));
                setNewSchoolStatus(`Okul kaydedildi. ID: ${body.id}`);
            } else {
                setNewSchoolStatus('Okul kaydedildi.');
            }
            setNewSchoolName('');
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Okul kaydedilemedi';
            setNewSchoolStatus(message);
        } finally {
            setNewSchoolLoading(false);
        }
    }, [newSchoolName]);

    const handleRequestBridgeCode = useCallback(async () => {
        const email = bridgeEmail.trim().toLowerCase();
        if (!email) {
            setBridgeError('E-posta adresi gerekli');
            return;
        }
        setBridgeLoading(true);
        setBridgeError(null);
        try {
            const payload: { email: string; name?: string; schoolId?: number } = { email };
            const nameTrimmed = bridgeName.trim();
            if (nameTrimmed) {
                payload.name = nameTrimmed;
            }
            const schoolTrimmed = bridgeSchoolId.trim();
            if (schoolTrimmed) {
                const parsedId = Number(schoolTrimmed);
                if (!Number.isNaN(parsedId)) {
                    payload.schoolId = parsedId;
                }
            }
            const response = await requestBridgeCode(payload);
            setBridgeCodeInfo({ code: response.code, expiresAt: response.expires_at });
            if (!bridgeName.trim() && response.user?.name) {
                setBridgeName(response.user.name);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Kod oluşturma başarısız';
            setBridgeError(message);
            setBridgeCodeInfo(null);
        } finally {
            setBridgeLoading(false);
        }
    }, [bridgeEmail, bridgeName, bridgeSchoolId]);
    // Varsayilan cozum suresi. Onceden 150 saniyeydi: hic ayar yapmayan kullanici
    // dogrudan en uzun sureyle basliyordu. Imkansiz kurallarda cozucu sureyi sonuna
    // kadar kullandigi icin en pahali denemeler basarisiz olanlardi (deneme basina
    // ~20 vCPU-dakika). 60 saniye ayni cevabi veriyor; daha uzun sure isteyen
    // "En iyi" profilini secebilir.
    const [optTime, setOptTime] = useState<number>(60);
    const [optSeedRatio, setOptSeedRatio] = useState<number>(0.15);
    const [optTabuTenure, setOptTabuTenure] = useState<number>(50);
    const [optTabuIter, setOptTabuIter] = useState<number>(2000);
    const [classicMode, setClassicMode] = useState<boolean>(false);
    // String inputs for better typing UX; clamp on blur
    const [timeText, setTimeText] = useState<string>(String(optTime));
    const [seedText, setSeedText] = useState<string>(String(optSeedRatio));
    const [tenureText, setTenureText] = useState<string>(String(optTabuTenure));
    const [iterText, setIterText] = useState<string>(String(optTabuIter));
    const [optStopFirst, setOptStopFirst] = useState<boolean>(true);
    const [useDeterministic, setUseDeterministic] = useState<boolean>(false);
    const [optRngSeed, setOptRngSeed] = useState<number>(1337);
    const [rngText, setRngText] = useState<string>('1337');
    const [optDisableLNS, setOptDisableLNS] = useState<boolean>(true);
    const [solverStrategy, setSolverStrategy] = useState<"repair"|"tabu"|"alns"|"cp">("cp");
    const [optDisableEdge, setOptDisableEdge] = useState<boolean>(true);
    const [relaxBlocksIfNeeded, setRelaxBlocksIfNeeded] = useState<boolean>(false);
    // CP-SAT (server) optional preferences – off by default; enable via simple toggles
    const [cpUseCustom, setCpUseCustom] = useState<boolean>(false);
    const [cpAllowSplit, setCpAllowSplit] = useState<boolean>(false);
    const [cpEdgeReduce, setCpEdgeReduce] = useState<boolean>(false);
    const [cpGapReduce, setCpGapReduce] = useState<boolean>(false);
    const [cpGapLimit, setCpGapLimit] = useState<'default' | '1' | '2'>('default');
    const [cpDailyMaxOn, setCpDailyMaxOn] = useState<boolean>(false);
    const [cpDailyMaxVal, setCpDailyMaxVal] = useState<string>('6');
    const [cpHelpOpen, setCpHelpOpen] = useState<boolean>(false);

    const [isMobileAdvancedOpen, setIsMobileAdvancedOpen] = useState<boolean>(false);
    const [isSmallScreen, setIsSmallScreen] = useState<boolean>(false);

    // Anonim kullanım sayımı: en fazla 12 saatte bir; hata olursa sessizce geçer.
    useEffect(() => { recordAppOpen(); }, []);

    // Uygulamanin bulundugu diger platformlar. Zaten uzerinde oldugun
    // platformun linkini gostermiyoruz.
    const platformLinks = useMemo(() => {
        const native = isNativeApp();
        const links: Array<{ label: string; url: string }> = [];
        if (native) {
            links.push({ label: 'Web paneli', url: WEB_PORTAL_URL });
            links.push({ label: 'Windows uygulamasi', url: WINDOWS_STORE_URL });
        } else {
            links.push({ label: 'Windows uygulamasi', url: WINDOWS_STORE_URL });
            links.push({ label: 'Android uygulamasi', url: PLAY_STORE_URL });
        }
        return links;
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return;
        }
        const mediaQuery = window.matchMedia('(min-width: 768px)');
        const update = (matches: boolean) => {
            if (matches) {
                setIsSmallScreen(false);
                setIsMobileAdvancedOpen(false);
            } else {
                setIsSmallScreen(true);
            }
        };
        update(mediaQuery.matches);
        const handler = (event: MediaQueryListEvent) => update(event.matches);
        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', handler);
            return () => mediaQuery.removeEventListener('change', handler);
        }
        mediaQuery.addListener(handler);
        return () => mediaQuery.removeListener(handler);
    }, []);

    // Load persisted CP-SAT toggles
    useEffect(() => {
        try {
            const raw = localStorage.getItem('cp_prefs');
            if (raw) {
                const p = JSON.parse(raw);
                if (typeof p.useCustom === 'boolean') setCpUseCustom(p.useCustom);
                if (typeof p.allowSplit === 'boolean') setCpAllowSplit(p.allowSplit);
                if (typeof p.edgeReduce === 'boolean') setCpEdgeReduce(p.edgeReduce);
                if (typeof p.gapReduce === 'boolean') setCpGapReduce(p.gapReduce);
                if (p.gapLimit === '1' || p.gapLimit === '2' || p.gapLimit === 'default') setCpGapLimit(p.gapLimit);
                if (typeof p.dailyMaxOn === 'boolean') setCpDailyMaxOn(p.dailyMaxOn);
                if (typeof p.dailyMaxVal === 'string') setCpDailyMaxVal(p.dailyMaxVal);
            }
        } catch {}
    }, []);

    // Persist CP-SAT toggles when changed
    useEffect(() => {
        try {
            const p = {
                useCustom: cpUseCustom,
                allowSplit: cpAllowSplit,
                edgeReduce: cpEdgeReduce,
                gapReduce: cpGapReduce,
                gapLimit: cpGapLimit,
                dailyMaxOn: cpDailyMaxOn,
                dailyMaxVal: cpDailyMaxVal,
            };
            localStorage.setItem('cp_prefs', JSON.stringify(p));
        } catch {}
    }, [cpUseCustom, cpAllowSplit, cpEdgeReduce, cpGapReduce, cpGapLimit, cpDailyMaxOn, cpDailyMaxVal]);
    const [showAnalyzer, setShowAnalyzer] = useState<boolean>(false);
    const [defaultMaxConsec, setDefaultMaxConsec] = useState<number | undefined>(3);
    const [showTeacherLoadSummary, setShowTeacherLoadSummary] = useState<boolean>(false);
    const [showTeacherActualLoad, setShowTeacherActualLoad] = useState<boolean>(false);
    const [showHeatmapPanel, setShowHeatmapPanel] = useState<boolean>(false);
    const [showDutyWarnings, setShowDutyWarnings] = useState<boolean>(false);
    const [showDutyCoverage, setShowDutyCoverage] = useState<boolean>(false);


    // Load saved settings
    useEffect(() => {
        try {
            const raw = localStorage.getItem('solver_settings');
            if (raw) {
                const s = JSON.parse(raw);
                if (typeof s.time === 'number') { setOptTime(s.time); setTimeText(String(s.time)); }
                if (typeof s.seed === 'number') { setOptSeedRatio(s.seed); setSeedText(String(s.seed)); }
                if (typeof s.tenure === 'number') { setOptTabuTenure(s.tenure); setTenureText(String(s.tenure)); }
                if (typeof s.iter === 'number') { setOptTabuIter(s.iter); setIterText(String(s.iter)); }
                if (typeof s.stopFirst === 'boolean') { setOptStopFirst(s.stopFirst); }
                if (typeof s.disableLNS === 'boolean') { setOptDisableLNS(s.disableLNS); }
                if (typeof s.disableEdge === 'boolean') { setOptDisableEdge(s.disableEdge); }
                if (typeof s.relaxBlocksIfNeeded === 'boolean') { setRelaxBlocksIfNeeded(s.relaxBlocksIfNeeded); }
                if (typeof s.defaultMaxConsec === 'number') { setDefaultMaxConsec(s.defaultMaxConsec); }
                if (typeof s.defaultMaxConsec === 'number') { setDefaultMaxConsec(s.defaultMaxConsec); }
            }
        } catch {}
    }, []);

    const saveSettingsAsDefault = () => {
        const s = { time: optTime, seed: optSeedRatio, tenure: optTabuTenure, iter: optTabuIter, stopFirst: optStopFirst, disableLNS: optDisableLNS, disableEdge: optDisableEdge, defaultMaxConsec, relaxBlocksIfNeeded };
        try { localStorage.setItem('solver_settings', JSON.stringify(s)); alert('Ayarlar varsayılan olarak kaydedildi.'); } catch {}
    };

    const applyProfile = (p: 'fast'|'balanced'|'max'|'classic') => {
        if (p==='fast') {
            setOptTime(45); setTimeText('45');
            setOptSeedRatio(0.12); setSeedText('0.12');
            setOptTabuTenure(60); setTenureText('60');
            setOptTabuIter(2500); setIterText('2500');
            setOptStopFirst(true);
            setClassicMode(false);
            setSolverStrategy('tabu');
        } else if (p==='balanced') {
            setOptTime(90); setTimeText('90');
            setOptSeedRatio(0.12); setSeedText('0.12');
            setOptTabuTenure(70); setTenureText('70');
            setOptTabuIter(3000); setIterText('3000');
            setOptStopFirst(false);
            setClassicMode(false);
            setSolverStrategy('alns');
        } else if (p==='classic') {
            setOptStopFirst(true);
            setOptDisableLNS(true);
            setOptDisableEdge(true);
            setClassicMode(true);
            setSolverStrategy('repair');
        } else {
            setOptTime(150); setTimeText('150');
            setOptSeedRatio(0.12); setSeedText('0.12');
            setOptTabuTenure(80); setTenureText('80');
            setOptTabuIter(3500); setIterText('3500');
            setOptStopFirst(false);
            setClassicMode(false);
            setSolverStrategy('tabu');
        }
    };

    const loadSampleData = async (name: 'ai'|'school') => {
        try {
            const res = await fetch(`sample-data/${name}.json`);
            if (!res.ok) throw new Error('Örnek dosya bulunamadı.');
            const json = await res.text();
            importData(json);
            setError(null); setSchedule(null); setSolverStats(null); setActiveScheduleName(null);
        } catch (e: any) {
            alert('Örnek veriyi yükleyemedim. Lütfen proje dizinine sample-data/ai.json ve sample-data/school.json ekleyin.');
        }
    };

    const handleGenerate = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        setSchedule(null);
        setSolverStats(null);
        setActiveScheduleName(null);
        try {
            let result;
            let localFallbackNote: string | null = null;
            try {
              // Sunucu tarafı CP-SAT tek varsayılan çözücüdür.
              let cpPrefs: any | undefined = undefined;
              if (cpUseCustom) {
                cpPrefs = {} as any;
                if (cpAllowSplit) cpPrefs.allowSameDaySplit = true;
                if (cpEdgeReduce) cpPrefs.edgeWeight = 2; // reduce first/last-hour use
                if (cpGapReduce) { cpPrefs.teacherGapWeight = 4; cpPrefs.nogapWeight = 3; }
                if (cpGapLimit !== 'default') cpPrefs.maxTeacherGapHours = Number(cpGapLimit);
                const dm = parseInt(cpDailyMaxVal);
                if (cpDailyMaxOn && Number.isFinite(dm) && dm > 0) cpPrefs.teacherDailyMaxHours = dm;
              }
              const totalTime = Math.min(optTime, 180);
              const hasDefinedBlocks = data.subjects.some((subject) =>
                subject.blockHours > 0 || (subject.tripleBlockHours ?? 0) > 0
              );
              const shouldTryRelaxedBlocks = relaxBlocksIfNeeded && hasDefinedBlocks;
              const strictTime = shouldTryRelaxedBlocks
                ? Math.max(5, Math.floor(totalTime * 0.65))
                : totalTime;
              result = await solveTimetableCP(
                data,
                schoolHours,
                strictTime,
                { maxConsec: defaultMaxConsec },
                cpPrefs,
                optStopFirst,
                // Teşhis yalnız son denemede istenir. Blok esnetmeli ikinci deneme
                // yapılacaksa sebebi orada ararız, yoksa iki kez koşar.
                !shouldTryRelaxedBlocks
              );
              if (!result.schedule && shouldTryRelaxedBlocks) {
                const relaxedData: TimetableData = {
                  ...data,
                  subjects: data.subjects.map((subject) => ({
                    ...subject,
                    blockHours: 0,
                    tripleBlockHours: 0,
                  })),
                };
                const relaxedTime = Math.max(5, totalTime - strictTime);
                const relaxedResult = await solveTimetableCP(
                  relaxedData,
                  schoolHours,
                  relaxedTime,
                  { maxConsec: defaultMaxConsec },
                  cpPrefs,
                  optStopFirst,
                  true
                );
                if (relaxedResult.schedule) {
                  relaxedResult.stats.notes = [
                    ...(relaxedResult.stats.notes ?? []),
                    'Bloklar esnetildi: Tanımlı 2\'li ve 3\'lü bloklar yer bulamadığı için ders saatleri bölünebildi.',
                  ];
                } else {
                  relaxedResult.stats.notes = [
                    ...(result.stats?.notes ?? []),
                    ...(relaxedResult.stats.notes ?? []),
                    'Önce tanımlı bloklarla, ardından bloklar esnetilerek denendi; çözüm bulunamadı.',
                  ];
                }
                result = relaxedResult;
              }
            } catch (cpErr: any) {
              // Sunucuya ulaşılamadı / meşgul: tarayıcı içi yedek çözücüye düş.
              const detail = cpErr instanceof Error ? cpErr.message : String(cpErr ?? '');
              const busy = /solver-busy/i.test(detail);
              // Ham hata metni İngilizce geliyordu ("Failed to fetch" gibi) ve
              // kullanıcıya olduğu gibi gösteriliyordu. Bilinen durumları Türkçe
              // karşılıklarıyla anlatıyoruz.
              const sebep = /failed to fetch|networkerror|load failed/i.test(detail)
                ? 'internet bağlantısı kurulamadı'
                : /timeout|zaman/i.test(detail)
                  ? 'sunucu zamanında cevap vermedi'
                  : /\b5\d\d\b/.test(detail)
                    ? 'sunucu hata verdi'
                    : 'bağlantı kurulamadı';
              localFallbackNote = busy
                ? 'Sunucu çözücüsü şu an meşgul; program tarayıcıdaki yedek çözücüyle oluşturuldu. Daha iyi sonuç için biraz sonra tekrar deneyin.'
                : `Sunucu çözücüsüne ulaşılamadı (${sebep}); program tarayıcıdaki yedek çözücüyle oluşturuldu.`;
            }
            if (localFallbackNote) {
              result = await solveTimetableLocally(data, { 
              schoolHours,
              timeLimitSeconds: optTime,
              strategy: classicMode ? 'repair' : (solverStrategy === 'cp' ? 'tabu' : solverStrategy),
              seedRatio: optSeedRatio,
              tabu: { tenure: optTabuTenure, iterations: optTabuIter },
              stopAtFirstSolution: classicMode ? true : optStopFirst,
              randomSeed: useDeterministic ? optRngSeed : undefined,
              disableLNS: classicMode ? true : optDisableLNS,
              disableTeacherEdgePenalty: classicMode ? true : optDisableEdge,
              teacherSpreadWeight: classicMode ? 0 : 1,
              teacherEdgeWeight: classicMode ? 0 : 1,
              allowBlockRelaxation: relaxBlocksIfNeeded,
              allowSameDaySplit: cpUseCustom && cpAllowSplit,
              });
            }
            
            const displayStats: SolverStats = {
                ...result.stats,
                notes: [
                    ...(localFallbackNote ? [localFallbackNote] : []),
                    ...(result.stats.notes ?? []).map(explainSolverNote),
                ],
            };
            setSolverStats(displayStats);
            recordSolve({
                solver: localFallbackNote ? 'local' : 'cpsat',
                success: Boolean(result.schedule),
                classrooms: data.classrooms.length,
                teachers: data.teachers.length,
                reason: result.schedule ? undefined : (displayStats.diagnosis?.blocker || undefined),
            });

            if (result.schedule) {
                setSchedule(result.schedule);
            } else {
                // Teşhis varsa EN BAŞA alınır. Kullanıcı ilk satırda ne yapacağını
                // görmeli; "status=INFEASIBLE" çevirisi ve teknik notlar arkada kalsın.
                const tani = displayStats.diagnosis;
                const digerNotlar = (displayStats.notes ?? []).filter((n) => n !== tani?.message);
                const errorMsg = tani?.message
                  ? [tani.message, ...digerNotlar].join(' | ')
                  : (digerNotlar.join(' | ') || "Çözüm bulunamadı. Kısıtlar çok sıkı olabilir.");
                setError(errorMsg);
            }
        } catch (err: any) {
            // Buraya program üretimi başlamadan düşen hatalar geliyor ve eskiden
            // kullanıcıya JavaScript'in İngilizce metni gösteriliyordu. Ayrıca bu
            // çökmeler sayıma hiç yazılmıyordu, yani kaç kez olduğu bilinmiyordu.
            const detay = err?.message ? String(err.message) : '';
            setError(
                'Program oluşturulurken beklenmeyen bir hata oldu. Tekrar deneyin; sorun sürerse ekran görüntüsüyle bize yazın.'
                + (detay ? ` (Teknik ayrıntı: ${detay})` : '')
            );
            recordSolve({
                solver: 'cpsat',
                success: false,
                classrooms: data.classrooms.length,
                teachers: data.teachers.length,
                reason: 'crash',
            });
        } finally {
            setIsLoading(false);
        }
    }, [data, schoolHours, optTime, optSeedRatio, optTabuTenure, optTabuIter, optStopFirst, classicMode, solverStrategy, useDeterministic, optRngSeed, optDisableLNS, optDisableEdge, cpUseCustom, cpAllowSplit, cpEdgeReduce, cpGapReduce, cpGapLimit, cpDailyMaxOn, cpDailyMaxVal, defaultMaxConsec, relaxBlocksIfNeeded]);
    
    const handleExportData = async () => {
        try {
            await saveTextFile(JSON.stringify({ data }, null, 2), "ders-programi-verileri.json");
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Veriler disa aktarilamadi.');
        }
    };

    const handleExportSchedule = async () => {
        if (!schedule) return;
        try {
            await saveTextFile(JSON.stringify({ data, schedule }, null, 2), "ders-programi.json");
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Program disa aktarilamadi.');
        }
    };

    const handleExportPdf = async () => {
        if (!schedule) {
            alert('Önce ders programı oluşturun.');
            return;
        }
        try {
            const { doc, fileName } = await buildSchedulePdf({
                schedule,
                data,
                schoolHours,
                maxDailyHours,
                mode: pdfScope,
                viewType,
                selectedHeaderId,
                viewMode,
                printInfo: effectivePrintInfo,
            });
            const blob = doc.output('blob') as Blob;
            await saveOrShareFile({ blob, fileName, title: 'Ders Programi' });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'PDF oluşturulurken bir hata oluştu.';
            alert(message);
        }
    };

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const text = e.target?.result;
                if (typeof text !== 'string') {
                    throw new Error("Dosya okunamadı.");
                }
                importData(text);
                setError(null);
                setSchedule(null);
                setSolverStats(null);
                setActiveScheduleName(null);
            } catch (err: any) {
                setError(err.message || "JSON dosyası işlenirken bir hata oluştu.");
            }
        };
        reader.onerror = () => {
             setError("Dosya okunurken bir hata oluştu.");
        }
        reader.readAsText(file, 'UTF-8');
        
        event.target.value = '';
    };

    const handleQrImportText = (text: string) => {
        try {
            const obj = JSON.parse(text);
            if (!obj || !obj.data) throw new Error('Geçersiz QR veri formatı');
            importData(JSON.stringify({ data: obj.data }));
            if (obj.schedule) {
                setSchedule(obj.schedule);
                setActiveScheduleName('QR ile İçe Aktarılan');
            } else {
                setSchedule(null);
                setActiveScheduleName(null);
            }
            setSolverStats(null);
            setError(null);
            alert('QR içeriği başarıyla içe aktarıldı.');
        } catch (e: any) {
            setError(e?.message || 'QR içeriği çözümlenemedi.');
        }
    };

    const [moveFeedback, setMoveFeedback] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
    useEffect(() => {
        if (!moveFeedback) return;
        const timeout = setTimeout(() => setMoveFeedback(null), moveFeedback.kind === 'ok' ? 3000 : 6000);
        return () => clearTimeout(timeout);
    }, [moveFeedback]);

    const handleIsMoveValid = useCallback((sourceInfo: any, targetInfo: any): boolean => {
        if (!schedule) return false;
        return planMove(schedule, { data, schoolHours, defaultMaxConsec }, sourceInfo, targetInfo).ok;
    }, [schedule, data, schoolHours, defaultMaxConsec]);

    const handleManualDrop = (sourceInfo: any, targetInfo: any) => {
        if (!schedule) return;
        const plan = planMove(schedule, { data, schoolHours, defaultMaxConsec }, sourceInfo, targetInfo);
        if (plan.ok === false) {
            if (plan.reason !== 'Ders zaten bu saatte.') {
                setMoveFeedback({ kind: 'error', text: plan.reason });
            }
            return;
        }
        setSchedule(plan.schedule);
        setSolverStats(null); // Manual change invalidates the report
        setActiveScheduleName(prev => prev ? `${prev.replace(' (değiştirildi)','')} (değiştirildi)` : 'Yeni Program (değiştirildi)');
        setMoveFeedback({ kind: 'ok', text: plan.swapped ? 'İki ders yer değiştirdi.' : 'Ders taşındı.' });
    };
    
    const handleSaveSchedule = () => {
        if (!schedule) return;
        const defaultName = activeScheduleName ? activeScheduleName.replace(' (değiştirildi)','') : `Versiyon ${new Date().toLocaleDateString('tr-TR')}`;
        const name = prompt("Program versiyonu için bir isim girin:", defaultName);
        if (name) {
            const newSave: SavedSchedule = {
                id: `sch_${Date.now()}`,
                name,
                createdAt: new Date().toISOString(),
                schedule: JSON.parse(JSON.stringify(schedule)), // Deep copy
                data: JSON.parse(JSON.stringify(data)), // Deep copy data context
            };
            updateSavedSchedules([...savedSchedules, newSave]);
            setActiveScheduleName(name);
            alert(`'${name}' adıyla program kaydedildi.`);
        }
    };

    const handleLoadSchedule = (scheduleId: string) => {
        const toLoad = savedSchedules.find(s => s.id === scheduleId);
        if (toLoad) {
            const dataToImport = { data: toLoad.data };
            importData(JSON.stringify(dataToImport));
            setSchedule(toLoad.schedule);
            setSolverStats(null);
            setActiveScheduleName(toLoad.name);
            setError(null);
            document.getElementById('schedule-container')?.scrollIntoView({ behavior: 'smooth' });
        }
    };
    
    const handleDeleteSchedule = (scheduleId: string) => {
        if (window.confirm("Bu kayıtlı programı silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.")) {
            const toDelete = savedSchedules.find(s => s.id === scheduleId);
            updateSavedSchedules(savedSchedules.filter(s => s.id !== scheduleId));
            
            if (toDelete && schedule && activeScheduleName && activeScheduleName.startsWith(toDelete.name)) {
                setSchedule(null);
                setSolverStats(null);
                setActiveScheduleName(null);
            }
        }
    };

    const handlePrint = async () => {
        // Android WebView'de window.print() calismaz; PDF uretip sistem
        // paylasim sayfasini aciyoruz (oradan yazdirma da secilebilir).
        if (isNativeApp()) {
            await handleExportPdf();
            return;
        }
        window.print();
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

    const renderTabs = () => (
      <div className="flex border-b border-slate-200 overflow-x-auto">
        {(['teachers', 'classrooms', 'subjects', 'locations', 'fixedAssignments', 'lessonGroups', 'duties'] as Tab[]).map(tab => (
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
    
    const renderContent = () => {
      const getTitle = (tab: Tab) => ({
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
        let cardList: React.ReactNode[] | null = null;
        let cardTitle: string | null = null;
        let cardDescription: string | null = null;
        
        const classroomErrors = [...validation.incompleteClasses, ...validation.overflowingClasses]
            .reduce((acc, err) => ({...acc, [err.id]: err.message}), {} as Record<string, string>);
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
            <td className={`px-4 py-3 whitespace-nowrap font-medium ${load.demand > load.capacity ? 'text-red-600' : 'text-slate-600'}`}>
                {Math.round(load.demand)} / {load.capacity} saat
                {item.maxWeeklyHours && <span className="ml-1 text-[10px] font-normal text-slate-500">(üst sınır {item.maxWeeklyHours})</span>}
            </td>
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
    const shortDayLabels = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum'];
    cardTitle = 'Öğretmenler';
                cardDescription = 'Temel bilgiler ve hızlı izin işlemleri';
                cardList = data.teachers.map(item => {
        const load = teacherLoads.get(item.id) || { demand: 0, capacity: 0 };
        const branches = item.branches.filter(Boolean);
        const availabilityMatrix = Array.isArray(item.availability) ? item.availability : [];
        const availableDays = availabilityMatrix
            .map((slots, index) => (Array.isArray(slots) && slots.some(Boolean) ? shortDayLabels[index] : null))
            .filter((label): label is string => Boolean(label));
        const totalAvailability = availabilityMatrix.reduce((sum, slots) => sum + (Array.isArray(slots) ? slots.filter(Boolean).length : 0), 0);
        return (
            <div key={item.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h3 className="text-base font-semibold text-slate-800">{item.name}</h3>
                        <p className="text-xs text-slate-500 mt-1">
                            {branches.length ? branches.join(', ') : 'Branş belirtilmemiş'}
                        </p>
                    </div>
                    <div className="flex items-center gap-1">
                        <button onClick={() => handleOpenModal(activeTab, item)} className="p-1 text-slate-500 hover:text-sky-600" title="Düzenle">
                            <PencilIcon className="w-4 h-4" />
                        </button>
                        <button onClick={() => onRemove(item.id)} className="p-1 text-slate-500 hover:text-red-600" title="Sil">
                            <TrashIcon className="w-4 h-4" />
                        </button>
                    </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                    <button onClick={() => handleAssignRandomRestDays(item.id, 1)} className="px-2 py-1 text-xs font-medium rounded border border-slate-200 text-slate-600 hover:bg-slate-100">1 Gün İzin</button>
                    <button onClick={() => handleAssignRandomRestDays(item.id, 2)} className="px-2 py-1 text-xs font-medium rounded border border-slate-200 text-slate-600 hover:bg-slate-100">2 Gün İzin</button>
                    {item.canTeachMiddleSchool && <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-800">Ortaokul</span>}
                    {item.canTeachHighSchool && <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-800">Lise</span>}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-y-2 gap-x-4 text-xs text-slate-600">
                    <div>
                        <span className="block text-slate-500 font-medium">Haftalık yük</span>
                        <span>{Math.round(load.demand)} / {load.capacity} saat</span>
                        {item.maxWeeklyHours && <span className="block text-[10px] text-slate-500">Tanımlı üst sınır: {item.maxWeeklyHours}</span>}
                    </div>
                    <div>
                        <span className="block text-slate-500 font-medium">Müsait slot</span>
                        <span>{totalAvailability} saat</span>
                    </div>
                    <div className="col-span-2">
                        <span className="block text-slate-500 font-medium">Müsait günler</span>
                        <span>{availableDays.length ? availableDays.join(', ') : 'Belirtilmemiş'}</span>
                    </div>
                </div>
            </div>
        );
    });
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
    cardTitle = 'Sınıflar';
    cardDescription = 'Yük durumu ve sınıf öğretmeni bilgileri';
    cardList = data.classrooms.map(item => {
        const load = classroomLoads.get(item.id) || { demand: 0, capacity: 0 };
        const subjectsForClass = data.subjects.filter(subject => subject.assignedClassIds.includes(item.id));
        const teacherName = data.teachers.find(t => t.id === item.homeroomTeacherId)?.name;
        return (
            <div key={item.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h3 className="text-base font-semibold text-slate-800">{item.name}</h3>
                        <p className="text-xs text-slate-500 mt-1">{item.level} · {item.group}</p>
                    </div>
                    <div className="flex items-center gap-1">
                        <button onClick={() => handleOpenModal(activeTab, item)} className="p-1 text-slate-500 hover:text-sky-600" title="Düzenle">
                            <PencilIcon className="w-4 h-4" />
                        </button>
                        <button onClick={() => onRemove(item.id)} className="p-1 text-slate-500 hover:text-red-600" title="Sil">
                            <TrashIcon className="w-4 h-4" />
                        </button>
                    </div>
                </div>
                <div className="mt-3 text-xs text-slate-600">
                    <span className="block text-slate-500 font-medium">Sınıf öğretmeni</span>
                    <span>{teacherName ?? 'Atanmamış'}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className={`px-2 py-0.5 rounded-full font-medium ${load.demand > load.capacity ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {load.demand}/{load.capacity} saat
                    </span>
                    {classroomErrors[item.id] && <span className="px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">Denge uyarısı</span>}
                </div>
                <div className="mt-4 text-xs text-slate-600">
                    <span className="block text-slate-500 font-medium">Dersler</span>
                    <span>{subjectsForClass.length ? subjectsForClass.map(subject => subject.name).join(', ') : 'Atanmamış'}</span>
                </div>
            </div>
        );
    });
    break;
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
           <td className="px-4 py-3 text-xs">{item.assignedClassIds.map(id => data.classrooms.find(c=>c.id === id)?.name).filter(Boolean).join(', ') || '-'}</td>
           <td className="px-4 py-3 whitespace-nowrap">{item.locationId ? data.locations.find(l => l.id === item.locationId)?.name : '-'}</td>
           <td className="px-4 py-3 whitespace-nowrap">
               <button onClick={() => handleOpenModal(activeTab, item)} className="p-1 text-slate-500 hover:text-sky-600"><PencilIcon className="w-4 h-4" /></button>
               <button onClick={() => onRemove(item.id)} className="p-1 text-slate-500 hover:text-red-600"><TrashIcon className="w-4 h-4" /></button>
           </td>
       </tr>
   ));
    cardTitle = 'Dersler';
    cardDescription = 'Haftalık saatler ve atanan sınıflar';
    cardList = data.subjects.map(item => {
        const assignedClasses = item.assignedClassIds.map(id => data.classrooms.find(c => c.id === id)?.name).filter(Boolean);
        const locationName = item.locationId ? data.locations.find(l => l.id === item.locationId)?.name : undefined;
        return (
            <div key={item.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h3 className="text-base font-semibold text-slate-800">{item.name}</h3>
                        <p className="text-xs text-slate-500 mt-1">Haftalık {item.weeklyHours} saat</p>
                    </div>
                    <div className="flex items-center gap-1">
                        <button onClick={() => handleOpenModal(activeTab, item)} className="p-1 text-slate-500 hover:text-sky-600" title="Düzenle">
                            <PencilIcon className="w-4 h-4" />
                        </button>
                        <button onClick={() => onRemove(item.id)} className="p-1 text-slate-500 hover:text-red-600" title="Sil">
                            <TrashIcon className="w-4 h-4" />
                        </button>
                    </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    {item.blockHours > 0 && <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-800">Blok {item.blockHours}</span>}
                    {item.tripleBlockHours > 0 && <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-800">3'lü blok {item.tripleBlockHours}</span>}
                    {item.pinnedTeacherByClassroom && Object.keys(item.pinnedTeacherByClassroom).length > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">Sabit öğretmenler var</span>
                    )}
                </div>
                <div className="mt-4 text-xs text-slate-600 space-y-1">
                    <div>
                        <span className="block text-slate-500 font-medium">Sınıflar</span>
                        <span>{assignedClasses.length ? assignedClasses.join(', ') : 'Atanmamış'}</span>
                    </div>
                    <div>
                        <span className="block text-slate-500 font-medium">Mekan</span>
                        <span>{locationName ?? 'Belirtilmemiş'}</span>
                    </div>
                </div>
            </div>
        );
    });
    break;
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
    cardTitle = 'Grup dersleri';
    cardDescription = 'Blok dersler ve dahil edilen sınıflar';
    cardList = data.lessonGroups.map(item => {
        const subjectName = data.subjects.find(s => s.id === item.subjectId)?.name;
        const classNames = item.classroomIds.map(id => data.classrooms.find(c => c.id === id)?.name).filter(Boolean);
        return (
            <div key={item.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h3 className="text-base font-semibold text-slate-800">{item.name}</h3>
                        <p className="text-xs text-slate-500 mt-1">{subjectName ?? 'Ders seçilmemiş'}</p>
                    </div>
                    <div className="flex items-center gap-1">
                        <button onClick={() => handleOpenModal(activeTab, item)} className="p-1 text-slate-500 hover:text-sky-600" title="Düzenle">
                            <PencilIcon className="w-4 h-4" />
                        </button>
                        <button onClick={() => onRemove(item.id)} className="p-1 text-slate-500 hover:text-red-600" title="Sil">
                            <TrashIcon className="w-4 h-4" />
                        </button>
                    </div>
                </div>
                <div className="mt-3 text-xs text-slate-600 flex flex-wrap gap-2">
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{item.weeklyHours} saat</span>
                    {item.isBlock && <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-800">Blok</span>}
                </div>
                <div className="mt-4 text-xs text-slate-600">
                    <span className="block text-slate-500 font-medium">Sınıflar</span>
                    <span>{classNames.length ? classNames.join(', ') : 'Atanmamış'}</span>
                </div>
            </div>
        );
    });
    break;
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
    cardTitle = 'Görevler';
    cardDescription = 'Nöbet ve ek görev planları';
    cardList = data.duties.map(item => {
        const teacherName = data.teachers.find(t => t.id === item.teacherId)?.name;
        return (
            <div key={item.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h3 className="text-base font-semibold text-slate-800">{item.name}</h3>
                        <p className="text-xs text-slate-500 mt-1">{teacherName ?? 'Öğretmen atanmadı'}</p>
                    </div>
                    <div className="flex items-center gap-1">
                        <button onClick={() => handleOpenModal(activeTab, item)} className="p-1 text-slate-500 hover:text-sky-600" title="Düzenle">
                            <PencilIcon className="w-4 h-4" />
                        </button>
                        <button onClick={() => onRemove(item.id)} className="p-1 text-slate-500 hover:text-red-600" title="Sil">
                            <TrashIcon className="w-4 h-4" />
                        </button>
                    </div>
                </div>
                <div className="mt-3 text-xs text-slate-600">
                    <span className="block text-slate-500 font-medium">Zaman</span>
                    <span>{DAYS[item.dayIndex]}, {item.hourIndex + 1}. ders</span>
                </div>
            </div>
        );
    });
    break;
                break;
        }

        const tableWrapperClass = cardList ? 'hidden md:block overflow-x-auto' : 'overflow-x-auto';

        return (
            <>
                <div className={tableWrapperClass}>
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
                {cardList && (
                    <div className="md:hidden space-y-3 mt-4">
                        {cardTitle && <h3 className="text-sm font-semibold text-slate-700">{cardTitle}</h3>}
                        {cardDescription && <p className="text-xs text-slate-500">{cardDescription}</p>}
                        {cardList}
                    </div>
                )}
            </>
        )
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
            <QuickCommandBar data={data} onApply={replaceData} />
            <div className="mt-4">{renderTable()}</div>
        </div>
      );
    };
    
    const renderSavedSchedules = () => {
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
                        {savedSchedules.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(saved => (
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
        )
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
    
    const sessionLoading = sessionStatus === 'loading';
    const nativeApp = isNativeApp();
    const requiresWebAuth = !sessionInfo && !sessionLoading
        && (REQUIRE_SIGN_IN || (!isSmallScreen && !guestWebMode));
    const needsSchoolOnboarding = Boolean(sessionInfo)
        && (sessionInfo?.schools?.length ?? 0) === 0
        && (sessionInfo?.user?.role ?? 'admin') !== 'teacher';
    const hasLocalWorkspaceData = !isEmptyOrStarterData(data);
    const activeSessionUser = sessionInfo?.user;
    const schoolOptions = sessionInfo?.schools ?? [];
    schoolNamesRef.current = Object.fromEntries(
        schoolOptions.map((school, index) => [Number(school.id), school.name || `Okul #${school.id ?? index + 1}`]),
    );
    // Okul adi bos birakilirsa PDF'te buluttaki okul adi kullanilir.
    const cloudSchoolName = activeSchoolId ? (sessionInfo?.schools ?? []).find(s => Number(s.id) === activeSchoolId)?.name ?? '' : '';
    const effectivePrintInfo: PrintInfo = {
        ...printInfo,
        schoolName: printInfo.schoolName.trim() || cloudSchoolName,
    };
    const bridgeCodeExpiryText = bridgeCodeInfo ? new Date(bridgeCodeInfo.expiresAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';

    const viewOptions = useMemo(() => {
        if (viewType === ViewType.Class) return data.classrooms;
        return data.teachers;
    }, [viewType, data.classrooms, data.teachers]);

    const SolverReport: React.FC<{ stats: SolverStats }> = ({ stats }) => {
        const reasonLabels: Record<keyof SolverStats['invalidReasons'], string> = {
            levelMismatch: 'Seviye Uyuşmazlığı',
            availability: 'Öğretmen Müsaitliği',
            classBusy: 'Sınıf Meşgul',
            teacherBusy: 'Öğretmen Meşgul',
            locationBusy: 'Mekan Meşgul',
            blockBoundary: 'Blok Ders Sınırı',
            sameDay: 'Aynı gün kuralı (bölünme / eşleşmiş ders)',
        };
    
        const topReasons = (Object.entries(stats.invalidReasons) as Array<[keyof SolverStats['invalidReasons'], number]>)
            .map(([key, value]) => ({ key, value }))
            .filter((item) => item.value > 0)
            .sort((a, b) => b.value - a.value)
            .slice(0, 3);
    
        return (
            <div className="bg-white p-6 rounded-lg shadow-lg no-print">
                <h2 className="text-xl font-bold mb-4 text-slate-800">Çözüm Raporu</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                    <div className="bg-slate-50 p-4 rounded-lg">
                        <p className="text-slate-500 font-medium">Süre</p>
                        {/* Ham deger 1.6799871921539307 gibi geliyordu; tek hane yeter. */}
                        <p className="text-2xl font-bold text-sky-600">{Number(stats.elapsedSeconds ?? 0).toFixed(1)} s</p>
                        {typeof stats.firstSolutionSeconds === 'number' && stats.firstSolutionSeconds! > 0 && (
                          <p className="text-slate-600">İlk çözüm: {stats.firstSolutionSeconds.toFixed(1)} s</p>
                        )}
                    </div>
                    <div className="bg-slate-50 p-4 rounded-lg">
                        <p className="text-slate-500 font-medium">Performans</p>
                        {/* Sunucudaki CP-SAT deneme/geri donus saymiyor; o durumda kutu
                            "0 deneme 0 geri dönüş" diye bozuk gorunuyordu. Anlamli olan
                            yerlesen ders sayisini gosteriyoruz. */}
                        {(stats.attempts > 0 || stats.backtracks > 0) ? (
                            <>
                                <p className="text-slate-700"><span className="font-semibold">{stats.attempts.toLocaleString('tr-TR')}</span> deneme</p>
                                <p className="text-slate-700"><span className="font-semibold">{stats.backtracks.toLocaleString('tr-TR')}</span> geri dönüş</p>
                            </>
                        ) : (
                            <p className="text-slate-700"><span className="font-semibold">{(stats.placements ?? 0).toLocaleString('tr-TR')}</span> ders yerleştirildi</p>
                        )}
                    </div>
                    <div className="md:col-span-2 bg-slate-50 p-4 rounded-lg">
                        <p className="text-slate-500 font-medium mb-2">En Çok Zorlayan Kısıtlar</p>
                        {topReasons.length > 0 ? (
                            <ul className="space-y-1">
                                {topReasons.map(reason => (
                                    <li key={reason.key} className="flex justify-between items-center">
                                        <span>{reasonLabels[reason.key]}</span>
                                        <span className="font-semibold bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full text-xs">
                                            {reason.value.toLocaleString('tr-TR')}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        ) : <p className="text-slate-600">Belirgin bir zorluk yaşanmadı.</p>}
                    </div>
                     {stats.hardestLessons.length > 0 && (
                        <div className="md:col-span-2 bg-slate-50 p-4 rounded-lg">
                            <p className="text-slate-500 font-medium mb-2">En Zorlu Dersler</p>
                            <ul className="space-y-1">
                                {stats.hardestLessons.map(lesson => (
                                    <li key={lesson.key} className="flex justify-between items-center">
                                        <span className="truncate pr-4">{lesson.key}</span>
                                        <span className="font-semibold bg-yellow-200 text-yellow-800 px-2 py-0.5 rounded-full text-xs">
                                            {lesson.failures} deneme
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {stats.notes.length > 0 && (
                        <div className="md:col-span-2 lg:col-span-4 bg-yellow-50 border border-yellow-200 p-4 rounded-lg">
                             <p className="text-yellow-700 font-medium mb-1">Önemli Notlar</p>
                             <ul className="list-disc list-inside text-yellow-800 space-y-1">
                                {stats.notes.map((note, i) => <li key={i}>{note}</li>)}
                             </ul>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const buildCpBlock = (layout: 'desktop' | 'mobile') => {
                const containerClass = layout === 'mobile'
            ? 'flex flex-col gap-2 w-full border-t border-slate-200 pt-3'
            : 'flex flex-wrap items-center gap-2 pl-2 ml-2 border-l border-slate-200';
        const innerClass = layout === 'mobile'
            ? 'flex flex-col gap-2'
            : 'flex flex-wrap items-center gap-2';
        const maxInputClass = layout === 'mobile'
            ? 'w-20 border rounded px-1 py-1 text-sm'
            : 'w-14 border rounded px-1 py-0.5 ml-1';

        return (
            <div className={containerClass}>
                <label className="flex items-center gap-1">
                    <input type="checkbox" checked={cpUseCustom} onChange={(e) => setCpUseCustom(e.target.checked)} />
                    <Tooltip text="İşaretlersen alttaki ayarlar devreye girer; işaretlemezsen varsayılan davranış korunur."><span className="text-slate-600">CP-SAT Özel Ayarlar</span></Tooltip>
                </label>
                {cpUseCustom && (
                    <div className={innerClass}>
                        <label className="flex items-center gap-1">
                            <input type="checkbox" checked={cpAllowSplit} onChange={(e) => setCpAllowSplit(e.target.checked)} />
                            <Tooltip text="Ders aynı gün içinde araya boşluk girerek bölünebilir. Kapalı tutmak blok/bütünlüğü artırır."><span className="text-slate-600">Aynı gün parçalanabilir</span></Tooltip>
                        </label>
                        <label className="flex items-center gap-1">
                            <input type="checkbox" checked={cpEdgeReduce} onChange={(e) => setCpEdgeReduce(e.target.checked)} />
                            <Tooltip text="Öğretmenlerin 1. ve son ders saatlerine yerleşmesini azaltmaya çalışır."><span className="text-slate-600">Kenar saat azalt</span></Tooltip>
                        </label>
                        <label className="flex items-center gap-1">
                            <input type="checkbox" checked={cpGapReduce} onChange={(e) => setCpGapReduce(e.target.checked)} />
                            <Tooltip text="Öğretmenlerin gün içindeki boş saatlerini (gap) azaltmaya çalışır."><span className="text-slate-600">Boşlukları azalt</span></Tooltip>
                        </label>
                        <label className="flex items-center gap-1">
                            <Tooltip text="İki ders arasındaki en fazla boş saat. Aşılırsa ceza uygulanır. 1=sıkı, 2=daha esnek."><span className="text-slate-600">Gap üst sınırı</span></Tooltip>
                            <select value={cpGapLimit} onChange={(e) => setCpGapLimit(e.target.value as 'default' | '1' | '2')} className="border rounded px-1 py-0.5">
                                <option value="default">Varsayılan</option>
                                <option value="1">1 saat</option>
                                <option value="2">2 saat</option>
                            </select>
                        </label>
                        <label className="flex items-center gap-1">
                            <input type="checkbox" checked={cpDailyMaxOn} onChange={(e) => setCpDailyMaxOn(e.target.checked)} />
                            <Tooltip text="Öğretmene bir günde verilebilecek en fazla ders saati (hard kısıt)."><span className="text-slate-600">Günlük max saat</span></Tooltip>
                            <input
                                type="number"
                                min={1}
                                max={12}
                                value={cpDailyMaxVal}
                                onChange={(e) => setCpDailyMaxVal(e.target.value)}
                                className={maxInputClass}
                            />
                        </label>
                        <div className="text-xs text-slate-500">Boşlukları/kenar saatleri azaltma tercih; boşluk ve günlük saat üst sınırları kesin kuraldır. Çok sıkı sınırlar çözümü engelleyebilir.</div>
                    </div>
                )}
            </div>
        );
    };

    const renderSolverAdvancedRows = (layout: 'desktop' | 'mobile'): React.ReactNode => {
        const rowClass = layout === 'mobile'
            ? 'flex flex-wrap items-center gap-3'
            : 'flex flex-wrap items-center gap-2';
        const numericInputClass = layout === 'mobile'
            ? 'w-20 border rounded px-1 py-1 text-sm'
            : 'w-16 border rounded px-1 py-0.5';
        const rngInputClass = layout === 'mobile'
            ? 'w-24 border rounded px-1 py-1 text-sm'
            : 'w-20 border rounded px-1 py-0.5';
        const rows: React.ReactNode[] = [];

        const firstRowItems: React.ReactNode[] = [];
        // Yalniz yedek yerel cozucuyu ilgilendiren ayarlar ayri bir <details> icinde toplanir.
        const localItems: React.ReactNode[] = [];
        const localRows: React.ReactNode[] = [];

        if (layout === 'desktop') {
            const desktopCp = buildCpBlock('desktop');
            if (desktopCp) {
                firstRowItems.push(desktopCp);
            }
        }

        firstRowItems.push(
            <Tooltip key="time-label" text="Toplam arama süresi. Daha uzun süre = daha yüksek başarı.">
                <span className="font-medium text-slate-600">Süre (sn)</span>
            </Tooltip>
        );
        firstRowItems.push(
            <input
                key="time-input"
                value={timeText}
                onChange={(e) => setTimeText(e.target.value)}
                onBlur={() => {
                    const parsed = parseInt(timeText, 10);
                    const next = Number.isNaN(parsed) ? optTime : parsed;
                    const clamped = Math.max(10, Math.min(600, next));
                    setOptTime(clamped);
                    setTimeText(String(clamped));
                }}
                inputMode="numeric"
                pattern="[0-9]*"
                type="text"
                className={numericInputClass}
            />
        );
        localItems.push(
            <Tooltip key="seed-label" text="Greedy tohumlama oranı. Düşük (0.10–0.15) daha esnek; yüksek daha hızlı fakat kilitlenebilir.">
                <span className="font-medium text-slate-600">Seed</span>
            </Tooltip>
        );
        localItems.push(
            <input
                key="seed-input"
                value={seedText}
                onChange={(e) => setSeedText(e.target.value)}
                onBlur={() => {
                    const parsed = parseFloat(seedText);
                    const next = Number.isNaN(parsed) ? optSeedRatio : parsed;
                    const clamped = Math.max(0.05, Math.min(0.5, next));
                    const fixed = Number(clamped.toFixed(2));
                    setOptSeedRatio(fixed);
                    setSeedText(String(fixed));
                }}
                type="text"
                inputMode="decimal"
                className={numericInputClass}
            />
        );

        rows.push(
            <div key="row-1" className={rowClass}>
                {firstRowItems}
            </div>
        );

        if (layout === 'mobile') {
            const mobileCp = buildCpBlock('mobile');
            if (mobileCp) {
                rows.push(<React.Fragment key="cp-mobile">{mobileCp}</React.Fragment>);
            }
        }

        localRows.push(
            <div key="row-2" className={rowClass}>
                <Tooltip text="Tabu tenure: aynı hamlenin tabu kaldığı iterasyon. 50–80 önerilir.">
                    <span className="font-medium text-slate-600">Tenure</span>
                </Tooltip>
                <input
                    value={tenureText}
                    onChange={(e) => setTenureText(e.target.value)}
                    onBlur={() => {
                        const parsed = parseInt(tenureText, 10);
                        const next = Number.isNaN(parsed) ? optTabuTenure : parsed;
                        const clamped = Math.max(10, Math.min(200, next));
                        setOptTabuTenure(clamped);
                        setTenureText(String(clamped));
                    }}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    type="text"
                    className={numericInputClass}
                />
                <Tooltip text="Tabu iterasyon sayısı. 2000–3500 dengeli.">
                    <span className="font-medium text-slate-600">Iter</span>
                </Tooltip>
                <input
                    value={iterText}
                    onChange={(e) => setIterText(e.target.value)}
                    onBlur={() => {
                        const parsed = parseInt(iterText, 10);
                        const next = Number.isNaN(parsed) ? optTabuIter : parsed;
                        const clamped = Math.max(500, Math.min(6000, next));
                        setOptTabuIter(clamped);
                        setIterText(String(clamped));
                    }}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    type="text"
                    className={numericInputClass}
                />
                <Tooltip text="Deterministik RNG tohumu. Aynı tohum = aynı arama çizgisi.">
                    <span className="font-medium text-slate-600">RNG</span>
                </Tooltip>
                <input
                    value={rngText}
                    onChange={(e) => setRngText(e.target.value)}
                    onBlur={() => {
                        const parsed = parseInt(rngText, 10);
                        if (!Number.isNaN(parsed)) {
                            setOptRngSeed(parsed);
                            setRngText(String(parsed));
                        } else {
                            setRngText(rngText ? rngText : '');
                        }
                    }}
                    placeholder="seed"
                    type="text"
                    inputMode="numeric"
                    className={rngInputClass}
                />
            </div>
        );

        rows.push(
            <div key="row-3" className={rowClass}>
                <label className="flex items-center gap-1">
                    <input type="checkbox" checked={optStopFirst} onChange={(e) => setOptStopFirst(e.target.checked)} />
                    <Tooltip text="İlk feasible çözüm bulunduğunda hemen durur (hızlı denemeler için)."><span className="text-slate-600">StopFirst</span></Tooltip>
                </label>
                <label className={`flex items-center gap-1 rounded px-2 py-1 ${relaxBlocksIfNeeded ? 'bg-amber-100 text-amber-900' : 'border border-amber-200 bg-amber-50 text-amber-800'}`}>
                    <input type="checkbox" checked={relaxBlocksIfNeeded} onChange={(e) => setRelaxBlocksIfNeeded(e.target.checked)} />
                    <Tooltip text="Örnek: 5 saatlik ders 3+2 olarak yerleşmezse 3+1+1 veya 2+1+1+1 gibi bölünmesine izin verir. CP-SAT önce tanımlı blokları dener; olmazsa esnetir."><span className="font-medium">Yer bulamazsa blokları esnet</span></Tooltip>
                </label>
            </div>
        );

        localRows.push(
            <div key="row-3-local" className={rowClass}>
                <label className="flex items-center gap-1">
                    <input type="checkbox" checked={useDeterministic} onChange={(e) => setUseDeterministic(e.target.checked)} />
                    <Tooltip text="İşaretliyken randomSeed gönderilir; aynı parametrelerle aynı sonuçları üretir."><span className="text-slate-600">Deterministik</span></Tooltip>
                </label>
                <label className="flex items-center gap-1">
                    <input type="checkbox" checked={optDisableLNS} onChange={(e) => setOptDisableLNS(e.target.checked)} />
                    <Tooltip text="Ruin&Recreate iyileştirmesini kapatır; daha klasik/kararlı davranış."><span className="text-slate-600">LNS kapalı</span></Tooltip>
                </label>
                <label className="flex items-center gap-1">
                    <input type="checkbox" checked={optDisableEdge} onChange={(e) => setOptDisableEdge(e.target.checked)} />
                    <Tooltip text="Öğretmenin gün başı/sonu ve tekil saat cezalarını kapatır."><span className="text-slate-600">Kenar cezası kapalı</span></Tooltip>
                </label>
            </div>
        );

        localRows.push(
            <div key="row-4" className={rowClass}>
                <Tooltip text="45 sn, seed 0.12, tenure 60, iter 2500, StopFirst açık">
                    <button onClick={() => applyProfile('fast')} className="px-2 py-1 border rounded text-slate-600 hover:bg-slate-50">Hızlı</button>
                </Tooltip>
                <Tooltip text="90 sn, seed 0.12, tenure 70, iter 3000">
                    <button onClick={() => applyProfile('balanced')} className="px-2 py-1 border rounded text-slate-600 hover:bg-slate-50">Dengeli</button>
                </Tooltip>
                <Tooltip text="150 sn, seed 0.12, tenure 80, iter 3500">
                    <button onClick={() => applyProfile('max')} className="px-2 py-1 border rounded text-slate-600 hover:bg-slate-50">Maks</button>
                </Tooltip>
                <Tooltip text="Klasik: Repair, StopFirst, LNS kapalı, kenar ve yayılım cezası yok">
                    <button onClick={() => applyProfile('classic')} className={`px-2 py-1 border rounded ${classicMode ? 'bg-amber-500 text-white border-amber-500' : 'text-slate-600 hover:bg-slate-50'}`}>Klasik</button>
                </Tooltip>
            </div>
        );

        rows.push(
            <div key="row-save" className={rowClass}>
                <Tooltip text="Bu ayarları başlangıçta otomatik yüklensin diye kaydeder.">
                    <button onClick={saveSettingsAsDefault} className="px-2 py-1 border rounded text-emerald-600 hover:bg-emerald-50">Varsayılan Yap</button>
                </Tooltip>
            </div>
        );

        rows.push(
            <details key="local-fallback" className="w-full rounded-md border border-dashed border-slate-300 px-3 py-2">
                <summary className="cursor-pointer text-slate-600">
                    Yedek yerel çözücü ayarları
                    <span className="ml-1 text-slate-400">(yalnız sunucuya ulaşılamazsa kullanılır)</span>
                </summary>
                <div className="mt-2 space-y-2">
                    <div className={rowClass}>{localItems}</div>
                    {localRows}
                </div>
            </details>
        );

        return <>{rows}</>;
    };

    const renderAnalysisToggles = (layout: 'desktop' | 'mobile') => {
        const containerClass = layout === 'mobile'
            ? 'flex flex-wrap items-center gap-2 text-xs text-slate-600 mt-3'
            : 'flex flex-wrap items-center gap-2 text-xs text-slate-600 mt-3';
        return (
            <div className={containerClass}>
                <label className="flex items-center gap-1">
                    <input
                        type="checkbox"
                        checked={showTeacherLoadSummary}
                        onChange={(e) => setShowTeacherLoadSummary(e.target.checked)}
                    />
                    <span>Öğretmen yük analizi</span>
                </label>
                <label className="flex items-center gap-1">
                    <input
                        type="checkbox"
                        checked={showTeacherActualLoad}
                        onChange={(e) => setShowTeacherActualLoad(e.target.checked)}
                    />
                    <span>Gerçekleşen yük</span>
                </label>
                <label className="flex items-center gap-1">
                    <input
                        type="checkbox"
                        checked={showHeatmapPanel}
                        onChange={(e) => setShowHeatmapPanel(e.target.checked)}
                    />
                    <span>Gün / saat analizi</span>
                </label>
                <label className="flex items-center gap-1">
                    <input
                        type="checkbox"
                        checked={showDutyWarnings}
                        onChange={(e) => setShowDutyWarnings(e.target.checked)}
                    />
                    <span>Paylaşılan ders uyarıları</span>
                </label>
                <label className="flex items-center gap-1">
                    <input
                        type="checkbox"
                        checked={showDutyCoverage}
                        onChange={(e) => setShowDutyCoverage(e.target.checked)}
                    />
                    <span>Nöbetçi yardımcısı</span>
                </label>
            </div>
        );
    };

    const renderSolverHelp = () => {
        return (
            <details className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <summary className="cursor-pointer font-semibold text-slate-700">Bu ayarlar ne işe yarıyor?</summary>
                <div className="mt-2 space-y-2 leading-relaxed">
                    <p className="rounded bg-white px-2 py-1 font-medium text-slate-700">
                        Program her zaman sunucudaki CP-SAT çözücüsüyle oluşturulur; Süre, StopFirst, blok esnetme ve CP-SAT Özel Ayarlar buna aittir. Sunucuya ulaşılamazsa veya meşgulse tarayıcıdaki yedek çözücü kendiliğinden devreye girer ve bu, sonuç notunda belirtilir.
                    </p>
                    <p><strong>Yedek yerel çözücü:</strong> Seed, Tenure, Iter, RNG, Deterministik, LNS, Kenar cezası ve Hızlı/Dengeli/Maks/Klasik profilleri yalnız bu yedek aramayı yönetir.</p>
                    <p><strong>Süre:</strong> Çözücünün arama için kullanabileceği azami saniyedir; varsayılan 60 saniyedir. Süre dolmadan iyi bir sonuç bulursa daha erken biter. Kurallar birbiriyle çelişiyorsa süreyi artırmak sonucu değiştirmez, çözücü yine "mümkün değil" der.</p>
                    <p><strong>Program oluşmazsa:</strong> Çözücü "bu kurallarla mümkün değil" dediğinde uygulama kuralları tek tek gevşetip hangisinin engellediğini arar ve sonucu düz bir cümleyle söyler; örneğin "Ayşe Yılmaz'ın müsait saatleri açılırsa program oluşuyor" ya da "2'li blok kuralları kaldırılınca program oluşuyor". Bu arama yalnız çözüm bulunamadığında çalışır ve birkaç saniye sürer.</p>
                    <p><strong>StopFirst:</strong> İlk geçerli programda durur. Açıkken hızlıdır; kapalıyken kalan sürede daha az boşluklu program arar.</p>
                    <p><strong>Yer bulamazsa blokları esnet:</strong> Kapalıysa 3+2 gibi tanımladığınız bloklar zorunludur. Açarsanız çözücü önce 3+2'yi dener; program çıkmazsa 3+1+1 veya 2+1+1+1 gibi bölerek yeniden dener.</p>
                    <p><strong>Seed / Tenure / Iter:</strong> Yalnız yerel Tabu/ALNS yöntemlerinin başlangıç oranı, hamle hafızası ve deneme sayısıdır.</p>
                    <p><strong>RNG + Deterministik:</strong> Aynı veri ve ayarlarla yerel aramayı tekrarlanabilir yapar.</p>
                    <p><strong>LNS kapalı / Kenar cezası kapalı:</strong> Yerel iyileştirmeyi ve öğretmenlerin ilk-son saatlerini azaltma tercihini kapatır.</p>
                    <p><strong>Analiz kutuları:</strong> Programı değiştirmez; yalnız öğretmen yükü, gerçekleşen saatler, müsaitlik, çakışma ve nöbet raporlarını açıp kapatır.</p>
                </div>
            </details>
        );
    };

    return (
        <div className="min-h-screen p-4 sm:p-6 lg:p-8">
        {!isSmallScreen && sessionLoading && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70">
                <div className="bg-white rounded-lg shadow-xl px-6 py-5 w-full max-w-md text-center space-y-3">
                    <h2 className="text-lg font-semibold text-slate-800">Oturum doğrulanıyor</h2>
                    <p className="text-sm text-slate-500">Yetki kodu kontrol ediliyor, lütfen bekleyin...</p>
                </div>
            </div>
        )}
        {(requiresWebAuth || needsSchoolOnboarding) && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/75 px-4">
                <div className="bg-white rounded-xl shadow-2xl px-6 py-6 w-full max-w-md space-y-5 max-h-[92vh] overflow-y-auto">
                    {needsSchoolOnboarding ? (
                        <>
                            <div>
                                <h2 className="text-xl font-semibold text-slate-900">Okulunuzu ekleyin</h2>
                                <p className="text-sm text-slate-500 mt-1">
                                    Hoş geldiniz{sessionInfo?.user?.name ? `, ${sessionInfo.user.name}` : ''}. Verilerinizin buluta
                                    kaydedilmesi için okulunuzun adını yazın. Bu cihazda kayıtlı veriler varsa okulunuza aktarılır.
                                </p>
                            </div>
                            <input
                                type="text"
                                value={onboardSchoolName}
                                onChange={(e) => setOnboardSchoolName(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleOnboardSchool(); } }}
                                placeholder="Örn: Atatürk Ortaokulu"
                                maxLength={120}
                                autoFocus
                                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                            />
                            <button
                                type="button"
                                onClick={handleOnboardSchool}
                                disabled={onboardLoading || onboardSchoolName.trim().length < 2}
                                className="w-full rounded-lg bg-sky-600 px-4 py-2 text-white font-medium shadow hover:bg-sky-700 disabled:opacity-60"
                            >
                                {onboardLoading ? 'Kaydediliyor…' : 'Devam et'}
                            </button>
                            <button
                                type="button"
                                onClick={handleSignOut}
                                className="w-full text-sm text-slate-500 hover:text-slate-700"
                            >
                                Farklı bir hesapla giriş yap
                            </button>
                        </>
                    ) : (
                        <>
                            <div className="text-center">
                                <img src="/assets/logo.png" alt="" className="mx-auto h-12 w-auto rounded-md" />
                                <h2 className="mt-3 text-xl font-semibold text-slate-900">DersTimeTable'a giriş yapın</h2>
                                <p className="text-sm text-slate-500 mt-1">
                                    Verileriniz hesabınıza kaydedilir; bilgisayardan, telefondan ve Windows uygulamasından aynı programa ulaşırsınız.
                                </p>
                            </div>

                            <div className="flex flex-col items-center gap-2">
                                <GoogleSignInButton onCredential={handleGoogleCredential} />
                                {googleLoginLoading && <p className="text-sm text-slate-500">Giriş yapılıyor…</p>}
                            </div>

                            <p className="text-center text-xs text-slate-500">
                                Giriş yaparak{' '}
                                <a href="https://idare.ozarik.org/gizlilik/" target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-700">
                                    Gizlilik Politikası
                                </a>
                                'nı kabul etmiş olursunuz.
                            </p>

                            {hasLocalWorkspaceData && (
                                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                                    Bu cihazda kayıtlı verileriniz var; giriş yaptığınızda hesabınıza aktarılır. İsterseniz önce{' '}
                                    <button type="button" onClick={handleExportData} className="font-medium underline">
                                        yedek indirin (JSON)
                                    </button>
                                    .
                                </div>
                            )}

                            <div className="border-t border-slate-200 pt-3 space-y-2">
                                <button
                                    type="button"
                                    onClick={() => setShowPasswordLogin((open) => !open)}
                                    aria-expanded={showPasswordLogin}
                                    className="text-xs text-slate-500 hover:text-slate-700"
                                >
                                    {showPasswordLogin ? '▾' : '▸'} E-posta ve şifreyle giriş (inceleme hesabı)
                                </button>
                                {showPasswordLogin && (
                                    <form
                                        className="space-y-2"
                                        onSubmit={(e) => { e.preventDefault(); handleReviewPasswordLogin(); }}
                                    >
                                        <input
                                            type="email"
                                            autoComplete="username"
                                            value={passwordLoginEmail}
                                            onChange={(e) => setPasswordLoginEmail(e.target.value)}
                                            placeholder="E-posta"
                                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                                        />
                                        <input
                                            type="password"
                                            autoComplete="current-password"
                                            value={passwordLoginSecret}
                                            onChange={(e) => setPasswordLoginSecret(e.target.value)}
                                            placeholder="Şifre"
                                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                                        />
                                        <button
                                            type="submit"
                                            disabled={passwordLoginLoading || !passwordLoginEmail.trim() || !passwordLoginSecret}
                                            className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                                        >
                                            {passwordLoginLoading ? 'Giriş yapılıyor…' : 'Giriş yap'}
                                        </button>
                                    </form>
                                )}
                            </div>

                            {/* Telefon kodu, telefondan web'e gecis icindir; Android'in kendisinde anlamsiz. */}
                            <div className={nativeApp ? 'hidden' : 'border-t border-slate-200 pt-3 space-y-3'}>
                                <button
                                    type="button"
                                    onClick={() => setShowCodeLogin((open) => !open)}
                                    aria-expanded={showCodeLogin}
                                    className="text-xs text-slate-500 hover:text-slate-700"
                                >
                                    {showCodeLogin ? '▾' : '▸'} Telefon uygulamasındaki kodla giriş
                                </button>
                                {showCodeLogin && (
                                    <div className="space-y-2">
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            value={codeInput}
                                            onChange={(e) => setCodeInput(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleVerifyBridgeCode(); } }}
                                            placeholder="Örn: 123456"
                                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-center text-lg tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            maxLength={6}
                                        />
                                        <button
                                            type="button"
                                            onClick={handleVerifyBridgeCode}
                                            disabled={verifyLoading || !codeInput.trim()}
                                            className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                                        >
                                            {verifyLoading ? 'Doğrulanıyor…' : 'Kodu doğrula'}
                                        </button>
                                        <p className="text-xs text-slate-400">Kodu mobil uygulamada "Web erişim kodu" bölümünden oluşturabilirsiniz.</p>
                                    </div>
                                )}
                                {!REQUIRE_SIGN_IN && (
                                    <button
                                        type="button"
                                        onClick={handleContinueWithoutLogin}
                                        className="block text-xs text-slate-400 hover:text-slate-600"
                                    >
                                        Şimdilik giriş yapmadan devam et (veriler yalnız bu cihazda kalır)
                                    </button>
                                )}
                            </div>
                        </>
                    )}
                    {sessionError && (
                        <p role="alert" className="text-sm text-red-600">{sessionError}</p>
                    )}
                </div>
            </div>
        )}
            <header className="mb-8 no-print">
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
            <div>
                <div className="flex items-center gap-3">
                    <img
                        src="/assets/logo.png"
                        alt="Ozarik DersTimeTable"
                        className="h-10 w-auto rounded-md shadow-sm"
                    />
                    <h1 className="text-3xl font-bold text-slate-900">Ozarik DersTimeTable</h1>
                </div>
                <p className="text-slate-500 mt-1">Haftalık ders programınızı saniyeler içinde oluşturun.</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-400">Ayrıca şuralarda:</span>
                    {platformLinks.map((link) => (
                        <a
                            key={link.url}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:border-sky-400 hover:text-sky-700"
                        >
                            {link.label}
                        </a>
                    ))}
                </div>
                <div className="mt-2 text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <a
                        href="https://idare.ozarik.org/gizlilik/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-slate-700 underline"
                    >
                        Gizlilik Politikası
                    </a>
                    <span className="text-slate-300">|</span>
                    <a
                        href="https://idare.ozarik.org/veri-silme/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-slate-700 underline"
                    >
                        Veri Silme Talebi
                    </a>
                    <span className="text-slate-300">|</span>
                    <a
                        href="mailto:kaanozarik@gmail.com"
                        className="hover:text-slate-700 underline"
                    >
                        Destek: kaanozarik@gmail.com
                    </a>
                </div>
                {activeSessionUser && (
                    <div
                        className={`mt-1 text-slate-500 ${isSmallScreen ? 'flex flex-col gap-1 text-sm' : 'flex items-center text-xs'}`}
                    >
                        <span>
                            <span>Bagli kullanici: </span>
                            <span className="font-medium text-slate-700">{activeSessionUser.name || activeSessionUser.email}</span>
                        </span>
                        <button
                            type="button"
                            onClick={handleSignOut}
                            className={`text-red-600 ${isSmallScreen ? 'mt-1 inline-flex items-center text-sm font-medium' : 'ml-2 text-xs'}`}
                        >
                            Cikis
                        </button>
                    </div>
                )}
                {!activeSessionUser && guestWebMode && !isSmallScreen && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">Yerel mod</span>
                        <span>Veriler sadece bu cihazda tutulur.</span>
                        <span className={localWorkspaceStatus === 'error' ? 'font-medium text-red-600' : 'text-emerald-700'}>
                            {localWorkspaceStatus === 'saving' && 'Otomatik kaydediliyor...'}
                            {localWorkspaceStatus === 'saved' && `Otomatik kaydedildi${localWorkspaceSavedAt ? ` · ${new Date(localWorkspaceSavedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}` : ''}`}
                            {localWorkspaceStatus === 'error' && 'Otomatik kayıt başarısız; JSON yedeği indirin.'}
                        </span>
                        <button
                            type="button"
                            onClick={() => {
                                persistGuestWebMode(false);
                                setSessionError(null);
                            }}
                            className="text-sky-600 underline underline-offset-2"
                        >
                            Bulut girisi ac
                        </button>
                    </div>
                )}
                {isRemoteMode && (
                    <>
                        {catalogStatus === 'loading' && (
                            <div className={`mt-2 text-xs ${isSmallScreen ? 'text-slate-600' : 'text-slate-500'}`}>
                                Bulut verileri yukleniyor...
                            </div>
                        )}
                        {catalogStatus === 'error' && catalogError && (
                            <div className="mt-2 text-xs text-red-600">
                                {catalogError}
                            </div>
                        )}
                        {catalogStatus === 'ready' && catalogSyncStatus === 'saving' && (
                            <div className={`mt-2 text-xs ${isSmallScreen ? 'text-slate-600' : 'text-slate-500'}`}>
                                Degisiklikler buluta kaydediliyor...
                            </div>
                        )}
                        {catalogStatus === 'ready' && catalogSyncStatus === 'error' && catalogSyncError && (
                            <div className="mt-2 text-xs text-red-600">
                                {catalogSyncError}
                            </div>
                        )}
                        {catalogStatus === 'ready' && catalogNotice && (
                            <div className="mt-2 text-xs font-medium text-amber-700">
                                {catalogNotice}
                            </div>
                        )}
                        {catalogStatus === 'ready' && catalogSyncStatus === 'idle' && !catalogSyncError && !catalogNotice && (
                            <div className={`mt-2 text-xs ${isSmallScreen ? 'text-slate-600' : 'text-slate-500'}`}>
                                Bulut ile senkron durumda.
                            </div>
                        )}
                    </>
                )}
                {schoolOptions.length > 0 && (
                    <div
                        className={`mt-2 ${isSmallScreen ? 'flex w-full flex-col gap-1 text-sm text-slate-600' : 'flex items-center gap-2 text-xs text-slate-500'}`}
                    >
                        <span className={isSmallScreen ? 'font-medium text-slate-600' : undefined}>Aktif okul{isSmallScreen ? '' : ':'}</span>
                        <select
                            value={activeSchoolId ?? ''}
                            onChange={(event) => {
                                const value = Number(event.target.value);
                                setActiveSchoolId(Number.isNaN(value) ? null : value);
                            }}
                            className={`rounded border border-slate-300 bg-white shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 ${
                                isSmallScreen ? 'mt-1 w-full px-3 py-2 text-sm' : 'px-2 py-1 text-xs'
                            }`}
                        >
                            {schoolOptions.map((school, index) => {
                                const id = Number(school.id);
                                const label = school.name || `Okul #${id || index + 1}`;
                                return (
                                    <option key={school.id ?? index} value={id}>
                                        {label}
                                    </option>
                                );
                            })}
                        </select>
                    </div>
                )}
            </div>
            <div className="flex flex-col gap-3 w-full xl:w-auto">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-100 p-3 rounded-lg border">
                    <div>
                        <label className="text-xs font-medium text-slate-500 block mb-2">Günlük Ders Saatleri</label>
                        <div className="space-y-2">
                            {[SchoolLevel.Middle, SchoolLevel.High].map(level => (
                                <div key={level} className="flex items-center gap-2">
                                    <span className="w-20 text-sm font-medium text-slate-600">{level}:</span>
                                    {DAYS.map((day, dayIndex) => (
                                        <input
                                            key={dayIndex}
                                            type="number"
                                            inputMode="numeric"
                                            title={`${level} - ${day}`}
                                            value={schoolHoursDraft[level]?.[dayIndex] ?? ''}
                                            onChange={(e) => handleSchoolHoursChange(level, dayIndex, e.target.value)}
                                            onBlur={() => handleSchoolHoursBlur(level, dayIndex)}
                                            min="4"
                                            max="16"
                                            className="w-12 rounded-md border-slate-300 text-center text-sm p-1"
                                        />
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>
                    <div>
                        <label className="text-xs font-medium text-slate-500 block mb-2">PDF Başlığı (resmî çıktı)</label>
                        <div className="space-y-2">
                            <input
                                type="text"
                                value={printInfo.schoolName}
                                onChange={(e) => handlePrintInfoChange('schoolName', e.target.value)}
                                placeholder={cloudSchoolName ? `Okul adı (boşsa: ${cloudSchoolName})` : 'Okul adı'}
                                title="Her sayfanın en üstünde yazar"
                                className="w-full rounded-md border-slate-300 text-sm p-1"
                            />
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={printInfo.academicYear}
                                    onChange={(e) => handlePrintInfoChange('academicYear', e.target.value)}
                                    placeholder="2026-2027"
                                    title="Eğitim-öğretim yılı; her sayfanın en üstünde okul adının yanında yazar"
                                    className="w-28 rounded-md border-slate-300 text-sm p-1"
                                />
                                <input
                                    type="text"
                                    value={printInfo.principalName}
                                    onChange={(e) => handlePrintInfoChange('principalName', e.target.value)}
                                    placeholder="Okul müdürü adı"
                                    title="Her sayfanın sağ alt köşesinde 'Okul Müdürü' imza yeri olarak yazar"
                                    className="flex-1 rounded-md border-slate-300 text-sm p-1"
                                />
                            </div>
                            <p className="text-[11px] text-slate-500">Boş bırakılan alan çıktıda görünmez.</p>
                        </div>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        accept=".json"
                        className="hidden"
                    />
                    <input
                        type="file"
                        ref={scheduleFileInputRef}
                        onChange={handleScheduleFileChange}
                        accept=".json"
                        className="hidden"
                    />
                    <button
                        onClick={handleImportClick}
                        className="flex items-center justify-center p-2 bg-white text-slate-700 rounded-lg border border-slate-300 hover:bg-slate-50"
                        title="Veri dosyasını yükle"
                    >
                        <UploadIcon className="w-5 h-5" />
                    </button>
                    {/* Örnek yükleme butonlarını header'dan kaldırdık */}
                    <button
                        onClick={handleExportData}
                        className="flex items-center justify-center p-2 bg-white text-slate-700 rounded-lg border border-slate-300 hover:bg-slate-50"
                        title="Sadece girilen verileri indir"
                    >
                        <DownloadIcon className="w-5 h-5" />
                    </button>
                    <button
                        onClick={handleClearAllData}
                        className="flex items-center justify-center p-2 bg-white text-slate-700 rounded-lg border border-slate-300 hover:bg-red-50 hover:text-red-600"
                        title="Tüm verileri sıfırla"
                    >
                        <TrashIcon className="w-5 h-5" />
                    </button>
                    <button
                        onClick={handleGenerate}
                        disabled={isLoading || !validation.isValid}
                        className="w-full sm:w-auto px-5 py-2 font-medium bg-sky-500 text-white rounded-lg shadow-md hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors"
                    >
                        {isLoading ? 'Oluşturuluyor...' : 'Program Oluştur'}
                    </button>
                </div>
                <div className="md:hidden bg-white border border-slate-200 rounded-lg px-3 py-3 shadow-sm">
                    <div className="flex flex-col gap-3">
                        <button
                            type="button"
                            onClick={() => setIsMobileAdvancedOpen((prev) => !prev)}
                            className="inline-flex items-center justify-between rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                            <span>Gelişmiş ayarlar</span>
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className={`w-4 h-4 transition-transform ${isMobileAdvancedOpen ? 'rotate-180' : ''}`}
                            >
                                <path d="M6 9l6 6 6-6" />
                            </svg>
                        </button>
                    </div>
                    {isMobileAdvancedOpen && (
                        <div className="mt-3 space-y-3 text-xs text-slate-600">
                            {renderSolverAdvancedRows('mobile')}
                            {renderSolverHelp()}
                            <div className="space-y-3 border-t border-slate-200 pt-3">
                                {activeSessionUser ? (
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="text-[11px] leading-tight text-slate-500">
                                                <div className="font-medium text-slate-700">{activeSessionUser?.name || activeSessionUser?.email}</div>
                                                <div>Mobil oturum aktif</div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={handleSignOut}
                                                className="text-[11px] text-red-600"
                                            >
                                                Cikis yap
                                            </button>
                                        </div>
                                        {schoolOptions.length > 0 && (
                                            <div className="flex items-center gap-2 text-[11px] text-slate-500">
                                                <span>Okul:</span>
                                                <select
                                                    value={activeSchoolId ?? ''}
                                                    onChange={(event) => {
                                                        const value = Number(event.target.value);
                                                        setActiveSchoolId(Number.isNaN(value) ? null : value);
                                                    }}
                                                    className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                                                >
                                                    {schoolOptions.map((school, index) => {
                                                        const id = Number(school.id);
                                                        const label = school.name || `Okul #${id || index + 1}`;
                                                        return (
                                                            <option key={school.id ?? index} value={id}>
                                                                {label}
                                                            </option>
                                                        );
                                                    })}
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <p className="text-[11px] text-slate-500">Web paneline baglanmak icin kod olusturun.</p>
                                )}
                                  <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 space-y-2 text-[11px]">
                                      <p>Bilgisayarinizdan erisim icin web paneli adresi:
                                          <span className="ml-1 font-semibold text-slate-700">{WEB_PORTAL_URL}</span>
                                      </p>
                                      <div className="flex flex-wrap items-center gap-2">
                                          <button
                                              type="button"
                                              onClick={handleOpenWebPortal}
                                              className="rounded bg-slate-700 px-3 py-1 text-white text-[11px] hover:bg-slate-800"
                                          >
                                              Siteyi ac
                                          </button>
                                          <button
                                              type="button"
                                              onClick={handleCopyWebPortalLink}
                                              className="rounded border border-slate-400 px-3 py-1 text-[11px] text-slate-700 hover:bg-slate-100"
                                          >
                                              Adresi kopyala
                                          </button>
                                      </div>
                                      <p className="border-t border-slate-200 pt-2">
                                          Windows bilgisayarlar icin masaustu uygulamasi:
                                          <button
                                              type="button"
                                              onClick={handleOpenWindowsStore}
                                              className="ml-1 font-semibold text-sky-700 underline hover:text-sky-800"
                                          >
                                              Microsoft Store'da ac
                                          </button>
                                      </p>
                                  </div>
                                  <div className="grid grid-cols-1 gap-2">
                                      <input
                                          type="email"
                                          value={bridgeEmail}
                                          onChange={(e) => setBridgeEmail(e.target.value)}
                                          placeholder="E-posta adresi"
                                        className="rounded border border-slate-300 px-3 py-2 text-xs"
                                    />
                                    <input
                                        type="text"
                                        value={bridgeName}
                                        onChange={(e) => setBridgeName(e.target.value)}
                                        placeholder="Ad (opsiyonel)"
                                        className="rounded border border-slate-300 px-3 py-2 text-xs"
                                    />
                                    <input
                                        type="text"
                                        value={bridgeSchoolId}
                                          onChange={(e) => setBridgeSchoolId(e.target.value)}
                                          placeholder="Okul ID (opsiyonel)"
                                          className="rounded border border-slate-300 px-3 py-2 text-xs"
                                      />
                                      <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 space-y-2">
                                          <span className="text-[11px] text-slate-600">Okulunuz yoksa buradan ekleyebilirsiniz.</span>
                                          <input
                                              type="text"
                                              value={newSchoolName}
                                              onChange={(e) => setNewSchoolName(e.target.value)}
                                              placeholder="Yeni okul adi"
                                              className="rounded border border-slate-300 px-3 py-2 text-xs"
                                          />
                                          <button
                                              type="button"
                                              onClick={handleCreateSchool}
                                              disabled={newSchoolLoading}
                                              className="rounded bg-slate-700 px-3 py-2 text-white text-xs font-medium shadow hover:bg-slate-800 disabled:opacity-60"
                                          >
                                              {newSchoolLoading ? 'Kaydediliyor...' : 'Okul kaydet'}
                                          </button>
                                      </div>
                                      <button
                                          type="button"
                                          onClick={handleRequestBridgeCode}
                                          disabled={bridgeLoading}
                                          className="rounded bg-blue-600 px-3 py-2 text-white text-xs font-medium shadow hover:bg-blue-700 disabled:opacity-60"
                                      >
                                          {bridgeLoading ? 'Kod olusturuluyor...' : 'Kod olustur'}
                                      </button>
                                  </div>
                                  {newSchoolStatus && <p className="text-[11px] text-slate-500">{newSchoolStatus}</p>}
                                  {webPortalStatus && <p className="text-[11px] text-sky-600">{webPortalStatus}</p>}
                                  {bridgeError && <p className="text-[11px] text-red-600">{bridgeError}</p>}
                                  {bridgeCodeInfo && (
                                      <div className="rounded-lg bg-slate-900 text-white text-center py-3">
                                          <div className="font-mono text-2xl tracking-[0.35em]">{bridgeCodeInfo.code}</div>
                                          <p className="text-[11px] mt-1 text-slate-300">Kod {bridgeCodeExpiryText || '10 dakikada'} sona erer.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                    {renderAnalysisToggles('mobile')}
                </div>
                <div className="hidden md:flex md:flex-col md:items-start gap-2 text-xs bg-white rounded-md px-3 py-2 shadow-sm max-w-[720px]">
                    {renderSolverAdvancedRows('desktop')}
                    {renderSolverHelp()}
                    {renderAnalysisToggles('desktop')}
                </div>
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
                        <p className="text-sm font-semibold pt-1">Program oluşturma butonu, tüm bu sorunlar çözülene kadar devre dışı bırakılmıştır.</p>
                    </div>
                )}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {showTeacherLoadSummary && (
                        <TeacherLoadAnalysis teachers={data.teachers} teacherLoads={teacherLoads} />
                    )}
                    {showTeacherActualLoad && (
                        <TeacherActualLoadPanel teachers={data.teachers} teacherLoads={teacherLoads} actualLoads={actualTeacherLoads} teacherDailyCounts={teacherDailyCounts} />
                    )}
                    {showHeatmapPanel && (
                        <TeacherAvailabilityHeatmap teachers={data.teachers} dayNames={DAYS} maxDailyHours={maxDailyHours} />
                    )}
                    {showAnalyzer && (
                        <ConflictAnalyzer data={data} schoolHours={schoolHours} maxDailyHours={maxDailyHours} />
                    )}
                    {schedule && (
                        <QualitySummary data={data} schedule={schedule} schoolHours={schoolHours} gapThreshold={cpGapLimit==='1'?1:2} />
                    )}
                </div>

                {showDutyCoverage && (
                    <DutyCoveragePanel
                        data={data}
                        schedule={schedule}
                        dayNames={DAYS}
                        assignments={substitutionAssignments}
                        onAssign={handleAssignSubstitution}
                        onCancel={handleCancelSubstitution}
                    />
                )}

                <PreflightOverview
                    data={data}
                    schoolHours={schoolHours}
                    onEditClassroom={(classroom) => handleOpenModal('classrooms', classroom)}
                    onEditTeacher={(teacher) => handleOpenModal('teachers', teacher)}
                    onEditSubject={(subject) => handleOpenModal('subjects', subject)}
                />

                {renderContent()}

                {renderSavedSchedules()}

                {error && <div className="p-4 bg-red-100 text-red-700 border border-red-200 rounded-lg no-print">{error}</div>}
                
                {isLoading && (
                    <div className="flex flex-col items-center justify-center h-96 bg-white rounded-lg shadow-lg">
                        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-sky-500"></div>
                        <p className="mt-4 text-slate-600">Program çözülüyor... Bu işlem verilerinizin karmaşıklığına göre birkaç saniye veya daha uzun sürebilir.</p>
                    </div>
                )}

                {solverStats && (
                    <SolverReport stats={solverStats} />
                )}
                
                {/* Gelişmiş: Örnek veri yükleme (header dışı, küçük bölüm) */}
                <div className="no-print flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <span className="font-medium">Örnek Veriler:</span>
                    <button onClick={()=>loadSampleData('ai')} className="px-2 py-1 border rounded hover:bg-slate-50">AI örnek yükle</button>
                    <button onClick={()=>loadSampleData('school')} className="px-2 py-1 border rounded hover:bg-slate-50">Okul örnek yükle</button>
                </div>

                {schedule && (
                    <div id="schedule-container" className="bg-white p-6 rounded-lg shadow-lg">
                         <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4 no-print">
                            <div className="flex items-center gap-4">
                                <h2 className="text-xl font-bold whitespace-nowrap">
                                    {activeScheduleName ? `${activeScheduleName}` : 'Yeni Program (Kaydedilmedi)'}
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
                            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                                <select 
                                    value={selectedHeaderId} 
                                    onChange={e => setSelectedHeaderId(e.target.value)}
                                    className={`w-full sm:w-48 rounded-md border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 text-sm p-1.5 ${viewMode === 'master' ? 'hidden' : ''}`}
                                >
                                    {viewOptions.map(opt => <option key={opt.id} value={opt.id}>{opt.name}</option>)}
                                </select>
                                <div className="flex items-center gap-2">
                                    <select
                                        value={pdfScope}
                                        onChange={(e) => setPdfScope(e.target.value as PrintScope)}
                                        className="rounded-md border-slate-300 bg-white text-sm shadow-sm focus:border-sky-500 focus:ring-sky-500 px-2 py-1"
                                        title="Hangi kayıtların PDF'e aktarılacağını seçin"
                                    >
                                        <option value="selected">Seçili kayıt</option>
                                        <option value="classes">Tüm sınıflar (ayrı sayfalar)</option>
                                        <option value="teachers">Tüm öğretmenler (ayrı sayfalar)</option>
                                        <option value="classMatrix">Toplu sınıf çizelgesi (A4)</option>
                                        <option value="teacherMatrix">Toplu öğretmen çizelgesi (A4)</option>
                                    </select>
                                    <button
                                        onClick={handleExportPdf}
                                        disabled={pdfScope === 'selected' && (viewMode !== 'single' || !selectedHeaderId)}
                                        className={`px-3 py-1.5 rounded-md border text-sm font-medium transition-colors ${pdfScope === 'selected' && (viewMode !== 'single' || !selectedHeaderId) ? 'cursor-not-allowed border-slate-200 text-slate-400 bg-slate-100' : 'border-slate-300 text-slate-700 hover:bg-slate-100'}`}
                                        title={pdfScope === 'selected' && viewMode !== 'single' ? 'Seçili kaydı PDF’e aktarmak için Sade görünüm moduna geçin.' : 'PDF indir'}
                                    >
                                        PDF indir
                                    </button>
                                </div>
                                <button onClick={handleSaveSchedule} className="p-2 text-slate-500 hover:text-sky-600 hover:bg-slate-100 rounded-full" title="Programı Kaydet"><SaveIcon className="w-5 h-5" /></button>
                                <button onClick={handleExportSchedule} className="p-2 text-slate-500 hover:text-sky-600 hover:bg-slate-100 rounded-full" title="Programı ve Verileri İndir"><DownloadIcon className="w-5 h-5" /></button>
                                <button onClick={handlePrint} className="p-2 text-slate-500 hover:text-sky-600 hover:bg-slate-100 rounded-full" title="Yazdır"><PrintIcon className="w-5 h-5" /></button>
                            </div>
                        </div>
                        {moveFeedback && (
                            <div
                                role="status"
                                className={`no-print mb-2 rounded-md px-3 py-2 text-sm ${moveFeedback.kind === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}
                            >
                                {moveFeedback.text}
                            </div>
                        )}
                        {!isSmallScreen && (
                            <TimetableView
                              schedule={schedule}
                              data={data}
                              viewType={viewType}
                              viewMode={viewMode}
                              schoolHours={schoolHours}
                              maxDailyHours={maxDailyHours}
                              selectedHeaderId={selectedHeaderId}
                              onCellDrop={handleManualDrop}
                              onIsMoveValid={handleIsMoveValid}
                            />
                        )}
                        {isSmallScreen && viewMode === 'single' && (
                            <MobileScheduleView
                              schedule={schedule}
                              data={data}
                              viewType={viewType}
                              selectedHeaderId={selectedHeaderId}
                              maxDailyHours={maxDailyHours}
                            />
                        )}
                        {isSmallScreen && viewMode !== 'single' && (
                            <div className="md:hidden mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
                                <p className="mb-3">
                                    Tüm tablo görünümü mobil ekranda desteklenmiyor. Sade görünümü seçerek seçili sınıf veya öğretmeni görüntüleyebilirsiniz.
                                </p>
                                <button
                                    type="button"
                                    onClick={() => setViewMode('single')}
                                    className="inline-flex items-center rounded-md bg-amber-600 px-3 py-1.5 text-white shadow-sm hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
                                >
                                    Sade Görünüm'e geç
                                </button>
                            </div>
                        )}
                    </div>
                )}
                
                 {!isLoading && !schedule && !error && (
                    <div className="flex flex-col items-center justify-center h-96 bg-white rounded-lg shadow-lg text-center p-4 no-print">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-slate-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2-2z" />
                        </svg>
                        <h3 className="text-lg font-medium text-slate-700">Program Bekleniyor</h3>
                        <p className="text-sm text-slate-500 mt-1">Verilerinizi girdikten sonra "Ders Programı Oluştur" butonuna tıklayın.</p>
                    </div>
                 )}
                
                <div className="hidden print:block">
                    {schedule && selectedHeaderId && (
                        <>
                            <h1 className="text-2xl font-bold text-center mb-4">
                                Haftalık Ders Programı - {viewOptions.find(o => o.id === selectedHeaderId)?.name}
                            </h1>
                            <TimetableView 
                                schedule={schedule} 
                                data={data} 
                                viewType={viewType} 
                                viewMode="single"
                                schoolHours={schoolHours}
                                maxDailyHours={maxDailyHours} 
                                selectedHeaderId={selectedHeaderId}
                                onCellDrop={() => {}} 
                                onIsMoveValid={() => false}
                            />
                        </>
                    )}
                </div>
            </main>
            
            <Modal
                isOpen={modalState.type !== null}
                onClose={handleCloseModal}
                title={`${modalState.item ? 'Düzenle' : 'Yeni Ekle'}: ${
                    {
                        teachers: 'Öğretmen',
                        classrooms: 'Sınıf',
                        subjects: 'Ders',
                        locations: 'Mekan',
                        fixedAssignments: 'Sabit Atama',
                        lessonGroups: 'Grup Dersi',
                        duties: 'Ek Görev',
                    }[modalState.type!]
                }`}
            >
                {renderModalContent()}
            </Modal>

            {/* CP-SAT Help Modal */}
            <Modal isOpen={cpHelpOpen} onClose={()=>setCpHelpOpen(false)} title="CP-SAT Ayar Açıklamaları">
              <div className="space-y-3 text-sm text-slate-700">
                <p><span className="font-semibold">Boşlukları azalt</span>: Öğretmenlerin gün içindeki boş saatlerini genel olarak azaltmaya çalışır (ceza ağırlığını artırır).</p>
                <p><span className="font-semibold">Gap üst sınırı</span>: Aynı gün iki ders arasındaki kabul edilebilir en fazla boş saat eşiğidir. Bu eşik aşıldığında ek ceza uygulanır. 1 = daha sıkı, 2 = daha esnek.</p>
                <p><span className="font-semibold">Birlikte kullanım</span>: “Gap üst sınırı” eşiği belirler; “Boşlukları azalt” ise bu boşlukların ne kadar önemli olduğunu (ceza gücünü) artırır. İkisi aynı şeyi değil, birbirini tamamlar.</p>
                <ul className="list-disc list-inside">
                  <li>Hızlı deneme: Sadece “Gap üst sınırı: 2”.</li>
                  <li>Dengeli: “Boşlukları azalt” + “Gap: 2”.</li>
                  <li>Sıkı: “Boşlukları azalt” + “Gap: 1” (çözümsüzlük riski artar).</li>
                </ul>
                <p><span className="font-semibold">Kenar saat azalt</span>: 1. ve son ders saatlerine atamayı azaltmaya çalışır.</p>
                <p><span className="font-semibold">Aynı gün parçalanabilir</span>: Dersi gün içinde araya boşluk girerek bölebilir. Kapalı tutmak blok/bütünlüğü artırır.</p>
              </div>
            </Modal>

        </div>
    );
};
export default App;























