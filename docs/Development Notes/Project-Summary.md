### Project Summary: Clerky (AI Clinical Assistant)

## High-level overview
- **Purpose**: Assist clinicians by extracting, summarising, and operationalising clinical guidelines (PDFs → structured advice, algorithms, and audits). Provides dynamic advice and clinical note generation from transcripts; supports auditing guideline adherence.
- **Architecture**: 
  - Static web app (vanilla JS/HTML/CSS) served directly or via Firebase Hosting.
  - Optional React + Vite frontend (`frontend/`) targeting the same backend.
  - Node/Express backend (`server.js`) with Firebase Admin (Auth, Firestore, Storage) and cost-aware multi‑provider AI routing.
- **Key technologies**
  - Frontend (vanilla): HTML, CSS, ES modules, Firebase JS SDK.
  - Frontend (React): React 19, Vite 6, React Query 5, Zustand, Axios, Firebase.
  - Backend: Node 18+, Express, Firebase Admin, axios, pdf-parse, helmet, express-rate-limit, multer.
  - AI providers: OpenAI, DeepSeek, Anthropic (Claude), Mistral, Gemini (cost-ordered fallbacks).
  - Anonymisation: `@libretto/redact-pii-light` bundled to `dist/libretto-bundle.js` (webpack).
- **Deployment**: Firebase Hosting rewrite to `index.html`; server hosted at `https://clerky-uzni.onrender.com` (configurable via `window.SERVER_URL`).

## Folder & file structure (key areas)
```text
clerky/
  index.html                # Main static app UI (top bar, actions, views); loads modules and SERVER_URL
  styles.css                # Global styles incl. three-column layout and dynamic advice UI
  script.js                 # Main app logic (large; UI flows, AI calls, guideline flows)
  anonymisation.js          # Clinical data anonymiser (Libretto bundle + fallbacks)
  firebase-init.js          # Client Firebase init & upload form handling with retry logic
  cookie-consent.js         # Consent banner utilities
  server.js                 # Express backend: API routes, AI providers, GitHub updates, audits
  build.js                  # Copies public assets into `dist/`
  webpack.config.js         # Bundles Libretto PII library → `dist/libretto-bundle.js`
  prompts.json              # Default prompts (also fetched/overridden via server)
  significant_terms.json    # Term lists supporting guideline relevance
  guidance/                 # Source guideline artefacts (PDFs, text, summaries)
  algos/                    # Generated algorithm HTMLs (large collection)
  dist/                     # Built static distribution (copied by `build.js`)
  modules/
    auth.js                 # Frontend auth helpers (onAuthStateChanged, disclaimer checks)
    firebase-core.js        # Frontend Firebase core (Auth/Firestore initialisation)
    guidelines.js           # Load/caches guideline metadata via backend
    audit.js                # Audit page logic (auditable elements, run/retrieve audits)
  docs/
    README.md               # High-level docs; additional tech/business/testing docs subfolders
    ...                     # Product, technical architecture, patent, testing docs
  scripts/                  # Automation/testing/ETL scripts (Python + JS) and autonomous agents
  logs/                     # Server-side logs (combined/error/server)
  data/                     # API-usage reports and other data artefacts
  frontend/                 # Optional React app (Vite)
    src/
      main.jsx              # React entrypoint
      services/api.js       # Axios API client (health, fetch guidelines/prompts, logs, handleIssues)
      components/...        # TopBar, auth screens, views (Guidelines/Prompts/Workflows), tabs
      stores/useStore.js    # Zustand store
      hooks/useData.js      # Data hooks
    vite.config.js          # Vite config
    eslint.config.js        # ESLint config
  firebase.json             # Hosting config (rewrites, ignores)
  firestore.rules           # Firestore security rules
  package.json              # Server/build tooling; webpack config
  frontend/package.json     # React dependencies and scripts
```

## Core conventions & practices
- **Code style & modules**
  - Frontend (vanilla) uses ES modules and global Firebase instances.
  - Backend is CommonJS; structured Express middleware (helmet, CORS, rate limiters).
  - Webpack used only to bundle the PII library; static assets copied by `build.js`.
