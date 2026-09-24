import { test as base, type Locator, type Page, type Request } from "@playwright/test";

/**
 * Shared E2E setup: authenticated browser state + a route-level mock of the
 * REST API.
 *
 * ── Why the API is mocked ─────────────────────────────────────────────────
 * playwright.config.ts starts ONE server: `npm run start:e2e` (a Next.js
 * build served on :3333 — see playwright.config.ts's `webServer` for why
 * this is a build and not `next dev`).
 * Nothing starts Django, and packages/core/src/api/client.ts points at
 * NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1" — so in CI every XHR
 * this app makes is a connection refused. These specs therefore intercept
 * `**​/api/v1/**` and answer from the fixtures below. That keeps CI free of a
 * Postgres/Django/Redis dependency while still exercising the real router,
 * middleware, React tree, TanStack Query cache and mutation wiring.
 *
 * ── Why the old fixture never authenticated anything ──────────────────────
 * The previous version wrote `access_token` / `refresh_token` / `user` into
 * localStorage. Not one of those three keys exists anywhere in the app:
 *   - middleware.ts:41 gates every non-public route on the COOKIE
 *     `soulledger_refresh`; localStorage is invisible to middleware, which
 *     runs on the server before any script executes.
 *   - packages/core/src/api/client.ts:42 reads the access token from the cookie
 *     `soulledger_access` or `sessionStorage.soulledger_access`.
 *   - TenantContext.tsx:62 hydrates the user from localStorage key
 *     `soulledger_user`, and expects a `{ user, storedAt }` envelope rather
 *     than a bare user object.
 * So even when it was called it authenticated nothing — and it was never
 * called: both specs imported it and no line invoked it.
 */

// Must mirror playwright.config.ts — cookies are scoped to this origin.
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3333";

// ── Locators for the display conventions ──────────────────────────────────

/**
 * Locates a domain enum by its RAW member — souls state/civilization,
 * workflow case_type/status/node_type, dispatch status, cross-judgment
 * status, audit action, realm type, and so on.
 *
 * BRIEF §4.6 (src/lib/domainDisplay.ts, src/components/ui/DomainValue.tsx):
 * `<DomainEnum>` puts the TRANSLATED copy in the text node and the raw
 * SCREAMING_SNAKE member in `title`, for triage. Two rules follow, and both
 * are the reason this helper exists rather than a bare getByText:
 *
 *   - Never assert a raw enum member as visible text. That is precisely the
 *     defect §4.6 removes, so such an assertion pins the bug in place.
 *   - Prefer this over asserting the translated string. Going through `title`
 *     survives a translation edit AND simultaneously proves the raw member
 *     stayed out of the text node.
 *
 * `.filter({ visible: true })` for the same reason the spec files do it: while
 * the dev server compiles a route it parks a duplicate subtree in a
 * `<div hidden>`, so an unfiltered locator intermittently matches twice.
 *
 * `scope` takes a Locator as well as the Page, and usually should: the same
 * enum member legitimately renders more than once per screen (a PROPOSED
 * dispatch appears in both the pending and history lists, since
 * dispatchApi.history() hits the same unfiltered endpoint), so a page-wide
 * getByTitle would be ambiguous. Scope it to the row or card under test.
 */
export function domainEnum(scope: Page | Locator, rawMember: string) {
  return scope.getByTitle(rawMember).filter({ visible: true });
}

// ── Identity ──────────────────────────────────────────────────────────────

/**
 * Shape of TenantContext's AuthUser (src/contexts/TenantContext.tsx:29).
 * ADMIN matters: usePermissions.hasPermission short-circuits to true for
 * role ADMIN, which is what opens every <RequirePermission> gate on the
 * screens under test.
 */
export const TEST_USER = {
  id: 1,
  username: "test_admin",
  display_name: "测试管理员",
  email: "test_admin@soulledger.test",
  role: "ADMIN" as const,
  tenant: { id: 1, code: "CN_DIYU", display_name: "中国地府" },
};

function b64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/**
 * A structurally valid unsigned JWT. Nothing verifies the signature here —
 * every request is answered by a route mock — but the payload deliberately
 * carries `tenant_code: CN_DIYU`, matching TEST_USER.tenant.code, so this
 * token would also satisfy the JWT-tenant/user cross-check added in 44d12f7
 * (backend TenantPermission) if these specs were ever pointed at a real API.
 */
export const MOCK_ACCESS_TOKEN = [
  b64url({ alg: "HS256", typ: "JWT" }),
  b64url({
    token_type: "access",
    exp: 4102444800, // 2100-01-01, so it never expires mid-suite
    user_id: TEST_USER.id,
    username: TEST_USER.username,
    tenant_code: TEST_USER.tenant.code,
    role: TEST_USER.role,
  }),
  "e2e_mock_signature",
].join(".");

export const MOCK_REFRESH_TOKEN = [
  b64url({ alg: "HS256", typ: "JWT" }),
  b64url({ token_type: "refresh", exp: 4102444800, user_id: TEST_USER.id, tenant_code: TEST_USER.tenant.code }),
  "e2e_mock_signature",
].join(".");

// ── Fixture data ──────────────────────────────────────────────────────────

export const PERMISSIONS = [
  { id: 1, codename: "soul.read", name: "查看灵魂", category: "souls" },
  { id: 2, codename: "soul.create", name: "创建灵魂", category: "souls" },
  { id: 3, codename: "dispatch.approve", name: "批准调度", category: "dispatch" },
  { id: 4, codename: "dispatch.reject", name: "驳回调度", category: "dispatch" },
  { id: 5, codename: "menu.read", name: "查看菜单", category: "system" },
  { id: 6, codename: "system.settings", name: "系统设置", category: "system" },
  { id: 7, codename: "recycle_bin.read", name: "查看回收站", category: "system" },
  { id: 8, codename: "recycle_bin.restore", name: "恢复条目", category: "system" },
];

const ALL_PERMISSION_IDS = PERMISSIONS.map((p) => p.id);

/**
 * Baseline grants. JUDGE and GUARDIAN are deliberately non-subsets of each
 * other (JUDGE alone holds dispatch.approve, GUARDIAN alone holds
 * recycle_bin.read) so the matrix's "peers, not a ladder" legend —
 * findNonSubsetPair, app/permissions/page.tsx:102 — has something real to
 * render.
 */
export const ROLE_GRANTS: Record<string, number[]> = {
  ADMIN: [...ALL_PERMISSION_IDS],
  JUDGE: [1, 3, 5],
  GUARDIAN: [1, 5, 7],
};

export const ROLES = [
  { id: 1, name: "ADMIN", display_name: "管理员", scope: "GLOBAL", organization: null, organization_name: null, user_count: 2, version: 7, update_time: "2026-08-01T00:00:00Z" },
  { id: 2, name: "JUDGE", display_name: "判官", scope: "TENANT", organization: null, organization_name: null, user_count: 5, version: 3, update_time: "2026-08-01T00:00:00Z" },
  { id: 3, name: "GUARDIAN", display_name: "守卫", scope: "TENANT", organization: null, organization_name: null, user_count: 4, version: 2, update_time: "2026-08-01T00:00:00Z" },
];

export const SOULS = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "孟婆的第一位客人",
    civilization: "CHINESE",
    current_state: "JUDGING",
    birth_date: { year: 1820, month: 3, day: 4 },
    death_date: { year: 1888, month: 11, day: 2 },
    merit_score: 120,
    demerit_score: 78,
    karmic_balance: 42,
    tenant_code: "CN_DIYU",
    date_problems: [],
    has_date_warning: false,
    has_record_error: false,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "尼罗河的书记官",
    civilization: "EGYPTIAN",
    current_state: "ALIVE",
    birth_date: { year: -1300, month: 1, day: 1 },
    death_date: null,
    merit_score: 0,
    demerit_score: 0,
    karmic_balance: 0,
    tenant_code: "EG_DUAT",
    date_problems: [],
    has_date_warning: false,
    has_record_error: false,
  },
];

/** A PROPOSED cross-civilization dispatch: Chinese Diyu → Egyptian Duat. */
/** Exactly the fields `DispatchRecordListSerializer` sends, and no others.
 *
 * It used to carry `reason`, `dispatched_by`, `dispatched_by_name`,
 * `decided_at`, `create_time` and `update_time` -- none of which the *list*
 * serializer emits. `e2e/critical-paths.spec.ts` then asserted that the
 * pending card shows `PROPOSED_DISPATCH.reason`, and it passed, because the
 * fixture supplied a field production does not. On a real list response that
 * card has no reason on it at all.
 *
 * (The assertion on the *detail* page in the same file is correct: detail goes
 * through `DispatchRecordSerializer`, which does send `reason`.)
 *
 * A fixture wider than the contract does not merely fail to catch a bug -- it
 * manufactures the behaviour the test then certifies. */
