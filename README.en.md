# SoulLedger

**English** | [中文](README.md)

Cross-Civilization Soul Management System — A full-stack web application for soul judgment and reincarnation across three civilizations (Chinese / European / Egyptian)

---

## Civilization Coverage

| Realm | Judgment | Memory Reset | Afterlife |
|-------|----------|--------------|-----------|
| **Chinese Underworld** | Ten Courts of Hell | Meng Po's Soup | Six Paths of Reincarnation |
| **European Heaven & Hell** | Original Sin + Dante's Nine Circles | River Lethe | Purgatory / Paradise / Hell |
| **Egyptian Duat** | Heart Weighing vs. Ma'at's Feather | Spell Recitation | Field of Reeds / Atum |

---

## Architecture

```
Frontend (Next.js 16)     →  http://localhost:3333
Backend  (Django 5 + DRF) →  http://localhost:8000/api/v1/
WebSocket (channels)      →  ws://localhost:8000/ws/notifications/
PostgreSQL 16              →  localhost:5432 (Docker)
Redis 7                    →  localhost:6379 (Channel Layer + Celery)
```

---

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 20+
- Docker (for PostgreSQL + Redis)

### 1. Start Infrastructure
```bash
cd infrastructure
docker compose up -d
```

### 2. Start Backend
```bash
cd backend
cp .env.example .env
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

### 3. Start Frontend
```bash
cd frontend
npm install
PORT=3333 npm run dev
```

### Or Use Scripts (from project root)
```bash
bash scripts/start-backend.sh     # Django on :8000
bash scripts/start-frontend.sh   # Next.js on :3333
bash scripts/stop-all.sh         # Stop both
bash scripts/status.sh           # Check status
bash scripts/restart-backend.sh  # Restart backend
bash scripts/restart-frontend.sh # Restart frontend
```

---

## Project Structure

```
SoulLedger/
├── backend/
│   ├── apps/
│   │   ├── souls/            # Soul models, state machine, karma
│   │   ├── karma/            # Karma calculation (time decay, inheritance)
│   │   ├── judgment/         # Judgment system
│   │   ├── disposition/      # Disposition plans
│   │   ├── reincarnation/    # Reincarnation system
│   │   ├── actors/           # Actor roles (judges, guardians, etc.)
│   │   ├── realms/           # Realm system (Underworld, Heaven, Duat)
│   │   ├── dispatch/         # Soul dispatch records
│   │   ├── permissions/      # Cross-realm judgment authorization
│   │   ├── audit/            # Audit logs (with trace_id)
│   │   ├── tenants/          # Multi-tenant: Tenant model, TenantManager
│   │   ├── authentication/   # JWT authentication
│   │   ├── workflow/         # Approval workflow system
│   │   ├── menus/            # Tree menus + MenuButton
│   │   ├── perm/             # RBAC: Permission, Role, DataScope, FieldPermission
│   │   ├── core/             # Shared: middleware, viewsets, mixins, WebSocket auth
│   │   ├── events/           # EventBus: EventEnvelope, DomainEventHandler, HandlerRegistry
│   │   ├── notifications/    # Notification system + WebSocket Consumer
│   │   ├── death_sync/       # Death Sync API
│   │   ├── social/           # Social: Post, Comment, Reaction, Follow, UserProfile
│   │   └── org/              # Organization
│   ├── config/               # Django config, URLs, ASGI (WebSocket routing)
│   └── tests/                # pytest tests (108 tests)
│
├── frontend/
│   ├── app/                  # Next.js 16 App Router pages
│   │   ├── souls/            # Soul list & detail
│   │   ├── karma/            # Karma management
│   │   ├── dispatch/         # Dispatch management
│   │   ├── workflow/         # Workflow visualization
│   │   ├── users/            # User management
│   │   ├── menus/            # Menu management
│   │   ├── permissions/      # Permission management
│   │   ├── admin/stats/      # Admin dashboard
│   │   └── (auth)/login/     # Login page
│   ├── lib/
│   │   ├── api/              # Type-safe API client
│   │   ├── social/           # Social domain hooks + queryKeys
│   │   └── ws/               # WebSocket client (WSClient)
│   ├── hooks/                # TanStack Query hooks + SocialEventBus
│   ├── src/components/       # UI components (AppLayout, RequireButton, ConnectionStatus)
│   ├── messages/             # i18n translations (zh-Hans, en, egy)
│   └── middleware.ts         # Route guard
│
├── infrastructure/
│   └── docker-compose.yml    # PostgreSQL + Redis
│
├── scripts/                  # Start/stop/restart/status scripts
├── docs/                     # Documentation + mythology research
├── DESIGN.md                 # Linear design system spec
└── SPEC.md                   # Full project spec
```

---

## Features

### Milestones
- **M1-M5**: Core system (Soul CRUD + multi-tenant + JWT + actors/realms + workflow)
- **M6**: Karma system (time decay + karmic inheritance)
- **M7**: DDD refactoring + RBAC permissions (DataScope, FieldPermission, Audit Trail)
- **M8-M9**: Engineering quality + bug fixes
- **M10**: Search system
- **M11**: Death Sync API + WebSocket infrastructure
- **M12**: Realtime system (EventBus + HandlerRegistry + Social domain + Frontend closure) ✅ **FINAL_CLOSE**

### Pages
| Page | Description | Access |
|------|-------------|--------|
| `/souls` | Soul list & detail | ALL |
| `/karma` | Karma time-decay calculation | JUDGE+ |
| `/dispatch` | Soul dispatch records | ADMIN |
| `/workflow` | Workflow visualization | JUDGE+ |
| `/users` | User management | ADMIN |
| `/menus` | Menu management | ADMIN |
| `/permissions` | Permission management | ADMIN |
| `/admin/stats` | Admin dashboard | ADMIN |

---

## Key APIs

```
Authentication
POST /api/v1/auth/login/         # Login (returns JWT)
POST /api/v1/auth/refresh/       # Refresh token

