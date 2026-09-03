import { type Locator, type Page, type Request } from "@playwright/test";

/**
 * Shared E2E setup: authenticated browser state + a route-level mock of the
 * REST API.
 *
 * ── Why the API is mocked ─────────────────────────────────────────────────
 * playwright.config.ts starts ONE server: `npm run dev` (Next.js on :3333).
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

export const EXECUTED_DISPATCH = {
  ...PROPOSED_DISPATCH,
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  soul: SOULS[1].id,
  soul_name: SOULS[1].name,
  source_tenant_code: "EU_HEAVEN_HELL",
  target_tenant_code: "CN_DIYU",
  status: "EXECUTED",
  reason: "已完成移交。",
  decided_at: "2026-08-05T02:00:00Z",
  executed_at: "2026-08-06T02:00:00Z",
};

/**
 * GET /souls/{id}/ — SoulSerializer. Sits in JUDGING so the detail page
 * offers the "开始审判" action.
 */
export const SOUL_DETAIL = {
  ...SOULS[0],
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
];

export const RECYCLE_BIN_ENTRY = {
  entity_type: "soul",
  kind: "domain" as const,
  id: "33333333-3333-4333-8333-333333333333",
  label: "误删的渡魂人",
  deleted_at: "2026-08-11T09:30:00Z",
  deleted_by: "test_admin",
  delete_reason: "录入重复",
  cascade_id: "cascade-0001",
  dependent_count: 8,
  retention_days: 30,
  hard_delete_eligible: false,
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
   * Called from `setupAuthenticatedPage`'s teardown. The message names the
   * paths, because the useful answer is "add a handler for these", not
   * "something was unhandled".
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
        return { status: 401, body: { detail: "No active account found with the given credentials" } };
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
        has_date_warning: false,
        has_record_error: false,
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
    this.on("GET", "/users/", paginated([
      { ...TEST_USER, is_active: true, last_login: "2026-08-30T10:00:00Z" },
      {
        id: 2,
        username: "test_judge",
        display_name: "测试判官",
        email: "judge@soulledger.test",
        role: "JUDGE",
        tenant: TEST_USER.tenant,
        is_active: true,
        last_login: null,
      },
    ]));
    this.on("GET", "/auth/profile/", { ...TEST_USER, is_active: true });
    this.on("GET", "/tenants/", paginated([
      { id: 1, code: "CN_DIYU", display_name: "中国地府", is_active: true },
      { id: 2, code: "EU_HEAVEN_HELL", display_name: "欧洲天堂地狱", is_active: true },
    ]));
    this.on("GET", "/realms/", paginated([
      {
        id: 1,
        realm_code: "DY_01",
        name_zh: "第一殿",
        name_en: "First Court",
        civilization: "CHINESE",
        realm_type: "PURGATORY",
        tier: 1,
        is_eternal: false,
      },
    ]));
    this.on("GET", "/actors/", paginated([
      {
        id: 1,
        name: "阎罗王",
        name_zh: "阎罗王",
        name_en: "Yama King",
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

    // ── Recycle bin ──
    this.on("GET", "/recycle-bin/", { results: [RECYCLE_BIN_ENTRY], count: 1 });
    this.on("POST", "/recycle-bin/restore/", { restored: 1 + RECYCLE_BIN_ENTRY.dependent_count });

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
    "Access-Control-Allow-Headers": "authorization,content-type,x-tenant-id",
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