export const PROPOSED_DISPATCH_DETAIL_ONLY = {
  reason: "此魂的罪业需由杜阿特的天平复核。",
  dispatched_by: "5",
  dispatched_by_name: "崔判官",
  decided_at: null,
  create_time: "2026-08-10T02:00:00Z",
  update_time: "2026-08-10T02:00:00Z",
};

export const PROPOSED_DISPATCH = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  source_tenant: 1,
  source_tenant_code: "CN_DIYU",
  target_tenant: 3,
  target_tenant_code: "EG_DUAT",
  soul: SOULS[0].id,
  soul_name: SOULS[0].name,
  status: "PROPOSED",
  proposed_at: "2026-08-10T02:00:00Z",
  executed_at: null,
};

/** Served from the same *list* endpoint as PROPOSED_DISPATCH, so it gets the
 * same field set. It spread PROPOSED_DISPATCH and then added `reason` and
 * `decided_at` straight back -- the two list-absent fields that fixture's
 * docstring records removing. Caught 2026-09-14 when
 * `test_e2e_fixtures_match_the_serializers.py` stopped reading a hand list. */
export const EXECUTED_DISPATCH = {
  ...PROPOSED_DISPATCH,
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  soul: SOULS[1].id,
  soul_name: SOULS[1].name,
  source_tenant_code: "EU_HEAVEN_HELL",
  target_tenant_code: "CN_DIYU",
  status: "EXECUTED",
  executed_at: "2026-08-06T02:00:00Z",
};

/**
 * GET /souls/{id}/ — SoulSerializer. Sits in JUDGING so the detail page
 * offers the "开始审判" action.
 *
 * Written out rather than `...SOULS[0]`: that spread carried
 * `has_date_warning` / `has_record_error`, which only `SoulListSerializer`
 * computes. The detail serializer does not send them.
 */
export const SOUL_DETAIL = {
  id: SOULS[0].id,
  name: SOULS[0].name,
  civilization: SOULS[0].civilization,
  current_state: SOULS[0].current_state,
  birth_date: SOULS[0].birth_date,
  death_date: SOULS[0].death_date,
  merit_score: SOULS[0].merit_score,
  demerit_score: SOULS[0].demerit_score,
  karmic_balance: SOULS[0].karmic_balance,
  tenant_code: SOULS[0].tenant_code,
  date_problems: SOULS[0].date_problems,
  birth_name: "孟氏",
  origin_location: "钱塘",
  description: "首位在忘川边留下姓名的魂。",
  tenant: 1,
};

/** GET /souls/{id}/karma/ — LedgerSummary. */
export const SOUL_LEDGER = {
  soul_id: SOULS[0].id,
  soul_name: SOULS[0].name,
  merit_score: 120,
  demerit_score: 78,
  karmic_balance: 42,
  record_count: 0,
  records: [],
  reading: {
    kind: "BALANCE",
    civilization: "CHINESE",
    balance: 42,
    merit: 120,
    demerit: 78,
  },
};

/** GET /ledger/inheritance/{soul_id}/ — LedgerInheritance, one object.
 *
 * Was `paginated([])`: a page envelope from an object endpoint. The soul page
 * treats any 200 body as the inheritance (`inheritance && …`), so the card
 * rendered `→ undefined` over NaN-width bars -- a state no response produces.
 * SOULS[0] is Chinese, which has a next life, so 200 is the honest reply;
 * the rates are the backend's (0.2 merit, 1.0 unripened demerit). */
export const SOUL_INHERITANCE = {
  soul_id: SOULS[0].id,
  inherited_merit: 24,
  inherited_demerit: 78,
  inheritance_merit_rate: 0.2,
  inheritance_demerit_rate: 1.0,
};

/** The judgment POST /judgment/ opens for a soul already in JUDGING. */
export const OPENED_JUDGMENT = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  soul: SOULS[0].id,
  soul_name: SOULS[0].name,
  civilization: "CHINESE",
  verdict: null,
  is_final: false,
  notes: "",
  concluded_at: null,
  /** `created_at`, not `create_time`.
   *
   * `JudgmentSerializer` sends `created_at`. With `create_time` the detail
   * page's `formatDate(judgment.created_at)` received undefined, threw
   * `RangeError: Invalid time value`, and the whole page rendered the error
   * boundary -- so every existing e2e that opened `/judgment/{id}` was
   * looking at "服务器错误", not at a judgment. */
  created_at: "2026-08-13T02:00:00Z",
};

/**
 * GET /ledger/stats/overview/ — the dashboard/welcome headline numbers.
 * Must carry `state_distribution`: app/welcome/page.tsx:115 reads
 * `stats?.state_distribution.find(...)`, where the optional chain stops at
 * `stats`, so any body missing that key throws into the error boundary.
 */
export const LEDGER_STATS = {
  total_souls: 2,
  state_distribution: [
    { state: "ALIVE", label: "在世", count: 1 },
    { state: "JUDGING", label: "审判中", count: 1 },
    { state: "DISPOSED", label: "已处置", count: 0 },
  ],
  tenants: [],
  karma_distribution: [],
  recent_activity: [],
  souls_by_realm: [],
};

/** One row for the workflow screen's "审批实例" tab. */
/** Exactly the fields `ApprovalWorkflowListSerializer` sends.
 *
 * `soul` used to hold `SOULS[0].name` -- a Chinese personal name. On that
 * serializer `soul` is the primary key, a UUID. `e2e/workflow.spec.ts` then
 * asserted that the row displays `WORKFLOW_INSTANCE.soul` and passed, while
 * the real page shows the UUID: the fixture supplied the behaviour the test
 * certified. The list serializer sends no `soul_name` at all, which is the
 * defect the corrected fixture exposes.
 *
 * It also carried `create_time` and `current_node`, which that serializer does
 * not send, and omitted `priority`, `cross_civilization`, `created_at` and
 * `completed_at`, which it does. */
export const WORKFLOW_INSTANCE = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  workflow_name: "十殿审判流程",
  case_type: "ROUTINE",
  soul: SOULS[0].id,
  // Added to the list serializer 2026-08-30, for the reason the corrected
  // `soul` above exposed: with only the primary key to hand, the row printed
  // a UUID where a name belongs.
  soul_name: SOULS[0].name,
  status: "IN_PROGRESS",
  is_appeal: false,
  priority: 0,
  cross_civilization: false,
  created_at: "2026-08-09T01:00:00Z",
  completed_at: null,
};

/**
 * Sidebar tree. ADMIN fetches menusApi.all() → GET /menus/list-public/,
 * which returns a bare array of top-level items (useSidebarMenus.ts).
 */
export const MENUS = [
  { id: 1, name: "灵魂", path: "/souls", icon: "users", order: 1, component: null, roles: [], is_active: true, parent: null, menu_type: "MENU", visible: true },
  { id: 2, name: "调度管理", path: "/dispatch", icon: "send", order: 2, component: null, roles: [], is_active: true, parent: null, menu_type: "MENU", visible: true },
  { id: 3, name: "权限管理", path: "/permissions", icon: "shield", order: 3, component: null, roles: [], is_active: true, parent: null, menu_type: "MENU", visible: true },
  { id: 4, name: "回收站", path: "/recycle-bin", icon: "trash", order: 4, component: null, roles: [], is_active: true, parent: null, menu_type: "MENU", visible: true },
  { id: 5, name: "定时任务", path: "/scheduler", icon: "Clock", order: 5, component: "scheduler", roles: ["ADMIN"], is_active: true, parent: null, menu_type: "MENU", visible: true },
  // backend/apps/menus/migrations/0016_add_soul_account_menus.py (flat here: this tree has no directories).
  { id: 6, name: "待交付初始密码", path: "/soul-credentials", icon: "KeyRound", order: 6, component: "soul-credentials", roles: ["ADMIN"], is_active: true, parent: null, menu_type: "MENU", visible: true },
  { id: 7, name: "转生申请", path: "/rebirth-applications", icon: "RefreshCw", order: 7, component: "rebirth-applications", roles: ["ADMIN", "JUDGE"], is_active: true, parent: null, menu_type: "MENU", visible: true },
  // backend/apps/menus/migrations/0017_add_moderation_menu.py
  { id: 8, name: "朋友圈审核", path: "/moderation", icon: "ShieldAlert", order: 8, component: "moderation", roles: ["ADMIN"], is_active: true, parent: null, menu_type: "MENU", visible: true },
  // backend/apps/menus/migrations/0018_add_soul_inbox_menu.py
  { id: 9, name: "殿司收件箱", path: "/soul-inbox", icon: "Inbox", order: 9, component: "soul-inbox", roles: ["ADMIN"], is_active: true, parent: null, menu_type: "MENU", visible: true },
  // backend/apps/menus/migrations/0019_add_sentence_requests_menu.py
  { id: 10, name: "受刑请求", path: "/sentence-requests", icon: "FileCheck", order: 10, component: "sentence-requests", roles: ["ADMIN", "JUDGE"], is_active: true, parent: null, menu_type: "MENU", visible: true },
];

