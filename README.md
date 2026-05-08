# SoulLedger

Cross-civilization soul management system — mythology research + full-stack web application.

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
Backend  (Django 5)   →  http://localhost:8000/api/v1/
PostgreSQL 16         →  localhost:5432
Redis 7                →  localhost:6379
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
python scripts/seed_chinese_data.py   # load Chinese Diyu reference data
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
bash scripts/start-backend.sh   # starts Django on :8000
bash scripts/start-frontend.sh # starts Next.js on :3333
bash scripts/stop-all.sh       # stops both
bash scripts/status.sh        # check status
```

---

## Project Structure

```
SoulLedger/
├── backend/                   # Django 5 + DRF API
│   ├── apps/
│   │   ├── souls/           # Soul model + state machine
│   │   ├── judgment/        # Judgment records
│   │   ├── disposition/     # Disposition + execution
│   │   ├── karma/           # Karma ledger service
│   │   ├── reincarnation/   # Rebirth cycle tracking
│   │   ├── realms/          # Reference: afterlife realms
│   │   ├── actors/          # Reference: deities, judges
│   │   └── events/          # Audit event log
│   ├── config/              # Django settings, URLs, Celery
│   ├── scripts/
│   │   └── seed_chinese_data.py  # Chinese Diyu seed data
│   └── tests/
│
├── frontend/                 # Next.js 14 (App Router)
│   ├── app/                 # Pages
│   ├── components/          # Reusable components
│   └── lib/api.ts           # Type-safe API client
│
├── infrastructure/            # Docker infra only
│   └── docker-compose.yml    # PostgreSQL + Redis
│
├── scripts/                  # Dev convenience scripts
│   ├── start-backend.sh
│   ├── start-frontend.sh
│   ├── start-all.sh
│   ├── stop-backend.sh
│   ├── stop-frontend.sh
│   ├── stop-all.sh
│   └── status.sh
│
├── docs/                     # Mythology research docs
│   ├── 地府结构研究/
│   ├── 欧洲天堂地狱/
│   └── 埃及冥界/
│
├── SPEC.md                   # Full project specification
└── docker-compose.yml        # Full-stack compose (all services)
```

---

## Key API Endpoints

```
GET    /api/v1/souls/                    # List souls
POST   /api/v1/souls/                    # Create soul
GET    /api/v1/souls/{id}/               # Soul detail
POST   /api/v1/souls/{id}/die/          # Mark soul as dead → JUDGING
POST   /api/v1/souls/{id}/transition/    # Manual state transition
GET    /api/v1/souls/{id}/karma/        # Karma summary

GET    /api/v1/realms/                   # List all realms
GET    /api/v1/actors/                   # List all actors
GET    /api/v1/events/                   # Audit event log

POST   /api/v1/judgment/                # Initiate judgment
POST   /api/v1/judgment/{id}/conclude/  # Submit verdict

GET    /api/v1/disposition/              # List dispositions
POST   /api/v1/disposition/{id}/execute/ # Execute → trigger reincarnation
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
| Frontend | Next.js 14, React 18, Tailwind CSS, TanStack Query, Zustand |
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

*Maintained by: Tardisyuan*
*GitHub: https://github.com/Tardisyuan/SoulLedger*
