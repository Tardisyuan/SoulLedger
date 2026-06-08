# SoulLedger — Claude Code Configuration

## Rules

- Do what has been asked; nothing more, nothing less
- NEVER create files unless absolutely necessary — prefer editing existing files
- NEVER create documentation files unless explicitly requested
- NEVER save working files or tests to root — use `/src`, `/tests`, `/docs`, `/config`, `/scripts`
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files
- Keep files under 500 lines
- Validate input at system boundaries

## Agent Comms

Named agents coordinate via `SendMessage`, not polling or shared state.

- ALWAYS name agents — `name: "role"` makes them addressable
- ALWAYS include comms instructions in prompts — who to message, what to send
- Spawn ALL agents in ONE message with `run_in_background: true`
- After spawning: STOP, tell user what's running, wait for results
- NEVER poll status — agents message back or complete automatically

## Build & Test

```bash
# Backend — matches CI pipeline exactly
cd backend && python manage.py makemigrations --check --dry-run
cd backend && python -m pytest --tb=short -q
cd backend && ruff check .
cd backend && pip-audit --strict --desc

# Frontend — matches CI pipeline exactly
cd frontend && npx tsc --noEmit
cd frontend && npm run lint
cd frontend && npm run build
cd frontend && npm test

# E2E
cd frontend && npx playwright test --project=chromium
```

**CI/Local Differences:**
- CI runs `python manage.py migrate` before tests (local uses existing DB)
- CI runs `pip-audit --strict` (local can skip)
- CI runs `npm audit --audit-level=high` (local can skip)
- CI runs E2E separately (local can run on demand)

## Setup

```bash
# Install Git hooks (run after cloning)
bash scripts/install-hooks.sh
```

## Git

- Format: `type(scope): description`
- Types: feat, fix, docs, style, refactor, test, ci, chore

## Lazy-Load Reference

Load `docs/claude-reference.md` only when explicitly required for:
- Agent communication patterns and examples
- Swarm routing and topology configuration
- Memory/learning MCP tools and hooks
- CLI commands and setup
