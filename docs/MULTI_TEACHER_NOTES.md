Summary of multi-teacher changes

What changed
- `Assignment` already used `teacherIds: string[]` in `types.ts` and UI.
- `services/localSolver.ts` was updated to treat assignments' `teacherIds` correctly: creating assignments with `teacherIds`, marking/unmarking teacherOccupied for every teacher in the array, and updating checks that previously used `assignment.teacherId` to use `assignment.teacherIds.includes(...)`.

Smoke test
- A temporary smoke test `scripts/smoke-solver.ts` was added to exercise the solver and validate `teacherIds` appears in produced assignments.
- In constrained CI/dev environments `ts-node` may have ESM/loader issues; a safe way to run the smoke test locally is:

```powershell
# from project root
npm install
npx -y tsc --module commonjs --target ES2022 --outDir tmp_smoke --esModuleInterop true --skipLibCheck true --resolveJsonModule true --allowJs true --moduleResolution node --rootDir . services/localSolver.ts scripts/smoke-solver.ts
node tmp_smoke\scripts\smoke-solver.cjs
```

Notes
- The local solver still uses a single-primary-teacher heuristic in some places (when a single teacher object is required); it uses `teacherIds[0]` as a fallback. That was an intentional, low-risk change to preserve previous logic while ensuring teacher occupancy is tracked for all teachers.
- Consider a follow-up to fully support multi-teacher lessons semantically (e.g., multi-person load accounting, fractional loads, required teacher counts per subject).