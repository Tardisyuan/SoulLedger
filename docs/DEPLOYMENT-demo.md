# The Vercel demo

A build of `frontend/` with no backend at all. Every visitor gets the same world, and whatever they change stays in
their own browser tab until they sign out or back in. It exists to be shown to people who want to see the product.

## How it works

`NEXT_PUBLIC_DEMO_MODE=1` at build time is the only switch. Without it the build behaves as if the demo did not exist:
the three entry points (`PlatformProvider`, the login page, the root layout) are behind a comparison the bundler folds, and
`frontend/demo/` never reaches a chunk. `src/__tests__/demoStaysOutOfTheNormalBuild.test.ts` holds the spelling of the
gates; `scripts/check-demo-bundle.sh absent|present` checks what a finished build really contains.

With it on:

| Piece | File | What it does |
|---|---|---|
| Interception | `demo/install.ts` | axios gets another adapter, `fetch` is wrapped for `/api/v1/` paths, `WebSocket` becomes a stand-in that says "connected" and stays quiet. No Service Worker, no network. |
| Reads | `demo/store.ts` | Answers GETs from the recording, under the session's overlay. Timestamps move with the calendar, so "two hours ago" stays true. |
| Writes | `demo/writes.ts`, `demo/flows.ts` | Generic create / patch / delete, plus the main lines that have to move state like the server (see below). |
| Sign-in | `demo/DemoLogin.tsx` | One button per role; goes through the real `authApi.login`, which the demo answers. `proxy.ts` still gates routes on the same cookie. |
| Banner | `demo/DemoBanner.tsx` | The strip on top of every page. |

Reset: the overlay lives in `sessionStorage`. A reload keeps it; a new tab or another person starts clean; sign-in and
sign-out drop it, along with any drafts in `localStorage`.

Anything the recording does not know reads as empty and logs a `console.info("[demo] …")`; it never errors.

## Deploying on Vercel

1. New Project → import this repository.
2. **Root Directory**: `frontend`. Leave "Include files outside the Root Directory" on: `packages/core` and the root
   `package-lock.json` are outside it.
3. `frontend/vercel.json` already sets the framework, the install command (`npx npm@11 ci` from the repo root: npm 10
   installs a broken tree from this lockfile, see `CLAUDE.md`) and `NEXT_PUBLIC_DEMO_MODE=1`. Add no other environment
   variables. In particular no `NEXT_PUBLIC_API_URL` and no Sentry DSN.
4. **Node.js Version**: 22.x. `.nvmrc` says 20.19.5 for this machine; the repo's gates are also green on 22.
5. Deploy. `next.config.js` turns `output: "standalone"` off in demo mode, and `proxy.ts` runs as Vercel's middleware.

To look at a demo build by hand, on the gates' machine:

```bash
DEMO_PUBLISH="-p 3334:3334" scripts/demo-remote.sh scripts/demo-serve-inner.sh   # then http://gates-host.lan:3334
```

Or on any machine with the dependencies installed: `cd frontend && export NEXT_PUBLIC_DEMO_MODE=1 && npx next build && npx next start -p 3334`.
The variable has to be set for `next start` as well: `next.config.js` reads it at both steps, and without it `next start` warns that it does not work with `output: "standalone"`. The app still runs, but the warning is right about that config.

## The app recordings

`frontend/public/demo-videos/` holds two short clips of the apps, recorded on a phone with `scrcpy` against the demo's
seeded world (`DEMO_PUBLISH="-p 8011:8000" scripts/demo-remote.sh scripts/demo-app-backend-inner.sh`, with Metro started
with `EXPO_PUBLIC_API_URL` pointing at it). The phone's status bar is cropped off.

## Publishing

The site follows the `demo` branch, not `main` (Vercel's Production branch is `demo`; `frontend/vercel.json` turns off
deployments from `main`, and preview deployments are off in the project settings). A push to `main` changes nothing on
the site. To publish what is on `main`:

```bash
git push origin main:demo
```

## Re-recording the data

`frontend/demo/data/<role>.<zh|en>.json` is recorded from the real backend, not written by hand: six roles (four civilizations' judges, administrator, moderator), each asked in both languages; what the seed wrote in one language is carried across by `scripts/demo-translations.json`, and `scripts/demo-cjk-report.py` lists what the English recordings still say in Chinese. When the API or the seed changes:

```bash
scripts/demo-record.sh        # needs GATES_REMOTE in .prepush.env; nothing heavy runs on this machine
```

That syncs this tree to the gates' machine and, in a container: creates a database on the throwaway PostgreSQL, migrates,
runs the seed commands and `scripts/demo-seed.py`, starts Django and a normal build, then `scripts/demo-record.mjs` signs in
as each role, walks every page and clicks every tab, sweeps every GET the OpenAPI schema declares, and writes the JSON. The
database is dropped at the end and the files come back here. Tokens and secret-named fields are removed from what is
recorded. To change what is in the world, edit `scripts/demo-seed.py`.

The administrator is walked first and alone: its screens list everyone's sign-ins, sessions, last logins and audit
rows, and every role's sign-in writes those. The other five roles see only their own, and a walk sends nothing but GETs
and its sign-in, so they then run at once, each against a Django process of its own (daphne runs a process's sync views
on one thread, so a shared server would only take turns); the browser's API requests are routed to that process. The
soul accounts are recorded last, because the judges' screens show soul sign-ins. `DEMO_PARALLEL` caps the concurrent
walks (default 5; `0` walks them in turn, as before). Measured one after another: admin 209 s, judge 148 s, judge_eu
113 s, judge_eg 116 s, judge_gr 101 s, moderator 49 s, about 12 minutes; expected now about 209 s plus the slowest of the
five under contention, roughly 6–7 minutes (an estimate until the next recording prints its `roles:` line).

The script records only when it has to. It hashes the working-tree content of `scripts/demo-seed.py`,
`scripts/demo-record.mjs` (which holds the role and route lists), `scripts/demo-record-inner.sh`,
`scripts/demo-backend-up.sh`, `scripts/demo_settings.py`, `scripts/demo-translations.json`, `backend/apps/`,
`backend/config/` and `backend/requirements.lock` (test files excluded), and keeps the hash in
`frontend/demo/data/.recorded-from` after each recording. An equal hash prints that the recording is current and exits
0 without reaching the gates' machine; `FORCE=1 scripts/demo-record.sh` records anyway. Frontend code is deliberately
not an input, so a change to the screens alone does not re-record; when a screen starts asking for something new,
use `FORCE=1`.

## Verifying

```bash
scripts/demo-remote.sh scripts/demo-e2e-inner.sh
```

Builds the demo, checks the bundle markers, and runs `frontend/e2e/demo/` (`frontend/playwright.demo.config.ts`), whose every
test fails if a request leaves the page's own origin. A normal `playwright test` ignores that directory.