export const RECYCLE_BIN_ENTRY = {
  entity_type: "soul",
  kind: "domain" as const,
  id: "33333333-3333-4333-8333-333333333333",
  label: "误删的渡魂人",
  location: { kind: "civilization" as const, value: "CHINESE" },
  deleted_at: "2026-08-11T09:30:00Z",
  deleted_by: "test_admin",
  delete_reason: "录入重复",
  cascade_id: "cascade-0001",
  dependent_count: 8,
  retention_days: 30,
  hard_delete_eligible: false,
};

/**
 * UserProfileSerializer (backend/apps/social/serializers.py) for the signed-in
 * user's own profile — `user` is TEST_USER.id, which is what
 * ProfileCard.tsx's `isOwnProfile` check compares against, so the mock always
 * renders the "Edit profile" button rather than a follow button.
 */
export const SOCIAL_PROFILE = {
  id: "profile-test-admin",
  user: TEST_USER.id,
  username: TEST_USER.username,
  bio: "",
  avatar: null as string | null,
  followers_count: 0,
  following_count: 0,
  post_count: 0,
};

/**
 * `/scheduler/jobs/` — ScheduledJobSerializer, a bare array (pagination_class
 * = None). One global row and one row per tenant, so the page has three
 * groups; one of them failing twice in a row with a FAILURE last run.
 */
export const SCHEDULER_JOBS = [
  {
    id: 1,
    job_key: "events.retry_pending_webhooks",
    periodic_task_name: "events.retry_pending_webhooks",
    task_name: "events.retry_pending_webhooks",
    scope: "GLOBAL",
    tenant: null as number | null,
    tenant_code: null as string | null,
    description_key: "scheduler.jobs.events_retry_pending_webhooks",
    enabled: true,
    minute: "*/5",
    hour: "*",
    day_of_month: "*",
    month_of_year: "*",
    day_of_week: "*",
    timezone: "UTC",
    max_runtime_seconds: 240,
    next_run_at: "2026-09-17T08:05:00Z",
    last_run: {
      id: 11,
      status: "SUCCESS",
      trigger: "SCHEDULE",
      queued_at: "2026-09-17T08:00:00Z",
      started_at: "2026-09-17T08:00:01Z",
      finished_at: "2026-09-17T08:00:02Z",
      duration_ms: 812,
    },
    overdue: false,
    expected_at: "2026-09-17T08:05:00Z",
    consecutive_failures: 0,
    last_alerted_at: null as string | null,
  },
  {
    id: 2,
    job_key: "ledger.recalculate_tenant",
    periodic_task_name: "ledger.recalculate_tenant@CN_DIYU",
    task_name: "ledger.recalculate_tenant",
    scope: "TENANT",
    tenant: 1,
    tenant_code: "CN_DIYU",
    description_key: "scheduler.jobs.ledger_recalculate_tenant",
    enabled: true,
    minute: "0",
    hour: "0",
    day_of_month: "*",
    month_of_year: "*",
    day_of_week: "*",
    timezone: "UTC",
    max_runtime_seconds: 3600,
    next_run_at: "2026-09-18T00:00:00Z",
    last_run: {
      id: 12,
      status: "FAILURE",
      trigger: "SCHEDULE",
      queued_at: "2026-09-17T00:00:00Z",
      started_at: "2026-09-17T00:00:01Z",
      finished_at: "2026-09-17T00:00:04Z",
      duration_ms: 3120,
    },
    overdue: false,
    expected_at: "2026-09-18T00:00:00Z",
    consecutive_failures: 2,
    last_alerted_at: "2026-09-16T00:00:05Z" as string | null,
  },
  {
    id: 3,
    job_key: "judgment.auto_conclude_stale_for_tenant",
    periodic_task_name: "judgment.auto_conclude_stale_for_tenant@EU_HEAVEN_HELL",
    task_name: "judgment.auto_conclude_stale_for_tenant",
    scope: "TENANT",
    tenant: 2,
    tenant_code: "EU_HEAVEN_HELL",
    description_key: "scheduler.jobs.judgment_auto_conclude_stale_for_tenant",
    enabled: false,
    minute: "0",
    hour: "1",
    day_of_month: "*",
    month_of_year: "*",
    day_of_week: "*",
    timezone: "Europe/Rome",
    max_runtime_seconds: 1800,
    next_run_at: null as string | null,
    last_run: null,
    overdue: false,
    expected_at: null as string | null,
    consecutive_failures: 0,
    last_alerted_at: null as string | null,
  },
];

/** `/scheduler/runs/` items — TaskRunSerializer. The failure carries a traceback tail. */
export const SCHEDULER_RUNS = [
  {
    id: 12,
    job: 2,
    task_name: "ledger.recalculate_tenant",
    celery_task_id: "0b7f2d6e-5b1c-4d7e-9a53-6c2f1e0d9a12",
    tenant: 1,
    trigger: "SCHEDULE",
    status: "FAILURE",
    queued_at: "2026-09-17T00:00:00Z",
    started_at: "2026-09-17T00:00:01Z",
    finished_at: "2026-09-17T00:00:04Z",
    duration_ms: 3120,
    worker_hostname: "celery@worker-1",
    error: 'Traceback (most recent call last):\n  File "apps/ledger/tasks.py", line 88, in recalculate_tenant\nValueError: ledger row 42 has no soul',
    result: "",
    triggered_by: null as number | null,
    triggered_by_username: null as string | null,
  },
  {
    id: 10,
    job: 2,
    task_name: "ledger.recalculate_tenant",
    celery_task_id: "5c1e8a90-2f3b-4c6d-8e7f-9a0b1c2d3e4f",
    tenant: 1,
    trigger: "MANUAL",
    status: "SUCCESS",
    queued_at: "2026-09-16T09:00:00Z",
    started_at: "2026-09-16T09:00:01Z",
    finished_at: "2026-09-16T09:00:03Z",
    duration_ms: 2040,
    worker_hostname: "celery@worker-1",
    error: "",
    result: "recalculated 12 souls",
    triggered_by: TEST_USER.id as number | null,
    triggered_by_username: TEST_USER.username as string | null,
  },
];

/** POST `/scheduler/jobs/:id/run/` → 202, a PENDING manual TaskRun. */
export const SCHEDULER_MANUAL_RUN = {
  id: 13,
  job: 2,
  task_name: "ledger.recalculate_tenant",
  celery_task_id: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b",
  tenant: 1,
  trigger: "MANUAL",
  status: "PENDING",
  queued_at: "2026-09-17T08:10:00Z",
  started_at: null as string | null,
  finished_at: null as string | null,
  duration_ms: null as number | null,
  worker_hostname: "",
  error: "",
  result: "",
  triggered_by: TEST_USER.id,
  triggered_by_username: TEST_USER.username,
};

/**
 * Soul accounts, officer side (backend/apps/soul_accounts/{views,serializers}.py).
 * SOUL_DETAIL's soul (life 1, cycle 0) has one current account whose initial
 * password is still unchanged, and one credential in each status the
 * pending-delivery page filters to.
 */
export const SOUL_ACCOUNT = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddd01",
  soul: SOULS[0].id,
  soul_code: "MPK7Q2RX9T",
  soul_name: SOULS[0].name,
  cycle: 0,
  previous_account: null as string | null,
  origin: "DEATH_SYNC",
  username: "soul.MPK7Q2RX9T.0",
  must_change_password: true,
  initial_password_expires_at: "2999-01-01T00:00:00Z" as string | null,
  retired_at: null as string | null,
  created_at: "2026-09-17T01:00:00Z",
  last_login: null as string | null,
  contact_email_masked: "",
  contact_phone_masked: "",
};

