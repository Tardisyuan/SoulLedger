# SoulLedger — Project Specification

> Cross-civilization soul management system. Multi-domain afterlife mythology research + full-stack web application.

---

## 1. Project Overview

**Vision**: A unified soul management platform that abstracts the afterlife systems of Chinese, European, and Egyptian civilizations into a single coherent architecture — serving as both a mythology reference and a functional web application.

**Core Problem**: No unified system exists to model, query, or simulate the soul disposition workflows across major mythological traditions.

**Target Users**: Developers building afterlife-related applications; mythology enthusiasts; educators; gamers.

---

## 2. Civilization Coverage

| Domain | Origin | Judgment | Memory Reset | Destination |
|--------|--------|----------|---------------|--------------|
| **Chinese Diyu** | 中国地府 | Ten Courts of Yama | 孟婆汤 (Mengpo Soup) | 六道轮回 (Six Realms) |
| **European Heaven & Hell** | 欧洲天堂地狱 | Mortal Sin + Dante Circles | Lethe River | Heaven / Purgatory / Hell |
| **Egyptian Duat** | 埃及冥界 | Heart vs Ma'at Feather | Spell Recitation | Aaru (beyond Duat) |

---

## 3. Technical Stack

```
Frontend
├── Next.js 14 (App Router)
├── Tailwind CSS
├── shadcn/ui
└── Zustand + TanStack Query

Backend
├── Django 5 + Django REST Framework
├── PostgreSQL 16
├── Redis (cache + broker)
├── Celery (async tasks)
└── FastAPI (AI microservice, optional)

AI
├── OpenAI GPT-4o / Claude API
└── RAG (soul knowledge base)

Infrastructure
├── Docker + docker-compose
├── Railway / Render / VPS
└── GitHub Actions (CI/CD)
```

---

## 4. System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Next.js Frontend                        │
├─────────────────────────────────────────────────────────────┤
│  Public Pages          │  Admin Dashboard                   │
│  ├── Landing Page      │  ├── Soul CRUD                   │
│  ├── Soul Lookup       │  ├── Judgment Workflow           │
│  ├── AI Chat           │  ├── Karma Ledger                │
│  └── Leaderboard       │  └── Workflow Approval           │
└────────────────────────┬──────────────────────────────────┘
                         │ REST API
┌────────────────────────┴──────────────────────────────────┐
│                   Django + DRF Backend                      │
├────────────────────────────────────────────────────────────┤
│  Core Apps                                                      │
│  ├── souls/        Soul identity, state machine, records      │
│  ├── judgment/     Multi-civilization judgment flows          │
│  ├── disposition/   Realm routing, memory reset mechanisms     │
│  ├── karma/        Merit/demerit ledger, karmic balance      │
│  ├── reincarnation/ Cycle tracking, realm assignment            │
│  ├── workflow/     Approval processes, admin queue            │
│  └── ai/           Chat, RAG, knowledge base                  │
│                                                                  │
│  Shared                                                          │
│  ├── actors/      Deities, judges, supernatural entities       │
│  ├── realms/      Cross-civilization realm definitions         │
│  └── events/      Audit log of all soul state changes         │
└───────────────────────────────────────────────────────────────┘
                         │
┌────────────────────────┴──────────────────────────────────┐
│                   PostgreSQL + Redis                          │
│  ├── Soul state machine      │  Celery async tasks            │
│  ├── Karma ledger            │  Workflow queue               │
│  └── Judgment records         │  Cache layer                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Data Model (Core Entities)

### Soul
```
soul_id          UUID (PK)
civilization     ENUM('CHINESE', 'EUROPEAN', 'EGYPTIAN')
current_state    ENUM('ALIVE', 'JUDGING', 'DISPOSED', 'REINCARNATING')
merit_score      INT DEFAULT 0
demerit_score    INT DEFAULT 0
karmic_balance   INT (computed: merit - demerit)
birth_date       DATE
death_date      DATE (nullable)
origin_location VARCHAR(255)
created_at       TIMESTAMP
updated_at       TIMESTAMP
```

