# SoulLedger

Cross-civilization soul management system — mythology research + full-stack web application.

---

## Civilization Coverage

| Domain | Judgment | Memory Reset | Destination |
|--------|----------|--------------|-------------|
| **Chinese Diyu** | Ten Courts of Yama | 孟婆汤 (Mengpo Soup) | 六道轮回 (Six Realms) |
| **European Heaven & Hell** | Mortal Sin + Dante Circles | Lethe River | Heaven / Purgatory / Hell |
| **Egyptian Duat** | Heart vs Ma'at Feather | Spell Recitation | Aaru (beyond Duat) |

---

## Architecture

```
Frontend (Next.js 14)  →  http://localhost:3333
Backend  (Django 5)     →  http://localhost:8000/api/v1/
PostgreSQL 16           →  localhost:5432
Redis 7                 →  localhost:6379
```

---

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 20+
- Docker (for PostgreSQL + Redis)

### 1. Start infrastructure
```bash
cd infrastructure
docker compose up -d
```

### 2. Start backend
```bash
cd backend
cp .env.example .env
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

### 3. Start frontend
```bash
cd frontend
npm install
PORT=3333 npm run dev
```

### Or use the scripts (from project root)
```bash
bash scripts/start-backend.sh   # Django on :8000
bash scripts/start-frontend.sh # Next.js on :3333
bash scripts/stop-all.sh       # stop both
bash scripts/status.sh         # check status
```

---

## Project Structure

```
SoulLedger/
├── backend/
│   ├── apps/
│   │   ├── souls/           # Soul model, state machine, karma
│   │   ├── tenants/         # Multi-tenant: Tenant model, middleware, TenantManager
│   │   ├── authentication/  # JWT auth, login endpoint
│   │   └── karma/           # Karma ledger service
│   ├── config/               # Django settings, URLs, Celery
│   ├── tests/
│   └── scripts/
│       └── seed_chinese_data.py  # Chinese Diyu seed data
│
├── frontend/
│   ├── app/                 # Next.js 14 App Router pages
│   │   ├── (auth)/login/   # Login page
│   │   ├── souls/           # Soul list + detail pages
│   │   └── page.tsx         # Home/landing page
│   ├── src/
│   │   ├── components/      # UI components
│   │   │   ├── ui/          # BaseModal, Toast
│   │   │   └── souls/       # SoulCreateModal, SoulEditModal
│   │   ├── contexts/        # TenantContext, ThemeContext, I18nContext, ToastContext
│   │   ├── hooks/           # TanStack Query hooks (useAuth, useSouls)
│   │   └── middleware.ts    # Route guard
│   ├── lib/api.ts           # Type-safe API client
│   ├── messages/             # i18n translations (zh-Hans, en, egy)
│   ├── tailwind.config.js   # Linear design tokens
│   └── components/          # LanguageSwitcher
│
├── infrastructure/
│   └── docker-compose.yml    # PostgreSQL + Redis
│
├── scripts/
│   ├── start-backend.sh
│   ├── start-frontend.sh
│   └── stop-all.sh
│
├── docs/                    # Mythology research docs
│
├── DESIGN.md                # Linear design system specification
├── AGENTS.md                # Agent work specification
├── SPEC.md                  # Full project specification
└── docker-compose.yml       # Full-stack compose
```

---

## Key API Endpoints

```
Authentication
POST   /api/v1/auth/login/            # Login (returns JWT)
POST   /api/v1/auth/refresh/         # Refresh token

Souls (requires X-Tenant-ID header)
GET    /api/v1/souls/                # List souls (tenant-filtered)
POST   /api/v1/souls/                # Create soul
GET    /api/v1/souls/{id}/           # Soul detail + records
PATCH  /api/v1/souls/{id}/           # Update soul
DELETE /api/v1/souls/{id}/           # Delete soul
POST   /api/v1/souls/{id}/transition/ # State transition

Karma (requires X-Tenant-ID header)
GET    /api/v1/karma/balance/{soul_id}/  # Get karmic balance
POST   /api/v1/karma/calculate/{soul_id}/ # Recalculate karma
```

---

## State Machine

```
ALIVE → JUDGING → DISPOSED → REINCARNATING → ALIVE (new life)
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14, React 18, Tailwind CSS, TanStack Query v5, @headlessui/react, TypeScript |
| Backend | Django 5, Django REST Framework, PostgreSQL 16 |
| Task Queue | Celery 5, Redis 7 |
| Cache | Redis 7 |
| Container | Docker Compose |

---

## Reference Data

Chinese Diyu realms and actors are pre-seeded:
- **11 realms**: DY_01_HEAVEN through DY_10_YAMA
- **16 actors**: 阎罗王, 孟婆, 牛头马面, 黑白无常, 判官, etc.

---

## Project Specifications

| File | Purpose |
|------|---------|
| `DESIGN.md` | Linear design system — color tokens, typography, component styles |
| `AGENTS.md` | Agent work specification — rules for Claude Code, sub-agents |
| `SPEC.md` | Full project specification — milestones, models, API contracts |

---

*Maintained by: Tardisyuan*
*GitHub: https://github.com/Tardisyuan/SoulLedger*