/** `/soul-accounts/credentials/?status=PENDING` — no contact on file, never sent. */
export const CREDENTIALS_PENDING = [
  {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01",
    account: SOUL_ACCOUNT.id,
    soul: SOULS[0].id,
    soul_code: SOUL_ACCOUNT.soul_code,
    soul_name: SOULS[0].name,
    cycle: 0,
    channel: "",
    status: "PENDING",
    expires_at: "2999-01-01T00:00:00Z",
    attempts: 0,
    last_error: "",
    created_at: "2026-09-17T01:00:00Z",
    sent_at: null as string | null,
    revealed_at: null as string | null,
    revealed_by: null as string | null,
    delivered_at: null as string | null,
    delivered_by: null as string | null,
  },
];

/** `?status=REVEALED` — sending failed three times, then an officer viewed it once. */
export const CREDENTIALS_REVEALED = [
  {
    ...CREDENTIALS_PENDING[0],
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02",
    status: "REVEALED",
    channel: "EMAIL",
    attempts: 3,
    last_error: "SMTPException",
    revealed_at: "2026-09-17T02:00:00Z" as string | null,
    revealed_by: TEST_USER.username as string | null,
  },
];

/** `?status=VOID` — expired before anyone delivered it. */
export const CREDENTIALS_VOID = [
  {
    ...CREDENTIALS_PENDING[0],
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03",
    status: "VOID",
    expires_at: "2026-09-01T00:00:00Z",
  },
];

/** POST `/soul-accounts/credentials/:id/reveal/` — RevealedCredentialSerializer. */
export const REVEALED_PASSWORD = {
  soul_code: SOUL_ACCOUNT.soul_code,
  password: "e2e-one-time-Pw9",
  expires_at: "2999-01-01T00:00:00Z",
};

// ── Soul circle moderation (backend/apps/social/moderation_serializers.py) ──

const MODERATION_AUTHOR = { user_id: 41, display_name: "被举报的灵魂" };

/** GET `/social-moderation/reports/` — ReportSerializer; three souls reported one post. */
export const MODERATION_REPORTS = [
  {
    id: "abababab-abab-4bab-8bab-ababababab01",
    target_type: "POST",
    post: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcd01",
    comment: null as string | null,
    target_user: MODERATION_AUTHOR,
    status: "OPEN",
    report_count: 3,
    content_excerpt: "这是一条被举报的帖子",
    content_status: "PUBLISHED",
    entries: [
      { reporter: { user_id: 42, display_name: "举报者甲" }, reason: "ABUSE", detail: "辱骂", created_at: "2026-09-18T01:00:00Z" },
    ],
    created_at: "2026-09-18T01:00:00Z",
    last_reported_at: "2026-09-18T02:00:00Z",
    resolution: "",
    resolution_note: "",
    resolved_at: null as string | null,
  },
];

/** GET `/social-moderation/posts/?moderation_status=PENDING` — ModeratedPostSerializer. */
export const MODERATED_POSTS = [
  {
    id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcd02",
    author: MODERATION_AUTHOR,
    content: "命中敏感词的帖子",
    moderation_status: "PENDING",
    open_report_count: 0,
    create_time: "2026-09-18T03:00:00Z",
    visibility: "PUBLIC",
    comment_count: 0,
  },
];

/** GET `/social-moderation/sensitive-words/`. */
export const SENSITIVE_WORDS = [
  { id: "efefefef-efef-4fef-8fef-efefefefef01", word: "违禁词", created_by: { user_id: 1, display_name: "测试管理员" }, created_at: "2026-09-18T00:00:00Z" },
];

/** GET `/social-moderation/mutes/`. */
export const SOCIAL_MUTES = [
  {
    id: "fafafafa-fafa-4afa-8afa-fafafafafa01",
    user: MODERATION_AUTHOR,
    until: "2999-01-01T00:00:00Z",
    reason: "辱骂",
    created_at: "2026-09-18T00:00:00Z",
    lifted_at: null as string | null,
    is_active: true,
  },
];

// ── Hall inbox (backend/apps/chat/serializers.py) ──

/** GET `/chat/inbox/` — OfficerInboxSerializer. */
export const INBOX_CONVERSATIONS = [
  {
    id: "abcdabcd-abcd-4bcd-8bcd-abcdabcdab01",
    soul: "abcdabcd-abcd-4bcd-8bcd-abcdabcdab02",
    soul_name: "写信的灵魂",
    soul_code: "ABCDEFGHJK",
    tenant: 1,
    tenant_name: "中国地府",
    hall_names: { "zh-Hans": "第五殿", en: "The Fifth Court", egy: "Yanluo Qedi" },
    last_message_at: "2026-09-18T01:00:00Z",
    created_at: "2026-09-18T00:00:00Z",
    closed_at: null as string | null,
  },
];

/** GET `/chat/inbox/:id/messages/` — InboxMessageSerializer, newest first. */
export const INBOX_MESSAGES = [
  { event_id: "$reply", from_officer: true, sender_name: "测试管理员", officer_title: "判官", body: "已收到,正在查", timestamp: 1789700000000 },
  { event_id: "$letter", from_officer: false, sender_name: "写信的灵魂", body: "我想申诉这次判决", timestamp: 1789690000000 },
];

// ── Sentence plans (backend/apps/sentence_plan/serializers.py) ──

const SENTENCE_NODE_BASE = {
  memory_reset: "NONE",
  dispatch_record_id: null as string | null,
  added_by_judgment_id: null as string | null,
  added_by_request_id: null as string | null,
  removed_by_request_id: null as string | null,
  reason: "",
};

/**
 * GET `/sentence-plans/` — SentencePlanSerializer. SOULS[0] (home CN_DIYU, which
 * is TEST_USER's tenant) has served stop 1 at home and is serving stop 2 in
 * EG_DUAT; stop 3 in EU_HEAVEN_HELL has not begun, and EU has asked the
 * original judge to drop it (case 2.2: the soul has not reached EU yet).
 */
export const SENTENCE_PLAN = {
  id: "5e5e5e5e-5e5e-4e5e-8e5e-5e5e5e5e5e01",
  soul: SOULS[0].id,
  soul_name: SOULS[0].name,
  tenant: 1,
  tenant_code: "CN_DIYU",
  cycle: 0,
  status: "ACTIVE",
  origin_judgment_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  cross_judgment_id: null as string | null,
  completed_at: null as string | null,
  cancel_reason: "",
  nodes: [
    { ...SENTENCE_NODE_BASE, id: "5e5e5e5e-5e5e-4e5e-8e5e-5e5e5e5e5e11", order: 1, tenant_code: "CN_DIYU", is_home: true,
      status: "COMPLETED", realm_code: "DY_COURT_01_QINGUANG", sentence_years: 3, is_eternal: false,
      disposition_id: "5e5e5e5e-5e5e-4e5e-8e5e-5e5e5e5e5e21", activated_at: "2026-09-01T00:00:00Z", completed_at: "2026-09-02T00:00:00Z" },
    { ...SENTENCE_NODE_BASE, id: "5e5e5e5e-5e5e-4e5e-8e5e-5e5e5e5e5e12", order: 2, tenant_code: "EG_DUAT", is_home: false,
      status: "ACTIVE", realm_code: "EG_HALL_TWO_TRUTHS", sentence_years: 10, is_eternal: false,
      disposition_id: "5e5e5e5e-5e5e-4e5e-8e5e-5e5e5e5e5e22", activated_at: "2026-09-03T00:00:00Z", completed_at: null as string | null },
    { ...SENTENCE_NODE_BASE, id: "5e5e5e5e-5e5e-4e5e-8e5e-5e5e5e5e5e13", order: 3, tenant_code: "EU_HEAVEN_HELL", is_home: false,
      status: "PENDING", realm_code: "EU_PURGATORY", sentence_years: 7, is_eternal: false,
      disposition_id: null as string | null, activated_at: null as string | null, completed_at: null as string | null },
  ],
  requests: [
    {
      id: "5e5e5e5e-5e5e-4e5e-8e5e-5e5e5e5e5e31",
      from_tenant_code: "EU_HEAVEN_HELL",
      kind: "AMEND",
      status: "PENDING",
      changes: { remove: ["5e5e5e5e-5e5e-4e5e-8e5e-5e5e5e5e5e13"] },
      requested_by_judgment_id: null as string | null,
      reason: "炼狱一站已由另案抵偿",
      decision_reason: "",
      decided_at: null as string | null,
      create_time: "2026-09-10T00:00:00Z",
    },
  ],
  create_time: "2026-09-01T00:00:00Z",
  update_time: "2026-09-10T00:00:00Z",
};