### SoulRecord
```
record_id        UUID (PK)
soul_id          FK(Soul)
record_type      ENUM('MERIT', 'DEMERIT', 'JUDGMENT', 'DISPOSITION')
description      TEXT
weight           INT (significance of the record)
civilization     ENUM  (which system's law this applies to)
evidence_json    JSONB (flexible evidence storage)
created_at       TIMESTAMP
```

### Judgment
```
judgment_id      UUID (PK)
soul_id          FK(Soul)
civilization     ENUM
judge_entity     VARCHAR(255)  -- Yama/Osiris/Christian Tribunal
evidence_json    JSONB
confession      TEXT
verdict         ENUM('PASSED', 'FAILED', 'PURGATORY', 'RETRY')
notes           TEXT
created_at      TIMESTAMP
```

### Disposition
```
disposition_id   UUID (PK)
soul_id          FK(Soul)
judgment_id      FK(Judgment)
destination_realm VARCHAR(100)  -- unified cross-civilization realm code
memory_reset     ENUM('MENGPO', 'LETHE', 'SPELL', 'NONE')
is_eternal       BOOLEAN
sentence_years   INT (nullable)
executed_at      TIMESTAMP (nullable)
```

### Reincarnation
```
reincarnation_id UUID (PK)
soul_id          FK(Soul)
disposition_id   FK(Disposition)
target_realm     VARCHAR(100)
rebirth_form     ENUM('HUMAN', 'ANIMAL', 'DIVINE', 'OTHER')
cycle_count      INT
previous_realm   VARCHAR(100)
```

### Realm (Reference Data)
```
realm_code       VARCHAR(100) (PK)  -- e.g. 'DY_01', 'EU_HEAVEN', 'EG_AARU'
civilization     ENUM
name_local      VARCHAR(255)  -- original name in native script
name_en         VARCHAR(255)
realm_type      ENUM('HELL', 'PURGATORY', 'BLISS', 'NEUTRAL')
tier            INT  -- severity/bliss level
parent_realm    VARCHAR(100) (nullable)
```

### Actor (Deities/Entities)
```
actor_id         UUID (PK)
name             VARCHAR(255)
civilization     ENUM
role             ENUM('JUDGE', 'EXECUTOR', 'GUARDIAN', 'CONDUIT')
realm_code       FK(Realm)
description      TEXT
powers_json      JSONB
```

---

## 6. State Machine

```
                    ┌─────────────┐
                    │   ALIVE    │
                    └──────┬─────┘
                           │ death
                           ▼
                    ┌─────────────┐
                    │  JUDGING    │◄─────────┐
                    └──────┬─────┘          │
                           │ verdict         │ retry
                           ▼                 │
              ┌────────────────────────────┐  │
              │                            │  │
              ▼                            │ │
       ┌────────────┐              ┌──────┴──────┐
       │ DISPOSED   │              │   JUDGING    │
       └──────┬─────┘              └─────────────┘
              │ (memory_reset)
              ▼
       ┌────────────┐
       │ REINCARNATING │
       └──────┬─────┘
              │
              ▼
       ┌────────────┐
       │   ALIVE    │ (new life)
       └────────────┘
```

---

## 7. Feature Roadmap

### Phase 1 — Foundation (MVP)
> _Goal: Core soul management with single-civilization coverage_

| Feature | Description | Priority |
|---------|-------------|----------|
| Soul CRUD | Create, read, update soul profiles with state machine | P0 |
| Soul Lookup | Public search by ID, name, civilization | P0 |
| Soul State Transitions | State machine with full audit log | P0 |
| Soul Records | Merit/demerit records with evidence | P0 |
| Karma Ledger | Balance calculation, history view | P0 |
| Realm Reference Data | Chinese Diyu realms pre-loaded | P0 |
| Actor Reference Data | Deities/ten courts pre-loaded | P0 |
| Judgment Flow (Chinese) | Basic ten courts flow (simplified) | P1 |
| Disposition Execution | Realm assignment, memory reset | P1 |
| Reincarnation Tracking | Cycle counter, rebirth record | P1 |

