// services/localSolver.ts
// Tek dosyalık yerel çözücü: Min-Conflicts (repair) + opsiyonel Tabu cilası
// Kullanım:
//   solveTimetableLocally(data, {
//     strategy: 'tabu',              // 'repair' (default) veya 'tabu'
//     timeLimitSeconds: 60,
//     maxConsecPerSubject: 2,        // Ortaokul=2, Lise=3 varsayılan (override edebilirsin)
//     schoolHours: { Ortaokul:[8,8,8,8,8], Lise:[8,8,8,8,8] },
//     tabu: { tenure: 25, iterations: 800 }
//   })

// (TS projelerinde tür kontrolü için — runtime'da etkisi yok)
// FIX: Add Teacher, Subject, Classroom to type imports for use in LocalSolver class.
import type { TimetableData, Schedule, SolveResult, SolverOptions, SolverStats, Teacher, Subject, Classroom } from '../types';

function makeWorkerScript() {
  function solverWorker() {
    // ---------- Worker Entry ----------
    self.onmessage = (evt) => {
      const payload = evt?.data || {};
      const data = payload.data || {};
      const options = payload.options || {};

      // Küçük yardımcılar
      const DAYS = 5;
      const DEFAULT_TIME_LIMIT = Math.max(1, options.timeLimitSeconds || 60);

      const rng = {
        _s: (options && typeof options.randomSeed === 'number') ? (options.randomSeed|0) : 1337,
        next() { this._s = (1664525 * this._s + 1013904223) >>> 0; return this._s / 0xFFFFFFFF; },
        pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
      };

      function normalizeName(str) {
        if (!str) return '';
        let s = ('' + str).toLowerCase();
        try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (_) {}
        s = s.replace(/\d+/g, '');
        s = s.replace(/[^a-zA-ZçğıöşüİıÇĞÖŞÜ]/g, '');
        if (s === 'ing' || s === 'ingilizce') s = 'ingilizce';
        if (s === 'mat' || s === 'matematik') s = 'matematik';
        return s;
      }

      class LocalSolver {
        // FIX: Declare all class properties to satisfy TypeScript type checking.
        data: TimetableData;
        options: any; // Using any because it's extended with defaults in the constructor.
        teacherById: Map<string, Teacher>;
        subjectById: Map<string, Subject>;
        classroomById: Map<string, Classroom>;
        schedule: Schedule;
        teacherOccupied: { [key: string]: boolean[][] };
        locationOccupied: { [key: string]: boolean[][] };
        fixedMask: { [key: string]: boolean[][] };
        dailyLessonCounts: { [key: string]: number[] };
        teacherSubjectMap: Map<string, string[]>;
        teacherSubjectMapNorm: Map<string, string[]>;
        maxDailyHours: number;
        stats: SolverStats;
        hardLessonCounter: Map<string, number>;
        failureReason: string | null;
        _deferredReinsert: any[];

        constructor(data: TimetableData, options: SolverOptions) {
          this.data = data as TimetableData;
          this.options = Object.assign({
            strategy: 'repair',
            timeLimitSeconds: DEFAULT_TIME_LIMIT,
            schoolHours: { Ortaokul: [8,8,8,8,8], Lise: [8,8,8,8,8] },
            tabu: { tenure: 25, iterations: 800 },
            seedRatio: 0.15,
            useRestarts: true,
            // New toggles for feasibility-first behavior
            disableLNS: false,              // set true to skip ruin-and-recreate hops
            teacherSpreadWeight: 1,          // set 0 to ignore teacher spread penalty
            teacherEdgeWeight: 1,            // set 0 to ignore first/last/isolated-hour penalty
            stopAtFirstSolution: false,      // set true to return immediately after first feasible
            allowBlockRelaxation: true,      // if false, never split 2'li/3'lü blokları
          }, options || {});
          // Backward-compat for older UI flag
          if (this.options.disableTeacherEdgePenalty === true) {
            this.options.teacherEdgeWeight = 0;
          }

          // Indeksler
          this.teacherById = new Map();
          this.subjectById = new Map();
          this.classroomById = new Map();

          // Program tabloları
          this.schedule = {};           // classId -> [5][H] assignment|null
          this.teacherOccupied = {};    // teacherId -> [5][H] bool
          this.locationOccupied = {};   // locationId -> [5][H] bool
          this.fixedMask = {};          // classId -> [5][H] bool
          this.dailyLessonCounts = {};  // rapor için: classId -> [5] count

          // Branş eşleşmeleri
          this.teacherSubjectMap = new Map();
          this.teacherSubjectMapNorm = new Map();

          const allHours = Object.values(this.options.schoolHours || {}).flat();
          // FIX: Cast `allHours` to number[] to resolve spread operator type error with Math.max.
          this.maxDailyHours = (allHours.length ? Math.max(...(allHours as number[])) : 8) || 8;

          this.stats = {
            startedAt: Date.now(), endedAt: 0, elapsedSeconds: 0, timedOut: false,
            firstSolutionAt: 0, firstSolutionSeconds: 0,
            attempts: 0, placements: 0, backtracks: 0,
            invalidReasons: { levelMismatch: 0, availability: 0, classBusy: 0, teacherBusy: 0, locationBusy: 0, blockBoundary: 0 },
            hardestLessons: [], mrvDeadEnds: 0, notes: []
          };
          this.hardLessonCounter = new Map();
          this.failureReason = null;
          this._deferredReinsert = [];

          this.initialize();
        }

        // ---- Restart helper: clear grids and re-apply static constraints ----
        resetForRestart() {
          const H = this.maxDailyHours;
          // Clear schedules and masks
          for (const c of (this.data.classrooms || [])) {
            this.schedule[c.id]  = Array(DAYS).fill(null).map(() => Array(H).fill(null));
            this.fixedMask[c.id] = Array(DAYS).fill(null).map(() => Array(H).fill(false));
            this.dailyLessonCounts[c.id] = Array(DAYS).fill(0);
          }
          for (const t of (this.data.teachers || [])) {
            this.teacherOccupied[t.id] = Array(DAYS).fill(null).map(() => Array(H).fill(false));
          }
          for (const l of (this.data.locations || [])) {
            this.locationOccupied[l.id] = Array(DAYS).fill(null).map(() => Array(H).fill(false));
          }
          this._deferredReinsert = [];
          this.failureReason = null;

          // Re-apply duties
          (this.data.duties || []).forEach(duty => {
            if (this.teacherOccupied[duty.teacherId]) {
              const d = duty.dayIndex|0, h = duty.hourIndex|0;
              if (d>=0 && d<DAYS && h>=0 && h<H) this.teacherOccupied[duty.teacherId][d][h] = true;
            }
          });
        }

        // ---- Zaman ----
        elapsedSeconds() { return (Date.now() - this.stats.startedAt) / 1000; }
        isTimedOut() {
          const limit = Math.max(1, this.options.timeLimitSeconds || DEFAULT_TIME_LIMIT);
          if (this.elapsedSeconds() > limit) {
            this.stats.timedOut = true;
            this.failureReason = `Zaman limiti (${limit}s) aşıldı.`;
            return true;
          }
          return false;
        }

        // ---- Varsayılanlar & Yardımcılar ----
        defaultMaxConsec(level: string) { return level === 'Lise' ? 3 : 2; }

        getRunLimitFor(classroomId: string, subjectId: string){
          const cls  = this.classroomById.get(classroomId);
          const subj = this.subjectById.get(subjectId);

          // Ders özelinde override
          if (typeof subj?.maxConsec === "number") return subj.maxConsec;

          // 3'lü blok tanımlıysa 3'e izin ver
          if ((subj?.tripleBlockHours|0) >= 3) return 3;

          // 2'li blok tanımlıysa en az 2'ye izin ver
          if ((subj?.blockHours|0) >= 2)
            return Math.max(2, this.options.maxConsecPerSubject || this.defaultMaxConsec(cls?.level));

          // Genel kural
          return this.options.maxConsecPerSubject || this.defaultMaxConsec(cls?.level);
        }

        getAllowedWindow(classroom: Classroom, day: number) {
          const daily = (this.options.schoolHours[classroom.level] || [])[day] || 0;
          const split = Math.floor(daily / 2);
          switch (classroom.sessionType || 'full') {
            case 'morning': return { start: 0, end: split };
            case 'afternoon': return { start: split, end: daily };
            default: return { start: 0, end: daily };
          }
        }
        lessonKey(classroomId: string, subjectId: string, isBlock: boolean, span: number) {
          const c = this.classroomById.get(classroomId);
          const s = this.subjectById.get(subjectId);
          const tag = isBlock ? (span === 3 ? " (3'lü blok)" : ' (blok)') : '';
          return `${(c?.name || classroomId)} – ${(s?.name || subjectId)}${tag}`;
        }
        bumpHardLesson(key: string) {
          this.hardLessonCounter.set(key, (this.hardLessonCounter.get(key) || 0) + 1);
        }

        // ---- Init ----
        initialize() {
          (this.data.teachers || []).forEach(t => this.teacherById.set(t.id, t));
          (this.data.subjects || []).forEach(s => this.subjectById.set(s.id, s));
          (this.data.classrooms || []).forEach(c => this.classroomById.set(c.id, c));

          const H = this.maxDailyHours;
          (this.data.classrooms || []).forEach(c => {
            this.schedule[c.id]  = Array(DAYS).fill(null).map(() => Array(H).fill(null));
            this.fixedMask[c.id] = Array(DAYS).fill(null).map(() => Array(H).fill(false));
            this.dailyLessonCounts[c.id] = Array(DAYS).fill(0);
          });
          (this.data.teachers || []).forEach(t => {
            this.teacherOccupied[t.id] = Array(DAYS).fill(null).map(() => Array(H).fill(false));
          });
          (this.data.locations || []).forEach(l => {
            this.locationOccupied[l.id] = Array(DAYS).fill(null).map(() => Array(H).fill(false));
          });

          // Branş map’leri
          (this.data.teachers || []).forEach(teacher => {
            (teacher.branches || []).forEach(branch => {
              if (!this.teacherSubjectMap.has(branch)) this.teacherSubjectMap.set(branch, []);
              this.teacherSubjectMap.get(branch)!.push(teacher.id);
              const nb = normalizeName(branch);
              if (!this.teacherSubjectMapNorm.has(nb)) this.teacherSubjectMapNorm.set(nb, []);
              this.teacherSubjectMapNorm.get(nb)!.push(teacher.id);
            });
          });

          // Nöbet/duty saatlerini meşgul say
          (this.data.duties || []).forEach(duty => {
            if (this.teacherOccupied[duty.teacherId]) {
              const d = duty.dayIndex|0, h = duty.hourIndex|0;
              if (d>=0 && d<DAYS && h>=0 && h<H) this.teacherOccupied[duty.teacherId][d][h] = true;
            }
          });
        }

        // ---- Multi-teacher helpers ----
        // Return the primary teacher id for an assignment (first entry of teacherIds or legacy teacherId)
        primaryTeacherId(assignment: any): string | null {
          if (!assignment) return null;
          if (Array.isArray((assignment as any).teacherIds) && (assignment as any).teacherIds.length) return (assignment as any).teacherIds[0];
          if ((assignment as any).teacherId) return (assignment as any).teacherId;
          return null;
        }

        // Return all teacher ids for an assignment (array or legacy single id)
        teacherIdsOf(assignment: any): string[] {
          if (!assignment) return [];
          if (Array.isArray((assignment as any).teacherIds)) return (assignment as any).teacherIds.slice();
          if ((assignment as any).teacherId) return [(assignment as any).teacherId];
          return [];
        }


teacherObjectsFromIds(ids: string[]): Teacher[] {
  if (!Array.isArray(ids)) return [];
  const out: Teacher[] = [];
  for (const id of ids) {
    const teacher = this.teacherById.get(id);
    if (teacher) out.push(teacher);
  }
  return out;
}

buildTeacherCombos(subject: Subject | undefined, classroomId: string): Teacher[][] {
  if (!subject) return [];
  const required = Math.max(1, subject.requiredTeacherCount || 1);
  const pinnedRaw = (subject.pinnedTeacherByClassroom || {})[classroomId] || [];
  const pinnedTeachers: Teacher[] = [];
  const seenPinned = new Set<string>();
  const toIterate = Array.isArray(pinnedRaw) ? pinnedRaw : [pinnedRaw];
  for (const pid of toIterate) {
    if (typeof pid !== 'string') continue;
    const teacher = this.teacherById.get(pid);
    if (teacher && !seenPinned.has(pid)) {
      pinnedTeachers.push(teacher);
      seenPinned.add(pid);
    }
  }

  if (pinnedTeachers.length >= required) {
    return [pinnedTeachers.slice(0, required)];
  }

  const candidateIds = this.getTeacherCandidates(subject, classroomId);
  const uniqueCandidateIds: string[] = [];
  for (const id of candidateIds) {
    if (!seenPinned.has(id) && !uniqueCandidateIds.includes(id)) uniqueCandidateIds.push(id);
  }
  const candidateTeachers: Teacher[] = [];
  for (const id of uniqueCandidateIds) {
    const teacher = this.teacherById.get(id);
    if (teacher) candidateTeachers.push(teacher);
  }

  const need = required - pinnedTeachers.length;
  if (need <= 0) {
    return [pinnedTeachers.slice(0, required)];
  }
  if (candidateTeachers.length + pinnedTeachers.length < required) {
    return [];
  }

  const combos: Teacher[][] = [];
  const current: Teacher[] = [];
  const limit = 40;
  const dfs = (start: number) => {
    if (combos.length >= limit) return;
    if (current.length === need) {
      combos.push(pinnedTeachers.concat(current.slice()));
      return;
    }
    for (let i = start; i < candidateTeachers.length; i++) {
      current.push(candidateTeachers[i]);
      dfs(i + 1);
      current.pop();
      if (combos.length >= limit) return;
    }
  };
  dfs(0);

  if (!combos.length && candidateTeachers.length) {
    const fallback = pinnedTeachers.slice();
    for (const teacher of candidateTeachers) {
      if (fallback.length < required) fallback.push(teacher);
    }
    if (fallback.length === required) combos.push(fallback);
  }

  const unique: Teacher[][] = [];
  const seen = new Set<string>();
  for (const combo of combos) {
    if (combo.length !== required) continue;
    const key = combo.map((t) => t.id).sort().join('|');
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(combo);
    }
  }

  return unique;
}

        // ---- Öğretmen adayları ----
        getTeacherCandidates(subject: Subject, classroomId: string){
          const list: string[] = [];
          const pinned = subject?.pinnedTeacherByClassroom?.[classroomId];
          if (pinned && Array.isArray(pinned)) {
            list.push(...pinned.filter(p => this.teacherById.has(p)));
          }

          if (Array.isArray((subject as any)?.teacherIds))
            for (const id of (subject as any).teacherIds) if (this.teacherById.has(id)) list.push(id);

          for (const id of (this.teacherSubjectMap.get(subject?.name)||[])) list.push(id);

          const nb = normalizeName(subject?.name);
          for (const id of (this.teacherSubjectMapNorm.get(nb)||[])) list.push(id);

          const uniq = Array.from(new Set(list));
          if (!classroomId) return uniq;

          const cls = this.classroomById.get(classroomId);
          const isHS = cls?.level === "Lise";
          return uniq.filter(id => {
            const t = this.teacherById.get(id);
            return isHS ? !!t?.canTeachHighSchool : !!t?.canTeachMiddleSchool;
          });
        }

        findTeachersForSubject(name: string) {
          const list = (this.teacherSubjectMap.get(name)||[]).slice();
          const list2 = (this.teacherSubjectMapNorm.get(normalizeName(name))||[]).slice();
          return Array.from(new Set(list.concat(list2)));
        }

        // ---- Preflight ----
        preflightValidate() {
          const issues: string[] = [];
          
          const missing = [];
          for (const subject of (this.data.subjects||[])) {
            for (const classId of (subject.assignedClassIds||[])) {
              const cands = this.getTeacherCandidates(subject, classId);
              if (!cands || cands.length === 0) {
                const cname = this.classroomById.get(classId)?.name || classId;
                missing.push(`${subject.name} / ${cname}`);
              }
            }
          }
          if (missing.length) {
            issues.push("Öğretmen eşleşmesi yok: " + missing.slice(0,6).join(", ") + (missing.length>6?" â€¦":""));
          }

          // kapasite
          const demand = new Map();
          (this.data.subjects || []).forEach(s => {
            (s.assignedClassIds || []).forEach(cid => demand.set(cid, (demand.get(cid)||0) + (s.weeklyHours||0)));
          });
          (this.data.lessonGroups || []).forEach(g => {
            (g.classroomIds || []).forEach(cid => demand.set(cid, (demand.get(cid)||0) + (g.weeklyHours||0)));
          });
          for (const c of (this.data.classrooms || [])) {
            let cap = 0;
            for (let d=0; d<DAYS; d++) { const w = this.getAllowedWindow(c, d); cap += Math.max(0, w.end - w.start); }
            const dem = demand.get(c.id) || 0;
            if (dem > cap) issues.push(`Kapasite aşımı: ${(c.name||c.id)} talep=${dem} > kapasite=${cap}`);
          }

          // Validate subject locations exist in data.locations
          const locIds = new Set((this.data.locations || []).map((l:any) => l.id));
          for (const s of (this.data.subjects || [])) {
            if (s?.locationId && !locIds.has(s.locationId)) {
              issues.push(`Ders '${s.name}' için tanımsız mekan (locationId='${s.locationId}')`);
            }
          }

          if (issues.length) throw new Error('Veri tutarsızlıkları: ' + issues.join(' | '));
        }

        // ---- Çöz ----
        solve() {
          try { this.preflightValidate(); }
          catch(e: any) { this.stats.notes.push('Ön kontrol hatası: ' + (e?.message || e)); this.finishStats(); throw e; }

          let bestScore = Infinity;
          let bestSnapshot: string | null = null;
          let bestNotes: string[] = [];
          let foundAny = false;

          while (!this.isTimedOut()) {
            // Start a fresh attempt
            this.resetForRestart();
            if (!this.placeFixedAssignments()) {
              // Fixed assignments infeasible, skip attempt
              continue;
            }

            let units = this.buildUnits();
            // Light randomization across attempts
            for (let i=units.length-1;i>0;i--) { const j=(rng.next()*(i+1))|0; const t=units[i]; units[i]=units[j]; units[j]=t; }
            this.greedySeed(units);

            let ok = this.repairLoop(units);
            if (!ok && !this.isTimedOut() && this.options.allowBlockRelaxation !== false) {
              this.stats.notes.push("Bloklar tamamen esnetildi (2'li/3'lü bloklar tekil saate çevrildi).");
              const singles = units.map(u => u.type==='single' ? Object.assign({},u,{span:1}) : u);
              ok = this.repairLoop(singles);
            }

            if (ok) {
              this.compactSchedule();
              // Record time of first feasible schedule
              if (!this.stats.firstSolutionAt) {
                this.stats.firstSolutionAt = Date.now();
                this.stats.firstSolutionSeconds = +(((this.stats.firstSolutionAt - this.stats.startedAt) / 1000).toFixed(3));
              }
              // Early exit on first feasible solution if requested
              if (this.options.stopAtFirstSolution) {
                this.finishStats();
                return { schedule: this.schedule, stats: this.buildHardestLessons() } as any;
              }
              if (this.options.strategy === 'tabu') {
                this.tabuOptimize();
                this.compactSchedule();
                this.stats.notes.push('Tabu Search: relocate+swap ile boşluk/ardışık iyileştirildi.');
              } else {
                this.stats.notes.push('Strateji: Min-Conflicts (repair) + yerel onarım.');
              }

              // Optional LNS hops while time remains
              if (!this.options.disableLNS) {
                if (!this.isTimedOut()) this.ruinAndRecreate(20);
                if (!this.isTimedOut()) this.ruinAndRecreate(25);
              }
              // Additional strategy-specific improvements
              if (this.options.strategy === "sa") { this.simulatedAnnealing(); this.compactSchedule(); this.stats.notes.push("Simulated Annealing: kabul/ret ile yerel iyileştirme."); }
              else if (this.options.strategy === "alns") { this.alnsOptimize(); this.compactSchedule(); this.stats.notes.push("ALNS: uyarlamalı ruin & recreate adımları."); }
              else if (this.options.strategy === "vns") { this.vnsOptimize(); this.compactSchedule(); this.stats.notes.push("VNS: farklı komşuluklarda sistematik arama."); }

              const score = this.objectiveScore();
              if (score < bestScore) { bestScore = score; bestSnapshot = JSON.stringify(this.schedule); bestNotes = this.stats.notes.slice(); foundAny = true; }
              if (this.options.stopAtFirstSolution) {
                // Return immediately with this solution
                this.schedule = JSON.parse(bestSnapshot!);
                this.finishStats();
                if (bestNotes && bestNotes.length) this.stats.notes = Array.from(new Set(bestNotes));
                return { schedule: this.schedule, stats: this.buildHardestLessons() } as any;
              }
              // Devam: süre bitene kadar daha iyi çözüm aramaya devam et
            } else {
              // attempt failed; keep searching until timeout
              if (this.failureReason) this.stats.notes.push(this.failureReason);
            }
          }

          // Finalize
          if (foundAny && bestSnapshot) {
            this.schedule = JSON.parse(bestSnapshot);
            this.finishStats();
            if (bestNotes && bestNotes.length) this.stats.notes = Array.from(new Set(bestNotes));
            return { schedule: this.schedule, stats: this.buildHardestLessons() };
          }
          this.finishStats();
          if (!this.stats.timedOut && !this.failureReason) this.stats.notes.push('Çözüm bulunamadı. Kısıtlar çok sıkı olabilir.');
          return { schedule: null, stats: this.buildHardestLessons() };
        }

        // ---- Sabitler ----

placeFixedAssignments() {
  for (const f of (this.data.fixedAssignments || [])) {
    const cls = this.classroomById.get(f.classroomId);
    const sub = this.subjectById.get(f.subjectId);
    if (!cls || !sub) continue;
    const w = this.getAllowedWindow(cls, f.dayIndex|0);
    const d = f.dayIndex|0, h = f.hourIndex|0;
    if (d<0 || d>=DAYS || h<w.start || h>=w.end) return false;
    const combos = this.buildTeacherCombos(sub, f.classroomId);
    if (!combos.length) return false;
    let placed = false;
    for (const combo of combos) {
      if (this.isValid(f.classroomId, sub, combo, d, h, 1)) {
        this.placeLesson(f.classroomId, sub, combo, d, h, 1);
        this.fixedMask[f.classroomId][d][h] = true;
        placed = true; break;
      }
    }
    if (!placed) return false;
  }
  return true;
}

        // ---- Unit üretimi ----
        buildUnits() {
          const out: any[] = [];
          for (const subject of (this.data.subjects || [])) {
            if (!subject) continue;
            for (const classId of (subject.assignedClassIds || [])) {
              let remaining = subject.weeklyHours || 0;

              // zaten yerleşmişleri düş (sabitler)
              const counted = new Set();
              for (let d=0; d<DAYS; d++) {
                const row = this.schedule[classId]?.[d];
                if (!row) continue;
                let h=0;
                while (h < this.maxDailyHours) {
                  const a = row[h];
                  if (a && a.subjectId===subject.id && !counted.has(a)) {
                    counted.add(a);
                    let span=1; while (h+span<this.maxDailyHours && row[h+span]===a) span++;
                    remaining -= span; h += span;
                  } else h++;
                }
              }
              if (remaining <= 0) continue;

              let tripleBudget = Math.floor(Math.max(0, subject.tripleBlockHours||0)/3);
              let doubleBudget = Math.floor(Math.max(0, subject.blockHours||0)/2);

              while (remaining>=3 && tripleBudget>0) { out.push({type:'single', classroomId:classId, subjectId:subject.id, span:3}); remaining-=3; tripleBudget--; }
              while (remaining>=2 && doubleBudget>0) { out.push({type:'single', classroomId:classId, subjectId:subject.id, span:2}); remaining-=2; doubleBudget--; }
              for (let i=0;i<remaining;i++) out.push({type:'single', classroomId:classId, subjectId:subject.id, span:1});
            }
          }

          for (const g of (this.data.lessonGroups || [])) {
            let hours = g.weeklyHours||0; if (hours<=0) continue;
            if (g.isBlock) {
              const pairs=Math.floor(hours/2);
              for (let i=0;i<pairs;i++) out.push({type:'group', groupId:g.id, blockSpan:2});
              if (hours%2===1) out.push({type:'group', groupId:g.id, blockSpan:1});
            } else {
              for (let i=0;i<hours;i++) out.push({type:'group', groupId:g.id, blockSpan:1});
            }
          }
          return out;
        }

        // ---- Seed ----
        greedySeed(units: any[]) {
          const ratio = Math.max(0.01, Math.min(0.5, this.options.seedRatio || 0.15));
          const seedCount = Math.min(Math.ceil(units.length * ratio), 100);
          const scored = units.map((u,i)=>({i, c:this.countValidPlacementsApprox(u)})).sort((a,b)=>a.c-b.c);
          const placed = new Set();
          for (let k=0;k<seedCount;k++) {
            const u = units[scored[k].i]; if (!u) continue;
            if (u.type==='single') {
              const s = this.subjectById.get(u.subjectId);
              const c = this.classroomById.get(u.classroomId);
              if (!s || !c) continue;
              const combos = this.buildTeacherCombos(s, u.classroomId);
              const cands = this.enumerateValidSlotsForSingle(u, s, c, combos);
              if (cands.length) {
                cands.sort((a,b)=> this.scorePlacement(a.unit,a.d,a.h,a.teachers) - this.scorePlacement(b.unit,b.d,b.h,b.teachers)).reverse();
                const top = cands[0];
                this.placeLesson(u.classroomId, s, top.teachers, top.d, top.h, u.span);
                placed.add(scored[k].i);
              }
            }
            if (this.isTimedOut()) break;
          }
          if (placed.size) {
            const rest: any[] = []; for (let i=0;i<units.length;i++) if (!placed.has(i)) rest.push(units[i]);
            units.length = 0; units.push(...rest);
          }
        }

        // ---- Repair ----
        repairLoop(units: any[]) {
          const pool = units.slice();
          this.drainDeferred(pool);

          while (pool.length) {
            if (this.isTimedOut()) return false;

            // MRV + span önceliği
            let idx=-1, best=Infinity, bestSpan=-1;
            for (let i=0;i<pool.length;i++) {
              const L = pool[i];
              const cnt = this.countValidPlacementsApprox(L);
              const span = (L.type==='single') ? L.span : (L.blockSpan||1);
              if (cnt<best || (cnt===best && span>bestSpan)) { best=cnt; bestSpan=span; idx=i; }
            }

            // "sıfır aday" → parçalama (opsiyonel)
            if (best === 0) {
              const U = pool.splice(idx,1)[0];
              if (this.options.allowBlockRelaxation === false) {
                const key = (U.type==='single')
                  ? this.lessonKey(U.classroomId, U.subjectId, (U.span||1)>1, U.span||1)
                  : ('[GRUP] ' + (this.subjectById.get(this.data.lessonGroups?.find(g=>g.id===U.groupId)?.subjectId)?.name || 'Bilinmeyen'));
                this.bumpHardLesson(key);
                this.failureReason = key + ' için geçerli yer bulunamadı.';
                return false;
              }
              if (U.type==='single' && U.span===3) {
                pool.push(Object.assign({},U,{span:2}), Object.assign({},U,{span:1}));
                this.stats.notes.push(`3'lü blok esnetildi: 2+1 → ${this.lessonKey(U.classroomId, U.subjectId, true, 3)}`);
                continue;
              } else if (U.type==='single' && U.span===2) {
                pool.push(Object.assign({},U,{span:1}), Object.assign({},U,{span:1}));
                this.stats.notes.push(`2'li blok esnetildi: 1+1 → ${this.lessonKey(U.classroomId, U.subjectId, true, 2)}`);
                continue;
              } else {
                const key = (U.type==='single')
                  ? this.lessonKey(U.classroomId, U.subjectId, (U.span||1)>1, U.span||1)
                  : ('[GRUP] ' + (this.subjectById.get(this.data.lessonGroups?.find(g=>g.id===U.groupId)?.subjectId)?.name || 'Bilinmeyen'));
                this.bumpHardLesson(key);
                this.failureReason = key + ' için geçerli yer bulunamadı.';
                return false;
              }
            }

            const unit = pool.splice(idx,1)[0];
            const placed = (unit.type==='single') ? this.placeUnitSingleWithRepair(unit)
                                                  : this.placeUnitGroupWithRepair(unit);
            if (!placed) {
              const key = (unit.type==='single')
                ? this.lessonKey(unit.classroomId, unit.subjectId, (unit.span||1)>1, unit.span||1)
                : ('[GRUP] ' + (this.subjectById.get(this.data.lessonGroups?.find(g=>g.id===unit.groupId)?.subjectId)?.name || 'Bilinmeyen'));
              this.bumpHardLesson(key);
              this.failureReason = key + ' için geçerli yer bulunamadı.';
              return false;
            }

            this.drainDeferred(pool);
          }
          return true;
        }

        drainDeferred(pool: any[]) {
          if (this._deferredReinsert && this._deferredReinsert.length) {
            for (const u of this._deferredReinsert) pool.push(u);
            this._deferredReinsert = [];
          }
        }

        // Tekil + küçük sök-tak

placeUnitSingleWithRepair(u: any) {
  const sub = this.subjectById.get(u.subjectId);
  const cls = this.classroomById.get(u.classroomId);
  if (!sub || !cls) return false;
  const teacherCombos = this.buildTeacherCombos(sub, u.classroomId);
  if (!teacherCombos.length) return false;

  const cands = this.enumerateValidSlotsForSingle(u, sub, cls, teacherCombos);
  if (cands.length) {
    cands.sort((a,b)=> this.scorePlacement(a.unit,a.d,a.h,a.teachers) - this.scorePlacement(b.unit,b.d,b.h,b.teachers)).reverse();
    const top = cands[0];
    this.placeLesson(u.classroomId, sub, top.teachers, top.d, top.h, u.span);
    return true;
  }

  const victims = this.pickBlockingAssignmentsForSingle(u, sub, cls, teacherCombos, 6);
  if (!victims.length) return false;

  const removed: any[] = [], removedAssn = new Set();
  for (const v of victims) {
    if (this.fixedMask[v.classroomId]?.[v.day]?.[v.hour]) continue;
    const assn = this.schedule[v.classroomId]?.[v.day]?.[v.hour];
    if (!assn || removedAssn.has(assn)) continue;
    const span = this.getSpanAt(v.classroomId, v.day, v.hour);
    this.removeLesson(v.classroomId, assn, v.day, v.hour, span);
    removedAssn.add(assn);
    removed.push({ type:'single', classroomId:v.classroomId, subjectId:assn.subjectId, span });
    if (this.isTimedOut()) break;
  }

  const c2 = this.enumerateValidSlotsForSingle(u, sub, cls, teacherCombos);
  if (c2.length) {
    c2.sort((a,b)=> this.scorePlacement(a.unit,a.d,a.h,a.teachers) - this.scorePlacement(b.unit,b.d,b.h,b.teachers)).reverse();
    const top = c2[0];
    this.placeLesson(u.classroomId, sub, top.teachers, top.d, top.h, u.span);
    this.stats.backtracks += removed.length;
    this._deferredReinsert = (this._deferredReinsert || []).concat(removed);
    return true;
  }

  // rollback best-effort
  for (const r of removed) {
    const s2 = this.subjectById.get(r.subjectId); if (!s2) continue;
    const cls2 = this.classroomById.get(r.classroomId); if (!cls2) continue;
    const combos2 = this.buildTeacherCombos(s2, r.classroomId);
    if (!combos2.length) continue;
    const cR = this.enumerateValidSlotsForSingle(r, s2, cls2, combos2);
    if (cR.length) {
      const top = cR[Math.floor(rng.next() * cR.length)];
      this.placeLesson(r.classroomId, s2, top.teachers, top.d, top.h, r.span);
    }
  }
  return false;
}

        // Grup (varsa)
        placeUnitGroupWithRepair(unit: any) {
          const group = (this.data.lessonGroups || []).find(g=>g.id===unit.groupId);
          const subject = this.subjectById.get(group?.subjectId);
          if (!group || !subject) return false;

          const ok1 = this.tryPlaceGroupAtAnyValidSlot(group, subject, unit.blockSpan || 1);
          if (ok1) return true;

          const victims = this.pickBlockingAssignmentsForGroup(group, subject, unit.blockSpan||1, 8);
          const removed: any[] = [], removedAssn = new Set();
          for (const v of victims) {
            if (this.fixedMask[v.classroomId]?.[v.day]?.[v.hour]) continue;
            const assn = this.schedule[v.classroomId]?.[v.day]?.[v.hour];
            if (!assn || removedAssn.has(assn)) continue;
            const span = this.getSpanAt(v.classroomId, v.day, v.hour);
            this.removeLesson(v.classroomId, assn, v.day, v.hour, span);
            removedAssn.add(assn);
            removed.push({ type:'single', classroomId:v.classroomId, subjectId:assn.subjectId, span });
            if (this.isTimedOut()) break;
          }

          const ok2 = this.tryPlaceGroupAtAnyValidSlot(group, subject, unit.blockSpan || 1);
          if (ok2) {
            this.stats.backtracks += removed.length;
            this._deferredReinsert = (this._deferredReinsert || []).concat(removed);
            return true;
          }

          // rollback
          for (const r of removed) {
            const s2 = this.subjectById.get(r.subjectId); if (!s2) continue;
            const cls2 = this.classroomById.get(r.classroomId); if (!cls2) continue;
            const combos2 = this.buildTeacherCombos(s2, r.classroomId);
            if (!combos2.length) continue;
            const cR = this.enumerateValidSlotsForSingle(r, s2, cls2, combos2);
            if (cR.length) { const top = cR[Math.floor(rng.next() * cR.length)]; this.placeLesson(r.classroomId, s2, top.teachers, top.d, top.h, r.span); }
          }
          return false;
        }

        tryPlaceGroupAtAnyValidSlot(group: any, subject: Subject, span: number) {
          const teachers = this.findTeachersForSubject(subject.name);
          for (let d=0; d<DAYS; d++) {
            const win = this.getGroupAllowedWindow(group.classroomIds, d);
            const maxH = win.end - (span-1);
            for (let h=win.start; h<maxH; h++) {
              const assign = this.findGroupAssignment(group, subject, d, h, teachers, span);
              if (assign) { this.placeGroupLesson(group, subject, d, h, assign, span); return true; }
            }
          }
          return false;
        }

        // ---- Aday sayımı & aday üretimi ----

countValidPlacementsApprox(unit: any) {
  if (unit.type==='group') {
    const group = (this.data.lessonGroups||[]).find(g=>g.id===unit.groupId);
    const subject = this.subjectById.get(group?.subjectId); if (!group || !subject) return 0;
    const teachers = this.findTeachersForSubject(subject.name);
    const span = unit.blockSpan || 1;
    let cnt=0;
    for (let d=0; d<DAYS; d++) {
      const win = this.getGroupAllowedWindow(group.classroomIds, d);
      const maxH = win.end - (span-1);
      for (let h=win.start; h<maxH; h++) if (this.findGroupAssignment(group, subject, d, h, teachers, span)) cnt++;
    }
    return cnt;
  } else {
    const subject = this.subjectById.get(unit.subjectId);
    const classroom = this.classroomById.get(unit.classroomId);
    if (!subject || !classroom) return 0;
    const combos = this.buildTeacherCombos(subject, unit.classroomId);
    if (!combos.length) return 0;
    let cnt=0;
    for (const combo of combos) {
      for (let d=0; d<DAYS; d++) {
        const win = this.getAllowedWindow(classroom, d);
        const maxH = win.end - (unit.span-1);
        for (let h=win.start; h<maxH; h++) if (this.isValid(unit.classroomId, subject, combo, d, h, unit.span)) cnt++;
      }
    }
    return cnt;
  }
}

enumerateValidSlotsForSingle(unit: any, subject: Subject, classroom: Classroom, teacherCombos: Teacher[][]) {
  const out: any[] = []; const span = unit.span || 1;
  for (const combo of teacherCombos) {
    if (!combo.length) continue;
    for (let d=0; d<DAYS; d++) {
      const win = this.getAllowedWindow(classroom, d);
      const maxH = win.end - (span-1);
      for (let h=win.start; h<maxH; h++) if (this.isValid(unit.classroomId, subject, combo, d, h, span)) out.push({d, h, teachers: combo, unit});
    }
  }
  return out;
}

pickBlockingAssignmentsForSingle(unit: any, subject: Subject, classroom: Classroom, teacherCombos: Teacher[][], K: number) {
  const span = unit.span || 1;
  const candidates: any[] = [];
  for (const combo of teacherCombos) {
    if (!combo.length) continue;
    for (let d=0; d<DAYS; d++) {
      const win = this.getAllowedWindow(classroom, d);
      const maxH = win.end - (span-1);
      for (let h=win.start; h<maxH; h++) {
        const block = this.listConflictingAssignments(unit.classroomId, subject, combo, d, h, span);
        if (block) candidates.push(block);
      }
    }
  }
  if (!candidates.length) return [];
  candidates.sort((a,b)=> a.items.length - b.items.length);
  const best = candidates[0].items.filter((x: any) => !this.fixedMask[x.classroomId]?.[x.day]?.[x.hour]);
  return best.slice(0, K||6);
}

listConflictingAssignments(classroomId: string, subject: Subject, teachers: Teacher[], day: number, hour: number, span: number) {
  const classroom = this.classroomById.get(classroomId)!;
  const { start, end } = this.getAllowedWindow(classroom, day);
  if (hour<start || (hour+span)>end) return null;
  if (!teachers || !teachers.length) return null;
  for (const teacher of teachers) {
    if (classroom.level==='Ortaokul' && !teacher.canTeachMiddleSchool) return null;
    if (classroom.level==='Lise' && !teacher.canTeachHighSchool) return null;
  }

  const items: any[] = [];
  const row = this.schedule[classroomId][day];
  let left=0, right=0;
  for (let i=hour-1; i>=start; i--) { const a=row[i]; if (a && a.subjectId===subject.id) left++; else break; }
  for (let i=hour+span; i<end; i++) { const a=row[i]; if (a && a.subjectId===subject.id) right++; else break; }

  const maxC = this.getRunLimitFor(classroomId, subject.id);
  if (left + span + right > maxC) {
    for (let i=hour-1;i>=start;i--){ const a=row[i]; if (a&&a.subjectId===subject.id) items.push({classroomId,day,hour:i}); else break; }
    for (let i=hour+span;i<end;i++){ const a=row[i]; if (a&&a.subjectId===subject.id) items.push({classroomId,day,hour:i}); else break; }
  }

  for (let k=0;k<span;k++) {
    const h = hour+k;
    const assnC = this.schedule[classroomId][day][h]; if (assnC) items.push({classroomId,day,hour:h});
    for (const teacher of teachers) {
      if (!teacher.availability?.[day]?.[h]) return null;
      if (this.teacherOccupied[teacher.id][day][h]) {
        const clash = this.findAssignmentByTeacherAt(teacher.id, day, h); if (clash) items.push({classroomId:clash.classroomId, day, hour:clash.hour});
      }
    }
    if (subject.locationId && this.locationOccupied[subject.locationId]?.[day]?.[h]) {
      const clash = this.findAssignmentByLocationAt(subject.locationId, day, h); if (clash) items.push({classroomId:clash.classroomId, day, hour:clash.hour});
    }
  }

  const seen = new Set(); const uniq: any[] = [];
  for (const it of items) { const key = it.classroomId+'|'+it.day+'|'+it.hour; if (!seen.has(key)) { seen.add(key); uniq.push(it); } }
  return { items: uniq };
}

        findAssignmentByTeacherAt(teacherId: string, day: number, hour: number) {
          for (const classId of Object.keys(this.schedule)) {
            const a = this.schedule[classId][day][hour];
            if (!a) continue;
            // Support assignments with teacherIds array or legacy teacherId field.
            if (Array.isArray((a as any).teacherIds) && (a as any).teacherIds.includes(teacherId)) return { classroomId: classId, day, hour };
            if ((a as any).teacherId === teacherId) return { classroomId: classId, day, hour };
          }
          return null;
        }
        findAssignmentByLocationAt(locationId: string, day: number, hour: number) {
          for (const classId of Object.keys(this.schedule)) {
            const a = this.schedule[classId][day][hour];
            if (a && a.locationId === locationId) return { classroomId: classId, day, hour };
          }
          return null;
        }

        getGroupAllowedWindow(classIds: string[], day: number) {
          let start=0, end=this.maxDailyHours;
          for (const cid of classIds) {
            const c = this.classroomById.get(cid); if (!c) continue;
            const w = this.getAllowedWindow(c, day);
            start = Math.max(start, w.start); end = Math.min(end, w.end);
          }
          if (end<start) return { start:0, end:0 };
          return { start, end };
        }
        findGroupAssignment(group: any, subject: Subject, day: number, hour: number, teacherIds: string[], span: number) {
          const win = this.getGroupAllowedWindow(group.classroomIds, day);
          if (hour<win.start || (hour+span)>win.end) return false;
          for (const classId of group.classroomIds) {
            const c = this.classroomById.get(classId); if (!c) return false;
            const w = this.getAllowedWindow(c, day);
            if (hour<w.start || (hour+span)>w.end) return false;
            for (let k=0;k<span;k++) if (this.schedule[classId][day][hour+k]) return false;
            if (this.violatesRunLimit(classId, subject.id, day, hour, span)) return false;
          }
          for (let k=0;k<span;k++) if (subject.locationId && this.locationOccupied[subject.locationId]?.[day]?.[hour+k]) return false;

          const teacherObjs = teacherIds.map(id=>this.teacherById.get(id)).filter(Boolean);
          const classes = group.classroomIds.slice();
          const candByClass = new Map();
          for (const classId of classes) {
            const cr = this.classroomById.get(classId)!;
            const list: Teacher[] = [];
            for (const t of teacherObjs) {
              let ok=true;
              if ((cr.level==='Ortaokul' && !t.canTeachMiddleSchool) || (cr.level==='Lise' && !t.canTeachHighSchool)) ok=false;
              for (let k=0;k<span && ok;k++) if (!t.availability?.[day]?.[hour+k] || this.teacherOccupied[t.id][day][hour+k]) ok=false;
              if (ok) list.push(t);
            }
            if (!list.length) return false;
            candByClass.set(classId, list);
          }
          classes.sort((a: string,b: string)=>(candByClass.get(a).length - candByClass.get(b).length));
          const used = new Set(); const assign: any = {};
          const dfs = (i: number): boolean => {
            if (i===classes.length) return true;
            const cid = classes[i];
            for (const t of candByClass.get(cid)) {
              if (used.has(t.id)) continue;
              used.add(t.id); assign[cid]=t;
              if (dfs(i+1)) return true;
              used.delete(t.id);
            }
            return false;
          };
          return dfs(0) ? assign : false;
        }

        // ---- Geçerlilik ----
        violatesRunLimit(classroomId: string, subjectId: string, day: number, hour: number, span: number) {
          const classroom = this.classroomById.get(classroomId)!;
          const { start, end } = this.getAllowedWindow(classroom, day);
          const row = this.schedule[classroomId][day];
          let left=0, right=0;
          for (let i=hour-1; i>=start; i--) { const a=row[i]; if (a && a.subjectId===subjectId) left++; else break; }
          for (let i=hour+span; i<end; i++) { const a=row[i]; if (a && a.subjectId===subjectId) right++; else break; }
          const maxC = this.getRunLimitFor(classroomId, subjectId);
          return (left + span + right) > maxC;
        }

        isValid(classroomId: string, subject: Subject, teachers: Teacher[], day: number, hour: number, span: number) {
          this.stats.attempts++;
          const classroom = this.classroomById.get(classroomId)!;
          const { start, end } = this.getAllowedWindow(classroom, day);
          if (hour<start || (hour+span)>end) { this.stats.invalidReasons.blockBoundary++; return false; }
          if (!teachers || !teachers.length) return false;
          for (const teacher of teachers) {
            if (classroom.level==='Ortaokul' && !teacher.canTeachMiddleSchool) { this.stats.invalidReasons.levelMismatch++; return false; }
            if (classroom.level==='Lise' && !teacher.canTeachHighSchool) { this.stats.invalidReasons.levelMismatch++; return false; }
          }

          for (let k=0;k<span;k++) {
            const h = hour+k;
            if (this.fixedMask[classroomId]?.[day]?.[h]) return false;
            if (this.schedule[classroomId][day][h]) { this.stats.invalidReasons.classBusy++; return false; }
            for (const teacher of teachers) {
              if (!teacher.availability?.[day]?.[h]) { this.stats.invalidReasons.availability++; return false; }
              if (this.teacherOccupied[teacher.id][day][h]) { this.stats.invalidReasons.teacherBusy++; return false; }
            }
            if (subject.locationId && this.locationOccupied[subject.locationId]?.[day]?.[h]) { this.stats.invalidReasons.locationBusy++; return false; }
          }
          if (this.violatesRunLimit(classroomId, subject.id, day, hour, span)) { this.stats.invalidReasons.blockBoundary++; return false; }
          return true;
        }

        // ---- Place/Remove ----
        placeLesson(classroomId: string, subject: Subject, teachers: Teacher[], day: number, hour: number, span: number) {
          const teacherIds = Array.isArray(teachers) ? Array.from(new Set(teachers.filter(Boolean).map(t => t.id))) : [];
          if (!teacherIds.length) return null;
          const a = { subjectId: subject.id, teacherIds, classroomId, locationId: subject.locationId } as any;
          for (let k=0;k<span;k++) {
            this.schedule[classroomId][day][hour+k] = a;
            for (const tid of teacherIds) {
              if (this.teacherOccupied[tid]) {
                this.teacherOccupied[tid][day][hour+k] = true;
              }
            }
            if (subject.locationId && this.locationOccupied[subject.locationId]) {
              this.locationOccupied[subject.locationId][day][hour+k] = true;
            }
            this.dailyLessonCounts[classroomId][day]++;
          }
          this.stats.placements++;
          return a;
        }
        removeLesson(classroomId: string, assignment: any, day: number, hour: number, span: number) {
          if (!assignment) return;
          const subject = this.subjectById.get(assignment.subjectId);
          for (let k=0;k<span;k++) {
            const idx = hour+k;
            if (this.schedule[classroomId][day][idx] === assignment) {
              this.schedule[classroomId][day][idx] = null;
              // Clear teacherOccupied for all teachers listed on the assignment (support teacherIds array)
              if (assignment?.teacherIds && Array.isArray(assignment.teacherIds)) {
                for (const tid of assignment.teacherIds) {
                  if (this.teacherOccupied[tid]) this.teacherOccupied[tid][day][idx] = false;
                }
              } else if ((assignment as any).teacherId) {
                const tid = (assignment as any).teacherId;
                if (this.teacherOccupied[tid]) this.teacherOccupied[tid][day][idx] = false;
              }
              if (subject?.locationId && this.locationOccupied[subject.locationId]) this.locationOccupied[subject.locationId][day][idx] = false;
              this.dailyLessonCounts[classroomId][day]--;
            }
          }
        }
        getSpanAt(classId: string, day: number, startHour: number) {
          const row = this.schedule[classId][day];
          const a = row[startHour];
          if (!a) return 1;
          let span=1; while (startHour+span<row.length && row[startHour+span]===a) span++;
          return span;
        }
        placeGroupLesson(group: any, subject: Subject, day: number, hour: number, teacherAssignments: any, span: number) {
          for (const classId of group.classroomIds) {
            const t = teacherAssignments[classId];
            this.placeLesson(classId, subject, [t], day, hour, span);
          }
        }

        // ---- Sıkıştırma ----
        compactSchedule() {
          let changed = true;
          while (changed) {
            if (this.isTimedOut()) return;
            changed = false;
            for (const classId of Object.keys(this.schedule)) {
              const classroom = this.classroomById.get(classId); if (!classroom) continue;
              for (let d=0; d<DAYS; d++) {
                const { start, end } = this.getAllowedWindow(classroom, d);
                let h=start;
                while (h<end) {
                  if (this.schedule[classId][d][h] !== null || this.fixedMask[classId][d][h]) { h++; continue; }
                  let k=h+1; while (k<end && this.schedule[classId][d][k]===null && !this.fixedMask[classId][d][k]) k++;
                  if (k>=end) break;
                  const assn = this.schedule[classId][d][k]; if (!assn) { h=k+1; continue; }
                  const subject = this.subjectById.get(assn.subjectId);
                  const teachers = this.teacherObjectsFromIds(this.teacherIdsOf(assn));
                  if (!subject || !teachers.length) { h++; continue; }
                  const span = this.getSpanAt(classId, d, k);
                  if (this.isValid(classId, subject, teachers, d, h, span)) {
                    this.removeLesson(classId, assn, d, k, span);
                    this.placeLesson(classId, subject, teachers, d, h, span);
                    changed = true; h += span;
                  } else h++;
                }
              }
            }
          }
        }

        // ---- Amaç fonksiyonu ----
        countGapsForDay(classId: string, day: number) {
          const row = this.schedule[classId][day];
          let gaps=0, seen=false;
          for (let h=0; h<row.length; h++) {
            const a=row[h];
            if (a) seen=true; else if (seen) gaps++;
          }
          return gaps;
        }
        countOverConsecForDay(classId: string, day: number) {
          const row = this.schedule[classId][day];
          let pen=0, h=0;
          while (h<row.length) {
            const a=row[h];
            if (!a) { h++; continue; }
            let span=1; while (h+span<row.length && row[h+span]===a) span++;
            const level = this.classroomById.get(classId)?.level || 'Ortaokul';
            const maxC = this.getRunLimitFor(classId, a.subjectId);
            if (span>maxC) pen += (span - maxC);
            h += span;
          }
          return pen;
        }
        teacherSpreadPenalty(day: number) {
          let p=0;
          for (const tId of Object.keys(this.teacherOccupied)) {
            const row = this.teacherOccupied[tId][day];
            let first=Infinity, last=-1, slots=0;
            for (let h=0; h<row.length; h++) if (row[h]) { first=Math.min(first,h); last=Math.max(last,h); slots++; }
            if (last>=first && Number.isFinite(first)) p += Math.max(0, (last-first+1) - slots);
          }
          return p;
        }
        objectiveScore() {
          let score=0;
          for (const classId of Object.keys(this.schedule)) {
            for (let d=0; d<DAYS; d++) {
              score += 5*this.countGapsForDay(classId,d);
              score += 20*this.countOverConsecForDay(classId,d);
            }
          }
          const wSpread = (this.options.teacherSpreadWeight ?? 1);
          const wEdge = (this.options.teacherEdgeWeight ?? 1);
          for (let d=0; d<DAYS; d++) {
            score += wSpread * this.teacherSpreadPenalty(d);
            score += wEdge * this.teacherEdgePenalty(d);
          }
          return score;
        }

        teacherEdgePenalty(day: number) {
          // Penalize using first/last hour and isolated single-hour segments per teacher
          let p=0;
          for (const tId of Object.keys(this.teacherOccupied)) {
            const row = this.teacherOccupied[tId][day]; if (!row) continue;
            const n = row.length; if (!n) continue;
            if (row[0]) p += 0.5;
            if (row[n-1]) p += 0.5;
            // isolated singles
            let h=0; while (h<n) {
              if (!row[h]) { h++; continue; }
              let start=h; while (h<n && row[h]) h++;
              const len = h-start;
              if (len===1) p += 0.75;
            }
          }
          return p;
        }

        // ---- Ruin & Recreate (LNS-lite) ----
        ruinAndRecreate(maxRemove: number) {
          const snapshot = JSON.stringify(this.schedule);
          const baseScore = this.objectiveScore();
          const removedUnits: any[] = [];

          // Collect all assignment starts with a local "badness" score
          const starts: Array<{classId:string, day:number, hour:number, span:number, subjectId:string, cost:number}> = [];
          for (const classId of Object.keys(this.schedule)) {
            const classroom = this.classroomById.get(classId)!;
            for (let d=0; d<DAYS; d++) {
              const { start, end } = this.getAllowedWindow(classroom, d);
              for (let h=start; h<end; h++) {
                const a = this.schedule[classId][d][h];
                if (!a) continue;
                if (h>start && this.schedule[classId][d][h-1]===a) continue;
                const span = this.getSpanAt(classId, d, h);
                const teacherIds = this.teacherIdsOf(a);
                const cost = this.localBlockCost(classId, d, h, span, teacherIds);
                starts.push({ classId, day:d, hour:h, span, subjectId:a.subjectId, cost });
              }
            }
          }
          if (!starts.length) return false;

          // Prefer higher-cost blocks, add some randomness among top
          starts.sort((a,b)=> b.cost - a.cost);
          const pool = starts.slice(0, Math.min(starts.length, Math.max(5, maxRemove*3)));
          for (let i=pool.length-1;i>0;i--){ const j=(rng.next()*(i+1))|0; const t=pool[i]; pool[i]=pool[j]; pool[j]=t; }
          const picked = pool.slice(0, Math.min(maxRemove, pool.length));

          // Remove picked blocks
          const removedAssn = new Set();
          for (const p of picked) {
            const assn = this.schedule[p.classId][p.day][p.hour];
            if (!assn || removedAssn.has(assn)) continue;
            this.removeLesson(p.classId, assn, p.day, p.hour, p.span);
            removedAssn.add(assn);
            removedUnits.push({ type:'single', classroomId:p.classId, subjectId:p.subjectId, span:p.span });
            if (this.isTimedOut()) break;
          }

          // Try to repair removed
          const ok = this.repairLoop(removedUnits);
          if (!ok) { this.schedule = JSON.parse(snapshot); return false; }
          this.compactSchedule();
          const newScore = this.objectiveScore();
          if (newScore <= baseScore) return true; // accept non-worse
          // Rollback if worse
          this.schedule = JSON.parse(snapshot);
          return false;
        }

        localBlockCost(classId: string, day: number, hour: number, span: number, teacherIds: string[] | string | undefined) {
          // Heuristic badness: class gaps that day + teacher edge/single penalties that day
          let cost = 0;
          cost += this.countGapsForDay(classId, day);
          // count over-consec overage for this run locally
          const row = this.schedule[classId][day];
          const a = row[hour];
          if (a) {
            let left=0, right=0; const classroom = this.classroomById.get(classId)!; const {start,end}=this.getAllowedWindow(classroom, day);
            for (let i=hour-1;i>=start;i--){ const x=row[i]; if (x===a) left++; else break; }
            for (let i=hour+span;i<end;i++){ const x=row[i]; if (x===a) right++; else break; }
            const maxC = this.getRunLimitFor(classId, a.subjectId);
            if (left + span + right > maxC) cost += (left + span + right - maxC)*3;
          }
          const idList = Array.isArray(teacherIds) ? teacherIds : (teacherIds ? [teacherIds] : []);
          for (const tid of idList) {
            const trow = this.teacherOccupied[tid]?.[day];
            if (trow && trow.length) {
              if (trow[0]) cost += 0.5;
              if (trow[trow.length-1]) cost += 0.5;
              let h=0; while (h<trow.length) { if (!trow[h]) { h++; continue; } let s=h; while (h<trow.length && trow[h]) h++; if (h-s===1) cost += 0.75; }
            }
          }
          return cost;
        }

        // ---- Tabu hareketleri ----
        enumerateRelocateMoves() {
          const moves: any[] =[];
          for (const classId of Object.keys(this.schedule)) {
            const classroom = this.classroomById.get(classId)!;
            for (let d=0; d<DAYS; d++) {
              const { start, end } = this.getAllowedWindow(classroom, d);
              for (let h=start; h<end; h++) {
                const a = this.schedule[classId][d][h];
                if (!a) continue;
                if (h>start && this.schedule[classId][d][h-1]===a) continue; // blok başı değil
                const span = this.getSpanAt(classId, d, h);
                const subject = this.subjectById.get(a.subjectId)!;
                const teachers = this.teacherObjectsFromIds(this.teacherIdsOf(a));
                if (!teachers.length) continue;
                for (let nh=start; nh<=end-span; nh++) {
                  if (nh===h) continue;
                  if (this.isValid(classId, subject, teachers, d, nh, span))
                    moves.push({ type:'relocate', classId, day:d, from:h, to:nh, span });
                }
              }
            }
          }
          return moves;
        }
        enumerateSwapMoves() {
          const moves: any[] =[];
          for (const classId of Object.keys(this.schedule)) {
            const classroom = this.classroomById.get(classId)!;
            for (let d=0; d<DAYS; d++) {
              const { start, end } = this.getAllowedWindow(classroom, d);
              for (let h=start; h<end; h++) {
                const A = this.schedule[classId][d][h];
                if (!A) continue;
                if (h>start && this.schedule[classId][d][h-1]===A) continue;
                const spanA = this.getSpanAt(classId, d, h);
                const subjA = this.subjectById.get(A.subjectId)!;
                const teachersA = this.teacherObjectsFromIds(this.teacherIdsOf(A));
                if (!teachersA.length) continue;
                for (let k=h+spanA; k<end; k++) {
                  const B = this.schedule[classId][d][k];
                  if (!B) continue;
                  if (k>h+spanA && this.schedule[classId][d][k-1]===B) continue;
                  const spanB = this.getSpanAt(classId, d, k);
                  const subjB = this.subjectById.get(B.subjectId)!;
                  const teachersB = this.teacherObjectsFromIds(this.teacherIdsOf(B));
                  if (!teachersB.length) continue;
                  if (this.isValid(classId, subjA, teachersA, d, k, spanA) && this.isValid(classId, subjB, teachersB, d, h, spanB))
                    moves.push({ type:'swap', classId, day:d, aStart:h, aSpan:spanA, bStart:k, bSpan:spanB });
                }
              }
            }
          }
          return moves;
        }
        applyMove(m: any) {
          if (m.type==='relocate') {
            const a = this.schedule[m.classId][m.day][m.from];
            if (!a) return;
            const subj = this.subjectById.get(a.subjectId)!;
            const teachers = this.teacherObjectsFromIds(this.teacherIdsOf(a));
            if (!teachers.length) return;
            this.removeLesson(m.classId, a, m.day, m.from, m.span);
            this.placeLesson(m.classId, subj, teachers, m.day, m.to, m.span);
          } else {
            const A = this.schedule[m.classId][m.day][m.aStart];
            const B = this.schedule[m.classId][m.day][m.bStart];
            if (!A || !B) return;
            const subjA = this.subjectById.get(A.subjectId)!; const teachersA = this.teacherObjectsFromIds(this.teacherIdsOf(A));
            const subjB = this.subjectById.get(B.subjectId)!; const teachersB = this.teacherObjectsFromIds(this.teacherIdsOf(B));
            if (!teachersA.length || !teachersB.length) return;
            this.removeLesson(m.classId, A, m.day, m.aStart, m.aSpan);
            this.removeLesson(m.classId, B, m.day, m.bStart, m.bSpan);
            this.placeLesson(m.classId, subjA, teachersA, m.day, m.bStart, m.aSpan);
            this.placeLesson(m.classId, subjB, teachersB, m.day, m.aStart, m.bSpan);
          }
        }
        reverseMove(m: any) { this.applyMove(m); } // swap kendi tersi; relocate tersi de aynı apply ile geri alınır

        tabuOptimize() {
          const tenure = (this.options.tabu?.tenure|0) || 25;
          const maxIter= (this.options.tabu?.iterations|0) || 800;
          const tabu = new Map();
          let bestScore = this.objectiveScore();
          let bestSnapshot = JSON.stringify(this.schedule);

          for (let iter=0; iter<maxIter; iter++) {
            if (this.isTimedOut()) break;
            let neigh = this.enumerateRelocateMoves();
            if (!neigh.length) neigh = this.enumerateSwapMoves();
            if (!neigh.length) break;

            // rastgele karıştır ve ilk 200 adayı değerlendir
            for (let i=neigh.length-1;i>0;i--) { const j=(rng.next()* (i+1))|0; const t=neigh[i]; neigh[i]=neigh[j]; neigh[j]=t; }
            const cap = Math.min(200, neigh.length);
            let chosen=null, chosenDelta=Infinity;
            const curScore = this.objectiveScore();

            for (let i=0; i<cap; i++) {
              const m = neigh[i];
              const key = JSON.stringify(m);
              if ((tabu.get(key)||0) > iter) continue;
              this.applyMove(m);
              const s = this.objectiveScore();
              const delta = s - curScore;
              if (delta < chosenDelta) { chosenDelta=delta; chosen=m; }
              this.reverseMove(m);
            }

            if (!chosen) chosen = neigh[0];
            this.applyMove(chosen);
            tabu.set(JSON.stringify(chosen), iter + tenure);

            const newScore = this.objectiveScore();
            if (newScore < bestScore) { bestScore=newScore; bestSnapshot=JSON.stringify(this.schedule); }
          }
          this.schedule = JSON.parse(bestSnapshot);
        }

        // ---- Simulated Annealing ----
        simulatedAnnealing() {
          const opts = this.options.sa || {};
          let T = typeof opts.initialTemp === 'number' ? opts.initialTemp : 1.0;
          const cooling = typeof opts.cooling === 'number' ? opts.cooling : 0.995;
          const maxIter = (opts.iterations|0) || 3000;
          let bestScore = this.objectiveScore();
          let best = JSON.stringify(this.schedule);
          for (let iter=0; iter<maxIter && !this.isTimedOut(); iter++) {
            const neigh = this.enumerateRelocateMoves().concat(this.enumerateSwapMoves());
            if (!neigh.length) break;
            const m = neigh[(Math.random()*neigh.length)|0];
            const cur = this.objectiveScore();
            this.applyMove(m);
            const next = this.objectiveScore();
            const delta = next - cur;
            const accept = delta <= 0 || Math.random() < Math.exp(-delta / Math.max(1e-6, T));
            if (!accept) this.reverseMove(m);
            else {
              if (next < bestScore) { bestScore = next; best = JSON.stringify(this.schedule); }
            }
            T *= cooling;
            if (T < 1e-4) T = 1e-4;
          }
          this.schedule = JSON.parse(best);
        }

        // ---- Simple ALNS ----
        alnsOptimize() {
          const iters = (this.options.alns?.iterations|0) || 150;
          let wSmall = 1, wBig = 1, wReloc = 1;
          let best = JSON.stringify(this.schedule);
          let bestScore = this.objectiveScore();
          for (let i=0; i<iters && !this.isTimedOut(); i++) {
            const sum = wSmall + wBig + wReloc;
            const r = Math.random()*sum;
            let op = 'small';
            if (r < wSmall) op='small'; else if (r < wSmall+wBig) op='big'; else op='reloc';
            const snapshot = JSON.stringify(this.schedule);
            const base = this.objectiveScore();
            let improved = false;
            if (op==='small') improved = !!this.ruinAndRecreate(12);
            else if (op==='big') improved = !!this.ruinAndRecreate(28);
            else {
              const moves = this.enumerateRelocateMoves();
              if (moves.length) {
                const m = moves[(Math.random()*Math.min(100,moves.length))|0];
                this.applyMove(m);
                improved = this.objectiveScore() <= base;
                if (!improved) this.reverseMove(m);
              }
            }
            const score = this.objectiveScore();
            if (score < bestScore) { bestScore=score; best=JSON.stringify(this.schedule); }
            if (!improved) this.schedule = JSON.parse(snapshot);
            if (op==='small') wSmall += improved ? 0.2 : -0.05;
            else if (op==='big') wBig += improved ? 0.2 : -0.05;
            else wReloc += improved ? 0.2 : -0.05;
            wSmall = Math.max(0.1, wSmall); wBig=Math.max(0.1,wBig); wReloc=Math.max(0.1,wReloc);
          }
          this.schedule = JSON.parse(best);
        }

        // ---- Simple VNS ----
        vnsOptimize() {
          const iters = (this.options.vns?.iterations|0) || 300;
          let best = JSON.stringify(this.schedule);
          let bestScore = this.objectiveScore();
          for (let i=0; i<iters && !this.isTimedOut(); i++) {
            let improved = false;
            // N1: relocate best-improvement
            let neigh = this.enumerateRelocateMoves();
            if (neigh.length) {
              let cur = this.objectiveScore();
              neigh.sort(()=>Math.random()-0.5);
              for (let k=0; k<Math.min(150, neigh.length); k++) {
                const m = neigh[k];
                this.applyMove(m);
                const s = this.objectiveScore();
                if (s <= cur) { improved = true; cur = s; }
                else this.reverseMove(m);
                if (this.isTimedOut()) break;
              }
            }
            // N2: swap exploration if no improvement
            if (!improved) {
              let cur = this.objectiveScore();
              let swaps = this.enumerateSwapMoves();
              swaps.sort(()=>Math.random()-0.5);
              for (let k=0; k<Math.min(100, swaps.length); k++) {
                const m = swaps[k];
                this.applyMove(m);
                const s = this.objectiveScore();
                if (s <= cur) { improved = true; cur = s; }
                else this.reverseMove(m);
                if (this.isTimedOut()) break;
              }
            }
            const sc = this.objectiveScore();
            if (sc < bestScore) { bestScore = sc; best = JSON.stringify(this.schedule); }
          }
          this.schedule = JSON.parse(best);
        }

        // ---- Puanlama ----
        scorePlacement(lesson: any, d: number, h: number, teachers: Teacher[]) {
          let score = 0;
          const classroom = this.classroomById.get(lesson.classroomId)!;
          const { start, end } = this.getAllowedWindow(classroom, d);
          const row = this.schedule[lesson.classroomId][d];
          const span = lesson.span || lesson.blockSpan || 1;
          const adjBefore = h>start && row[h-1]!==null;
          const adjAfter  = (h+span)<end && row[h+span]!==null;
          if (adjBefore) score += 10;
          if (adjAfter)  score += 10;
          score += (end - h);
          let same=0, hasBlock=false;
          for (let x=start; x<end; x++) {
            const a=row[x]; if (a?.subjectId===lesson.subjectId) { same++; if (x+1<end && row[x+1]===a) hasBlock=true; }
          }
          score -= same*10; if ((lesson.span||1)>1 && hasBlock) score -= 14;

          let loadCount = 0;
          for (const teacher of (teachers || [])) {
            const occupiedRow = this.teacherOccupied[teacher.id]?.[d];
            if (!occupiedRow) continue;
            for (let x=start; x<end; x++) if (occupiedRow[x]) loadCount++;
          }
          const loadThreshold = 5 * Math.max(1, teachers ? teachers.length : 1);
          if (loadCount > loadThreshold) score -= (loadCount - loadThreshold);

          if (span===3) score += 3; else if (span===2) score += 1;

          const subj = this.subjectById.get(lesson.subjectId || lesson.groupSubjectId);
          const pinnedRaw = subj?.pinnedTeacherByClassroom?.[lesson.classroomId];
          const pinnedIds = Array.isArray(pinnedRaw) ? pinnedRaw : [];
          if (pinnedIds.length && teachers && teachers.length) {
            const teacherIds = teachers.map(t => t.id);
            if (teacherIds.every(id => pinnedIds.includes(id))) score += 15;
          }
          return score;
        }

        // ---- Grup yardımcıları & istatistik ----
        pickBlockingAssignmentsForGroup(group: any, subject: Subject, span: number, K: number) {
          let best: any =null;
          for (let d=0; d<DAYS; d++) {
            const win = this.getGroupAllowedWindow(group.classroomIds, d);
            const maxH = win.end - (span-1);
            for (let h=win.start; h<maxH; h++) {
              const blockers: any[] =[]; let feas=true;
              for (const classId of group.classroomIds) {
                const c=this.classroomById.get(classId); if (!c) {feas=false;break;}
                const w=this.getAllowedWindow(c,d);
                if (h<w.start || (h+span)>w.end) {feas=false;break;}
                for (let k=0;k<span;k++) { const a=this.schedule[classId][d][h+k]; if (a) blockers.push({classroomId:classId,day:d,hour:h+k}); }
              }
              if (!feas) continue;
              if (best===null || blockers.length<best.blockers.length) best={d,h,blockers};
            }
          }
          if (!best) return [];
          const seen = new Set(); const uniq: any[] =[];
          for (const it of best.blockers) { const k = it.classroomId+'|'+it.day+'|'+it.hour; if (!seen.has(k)) { seen.add(k); uniq.push(it); } }
          return uniq.filter(x=>!this.fixedMask[x.classroomId]?.[x.day]?.[x.hour]).slice(0, K||8);
        }

        finishStats() {
          this.stats.endedAt = Date.now();
          this.stats.elapsedSeconds = +(((this.stats.endedAt - this.stats.startedAt) / 1000).toFixed(3));
        }
        buildHardestLessons() {
          // Deduplicate notes to avoid noisy repetition in report
          if (Array.isArray(this.stats.notes)) {
            this.stats.notes = Array.from(new Set(this.stats.notes));
          }
          const arr = Array.from(this.hardLessonCounter.entries()).map(([key,failures])=>({key,failures})).sort((a,b)=>b.failures-a.failures).slice(0,8);
          this.stats.hardestLessons = arr;
          return this.stats;
        }
      }

      // ---------- Worker main ----------
      try {
        const solver = new LocalSolver(data, options);
        let result: SolveResult | { schedule: null, stats: SolverStats } = solver.solve();

        if (solver._deferredReinsert && solver._deferredReinsert.length && result?.schedule) {
          const units = solver._deferredReinsert.slice();
          solver._deferredReinsert = [];
          const ok2 = solver.repairLoop(units);
          if (ok2) {
            solver.compactSchedule();
            if (solver.options.strategy==='tabu') { solver.tabuOptimize(); solver.compactSchedule(); }
            solver.finishStats();
            result = { schedule: solver.schedule, stats: solver.buildHardestLessons() };
          }
        }

        if (result?.schedule) {
          self.postMessage({ success:true, schedule: result.schedule, stats: result.stats });
        } else {
          self.postMessage({ success:false, schedule:null, stats: result?.stats || null, error: (result?.stats?.notes||[]).join(' | ') || 'Çözüm bulunamadı.' });
        }
      } catch (e: any) {
        // Çöküş güvenliği
        self.postMessage({ success:false, schedule:null, stats:null, error: e?.message || 'Bilinmeyen çözücü hatası.' });
      }
    };
  }
  return `(${solverWorker.toString()})();`;
}

