
export enum SchoolLevel {
  Middle = "Ortaokul",
  High = "Lise",
}

export enum ClassGroup {
  None = "Yok",
  TM = "TM",
  Dil = "DİL",
  Soz = "SOS",
  Fen = "FEN",
}

export interface Teacher {
  id: string;
  name: string;
  branches: string[];
  availability: boolean[][]; // 5 days x 16 hours
  canTeachMiddleSchool: boolean;
  canTeachHighSchool: boolean;
}

export interface Classroom {
  id: string;
  name: string;
  level: SchoolLevel;
  group: ClassGroup;
  homeroomTeacherId?: string;
  sessionType: 'full' | 'morning' | 'afternoon';
}

export interface Location {
  id: string;
  name: string;
}

export interface Subject {
  id: string;
  name: string;
  blockHours: number; // How many of the weekly hours should be in 2-hour blocks. Must be an even number.
  tripleBlockHours?: number; // How many of the weekly hours should be in 3-hour blocks. Must be a multiple of 3.
  maxConsec?: number; // Ders bazında ardışık saat limiti
  locationId?: string; // e.g., Lab, Gym
  weeklyHours: number;
  assignedClassIds: string[];
  pinnedTeacherByClassroom?: { // Pin a specific teacher for this subject in a specific classroom
    [classroomId: string]: string; // teacherId
  };
}

export interface FixedAssignment {
  id: string;
  classroomId: string;
  subjectId: string;
  dayIndex: number; // 0-4 for Monday-Friday
  hourIndex: number; // 0-7 for 1st-8th hour
}

export interface LessonGroup {
  id: string;
  name: string;
  subjectId: string;
  classroomIds: string[];
  weeklyHours: number;
  isBlock: boolean;
}

export interface Duty {
  id: string;
  teacherId: string;
  name: string;
  dayIndex: number;
  hourIndex: number;
}

export interface TimetableData {
  teachers: Teacher[];
  classrooms: Classroom[];
  subjects: Subject[];
  locations: Location[];
  fixedAssignments: FixedAssignment[];
  lessonGroups: LessonGroup[];
  duties: Duty[];
}

export interface Assignment {
  subjectId: string;
  teacherId: string;
  locationId?: string;
  classroomId: string;
}

export interface Schedule {
  [classroomId: string]: (Assignment | null)[][]; // Day -> Hour -> Assignment
}

export enum ViewType {
  Class,
  Teacher
}

export interface SavedSchedule {
  id: string;
  name: string;
  createdAt: string;
  schedule: Schedule;
  data: TimetableData; // Snapshot of the data at the time of saving
}

export type SchoolHours = {
  [SchoolLevel.Middle]: number[]; // Array of 5 for Mon-Fri
  [SchoolLevel.High]: number[];   // Array of 5 for Mon-Fri
};

// --- Solver Reporting Interfaces ---

export interface SolverOptions {
  schoolHours: SchoolHours;
  timeLimitSeconds?: number;             // e.g., 30 | 60 | 120 (default: 120)
  enableForwardCheck?: boolean;          // default: true
  stopAtFirstSolution?: boolean;         // default: true
  strategy?: 'repair' | 'tabu';
  maxConsecPerSubject?: number;          // Genel ardışık ders limiti
  tabu?: {                               // Tabu Search parametreleri
    tenure?: number;
    iterations?: number;
  };
  seedRatio?: number;                    // Greedy tohumlama oranı (0.05–0.30 önerilir)
  useRestarts?: boolean;                 // Süre boyunca çoklu yeniden başlatma
  randomSeed?: number;                   // Deterministik çalıştırma için RNG tohumu
  disableLNS?: boolean;                  // LNS (ruin&recreate) devre dışı
  disableTeacherEdgePenalty?: boolean;   // Öğretmen ilk/son saat ve tekil cezasını kapat
  // Opsiyonel kalite/rafinman parametreleri (yerel çözücüler isteğe bağlı kullanır)
  teacherSpreadWeight?: number;
  teacherEdgeWeight?: number;
  allowBlockRelaxation?: boolean;
}

export interface SolverStats {
  startedAt: number;                     // epoch ms
  endedAt: number;                       // epoch ms
  elapsedSeconds: number;
  firstSolutionAt?: number;              // epoch ms (first feasible solution time)
  firstSolutionSeconds?: number;         // seconds from start to first solution
  timedOut: boolean;
  attempts: number;                      // Placement attempts
  placements: number;                    // Final successful placements
  backtracks: number;                    // Number of backtracks
  invalidReasons: {
    levelMismatch: number;
    availability: number;
    classBusy: number;
    teacherBusy: number;
    locationBusy: number;
    blockBoundary: number;
  };
  hardestLessons: Array<{ key: string; failures: number }>; // Lessons that caused the most backtracks
  mrvDeadEnds: number;                   // Number of times MRV found no valid placements
  notes: string[];                       // Explanatory notes (e.g., timeout)
}

export type SolveResult = { 
  schedule: Schedule | null; 
  stats: SolverStats;
};

export type Tab = 'teachers' | 'classrooms' | 'subjects' | 'locations' | 'fixedAssignments' | 'lessonGroups' | 'duties';