### Phase 2 — Multi-Civilization + Workflow
> _Goal: Full coverage across all three systems + admin workflow_

| Feature | Description | Priority |
|---------|-------------|----------|
| Judgment Flow (European) | Christian tribunal + Purgatory | P0 |
| Judgment Flow (Egyptian) | Osiris judgment + heart weighing | P0 |
| Realm Reference Data | EU + EG realms pre-loaded | P0 |
| Actor Reference Data | EU angels, EG deities pre-loaded | P0 |
| Workflow Engine | Multi-step approval queue in Django admin | P1 |
| Cross-Civilization Transfer | Soul migrating between systems | P1 |
| Audit Event Log | Full immutable history | P1 |
| Public Leaderboard | Merit/demerit rankings | P2 |

### Phase 3 — AI + Engagement
> _Goal: Intelligent features + public engagement_

| Feature | Description | Priority |
|---------|-------------|----------|
| AI Soul Chat | RAG-powered chat with soul knowledge base | P0 |
| Soul Profile Page | Public individual soul page (shareable) | P1 |
| Reincarnation Simulator | "What realm will you go to?" quiz | P1 |
| Karma Report | Generated PDF karma statement | P2 |
| Webhook API | External system integration | P2 |
| i18n | Chinese + English interfaces | P2 |

### Phase 4 — Scale + Advanced
> _Goal: High-traffic support + advanced workflows_

| Feature | Description | Priority |
|---------|-------------|----------|
| Seckill Judgment | Rate-limited batch judgment (Celery + Redis) | P1 |
| Scheduled Retribution | Cron-based karma recalculation | P1 |
| Admin Dashboard | Charts, metrics, realm heatmaps | P2 |
| Open API | Public REST API with auth | P2 |
| Mobile Responsive | Tailwind breakpoints | P2 |

---

## 8. Milestones

### Milestone 1 — Soul Core ✓ (Target: Week 1-2)
```
- [ ] Django project + apps scaffolded
- [ ] Soul model + CRUD endpoints
- [ ] Soul state machine logic
- [ ] Soul records model
- [ ] Karma ledger logic
- [ ] Realm reference data (Chinese)
- [ ] Actor reference data (Chinese)
- [ ] Basic unit tests
```

### Milestone 2 — Judgment & Disposition ✓ (Target: Week 3-4)
```
- [ ] Chinese judgment flow (simplified ten courts)
- [ ] Disposition execution
- [ ] Reincarnation tracking
- [ ] State transition audit log
- [ ] Basic frontend soul lookup page
- [ ] Integration tests
```

### Milestone 3 — Multi-Civilization ✓ (Target: Week 5-6)
```
- [ ] European judgment flow
- [ ] Egyptian judgment flow
- [ ] EU + EG realm + actor data
- [ ] Cross-civilization transfer protocol
- [ ] Workflow engine (Django admin)
- [ ] Public leaderboard
```

### Milestone 4 — AI Features ✓ (Target: Week 7-8)
```
- [ ] Vector database setup (knowledge base)
- [ ] RAG pipeline for soul mythology
- [ ] AI chat endpoint
- [ ] Chat UI page
- [ ] Soul profile public page
```

### Milestone 5 — Scale & Polish ✓ (Target: Week 9-10)
```
- [ ] Redis caching layer
- [ ] Celery seckill judgment task
- [ ] Scheduled retribution cron
- [ ] Open API (OAuth2)
- [ ] i18n (ZH/EN)
- [ ] Docker compose setup
- [ ] CI/CD pipeline
```

---

## 9. API Design (Core Endpoints)