/** POST `.../requests/:id/decide/` with ACCEPT — the plan after stop 3 is removed. */
export const SENTENCE_PLAN_DECIDED = {
  ...SENTENCE_PLAN,
  nodes: SENTENCE_PLAN.nodes.map((n) =>
    n.order === 3 ? { ...n, status: "REMOVED", removed_by_request_id: SENTENCE_PLAN.requests[0].id } : n
  ),
  requests: [{ ...SENTENCE_PLAN.requests[0], status: "ACCEPTED", decided_at: "2026-09-11T00:00:00Z" }],
};

/** POST `.../mark-delivered/` — the REVEALED row, now DELIVERED. */
export const DELIVERED_CREDENTIAL = {
  ...CREDENTIALS_REVEALED[0],
  status: "DELIVERED",
  delivered_at: "2026-09-17T03:00:00Z" as string | null,
  delivered_by: TEST_USER.username as string | null,
};

/** `/soul-accounts/rebirth-applications/` — OfficerRebirthApplicationSerializer. */
export const REBIRTH_APPLICATIONS = [
  {
    id: "ffffffff-ffff-4fff-8fff-ffffffffff01",
    soul: SOULS[0].id,
    soul_code: SOUL_ACCOUNT.soul_code,
    soul_name: SOULS[0].name,
    account: SOUL_ACCOUNT.id,
    cycle: 0,
    desired_form: "HUMAN",
    statement: "愿再入人道,侍奉双亲。",
    appeal_statement: "",
    status: "UNDER_REVIEW",
    workflow: "ffffffff-ffff-4fff-8fff-ffffffffff11",
    appeal_workflow: null as string | null,
    cross_civilization: null as boolean | null,
    rejection_reason: "",
    decided_at: null as string | null,
    current_step: { node_type: "EVALUATION", approver_role: "JUDGE", is_appeal: false } as {
      node_type: string;
      approver_role: string;
      is_appeal: boolean;
    } | null,
    can_appeal: false,
    cooldown_until: null as string | null,
    created_at: "2026-09-17T04:00:00Z",
    updated_at: "2026-09-17T04:00:00Z",
  },
];

const REBIRTH_FIRST_NODE = {
  id: "ffffffff-ffff-4fff-8fff-ffffffffff21",
  workflow: REBIRTH_APPLICATIONS[0].workflow,
  node_name: "判官初审",
  node_type: "EVALUATION",
  court_code: "转生申请",
  node_order: 1,
  approver_type: "ROLE",
  approver_role: "JUDGE",
  status: "PENDING",
  verdict: null as string | null,
  decided_at: null as string | null,
  notes: "",
};

/** GET `/workflows/:id/` — ApprovalWorkflowSerializer: the rebirth application's workflow, at its first node. */
export const REBIRTH_WORKFLOW = {
  id: REBIRTH_APPLICATIONS[0].workflow,
  workflow_name: `转生申请: ${SOUL_ACCOUNT.soul_code}`,
  case_type: "REBIRTH_APPLICATION",
  soul: SOULS[0].id,
  soul_name: SOULS[0].name,
  status: "IN_PROGRESS",
  is_appeal: false,
  priority: 0,
  cross_civilization: false,
  current_node: REBIRTH_FIRST_NODE.id as string | null,
  current_node_detail: REBIRTH_FIRST_NODE,
  nodes: [
    REBIRTH_FIRST_NODE,
    { ...REBIRTH_FIRST_NODE, id: "ffffffff-ffff-4fff-8fff-ffffffffff22", node_name: "终审", node_type: "FINAL", node_order: 2, approver_role: "ADMIN" },
  ],
  created_at: "2026-09-17T04:00:00Z",
  updated_at: "2026-09-17T04:00:00Z",
  completed_at: null as string | null,
};

// ── Mock engine ───────────────────────────────────────────────────────────

export interface RecordedCall {
  method: string;
  /** Path with the `/api/v1` prefix stripped, e.g. `/souls/`. */
  path: string;
  query: Record<string, string>;
  /** Parsed JSON request body, or undefined for bodyless requests. */
  body: any;
  /** False when no registered handler matched and the fallback answered. */
  handled: boolean;
}

export interface MockReply {
  status?: number;
  body?: unknown;
}

export type MockHandler = (call: RecordedCall) => MockReply | Promise<MockReply>;

/** Turns `/dispatch/records/:id/approve/` into an anchored RegExp. */
function toRegExp(pattern: string | RegExp): RegExp {
  if (pattern instanceof RegExp) return pattern;
  const source = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, "[^/]+");
  return new RegExp(`^${source}$`);
}

function paginated(results: unknown[]) {
  return { count: results.length, next: null, previous: null, results };
}

/**
 * Endpoints a page may call that no spec models, and that are genuinely fine
 * as an empty list.
 *
 * Deliberately short and deliberately explicit. Anything not here that falls
 * through fails the test — see `ApiMock.assertEverythingWasHandled`.
 */
const BACKGROUND_PATHS: RegExp[] = [
  /^\/notifications\//,
  /^\/menus\//,
  /^\/social\//,
  /^\/audit-logs\//,
];

/**
 * A tiny in-browser API server. Handlers registered later win, so a test can
 * override any default with `api.on(...)` — that is how the destructive
 * checks (500s, 409 conflicts) are driven.
 */
export class ApiMock {
  /** Every intercepted request, in order. Assert against this. */
  readonly calls: RecordedCall[] = [];

  /** Every WebSocket URL the page opened, minus the dev server's own HMR
   *  socket. See `interceptWebSockets`. */
  readonly socketUrls: string[] = [];

  /** The origin the app actually sent its API requests to.
   *
   *  Read from the first intercepted request rather than from
   *  `process.env.NEXT_PUBLIC_API_URL`: the browser resolves that at build
   *  time from `.env.local`, and the Playwright process does not load that
   *  file — so a test that recomputed it from the environment compared the
   *  app's real target against a different string and failed on a correct
   *  app. Measured 2026-08-31: browser `192.168.2.200:8000`, test process
   *  `localhost:8000`. */
  apiOrigin: string | null = null;

  private routes: { method: string; matcher: RegExp; handler: MockHandler }[] = [];

  /** Live role versions, so the optimistic-lock counter actually advances. */
  readonly roleVersions: Record<string, number> = Object.fromEntries(
    ROLES.map((r) => [r.name, r.version])
  );

  /** The signed-in user's avatar URL, so a successful upload is visible on
   *  the next GET of the same profile — same live-state shape as
   *  `roleVersions` above. */
  currentAvatar: string | null = null;

  /**
   * Register a handler. `reply` may be a function or a plain value, in which
   * case it is sent as a 200 body. Overloaded so the handler form infers its
   * `call` parameter instead of widening to `unknown`.
   */
  on(method: string, path: string | RegExp, handler: MockHandler): this;
  on(method: string, path: string | RegExp, body: unknown): this;
  on(method: string, path: string | RegExp, reply: MockHandler | unknown): this {
    const handler: MockHandler =
      typeof reply === "function" ? (reply as MockHandler) : () => ({ body: reply });
    this.routes.unshift({ method: method.toUpperCase(), matcher: toRegExp(path), handler });
    return this;
  }

  /** Every recorded call matching method + path. */
  find(method: string, path: string | RegExp): RecordedCall[] {
    const matcher = toRegExp(path);
    return this.calls.filter((c) => c.method === method.toUpperCase() && matcher.test(c.path));
  }

  lastCall(method: string, path: string | RegExp): RecordedCall | undefined {
    return this.find(method, path).at(-1);
  }

  countOf(method: string, path: string | RegExp): number {
    return this.find(method, path).length;
  }

  async resolve(call: RecordedCall): Promise<MockReply> {
    for (const route of this.routes) {
      if (route.method === call.method && route.matcher.test(call.path)) {
        call.handled = true;
        return route.handler(call);
      }
    }
    // Unmatched: an empty page, which is what the untested background
    // requests (notifications, menus, stats) should look like.
    //
    // **Recording `handled=false` was not enough.** Nothing ever read the
    // flag — a repo-wide grep for it matched only this class's own writes —
    // so the day the app starts calling a new endpoint, that endpoint gets a
    // confident `200 {results: []}` and every spec stays green. The comment
    // in workflow.spec.ts:140 wrote the trap down and stepped around it.
    //
    // `assertEverythingWasHandled()` below turns the flag into a check, and
    // `BACKGROUND_PATHS` names the fall-throughs that are meant to be
    // fall-throughs. A path not in that list is a spec's problem, not the
    // fixture's.
    return { body: paginated([]) };
  }

