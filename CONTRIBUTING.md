# Contributing to SoulLedger

## Quick Start

```bash
# Backend
cd backend && pip install -r requirements.txt
python manage.py migrate && python manage.py runserver

# Frontend
cd frontend && npm install && npm run dev
```

## Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make changes and add tests
4. Run tests: `cd backend && pytest` / `cd frontend && npm run test:coverage`
   (the backend suite needs `DATABASE_URL` **and** `REDIS_URL` pointed at throwaway
   services first — see `CLAUDE.md`, Build & Test, for the exact invocation)
5. Commit: `git commit -m "feat: description"`
6. Push and create a Pull Request

## Code Conventions

### Backend (Python/Django)
- Follow PEP 8
- Use type hints where possible
- ViewSets use `CodenameViewSetMixin` for permission codenames
- Services for cross-context orchestration
- Models for domain logic (state machines, validation)

### Frontend (TypeScript/React)
- Use `useI18n()` for all user-facing strings — no hardcoded text
- Use `RequirePermission` for CRUD button gating
- Use `PageShell` for page layouts (33 of 37 routes do; `PageSection` is for
  sub-blocks within a page. `TableSkeleton` has zero callers under `app/` —
  table loading goes through `<DataTable isLoading>`)
- Colours have exactly one spelling: `text-[hsl(var(--color-ink))]`. The bare
  `text-ink` form silently renders the wrong value — see
  `docs/CONVENTIONS-frontend.md` §2
- Use TanStack Query for API calls with proper query keys

### Git Commits
See **`CLAUDE.md` → `## Git`** — that section is the single authority for the format
and the type list. This file used to carry its own copy, which had drifted to a
different set (it was missing `style`); `AGENTS.md` carried a third, which specified
no scope at all while two thirds of commits have one. Nothing enforces the format —
there is no commit-msg hook — so three copies drifted silently. Now there is one.

## Testing

- Backend: `cd backend && pytest --cov=apps` (isolate `DATABASE_URL` and `REDIS_URL` — see `CLAUDE.md`)
- Frontend unit: `cd frontend && npm run test:coverage` — **not `npm test`**, which
  is bare `jest`: `jest.config.js` sets `coverageThreshold` without
  `collectCoverage`, so the threshold is only evaluated with `--coverage`
  (measured: `npm test` prints "coverage" zero times)
- `packages/core` (the platform-independent workspace) has three of its own,
  and `pre-push` runs all three on any `^packages/` change:
  `npm run --workspace packages/core typecheck | lint | test` (the last is vitest)
- Frontend E2E: **`npm run build` first**, then
  `npx playwright test --project=chromium|firefox|mobile-chrome` — three
  projects, and CI's matrix runs all three. `webServer` serves the build
  output, not `next dev`: a dev server compiles on demand, so
  `waitForLoadState("networkidle")` was waiting on compilation. Same code, three
  runs, 3/4/2 failures with a different route hit each time; against the build
  output all three projects are deterministic and ~3× faster.
- TypeScript: `cd frontend && npx tsc --noEmit`

## Architecture

See `docs/TECHNICAL_DOCS.md` for architecture overview.
See `docs/API.md` for API documentation.