export const solveTimetableLocally = (
  data: TimetableData,
  options: SolverOptions
): Promise<SolveResult> => {
  return new Promise((resolve) => {
    const workerScript = makeWorkerScript();
    const blob = new Blob([workerScript], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    const worker = new Worker(workerUrl);

    function defaultEmptyStats(): SolverStats {
      return {
        startedAt: Date.now(),
        endedAt: Date.now(),
        elapsedSeconds: 0,
        firstSolutionAt: 0,
        firstSolutionSeconds: 0,
        timedOut: false,
        attempts: 0,
        placements: 0,
        backtracks: 0,
        invalidReasons: { levelMismatch: 0, availability: 0, classBusy: 0, teacherBusy: 0, locationBusy: 0, blockBoundary: 0 },
        hardestLessons: [],
        mrvDeadEnds: 0,
        notes: [],
      };
    }

    worker.onmessage = (event) => {
      const { success, schedule, stats, error } = event.data || {};
      if (success) {
        resolve({ schedule: schedule as Schedule, stats: stats as SolverStats });
      } else {
        const finalStats = (stats as SolverStats) || defaultEmptyStats();
        if (error && !finalStats.notes.includes(error)) finalStats.notes.push(error);
        if (finalStats.notes.length === 0) finalStats.notes.push('Bilinmeyen bir hata nedeniyle çözüm bulunamadı.');
        finalStats.endedAt = Date.now();
        resolve({ schedule: null, stats: finalStats });
      }
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
    };

    worker.onerror = (err) => {
      const stats = defaultEmptyStats();
      stats.notes.push('Çözücü çalıştırılırken bir worker hatası oluştu: ' + err.message);
      stats.endedAt = Date.now();
      resolve({ schedule: null, stats });
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
    };

    worker.postMessage({ data, options });
  });
};