  /** Requests that fell through to the empty-page default, minus the expected ones. */
  unexpectedUnhandled(): RecordedCall[] {
    return this.calls.filter(
      (call) => !call.handled && !BACKGROUND_PATHS.some((re) => re.test(call.path))
    );
  }

  /**
   * Fail if the app called an endpoint this mock does not model.
   *
   * Installed by the `apiMockModelsEveryCall` auto-fixture on the `test`
   * exported from THIS file — see the block above it. It ran nowhere until
   * 2026-09-10: this comment used to say "called from
   * `setupAuthenticatedPage`'s teardown", and `setupAuthenticatedPage` is a
   * plain async function with no teardown to hang anything on. A repo-wide
   * grep for the name matched only its own definition and two comments.
   *
   * The message names the paths, because the useful answer is "add a handler
   * for these", not "something was unhandled".
   */
  assertEverythingWasHandled(): void {
    const stray = this.unexpectedUnhandled();
    if (stray.length === 0) return;
    const lines = stray.map((c) => `  ${c.method} ${c.path}`).join("\n");
    throw new Error(
      `ApiMock 没有模型化这些请求,它们拿到了一个默认的 200 空列表:\n${lines}\n` +
        `请给它们注册 handler,或者(确实是背景噪音的话)加进 BACKGROUND_PATHS。\n` +
        `一个静默的 200 空页会让「应用开始调一个新端点」这件事对整套 e2e 不可见。`
    );
  }