- **State & data**
  - Static app manipulates DOM directly; caches guideline metadata in `modules/guidelines.js`.
  - React app uses Zustand for state and React Query for server data.
  - Backend integrates Firebase Admin for Auth verification, Firestore access, and Storage (PDF retrieval).
- **Naming & organisation**
  - Feature-oriented modules in `modules/` (auth/guidelines/audit).
  - Generated/compiled artefacts in `dist/`, inputs in `guidance/`, algorithms in `algos/`.
  - Scripts and automated agents in `scripts/`.
- **AI provider strategy**
  - Providers tried in ascending cost order with fallbacks. Preference list in `server.js` (`AI_PROVIDER_PREFERENCE`).
  - Backend endpoints accept `aiProvider` when needed; otherwise choose based on availability/cost.
- **Security & resilience**
  - Firebase ID token verification middleware for protected routes.
  - CORS allow‑list with detailed logging.
  - Rate limiting on AI-heavy endpoints.
  - Robust upload retries (client) and exponential backoff for network errors.
  - PII anonymisation on the client prior to submission when applicable.
- **Testing strategy**
  - HTML harnesses in repo for manual/visual tests: `test-*.html`, `dev.html`, `debug-anonymisation.html`.
  - Scripted tests and agents in `scripts/` (Node/Python).
  - No formal unit test framework present; logs in `logs/` for observability.
- **Configuration**
  - `.env` on server: API keys (OpenAI/DeepSeek/Anthropic/Mistral/Gemini), `GITHUB_TOKEN`, Firebase Admin creds.
  - `firebase.json` hosts from repo root, rewrites all paths to `index.html`.
  - Client Firebase config is embedded in `firebase-init.js` / `modules/firebase-core.js`.

## Key entry points
- **Static app**
  - UI: `index.html` (top bar, model select, primary actions: Dynamic Advice, Generate Note, Ask Guidelines, Dev tools).
  - Scripts loaded: `cookie-consent.js`, Firebase SDKs, `firebase-init.js`, `anonymisation.js`, `script.js`.
  - Global server URL set via `window.SERVER_URL`.
- **React app**
  - Entry: `frontend/src/main.jsx` → `App.jsx` with views: `MainView`, `GuidelinesView`, `PromptsView`, `WorkflowsView`.
  - API client: `frontend/src/services/api.js` (health, guidelines/prompts via GitHub raw, `handleIssues` via server).
- **Backend (selected routes)**
  - Health: `GET /health`
  - Auth-protected:
    - Knowledge: `GET /getAgentKnowledge`
    - Guidelines: `GET /getAllGuidelines`
    - Upload: `POST /uploadGuideline` (multer; Firebase token required)
    - Issues: `POST /handleIssues` (clinical issues extraction)
    - Advice/actions: `POST /handleAction`, `POST /SendToAI`, `POST /generateFakeClinicalInteraction`
    - Audits: 
      - `POST /generateAuditTranscript`
      - `POST /generateIncorrectAuditScripts`
      - `POST /auditElementCheck`
      - `GET /getAudits?guidelineId=...`
      - `POST /updateGuidelinesWithAuditableElements`
  - GitHub integration (server side): read/update content in `guidance/` and related assets.
  - Static hosting: serves root `index.html` and assets; JSON body limit increased for large payloads.
- **Build/deploy**
  - `npm run build` (root) runs `build.js` copying assets to `dist/`.
  - Webpack bundles PII library: `npm run bundle-libretto` → `dist/libretto-bundle.js`.
  - Firebase Hosting (`firebase.json`) serves repo root with SPA rewrites.

## How to use this summary
- Paste this entire “Project Summary” into future chats to give immediate context.
- When asking for changes, reference specific files/dirs (e.g., `modules/guidelines.js`, `server.js`) and the relevant section above.
- For UI changes, specify target (static app `index.html`/`script.js` vs React app under `frontend/`).
- For backend/API work, cite endpoint(s) and expected contracts from the Key entry points section.
