Netlify deployment notes for DersTimeTable

Required Netlify Build Settings (these are the values used in the repo's `netlify.toml`, but confirm in the Netlify UI):

- Build command: npm run build
- Publish directory: dist
- Functions directory: netlify/functions
- Base directory: / (unless you want to point to a subfolder)

Recommended Environment & Runtime:

- Node version: 18 (pinned via `.nvmrc` and in `netlify.toml` build.environment.NODE_VERSION)
- Vite expects the `preview` script to run for preview builds, but Netlify will use the `build` command for production deploys.

Preview Server (Netlify CLI):

- The `dev` block in `netlify.toml` sets the preview command to run Vite with host 0.0.0.0 and port 8888 so it's reachable from the Netlify CLI.
- To run locally using Netlify CLI:

  npm i -g netlify-cli
  netlify dev

Special notes about the server/CP-SAT solver:

- The repository contains a Python-based server under `server/` used to run a CP-SAT solver. Netlify functions are Node.js serverless functions and cannot directly run long-lived Python processes.
- If you rely on the CP-SAT solver in production, consider one of:
  - Deploy the Python server separately (Heroku, Railway, Fly, or a small VM) and call it from the frontend.
  - Package a serverless-friendly API around the solver and deploy to a platform that supports Python functions (e.g., Google Cloud Functions with Python, or AWS Lambda with layers).

Environment variables to set on Netlify (if used in your app):

- API_BASE_URL — If you host the CP-SAT solver or other backend, point this to the backend's public URL.

Troubleshooting:

- If builds fail due to Node version mismatches, ensure Netlify is using Node 18 (Site settings → Build & deploy → Environment → Environment variables & secrets → Add NODE_VERSION=18 or set in UI).
- If your build fails with ESM/CommonJS issues, try toggling package.json "type" to "module" (already set) and ensure any server-only scripts are not imported into client bundles.

If you want, I can add a GitHub Actions workflow or a Railway deployment helper next.