  /** The defaults every spec starts from. */
  registerDefaults(): this {
    this.on("POST", "/auth/login/", (call) => {
      if (call.body?.username !== TEST_USER.username) {
        return { status: 401, body: { detail: "No active account found with the given credentials", remaining_attempts: 4 } };
      }
      return {
        body: {
          access: MOCK_ACCESS_TOKEN,
          refresh: MOCK_REFRESH_TOKEN,
          user: { ...TEST_USER, permissions: PERMISSIONS.map((p) => p.codename) },
        },
      };
    });

    this.on("GET", "/perm/role-permissions/", {
      role: TEST_USER.role,
      permissions: PERMISSIONS.map((p) => p.codename),
      details: PERMISSIONS,
    });

    // Sidebar. ADMIN takes menusApi.all() → /menus/list-public/, a bare array.
    this.on("GET", "/menus/list-public/", MENUS);

    this.on("GET", "/ledger/stats/overview/", LEDGER_STATS);

    // ── Souls ──
    this.on("GET", "/souls/", (call) =>
      // The date-problem badge issues its own list request with
      // has_date_problem=true; that one must not return the whole list.
      call.query.has_date_problem === "true"
        ? { body: paginated([]) }
        : { body: paginated(SOULS) }
    );
    this.on("POST", "/souls/", (call) => ({
      status: 201,
      body: {
        id: "99999999-9999-4999-8999-999999999999",
        ...call.body,
        current_state: "ALIVE",
        death_date: null,
        date_problems: [],
      },
    }));

    // Soul detail: seven parallel requests (app/souls/[id]/page.tsx:120).
    // /records/ is a BARE array — the @action returns serializer.data
    // directly — so the paginated fallback would break it.
    this.on("GET", "/souls/:id/", SOUL_DETAIL);
    this.on("GET", "/souls/:id/karma/", SOUL_LEDGER);
    this.on("GET", "/souls/:id/records/", []);

    // ── Judgment ──
    this.on("GET", "/judgment/", paginated([]));
    this.on("POST", "/judgment/", { ...OPENED_JUDGMENT });
    this.on("GET", "/judgment/:id/", { ...OPENED_JUDGMENT });
    // After `:id/`, so it wins (routes are unshifted): otherwise "next" is an id
    // and the dashboard's 审判队列 count reads a judgment body with no `total`.
    // An empty queue — the cursor's shape (JudgmentQueueCursor) with nothing in it.
    this.on("GET", "/judgment/next/", {
      total: 0, remaining: 0, skipped: 0, position: null,
      judgment: null, soul: null, ledger: null, prior_cycles: [], realm_options: [],
    });

    // ── Dispatch ──
    this.on("GET", "/dispatch/records/", () => ({
      body: paginated([PROPOSED_DISPATCH, EXECUTED_DISPATCH]),
    }));
    // Detail goes through `DispatchRecordSerializer`, which sends everything
    // the list serializer does *and* `reason`, `dispatched_by` and the
    // timestamps. The two fixtures are separate so that a list assertion
    // cannot silently borrow a detail-only field -- which is exactly what
    // happened: `critical-paths.spec.ts` asserted the pending *card* showed
    // the proposal's reason, and passed, because the single fixture supplied
    // one.
    this.on("GET", "/dispatch/records/:id/", {
      ...PROPOSED_DISPATCH,
      ...PROPOSED_DISPATCH_DETAIL_ONLY,
    });
    this.on("POST", "/dispatch/records/:id/approve/", {
      ...PROPOSED_DISPATCH,
      status: "APPROVED",
      decided_at: "2026-08-13T02:00:00Z",
    });
    // The approval inbox is its own endpoint, not the list filtered by status:
    // the list returns both sides of a transfer (`Q(source) | Q(target)`) while
    // `approve` accepts only the target, so the filtered form put this tenant's
    // own outgoing proposals in its inbox behind a button that always 403'd.
    //
    // Registered *after* `/dispatch/records/:id/` on purpose. `on()` unshifts,
    // so the last registration wins, and `:id` compiles to `[^/]+`, which
    // matches the literal segment `proposed` as readily as a uuid. Registered
    // before, the inbox would be served a single detail object.
    this.on("GET", "/dispatch/records/proposed/", paginated([PROPOSED_DISPATCH]));

    // ── Permissions matrix ──
    this.on("GET", "/perm/permissions/", PERMISSIONS);
    this.on("GET", "/perm/roles/", () =>
      // Versions come from the live map so a save's bump is visible to a refetch.
      ({ body: ROLES.map((r) => ({ ...r, version: this.roleVersions[r.name] })) })
    );
    this.on("GET", "/perm/roles/:name/permissions/", (call) => {
      const role = call.path.split("/")[3];
      const ids = ROLE_GRANTS[role] ?? [];
      const details = PERMISSIONS.filter((p) => ids.includes(p.id));
      return { body: { role, permissions: details.map((p) => p.codename), details } };
    });
    this.on("POST", "/perm/role-permissions/assign/", (call) => {
      const role: string = call.body?.role;
      const current = this.roleVersions[role] ?? 0;
      if (call.body?.expected_version !== undefined && call.body.expected_version !== current) {
        return {
          status: 409,
          body: { detail: "版本冲突", expected_version: call.body.expected_version, current_version: current },
        };
      }
      this.roleVersions[role] = current + 1;
      return {
        body: {
          role,
          assigned_count: call.body?.permission_ids?.length ?? 0,
          permission_ids: call.body?.permission_ids ?? [],
          version: this.roleVersions[role],
        },
      };
    });

    // ── Workflow ──
    // WorkflowTemplateViewSet sets pagination_class = None, so the template
    // list is a bare array, not a page envelope.
    this.on("GET", "/workflow/templates/", []);
    this.on("GET", "/workflows/", paginated([WORKFLOW_INSTANCE]));

    // ── Reference lists the sidebar's admin pages read ──
    //
    // These six were **not modelled** until 2026-08-31: /users, /tenants,
    // /realms, /actors, /auth/profile/ and /death-sync/registrations/ all fell
    // through to the empty-page default, so the specs that "cover" those pages
    // were asserting against a fabricated empty list and would have stayed
    // green through any regression in what the page renders.
    // `e2e/the-api-mock-models-what-the-app-calls.spec.ts` is what found them,
    // and is what stops the seventh from being added silently.
    //
    // 2026-09-14: the bodies below are trimmed to what their serializers send.
    // `/users/` (UserManagementSerializer) has no `display_name` or
    // `last_login`; `/auth/profile/` (UserSerializer) has no `tenant`;
    // RealmListSerializer has no `name_zh` / `is_eternal`; ActorListSerializer
    // has no `name_zh` / `name_en`. All were spread in or copied from other
    // shapes, and `test_e2e_fixtures_match_the_serializers.py` now reads these
    // handlers rather than a hand list, which is how it saw them.
    this.on("GET", "/users/", paginated([
      {
        id: TEST_USER.id,
        username: TEST_USER.username,
        email: TEST_USER.email,
        role: TEST_USER.role,
        tenant: TEST_USER.tenant,
        is_active: true,
      },
      {
        id: 2,
        username: "test_judge",
        email: "judge@soulledger.test",
        role: "JUDGE",
        tenant: TEST_USER.tenant,
        is_active: true,
      },
    ]));
    this.on("GET", "/auth/profile/", {
      id: TEST_USER.id,
      username: TEST_USER.username,
      display_name: TEST_USER.display_name,
      email: TEST_USER.email,
      role: TEST_USER.role,
      is_active: true,
    });
    this.on("GET", "/tenants/", paginated([
      { id: 1, code: "CN_DIYU", display_name: "中国地府", is_active: true },
      { id: 2, code: "EU_HEAVEN_HELL", display_name: "欧洲天堂地狱", is_active: true },
    ]));
    this.on("GET", "/realms/", paginated([
      {
        id: 1,
        realm_code: "DY_01",
        name_en: "First Court",
        civilization: "CHINESE",
        realm_type: "PURGATORY",
        tier: 1,
      },
    ]));
    this.on("GET", "/actors/", paginated([
      {
        id: 1,
        name: "阎罗王",
        role: "JUDGE",
        civilization: "CHINESE",
        is_active: true,
      },
    ]));
    this.on("GET", "/death-sync/registrations/", paginated([
      {
        id: "11111111-1111-1111-1111-111111111111",
        source_system: "civil-registry",
        idempotency_key: "reg-001",
        status: "PROCESSED",
        request_timestamp: "2026-08-30T09:00:00Z",
      },
    ]));
    // The dashboard's 死亡同步异常 cell (ADMIN) and the /death-sync shortcut.
    this.on("GET", "/death-sync/registrations/summary/", { anomaly_status: "FAILED", anomaly_count: 0 });

    // ── Recycle bin ──
    this.on("GET", "/recycle-bin/", { results: [RECYCLE_BIN_ENTRY], count: 1 });
    this.on("POST", "/recycle-bin/restore/", { restored: 1 + RECYCLE_BIN_ENTRY.dependent_count });

    // ── Social profile / avatar upload ──
    // `currentAvatar` is live state (see the field above), so a successful
    // upload shows up on the GET a query invalidation triggers right after.
    this.on("GET", "/social/profiles/:id/", () => ({
      body: { ...SOCIAL_PROFILE, avatar: this.currentAvatar },
    }));
    this.on("POST", "/social/profiles/me/avatar/", () => {
      this.currentAvatar = "https://soulledger.test/media/avatars/uploaded.png";
      return { body: { ...SOCIAL_PROFILE, avatar: this.currentAvatar } };
    });

    // ── 2026-09-10 装上 `assertEverythingWasHandled` 那一刻现形的六个端点 ──
    //
    // 在此之前它们**每一个都在拿一个自信的 `200 {results: []}`**,而且没有任何
    // 东西看得见这件事:`the-api-mock-models-what-the-app-calls.spec.ts` 的
    // `ROUTES` 是手维护的 17 条,而 `/disposition`、`/organizations`、
    // `/cross-judgments` 三条路由**不在那张单子上** —— 那正是「按路由清单扫」
    // 和「每个 test 都查」的差别。`/ledger/inheritance/:id/` 更进一步:它是
    // `critical-paths.spec.ts` 里点开一份判决之后才发出的,任何只 goto 的扫描
    // 都到不了。
    //
    // **为什么是登记成空,而不是塞进 `BACKGROUND_PATHS`。** 那张表说的是「这条
    // 路径可以落到回退」,一进去就永远不会再被问起;而这六条是页面的**正文
    // 数据**,不是通知轮询那种背景噪音。登记在这里的空列表和回退给的空列表
    // 逐字节相同(所以现有 spec 的行为一处都没变),差别只在 `handled` ——
    // 也就是「有人写下过这个模型」和「没人想过这件事」的差别。应用哪天调一个
    // **新**端点,门禁照样红。
    //
    // 反过来也要说清楚:登记成空意味着这六个页面在 E2E 里渲染的是空态,它们
    // 有数据时的那条路径仍然没有被走过。**这一点在装门禁之前就是如此**,门禁
    // 没有让它变好也没有让它变坏;要走那条路径需要各自的 spec,是另一件事。
    this.on("GET", "/disposition/", paginated([]));
    this.on("GET", "/reincarnation/", paginated([]));
    this.on("GET", "/events/", paginated([]));
    this.on("GET", "/organizations/", paginated([]));
    this.on("GET", "/dispatch/cross-tenant-judgments/", paginated([]));
    // Not a list endpoint: see SOUL_INHERITANCE. (The paragraph above still
    // holds for the other five.)
    this.on("GET", "/ledger/inheritance/:id/", SOUL_INHERITANCE);

    // ── Scheduler (backend/apps/scheduler/views.py) ──
    this.on("GET", "/scheduler/jobs/", SCHEDULER_JOBS);
    // PATCH answers with the whole row (ScheduledJobSerializer), changed fields applied.
    this.on("PATCH", "/scheduler/jobs/:id/", (call) => {
      const id = Number(call.path.split("/")[3]);
      const row = SCHEDULER_JOBS.find((job) => job.id === id);
      return row ? { body: { ...row, ...call.body } } : { status: 404, body: { detail: "Not found." } };
    });
    this.on("POST", "/scheduler/jobs/:id/run/", () => ({ status: 202, body: SCHEDULER_MANUAL_RUN }));
    // Registered after `/scheduler/jobs/:id/` for the reason given on
    // `/dispatch/records/proposed/` above, though the methods differ today.
    this.on("POST", "/scheduler/jobs/rebuild/", { created: 0, updated: 3, removed: 0, legacy_removed: 0 });
    this.on("GET", "/scheduler/runs/", paginated(SCHEDULER_RUNS));

    // ── Soul accounts, officer side (backend/apps/soul_accounts/views.py) ──
    this.on("GET", "/soul-accounts/accounts/", paginated([SOUL_ACCOUNT]));
    this.on("POST", "/soul-accounts/accounts/provision/", () => ({ status: 201, body: SOUL_ACCOUNT }));
    this.on("POST", "/soul-accounts/accounts/:id/reset-credential/", CREDENTIALS_PENDING[0]);
    // Filtered on the server by `?status=`; one fixture list per status.
    this.on("GET", "/soul-accounts/credentials/", (call) =>
      call.query.status === "PENDING"
        ? { body: paginated(CREDENTIALS_PENDING) }
        : call.query.status === "REVEALED"
          ? { body: paginated(CREDENTIALS_REVEALED) }
          : call.query.status === "VOID"
            ? { body: paginated(CREDENTIALS_VOID) }
            : { body: paginated([]) }
    );
    this.on("POST", "/soul-accounts/credentials/:id/reveal/", REVEALED_PASSWORD);
    this.on("POST", "/soul-accounts/credentials/:id/mark-delivered/", DELIVERED_CREDENTIAL);
    this.on("POST", "/soul-accounts/credentials/:id/retry/", CREDENTIALS_PENDING[0]);
    this.on("GET", "/soul-accounts/rebirth-applications/", paginated(REBIRTH_APPLICATIONS));
    this.on("POST", "/soul-accounts/rebirth-applications/:id/cross-civilization/", (call) => ({
      body: { ...REBIRTH_APPLICATIONS[0], cross_civilization: call.body.cross_civilization },
    }));
    this.on("GET", "/workflows/:id/", REBIRTH_WORKFLOW);

    // ── Soul circle moderation (backend/apps/social/moderation_views.py) ──
    this.on("GET", "/social-moderation/reports/", paginated(MODERATION_REPORTS));
    this.on("POST", "/social-moderation/reports/:id/resolve/", (call) => ({
      body: { ...MODERATION_REPORTS[0], status: call.body.resolution === "DISMISS" ? "DISMISSED" : "RESOLVED", resolution: call.body.resolution },
    }));
    this.on("GET", "/social-moderation/posts/", paginated(MODERATED_POSTS));
    this.on("GET", "/social-moderation/comments/", paginated([]));
    this.on("POST", "/social-moderation/posts/:id/approve/", { ...MODERATED_POSTS[0], moderation_status: "PUBLISHED" });
    this.on("GET", "/social-moderation/sensitive-words/", paginated(SENSITIVE_WORDS));
    this.on("POST", "/social-moderation/sensitive-words/", (call) => ({
      status: 201,
      body: { ...SENSITIVE_WORDS[0], id: "efefefef-efef-4fef-8fef-efefefefef02", word: String(call.body.word).trim().toLowerCase() },
    }));
    this.on("GET", "/social-moderation/mutes/", paginated(SOCIAL_MUTES));
    this.on("POST", "/social-moderation/mutes/:id/lift/", { ...SOCIAL_MUTES[0], lifted_at: "2026-09-18T04:00:00Z", is_active: false });

    // ── Sentence plans (backend/apps/sentence_plan/views.py) ──
    // One plan, for the soul panel (`?soul=`) and the request inbox (`?pending_request=true`).
    this.on("GET", "/sentence-plans/", (call) =>
      call.query.soul === SOULS[0].id || call.query.pending_request === "true"
        ? { body: paginated([SENTENCE_PLAN]) }
        : { body: paginated([]) }
    );
    this.on("POST", "/sentence-plans/:id/requests/:id/decide/", SENTENCE_PLAN_DECIDED);

    // ── Hall inbox (backend/apps/chat/views.py OfficerInboxViewSet) ──
    this.on("GET", "/chat/inbox/", paginated(INBOX_CONVERSATIONS));
    this.on("GET", "/chat/inbox/:id/messages/", INBOX_MESSAGES);
    this.on("POST", "/chat/inbox/:id/reply/", () => ({ status: 201, body: { event_id: "$sent" } }));

    return this;
  }
}

