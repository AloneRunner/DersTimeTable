"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
"use strict";
// --- Node shim for browser Worker/Blob/URL used by the transpiled solver ---
const { Worker: NodeWorker, isMainThread } = require('worker_threads');
global.Blob = global.Blob || function (parts, options) {
    // Emulate minimal Blob: store joined parts as __source so createObjectURL can read it
    const obj = {};
    try {
        if (Array.isArray(parts))
            obj.__source = parts.map(p => (typeof p === 'string' ? p : String(p))).join('\n');
        else
            obj.__source = typeof parts === 'string' ? parts : String(parts);
    }
    catch (e) { obj.__source = '' + parts; }
    return obj;
};
global.URL = global.URL || {
    createObjectURL: (blobLike) => {
        // Normalize blob-like input to string source
        let src = '';
        try {
            if (blobLike && typeof blobLike === 'object' && blobLike.__source)
                src = blobLike.__source;
            else if (typeof blobLike === 'string')
                src = blobLike;
            else if (blobLike && typeof blobLike === 'object' && typeof blobLike.toString === 'function')
                src = blobLike.toString();
            else
                src = String(blobLike);
        }
        catch (e) { src = '' + blobLike; }
        const key = 'blob:nodedata:' + (Math.random().toString(36).slice(2));
        global.__worker_scripts__ = global.__worker_scripts__ || {};
        global.__worker_scripts__[key] = src;
        return key;
    }
};
global.Worker = global.Worker || class Worker {
    constructor(urlKey) {
        const scripts = global.__worker_scripts__ || {};
        let src = scripts[urlKey];
        if (!src) {
            // Fallback: pick any available script (useful in constrained test environment)
            const keys = Object.keys(scripts || {});
            if (keys.length > 0) {
                src = scripts[keys[0]];
            }
        }
        if (!src)
            throw new Error('Worker script not found for key ' + urlKey);
        // Create a worker thread that evaluates the script and communicates via postMessage/onmessage
        const fn = `const { parentPort } = require('worker_threads');\nconst self = { postMessage: (m) => parentPort.postMessage(m), onmessage: null };\nself.importScripts = ()=>{};\n${src}\n// keep worker alive\n`;
        // Use eval inside a new worker thread
        this._worker = new NodeWorker(fn, { eval: true });
        this._worker.on('message', (m) => { if (this.onmessage) this.onmessage({ data: m }); });
        this._worker.on('error', (e) => { if (this.onmessage) this.onmessage({ data: { success: false, error: e.message } }); });
    }
    postMessage(msg) { this._worker.postMessage(msg); }
    terminate() { this._worker.terminate(); }
};

const localSolver_1 = require("../services/localSolver.cjs");
(async () => {
    // Minimal test data: 2 teachers, 1 classroom, 1 subject that can be taught by both
    const data = {
        teachers: [
            { id: 't1', name: 'T1', branches: ['Matematik'], availability: Array.from({ length: 5 }, () => Array(8).fill(true)), canTeachMiddleSchool: true, canTeachHighSchool: true },
            { id: 't2', name: 'T2', branches: ['Matematik'], availability: Array.from({ length: 5 }, () => Array(8).fill(true)), canTeachMiddleSchool: true, canTeachHighSchool: true },
        ],
        classrooms: [{ id: 'c1', name: 'C1', level: 'Lise', group: 'Yok', sessionType: 'full' }],
        subjects: [{ id: 's1', name: 'Matematik', blockHours: 0, weeklyHours: 1, assignedClassIds: ['c1'] }],
        locations: [],
        fixedAssignments: [],
        lessonGroups: [],
        duties: [],
    };
    const res = await (0, localSolver_1.solveTimetableLocally)(data, { timeLimitSeconds: 2, schoolHours: { Ortaokul: [8, 8, 8, 8, 8], Lise: [8, 8, 8, 8, 8] } });
    console.log('Solver finished. schedule present?', !!res.schedule);
    if (!res.schedule) {
        console.log('No schedule:', res.stats);
        process.exit(1);
    }
    // Inspect schedule: any assignment should have teacherIds array
        const classSched = res.schedule['c1'];
        if (!classSched) {
            console.error('No class schedule for c1');
            process.exit(2);
        }
        console.log('Dumping non-null assignments for c1:');
        let found = false;
        for (let d = 0; d < classSched.length; d++) {
            for (let h = 0; h < classSched[d].length; h++) {
                const a = classSched[d][h];
                if (a) {
                    found = true;
                    console.log(`day ${d} hour ${h}:`, a);
                    if (!Array.isArray(a.teacherIds)) {
                        console.error('Assignment at', d, h, 'missing teacherIds');
                        process.exit(4);
                    }
                }
            }
        }
        if (!found) {
            console.error('No assignments placed for c1');
            process.exit(3);
        }
        console.log('Smoke diagnostics complete');
    console.log('Smoke test OK');
})();
