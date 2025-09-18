from ortools.sat.python import cp_model
from typing import Dict, List, Tuple, Any, Optional
import time


def solve_cp_sat(
    data: Dict[str, Any],
    school_hours: Dict[str, List[int]],
    time_limit_sec: int,
    default_max_consec: Optional[int] = None,
    preferences: Optional[Dict[str, Any]] = None,
    stop_at_first: bool = False,
) -> Dict[str, Any]:
    teachers: List[Dict[str, Any]] = data.get('teachers', [])
    classrooms: List[Dict[str, Any]] = data.get('classrooms', [])
    subjects: List[Dict[str, Any]] = data.get('subjects', [])
    fixed: List[Dict[str, Any]] = data.get('fixedAssignments', [])

    teacher_by_id = {t['id']: t for t in teachers}
    classroom_by_id = {c['id']: c for c in classrooms}
    subject_by_id = {s['id']: s for s in subjects}

    # Max hours per day across levels
    maxDailyHours = max((h for arr in school_hours.values() for h in arr), default=0)

    def class_day_ok(c: Dict[str, Any], d: int, h: int) -> bool:
        level = c['level']
        allowed = school_hours['Ortaokul'] if level == 'Ortaokul' else school_hours['Lise']
        return h < allowed[d]

    # Teacher eligibility per class+subject
    def eligible_teachers(c: Dict[str, Any], s: Dict[str, Any]) -> List[str]:
        level = c['level']
        need_middle = level == 'Ortaokul'
        need_high = level == 'Lise'
        pinned_map = s.get('pinnedTeacherByClassroom') or {}
        pinned = pinned_map.get(c['id'])
        if pinned and pinned in teacher_by_id:
            return [pinned]
        el = []
        for t in teachers:
            if need_middle and not t.get('canTeachMiddleSchool', False):
                continue
            if need_high and not t.get('canTeachHighSchool', False):
                continue
            branches = t.get('branches') or []
            # If branches defined, prefer matching; if empty, consider eligible.
            if branches and s['name'] not in branches:
                continue
            el.append(t['id'])
        return el

    model = cp_model.CpModel()

    # Decision vars:
    #  - Block start variables: y1 (single), y2 (2'li blok), y3 (3'lü blok)
    #  - Slot occupancy variables: x[(cid,sid,tid,d,h)] ∈ {0,1}
    y1: Dict[Tuple[str, str, str, int, int], Any] = {}
    y2: Dict[Tuple[str, str, str, int, int], Any] = {}
    y3: Dict[Tuple[str, str, str, int, int], Any] = {}
    x: Dict[Tuple[str, str, str, int, int], Any] = {}
    notes: List[str] = []
    prefs = preferences or {}
    allow_same_day_split = bool(prefs.get('allowSameDaySplit', False))

    max_teacher_gap_hours: Optional[int] = None
    try:
        raw_gap_limit = prefs.get('maxTeacherGapHours')
        if raw_gap_limit is not None:
            gap_val = int(raw_gap_limit)
            if gap_val >= 0:
                max_teacher_gap_hours = gap_val
    except Exception:
        max_teacher_gap_hours = None

    teacher_gap_weight = 0
    try:
        if prefs.get('teacherGapWeight') is not None:
            teacher_gap_weight = max(0, int(prefs.get('teacherGapWeight')))
    except Exception:
        teacher_gap_weight = 0


    # Create variables only where slot valid and teacher available for entire block
    for s in subjects:
        sid = s['id']
        wh = int(s.get('weeklyHours', 0))
        block2 = int(max(0, int(s.get('blockHours', 0)))) // 2
        block3 = int(max(0, int(s.get('tripleBlockHours', 0) or 0))) // 3
        # effective maxConsec: subject override or global default, then clamp to weeklyHours
        eff_max_consec = s.get('maxConsec') if s.get('maxConsec') is not None else default_max_consec
        if eff_max_consec is not None:
            try:
                eff_max_consec = int(eff_max_consec)
            except Exception:
                eff_max_consec = None
        if eff_max_consec is not None and wh > 0:
            eff_max_consec = max(1, min(wh, eff_max_consec))
        for cid in s.get('assignedClassIds', []):
            c = classroom_by_id.get(cid)
            if not c:
                continue
            t_ids = eligible_teachers(c, s)
            if not t_ids:
                notes.append(f"Atlandı: {s['name']} / {cid} (uygun öğretmen yok)")
                continue
            for tid in t_ids:
                teacher = teacher_by_id[tid]
                for d in range(5):
                    allowed_len = school_hours['Ortaokul'][d] if c['level'] == 'Ortaokul' else school_hours['Lise'][d]
                    for h in range(allowed_len):
                        if not class_day_ok(c, d, h):
                            continue
                        # single start
                        if teacher['availability'][d][h]:
                            y1[(cid, sid, tid, d, h)] = model.NewBoolVar(f"y1_{cid}_{sid}_{tid}_{d}_{h}")
                        # 2-block start
                        if h + 1 < allowed_len and teacher['availability'][d][h] and teacher['availability'][d][h+1]:
                            y2[(cid, sid, tid, d, h)] = model.NewBoolVar(f"y2_{cid}_{sid}_{tid}_{d}_{h}")
                        # 3-block start
                        if h + 2 < allowed_len and teacher['availability'][d][h] and teacher['availability'][d][h+1] and teacher['availability'][d][h+2]:
                            y3[(cid, sid, tid, d, h)] = model.NewBoolVar(f"y3_{cid}_{sid}_{tid}_{d}_{h}")

                # Create occupancy vars x for all feasible slots and link to y’s later
                for tid in t_ids:
                    for d in range(5):
                        allowed_len = school_hours['Ortaokul'][d] if c['level'] == 'Ortaokul' else school_hours['Lise'][d]
                        for h in range(allowed_len):
                            x[(cid, sid, tid, d, h)] = model.NewBoolVar(f"x_{cid}_{sid}_{tid}_{d}_{h}")

            # Required count constraints per (class,subject) regardless of teacher
            # Sum over teachers
            vars_y1 = [v for (cc, ss, *_), v in y1.items() if cc == cid and ss == sid]
            vars_y2 = [v for (cc, ss, *_), v in y2.items() if cc == cid and ss == sid]
            vars_y3 = [v for (cc, ss, *_), v in y3.items() if cc == cid and ss == sid]
            if wh > 0 and (vars_y1 or vars_y2 or vars_y3):
                # total hours coverage
                model.Add(sum(vars_y1) + 2 * sum(vars_y2) + 3 * sum(vars_y3) == wh)
                # exact block counts
                if block2 > 0:
                    model.Add(sum(vars_y2) == block2)
                else:
                    model.Add(sum(vars_y2) == 0)
                if block3 > 0:
                    model.Add(sum(vars_y3) == block3)
                else:
                    model.Add(sum(vars_y3) == 0)

            # Subject-level max consecutive constraint per day (hard), using effective max if present
            if eff_max_consec is not None and eff_max_consec > 0:
                for d in range(5):
                    allowed_len = school_hours['Ortaokul'][d] if c['level'] == 'Ortaokul' else school_hours['Lise'][d]
                    for start in range(0, max(0, allowed_len - (eff_max_consec + 1) + 1)):
                        # Sum x over all teachers for (cid,sid) within the sliding window
                        window_vars = [
                            v for (cc, ss, tt, dd, hh), v in x.items()
                            if cc == cid and ss == sid and dd == d and start <= hh <= start + eff_max_consec
                        ]
                        if window_vars:
                            model.Add(sum(window_vars) <= eff_max_consec)

            if not allow_same_day_split:
                # Single contiguous segment per day (hard): no gaps for this subject across the day
                # Build subject-occupancy across teachers: s_occ[h] = OR_t x[(cid,sid,t,d,h)]
                for d in range(5):
                    allowed_len = school_hours['Ortaokul'][d] if c['level'] == 'Ortaokul' else school_hours['Lise'][d]
                    s_occ = []
                    for h in range(allowed_len):
                        b = model.NewBoolVar(f"socc_{cid}_{sid}_{d}_{h}")
                        ors = [x[(cc, ss, tt, d, h)] for (cc, ss, tt, dd, hh) in x.keys() if cc == cid and ss == sid and dd == d and hh == h and (cc, ss, tt, d, h) in x]
                        if ors:
                            for v in ors:
                                model.Add(b >= v)
                            model.Add(sum(ors) >= b)
                        else:
                            model.Add(b == 0)
                        s_occ.append(b)
                    # Enforce contiguity: forbid pattern 1,0,1 (no gaps)
                    if len(s_occ) >= 3:
                        for h in range(1, allowed_len - 1):
                            # s_occ[h-1] + s_occ[h+1] - s_occ[h] <= 1
                            model.Add(s_occ[h-1] + s_occ[h+1] - s_occ[h] <= 1)

    # Link occupancy x to block starts y (coverage). For each slot, x == sum of covering starts.
    for (cid, sid, tid, d, h), var in x.items():
        cover_terms = []
        v1 = y1.get((cid, sid, tid, d, h))
        if v1 is not None:
            cover_terms.append(v1)
        v2s = []
        v2s.append(y2.get((cid, sid, tid, d, h)))      # block starts at h covers h,h+1
        v2s.append(y2.get((cid, sid, tid, d, h-1)))    # block starts at h-1 covers h-1,h
        cover_terms.extend([v for v in v2s if v is not None])
        v3s = []
        v3s.append(y3.get((cid, sid, tid, d, h)))      # start at h covers h,h+1,h+2
        v3s.append(y3.get((cid, sid, tid, d, h-1)))    # start at h-1 covers h-1,h,h+1
        v3s.append(y3.get((cid, sid, tid, d, h-2)))    # start at h-2 covers h-2,h-1,h
        cover_terms.extend([v for v in v3s if v is not None])
        if cover_terms:
            model.Add(var == sum(cover_terms))
        else:
            model.Add(var == 0)

    # One lesson per classroom per slot
    for c in classrooms:
        cid = c['id']
        for d in range(5):
            allowed_len = school_hours['Ortaokul'][d] if c['level'] == 'Ortaokul' else school_hours['Lise'][d]
            for h in range(allowed_len):
                vars_slot = [v for (cc, ss, tt, dd, hh), v in x.items() if cc == cid and dd == d and hh == h]
                if len(vars_slot) > 1:
                    model.Add(sum(vars_slot) <= 1)

    # Teacher no-overlap across classes per slot
    for t in teachers:
        tid = t['id']
        for d in range(5):
            # use max allowed among levels for iteration; x outside allowed becomes 0 via linking
            allowed_len = max(school_hours['Ortaokul'][d], school_hours['Lise'][d])
            for h in range(allowed_len):
                vars_t = [v for (cc, ss, tt, dd, hh), v in x.items() if tt == tid and dd == d and hh == h]
                if len(vars_t) > 1:
                    model.Add(sum(vars_t) <= 1)

    # Optional hard limit: maximum daily lesson hours per teacher
    teacher_daily_max = None
    try:
        if prefs.get('teacherDailyMaxHours') is not None:
            tdm = int(prefs.get('teacherDailyMaxHours'))
            if tdm >= 0:
                teacher_daily_max = tdm
    except Exception:
        teacher_daily_max = None
    if teacher_daily_max is not None:
        for t in teachers:
            tid = t['id']
            for d in range(5):
                vars_day = [v for (cc, ss, tt, dd, hh), v in x.items() if tt == tid and dd == d]
                if vars_day:
                    model.Add(sum(vars_day) <= teacher_daily_max)

    # Fixed assignments: enforce that the slot is covered by the subject with exactly one teacher
    for fa in fixed:
        cid = fa['classroomId']
        sid = fa['subjectId']
        d = fa['dayIndex']
        h = fa['hourIndex']
        vars_fixed = [v for (cc, ss, tt, dd, hh), v in x.items() if cc == cid and ss == sid and dd == d and hh == h]
        if vars_fixed:
            model.Add(sum(vars_fixed) == 1)

    # Note: per-subject maxConsec hard constraints already added within the subject loop using effective values.

    # No explicit objective for now (feasibility focus). Could add spread/edge minimization later.
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(max(1, time_limit_sec))
    solver.parameters.num_search_workers = 8

    started = time.time()
    # Build soft objective: minimize teacher edge usage and heavy-days-without-gap
    edge_penalty = []  # first/last hour usage
    nogap_penalty = []  # heavy day (>=6) and no single-hour gap
    gap_penalty = []  # teacher gap indicators for objective tuning

    # Build per-teacher occupancy booleans o[t,d,h]
    o: Dict[Tuple[str, int, int], Any] = {}
    for t in teachers:
        tid = t['id']
        for d in range(5):
            allowed_len = max(school_hours['Ortaokul'][d], school_hours['Lise'][d])
            for h in range(allowed_len):
                vars_t = [v for (cc, ss, tt, dd, hh), v in x.items() if tt == tid and dd == d and hh == h]
                if vars_t:
                    b = model.NewBoolVar(f"occ_{tid}_{d}_{h}")
                    # OR-linking
                    for v in vars_t:
                        model.Add(b >= v)
                    model.Add(sum(vars_t) >= b)
                else:
                    b = model.NewBoolVar(f"occ_{tid}_{d}_{h}")
                    model.Add(b == 0)
                o[(tid, d, h)] = b

            # Edge penalties (hour 0 and last hour if within any class day length)
            if allowed_len > 0:
                edge_penalty.append(o[(tid, d, 0)])
                edge_penalty.append(o[(tid, d, allowed_len - 1)])

            # Heavy-day with no-gap penalty via detection of single-hour hole
            occ_vars = [o[(tid, d, h)] for h in range(allowed_len)]
            occ_count = model.NewIntVar(0, allowed_len, f"ocnt_{tid}_{d}")
            model.Add(occ_count == sum(occ_vars))
            heavy = model.NewBoolVar(f"heavy_{tid}_{d}")
            model.Add(occ_count >= 6).OnlyEnforceIf(heavy)
            model.Add(occ_count <= 5).OnlyEnforceIf(heavy.Not())

            # gap detection: exists h with pattern 1,0,1
            gap_candidates = []
            for h in range(1, max(0, allowed_len - 1)):
                if h + 1 >= allowed_len:
                    continue
                g = model.NewBoolVar(f"gap_{tid}_{d}_{h}")
                # g <= o[h-1], g <= (1 - o[h]), g <= o[h+1]
                model.Add(g <= o[(tid, d, h - 1)])
                model.Add(g <= 1 - o[(tid, d, h)])
                model.Add(g <= o[(tid, d, h + 1)])
                # g >= o[h-1] + o[h+1] + (1 - o[h]) - 2
                model.Add(g >= o[(tid, d, h - 1)] + o[(tid, d, h + 1)] + (1 - o[(tid, d, h)]) - 2)
                gap_candidates.append(g)
            if max_teacher_gap_hours is not None and gap_candidates:
                model.Add(sum(gap_candidates) <= max_teacher_gap_hours)

            gap_penalty.extend(gap_candidates)

            gap_present = model.NewBoolVar(f"gapp_{tid}_{d}")
            if gap_candidates:
                for gc in gap_candidates:
                    model.Add(gap_present >= gc)
                model.Add(sum(gap_candidates) >= gap_present)
            else:
                model.Add(gap_present == 0)

            no_gap_heavy = model.NewBoolVar(f"ngh_{tid}_{d}")
            model.Add(no_gap_heavy <= heavy)
            model.Add(no_gap_heavy <= 1 - gap_present)
            model.Add(no_gap_heavy >= heavy - gap_present)
            nogap_penalty.append(no_gap_heavy)

    # Weights (configurable); if both zero or stop_at_first, skip objective (first feasible)
    prefs = preferences or {}
    W_EDGE = int(prefs.get('edgeWeight', 1))
    W_NOGAP = int(prefs.get('nogapWeight', 3))
    W_GAP = teacher_gap_weight
    if not stop_at_first and (W_EDGE > 0 or W_NOGAP > 0 or W_GAP > 0):
        model.Minimize(W_EDGE * sum(edge_penalty) + W_NOGAP * sum(nogap_penalty) + W_GAP * sum(gap_penalty))

    status = solver.Solve(model)
    ended = time.time()

    # Build empty schedule
    schedule: Dict[str, List[List[Any]]] = {}
    for c in classrooms:
        level = c['level']
        allowed = school_hours['Ortaokul'] if level == 'Ortaokul' else school_hours['Lise']
        per_day = [[None for _ in range(allowed[d])] for d in range(5)]
        schedule[c['id']] = per_day

    placements = 0
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for (cid, sid, tid, d, h), var in x.items():
            if solver.BooleanValue(var):
                s = subject_by_id[sid]
                assign = {
                    'subjectId': sid,
                    'teacherId': tid,
                    'locationId': s.get('locationId'),
                    'classroomId': cid,
                }
                if d < len(schedule[cid]) and h < len(schedule[cid][d]) and schedule[cid][d][h] is None:
                    schedule[cid][d][h] = assign
                    placements += 1

    status_map = {
        cp_model.OPTIMAL: 'OPTIMAL',
        cp_model.FEASIBLE: 'FEASIBLE',
        cp_model.INFEASIBLE: 'INFEASIBLE',
        cp_model.MODEL_INVALID: 'MODEL_INVALID',
        cp_model.UNKNOWN: 'UNKNOWN',
    }

    stats = {
        'startedAt': int(started * 1000),
        'endedAt': int(ended * 1000),
        'elapsedSeconds': ended - started,
        'firstSolutionAt': None,
        'firstSolutionSeconds': None,
        'timedOut': (status == cp_model.UNKNOWN),
        'attempts': 0,
        'placements': placements,
        'backtracks': 0,
        'invalidReasons': {
            'levelMismatch': 0,
            'availability': 0,
            'classBusy': 0,
            'teacherBusy': 0,
            'locationBusy': 0,
            'blockBoundary': 0,
        },
        'hardestLessons': [],
        'mrvDeadEnds': 0,
        'notes': notes + [f"status={status_map.get(status, str(status))}"]
    }

    return {
        'schedule': schedule,
        'stats': stats,
    }