/**
 * The app's origin is :3333 and the API's is :8000, so every XHR is
 * cross-origin and the browser still enforces CORS on our fulfilled
 * responses. These headers (and the OPTIONS short-circuit below) are what
 * keep the preflight from failing the request before the mock is consulted.
 */
function corsHeaders(request: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": request.headers()["origin"] ?? "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "authorization,content-type",
    "Access-Control-Max-Age": "86400",
  };
}

/**
 * Records every WebSocket this page opens, and answers none of them.
 *
 * `page.route` only covers HTTP, so `packages/core/src/ws/client.ts` escaped the mock
 * entirely: a regression that pointed the socket at the wrong host was
 * invisible to the whole suite. This does not simulate a server — it records
 * the URL, which is the part a spec can assert on, and lets the client's own
 * retry/backoff run against a socket that never opens (what it already does
 * today whenever the dev server has no channel layer).
 */
export async function interceptWebSockets(page: Page, mock: ApiMock): Promise<void> {
  page.on("websocket", (ws) => {
    // Next's own hot-reload socket rides on the page origin and is not the
    // app talking to its API. Excluded by path, not by host — on a machine
    // where the API and the dev server share a host, a host filter would drop
    // the socket this exists to watch.
    if (ws.url().includes("/_next/")) return;
    mock.socketUrls.push(ws.url());
  });
}

/** Installs the interceptor for every `/api/v1/**` request on this page. */
export async function mockApi(page: Page, mock: ApiMock = new ApiMock().registerDefaults()): Promise<ApiMock> {
  // The auto-fixture reads this after the test body; see `test` below.
  // Registering here rather than in `setupAuthenticatedPage` covers the specs
  // that call `mockApi` directly.
  liveMocks.push(mock);

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const headers = corsHeaders(request);

    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }

    const url = new URL(request.url());
    const call: RecordedCall = {
      method: request.method(),
      path: url.pathname.replace(/^.*\/api\/v1/, ""),
      query: Object.fromEntries(url.searchParams),
      body: (() => {
        try {
          return request.postDataJSON();
        } catch {
          return undefined;
        }
      })(),
      handled: false,
    };
    mock.apiOrigin ??= url.origin;
    mock.calls.push(call);

    const reply = await mock.resolve(call);
    await route.fulfill({
      status: reply.status ?? 200,
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(reply.body ?? {}),
    });
  });

  return mock;
}

/**
 * Puts the browser in the exact state a real login leaves behind:
 *   - `soulledger_refresh` cookie — the only thing middleware.ts inspects,
 *     and it must be a real cookie (not localStorage) or the very first
 *     server-side navigation redirects to /login.
 *   - `soulledger_access` in sessionStorage — where packages/core/src/api/client.ts's
 *     request interceptor looks for the bearer token.
 *   - `soulledger_user` envelope in localStorage — what TenantContext
 *     rehydrates from on mount, giving the tree a role of ADMIN.
 *
 * addInitScript runs before any page script on every navigation, so the
 * storage is already populated by the time TenantContext's mount effect runs.
 */
export async function seedAuthState(page: Page): Promise<void> {
  await page.context().addCookies([
    { name: "soulledger_refresh", value: MOCK_REFRESH_TOKEN, url: BASE_URL },
    { name: "soulledger_access", value: MOCK_ACCESS_TOKEN, url: BASE_URL },
    { name: "soulledger-locale", value: "zh-Hans", url: BASE_URL },
  ]);

  await page.addInitScript(
    ({ user, accessToken }) => {
      sessionStorage.setItem("soulledger_access", accessToken);
      // CachedUserEnvelope — TenantContext.tsx:42. `permissions` is
      // deliberately absent; the context refetches it and never trusts cache.
      localStorage.setItem("soulledger_user", JSON.stringify({ user, storedAt: Date.now() }));
    },
    { user: TEST_USER, accessToken: MOCK_ACCESS_TOKEN }
  );
}

/**
 * One-call setup for any spec that needs to be logged in: API mock first
 * (so no request escapes to a non-existent backend), then auth state.
 * Does not navigate — the test decides where to go.
 *
 * Returns the ApiMock so tests can override routes and assert on payloads.
 */
export async function setupAuthenticatedPage(page: Page): Promise<ApiMock> {
  const api = await mockApi(page);
  await interceptWebSockets(page, api);
  await seedAuthState(page);
  return api;
}

/**
 * **每个 spec 都要从这里 import `test`,而不是从 `@playwright/test`。**
 *
 * ── 为什么存在这个再导出 ──────────────────────────────────────────────────
 * `ApiMock.assertEverythingWasHandled()` 的文档注释说它「由
 * `setupAuthenticatedPage` 的 teardown 调用」。**那句话是假的**:2026-09-10 全仓
 * grep `assertEverythingWasHandled` 只有三处命中 —— 它自己的定义、它自己的注释,
 * 和另一段引用它的注释。**零个调用点。** 而 `setupAuthenticatedPage` 是一个普通
 * 的 async 函数,不是 playwright fixture,它根本没有 teardown 可挂。
 *
 * (要说清楚的是:**那道门禁本身并不是没跑过。**
 * `the-api-mock-models-what-the-app-calls.spec.ts` 逐条打开 17 条路由,直接调
 * `api.unexpectedUnhandled()` 做同一件事,而且带着一条「守卫的守卫」。所以这里
 * 修的不是「一道从没运行的门禁」,是**一个死方法加一句描述并不存在的安装方式的
 * 注释**。真正的缺口是覆盖面:那条 spec 只在**打开页面**时扫,而点击「批准」、
 * 提交工作流、触发 409 冲突这些**交互**会调到页面加载永远走不到的端点 ——
 * 那些请求没有任何东西在看。这个 fixture 补的是这一块。)
 *
 * ── 为什么是 fixture,不是 `test.afterEach` ────────────────────────────────
 * 在这个文件的模块作用域里写 `test.afterEach(...)` **会静默地只装上一半**:
 * playwright 每个 worker 只求值一次 `fixtures.ts`,那个 afterEach 于是只挂在
 * **第一个加载它的 spec 文件**的 suite 上,其余的一条都不挂。而「装了一半」和
 * 「全都通过」的输出一模一样 —— 正是这个仓库反复踩的形状。
 *
 * `auto: true` 的 fixture 没有这个问题:它挂在 `test` 对象上,凡是用这个 `test`
 * 的文件都拿到它。代价是每个 spec 的 import 行要改一个字符串 —— 2026-09-10 实测
 * 全部 **11 个** spec 文件(不是四十个;四十是 test 的条数)。spec 正文一行不用动。
 *
 * ── 已经失败的测试不再叠加 ────────────────────────────────────────────────
 * 测试已经红了的时候,「有个端点没建模」是噪音,而且会盖住真正的报错。
 * `testInfo.errors.length > 0` 时直接跳过。
 */
const liveMocks: ApiMock[] = [];

export const test = base.extend<{ apiMockModelsEveryCall: void }>({
  apiMockModelsEveryCall: [
    async ({}, use, testInfo) => {
      liveMocks.length = 0;
      await use();
      const mocks = [...liveMocks];
      liveMocks.length = 0;
      if (testInfo.errors.length > 0) return;
      for (const mock of mocks) mock.assertEverythingWasHandled();
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
