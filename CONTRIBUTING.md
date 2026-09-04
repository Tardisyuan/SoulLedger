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
- Use `PageSection` + `TableSkeleton` for page layouts
- Use TanStack Query for API calls with proper query keys

### Git Commits
Format: `type(scope): description`
Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`

## Testing

- Backend: `cd backend && pytest --cov=apps` (isolate `DATABASE_URL` and `REDIS_URL` — see `CLAUDE.md`)
- Frontend unit: `cd frontend && npm run test:coverage` — **not `npm test`**, which
  is bare `jest`: `jest.config.js` sets `coverageThreshold` without
  `collectCoverage`, so the threshold is only evaluated with `--coverage`
  (measured: `npm test` prints "coverage" zero times)
- `packages/core` (the platform-independent workspace) has three of its own,
  and `pre-push` runs all three on any `^packages/` change:
  `npm run --workspace packages/core typecheck | lint | test` (the last is vitest)
- Frontend E2E: `cd frontend && npm run test:e2e`
- TypeScript: `cd frontend && npx tsc --noEmit`

## Architecture

See `docs/TECHNICAL_DOCS.md` for architecture overview.
See `docs/API.md` for API documentation.