Souls (requires X-Tenant-ID header)
GET    /api/v1/souls/                     # List
POST   /api/v1/souls/                     # Create
GET    /api/v1/souls/{id}/               # Detail
PATCH  /api/v1/souls/{id}/               # Update
DELETE /api/v1/souls/{id}/               # Delete
POST   /api/v1/souls/{id}/transition/    # State transition

Karma
GET    /api/v1/karma/balance/{soul_id}/     # Karmic balance
POST   /api/v1/karma/calculate/{soul_id}/  # Recalculate karma

Actors & Realms
GET /api/v1/actors/   # Actor list
GET /api/v1/realms/   # Realm list

Dispatch
GET  /api/v1/dispatch/records/      # Dispatch records
POST /api/v1/dispatch/records/      # Create dispatch
GET  /api/v1/dispatch/proposed/     # Pending approval

Workflow
GET    /api/v1/workflows/                    # Workflow list
GET    /api/v1/nodes/                        # Node list
POST   /api/v1/workflow/templates/           # Create template
```

---

## State Machine

```
ALIVE → JUDGING → DISPOSED → REINCARNATING → ALIVE (new life)
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 18, Tailwind CSS, TanStack Query v5, TypeScript |
| Backend | Django 5, Django REST Framework, channels, contextvars TenantManager |
| Database | PostgreSQL 16 (production/Docker), SQLite (local dev) |
| Realtime | WebSocket (channels + RedisChannelLayer) |
| Event Bus | EventBus (EventEnvelope + DomainEventHandler + HandlerRegistry) |
| Task Queue | Celery 5, Redis 7 |
| Container | Docker Compose |
| Tests | 108 backend tests, 277 frontend tests |

---

## Seed Data

Pre-filled realms and roles for all three civilizations:

### Chinese Underworld (CN_DIYU)
- **11 Realms**: Celestial Court, City of Wrongful Death, Ten Courts of Hell, etc.
- **33 Actors**: Ten Kings of Hell, Wei Zheng, Lord Cui, Ksitigarbha, Ox-Head & Horse-Face, Black & White Impermanence, etc.

### European Heaven & Hell (EU_HEAVEN_HELL)
- **15 Actors**: Michael, Gabriel, Lucifer, Hades, Three Greek Judges, Odin, Freya, Hel, etc.

### Egyptian Duat (EG_DUAT)
- **43 Actors**: Osiris, Anubis, Thoth, Horus + 42 Judges + Ammit, etc.

---

## Security

- JWT + API Key authentication
- RBAC 4-tier roles (ADMIN/JUDGE/GUARDIAN/VIEWER) + DataScope + FieldPermission
- Fernet encryption (webhook secrets, PII payloads)
- Redis INCR atomic rate limiting
- SSRF protection (webhook URL validation)
- CSP / HSTS / X-Frame-Options

## Realtime Architecture

```
EventService → EventBus → Handlers → ChannelLayer → Consumer → Frontend
                                     (Redis)         (WebSocket)
```

- EventBus: Unified event bus with EventEnvelope + DomainEventHandler
- HandlerRegistry: O(1) dispatch, supports event_type/domain/global handlers
- 6 domains: soul, workflow, notification, dispatch, deathsync, social
- ChannelNaming: `rt_tenant_{code}`, `rt_user_{user_id}`

---

## Design Reference

Menu and permission system inspired by [Snowy](https://github.com/xiaonuobase/Snowy) (Apache-2.0).

---

*Maintainer: Tardisyuan*
*GitHub: https://github.com/Tardisyuan/SoulLedger*
