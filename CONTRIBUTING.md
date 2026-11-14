# Contributing to SoulLedger

Thanks for looking. This file is all a contributor needs; `CLAUDE.md` and `AGENTS.md` are the maintainer's
instructions for AI coding agents, and you do not have to read them.

## What is welcome

- **Small pull requests**: documentation fixes, translations (`packages/core/messages/`), corrections to the
  mythology research in `docs/`, bug fixes with a reproduction, and missing tests.
- **Issues**: bugs, confusing docs, questions about a design decision. The ADRs in [`docs/adr/`](docs/adr/)
  explain most of the big ones.
- **A first contribution**: issues labelled
  [good first issue](https://github.com/Tardisyuan/SoulLedger/labels/good%20first%20issue) are small, say
  which files to touch and how to check the result.
- **Open an issue first** for anything over about 200 lines, anything that crosses several Django apps, and
  anything that changes a model, a permission or the approval workflow. `main` moves fast, and a short
  discussion saves a rewrite.

The maintainer works alone. Expect a first reply within a week. If two weeks pass with no reply, mention
`@Tardisyuan` in the issue or PR.

## Setting up

The short path needs Python 3.11 (with [`uv`](https://docs.astral.sh/uv/)) and Node.js ≥ 20.9 (`nvm use`
reads `.nvmrc`). No Docker, PostgreSQL or Redis.

```bash
# back end (SQLite fallback), http://localhost:8000/api/v1/
cd backend && cp .env.example .env
uv venv --python 3.11 .venv
uv pip install --python .venv/bin/python --no-deps -r requirements.lock -r requirements-dev.txt
.venv/bin/python manage.py migrate
.venv/bin/python manage.py seed_tenants && .venv/bin/python manage.py seed_mythology
.venv/bin/python manage.py runserver

# web, from the repository root (not inside frontend/), http://localhost:3333
npx -y npm@11 ci                      # npm 11: npm 10 exits 0 with an incomplete tree
git checkout -- package-lock.json     # npm ci rewrites the lockfile; keep it unchanged
npm run dev --workspace frontend
```

**Signing in.** A new database has no account that can sign in. `manage.py seed_dev_users`
creates one account for each of the six roles (ADMIN, MODERATOR, JUDGE, GUARDIAN, VIEWER, and a SOUL account
for the soul app), runs only when `DEBUG=True`, and prints what it created (`manage.py createsuperuser` also works).

The two mobile apps, Docker, PostgreSQL and Redis, and every seed command are in
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## Making a change

1. Fork, then branch from the latest `main`: `git checkout -b fix/short-name`.
2. Change the code and add or update a test. A bug fix needs a test that fails without the fix.
3. Run the checks for the part you touched (below). Read the **exit code**, not the last line of output:
   `cmd; echo "exit: $?"`. A pipe such as `cmd | tail` always exits 0.
4. Commit as `type(scope): description`, for example `fix(judgment): reject a verdict on a closed case`.
   Types are `feat fix docs style refactor test ci chore`, and the scope is optional. The authority is
   the same list in `CLAUDE.md` § Git; if the two ever differ, that one wins.
5. Open the PR and fill in the template, including the commands you ran and their exit codes.

### Checks to run

| You changed | Run |
|---|---|
| `backend/` | `cd backend && .venv/bin/ruff check .` and `DATABASE_URL=sqlite:///:memory: .venv/bin/python manage.py makemigrations --check --dry-run`, then the tests below |
| `frontend/` | `cd frontend && npx tsc --noEmit && npm run lint`, then `npx jest <path>` for the tests near your change |
| `packages/core/` | `npm run --workspace packages/core typecheck`, `lint` and `test` |
| `mobile/` or `mobile-officer/` | `npm run --workspace mobile typecheck`, `lint` and `test` (and the same for `@soulledger/officer`; it imports `mobile/src`) |

Backend tests need a throwaway Redis, so they cannot write into a shared one:

```bash
redis-server --port 6399 --daemonize yes --save '' --appendonly no
cd backend && SECRET_KEY=ci-test-key-not-for-production-32-bytes-min DEBUG=true \
  DATABASE_URL=sqlite:///:memory: REDIS_URL=redis://127.0.0.1:6399/0 \
  .venv/bin/python -m pytest --no-cov -q tests/test_something.py apps/judgment/
```

Some tests read other files instead of importing them. A frontend change can therefore break a backend
test, and the reverse. Each side keeps a list of these tests: `backend/tests/reads-outside-backend.txt`
and `frontend/jest.always-run.txt`. If a CI job goes red in a place you did not touch, those lists are
the first place to look.

Two things that bite:
- `packages/core/src/config/workflow-templates.ts` is read by backend tests by its *layout*. Do not run a
  formatter over it.
- SQLite hides aborted transactions and `varchar` lengths. The daily CI runs on PostgreSQL, so a change to
  transactions or column widths can pass locally and fail there.

## What CI runs

- **On your pull request**: [`pr-checks.yml`](.github/workflows/pr-checks.yml). It runs ruff,
  `makemigrations --check`, `tsc` and eslint for each workspace, and a smoke test of the back end. It takes
  about ten minutes, with a read-only token and no secrets.
- **After merge, daily on `main`**: the full suite in [`ci.yml`](.github/workflows/ci.yml). It covers
  PostgreSQL, coverage floors, the three E2E browsers and audits.

Before merging, the maintainer runs the full local gate. Something it finds may come back to you as a
review comment.

## AI-assisted contributions

Most of this repository was written by Claude Code under the maintainer's rules, so AI-assisted PRs are
fine. The same rules apply to yours:

- **Say which tool you used** in the PR description.
- **You own every line.** You can explain it, you ran it, and the template lists the commands and exit
  codes.
- **Not accepted**, and closed without a long review:
  - bulk-generated changes that were never run;
  - formatting-only or wording-only churn;
  - PRs whose author cannot answer review questions.
- **Review**: the maintainer decides every merge. A first pass may be done with an AI tool; such comments
  say so.

## Licence

By submitting a contribution you agree to license it under the [Apache License 2.0](LICENSE), the
project's licence.

## Code of conduct

Be kind and specific. Criticise code, not people. Harassment gets a PR or issue closed and the account
blocked. Report problems to [tardisyuan@gmail.com](mailto:tardisyuan@gmail.com).

## Security

Do not open a public issue for a vulnerability. See [`SECURITY.md`](SECURITY.md).
