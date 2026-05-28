# Changelog

All notable changes to SoulLedger will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- GitHub Actions CI/CD pipeline (backend + frontend + migration check)
- Pre-commit hooks (ruff, prettier, eslint, trailing-whitespace)
- API documentation via DRF Spectacular (Swagger UI at `/api/docs/`)
- Frontend test framework: Jest + React Testing Library (126 tests)
- Semantic color tokens for theme-aware status/karma/verdict colors
- i18n: ~100 new translation keys across en.json and zh-Hans.json
- Data scope architecture design (Snowy analysis) documented for M7

### Fixed
- **CRITICAL**: Toast.tsx XSS vulnerability (innerHTML → textContent)
- **CRITICAL**: admin/stats page missing role guard
- **CRITICAL**: welcome page missing auth check
- **CRITICAL**: UserModal type assertion bypass (as any → proper typing)
- **CRITICAL**: SettingsDrawer CSS injection (hex color validation)
- **HIGH**: NotificationViewSet tenant isolation bypass
- **HIGH**: Password reset code length validation (6-digit enforced)
- **HIGH**: ALLOWED_HOSTS=['*'] → environment-based configuration
- **HIGH**: Registration rate limiting (5/hour via DRF throttle)
- **HIGH**: Empty tenant soul creation prevention
- **HIGH**: Cross-civilization workflow validation
- **HIGH**: SoulEvent `created_at` migration issue (stale column removed)
- Auth token reading: now checks both cookie and sessionStorage
- Events API 500 error (field name mismatch `created_at` → `create_time`)
- 15+ hardcoded Tailwind colors replaced with CSS variables
- 5 files with missing `hsl()` wrapper on CSS variables
- Toast SSR crash protection (document guard)
- localStorage try/catch in SettingsDrawer and AppLayout
- Variable shadowing in dashboard and workflow pages
- Dead component `progress-bar.tsx` removed
- 27+ hardcoded Chinese/English strings replaced with i18n keys

### Changed
- WorkflowEditor: 40+ hardcoded strings → i18n keys
- SoulEditModal: 15+ hardcoded strings → i18n keys
- All CIVILIZATION_LABELS/ROLE_LABELS/NODE_TYPE_LABELS → i18n
- KarmaChart colors: hardcoded hex → CSS variables
- Jest config: testEnvironment `node` → `jsdom`

## [0.1.0] - 2026-05-08

### Added
- Initial release
- Soul lifecycle management (ALIVE → JUDGING → DISPOSED → REINCARNATING)
- Multi-civilization support (Chinese Diyu, European Heaven-Hell, Egyptian Duat)
- Karma system with time-decay formula
- Judgment system with verdicts (PASSED/FAILED/PURGATORY/RETRY)
- Disposition and reincarnation workflows
- Cross-civilization soul dispatch
- Multi-stage approval workflow with ReactFlow visualization
- Role-based access control (RBAC) with menu permissions
- Tenant isolation (3 civilizations)
- Audit logging
- i18n support (zh-Hans, en, egy)
- Dark/light theme with CSS variables
