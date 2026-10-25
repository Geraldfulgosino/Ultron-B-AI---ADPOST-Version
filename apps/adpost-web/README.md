# adpost-web — ULTRON-B AI, ADPOST Edition

A standalone React 19 + TypeScript + Vite + Tailwind v4 app. It runs fully local, on typed in-memory adapters seeded with synthetic data. No Supabase connection and no LLM keys are needed. See `docs/development/ARCHITECTURE_DECISIONS.md`.

```bash
cd apps/adpost-web
npm install
npm run dev        # http://localhost:5173
npm test           # vitest
npm run typecheck
npm run build
```

The legacy Laravel/Inertia app in the repo root is untouched and still runs as before.