### Souls
```
GET    /api/v1/souls/                    # List souls (paginated, filterable)
POST   /api/v1/souls/                    # Create soul
GET    /api/v1/souls/{id}/               # Get soul detail
PATCH  /api/v1/souls/{id}/               # Update soul
DELETE /api/v1/souls/{id}/               # Soft delete soul
GET    /api/v1/souls/{id}/records/       # Get soul's merit/demerit records
POST   /api/v1/souls/{id}/records/       # Add record
GET    /api/v1/souls/{id}/judgment/       # Get current judgment
GET    /api/v1/souls/{id}/disposition/    # Get current disposition
```

### Judgment
```
POST   /api/v1/judgments/                # Initiate judgment
GET    /api/v1/judgments/{id}/            # Get judgment detail
POST   /api/v1/judgments/{id}/verdict/     # Submit verdict
POST   /api/v1/judgments/{id}/appeal/     # File appeal
```

### Karma
```
GET    /api/v1/karma/balance/{soul_id}/   # Get karmic balance
GET    /api/v1/karma/history/{soul_id}/    # Get karma history
POST   /api/v1/karma/calculate/            # Trigger recalculation
```

### Workflow
```
GET    /api/v1/admin/workflow/            # List pending approvals
POST   /api/v1/admin/workflow/{id}/approve/
POST   /api/v1/admin/workflow/{id}/reject/
```

### AI
```
POST   /api/v1/ai/chat/                   # Send chat message
GET    /api/v1/ai/chat/{session_id}/       # Get chat history
```

### Realms & Actors
```
GET    /api/v1/realms/                    # List all realms
GET    /api/v1/realms/{code}/             # Get realm detail
GET    /api/v1/actors/                    # List all actors
GET    /api/v1/actors/{id}/               # Get actor detail
```

---

## 10. Environment Variables

```env
# Django
SECRET_KEY=
DEBUG=true
ALLOWED_HOSTS=localhost,127.0.0.1

# Database
DATABASE_URL=postgres://user:pass@localhost:5432/soulledger

# Redis
REDIS_URL=redis://localhost:6379/0

# Celery
CELERY_BROKER_URL=redis://localhost:6379/1
CELERY_RESULT_BACKEND=redis://localhost:6379/2

# AI
OPENAI_API_KEY=
ANTHROPIC_API_KEY=

# App
CIVILIZATION_DEFAULT=CHINESE
KARMA_RECORD_WEIGHT_MAX=100
```

---

## 11. Project Structure

```
soulledger/
├── apps/
│   ├── souls/
│   │   ├── models.py
│   │   ├── serializers.py
│   │   ├── views.py
│   │   ├── services.py       # business logic
│   │   ├── state_machine.py
│   │   └── tests/
│   ├── judgment/
│   ├── disposition/
│   ├── karma/
│   ├── reincarnation/
│   ├── workflow/
│   ├── actors/
│   ├── realms/
│   └── events/               # audit log
├── config/
│   ├── settings.py
│   ├── urls.py
│   ├── celery.py
│   └── docker-compose.yml
├── frontend/
│   ├── app/
│   │   ├── (public)/         # landing, lookup, chat
│   │   ├── admin/           # dashboard
│   │   └── api/             # API routes
│   ├── components/
│   ├── lib/
│   └── package.json
├── docs/
│   └── SPEC.md
├── tests/
├── scripts/
│   └── seed_data.py          # realm + actor seeders
├── .env.example
├── docker-compose.yml
├── Dockerfile
├── .gitignore
└── README.md
```

---

## 12. Open Questions / Future Considerations

- [ ] How to handle souls that die in civilization A but belong to civilization B (e.g., Chinese person dying in Europe)?
- [ ] Should the AI chat use real-time webhooks or polling?
- [ ] Rate limits for public API tier?
- [ ] GDPR-like concerns for soul data (right to erasure)?
- [ ] GraphQL vs REST for complex nested queries (soul → records → judgment → disposition)?

---

*Last updated: 2026-05-08*
*Version: 1.0*
