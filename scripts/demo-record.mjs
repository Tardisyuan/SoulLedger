// Records what the real backend answers each demo role, into frontend/demo/data/<role>.json.
// Run by scripts/demo-record-inner.sh with a seeded Django on :8000 and a normal Next build on :3333.
//
// Two passes, because neither is enough alone:
//   1. A browser signs in through the real login page and walks every page, clicking every tab: this finds what
//      the screens really ask for, with the query strings they really send.
//   2. A sweep over the OpenAPI schema (DEMO_SCHEMA): every GET the backend declares, with path parameters filled from the lists
//      found so far. This reaches what only a click on some row would have fetched (drawers, sub-resources).
//
// Output shape (read by frontend/demo/store.ts):
//   { recordedAt, login, lists: { "/souls/?state=X": { rows, extra } }, docs: { "/souls/<id>/": { s, b } } }
// `lists` holds paginated answers with their pages flattened; the key leaves out page and page_size.
//
// Order (2026-11-08). The administrator goes first and alone: it reads everyone's sign-ins, sessions, last logins and
// audit rows, and a recording role's own sign-in writes those; walked beside the others it would record them signing
// in. The other five see only their own (their recordings hold no login-log, admin-session or user list, and only
// `/audit-logs/?user=<own id>`), and the walks send nothing but GETs and the sign-in, so they run at once, each against
// a Django of its own on DEMO_ROLE_PORTS (comma-separated; one walk at a time per port, so the port count is the
// concurrency cap). Django here is daphne, which runs every sync view of a process on one thread: on a shared server
// the walks would only take turns. The browser keeps the build's API address and each context's requests are routed
// to its port. Without DEMO_ROLE_PORTS everything runs in turn on :8000, as before. The souls come last: the judges'
// screens show soul accounts' sign-ins.
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeHomePreview } from "./demo-home-preview.mjs";

const FRONT = process.env.DEMO_FRONT || "http://localhost:3333";
const API_ORIGIN = process.env.DEMO_API_ORIGIN || "http://localhost:8000";
const API = `${API_ORIGIN}/api/v1`;
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../frontend/demo/data");
const PASSWORD = "demo-only-not-a-secret";
const ROLES = { admin: "demo_admin", judge: "demo_judge", judge_eu: "demo_judge_eu", judge_eg: "demo_judge_eg", judge_gr: "demo_judge_gr", moderator: "demo_moderator" };
const STATIC_ROUTES = `/dashboard /dashboard/annual /about /actors /admin/assistant /admin/assistant/usage /admin/stats /audit /audit/logins
  /audit/permissions /audit/sessions /audit/stats /city-god-cases /city-gods /corpus /cross-judgments /death-sync
  /death-sync/api-keys /death-sync/tudi-gods /death-sync/webhooks /desk /desk/overview /dispatch /dispatch/propose /disposition /events /halls
  /judgment /judgment/appeals /judgment/capture-due /judgment/queue /ledger /menus /menus/buttons /moderation
  /notifications /organizations /permissions /profile /realms /rebirth-applications /rebirths /recycle-bin /scheduler
  /sentence-plans /sentence-requests /social /social/follows /soul-credentials /soul-inbox /souls /tenants /users /welcome
  /workflow`.split(/\s+/);
// A list that feeds a detail route. The id's lists are read from what the walk recorded.
const DETAIL_ROUTES = [
  ["/souls/", (r) => `/souls/${r.id}`], ["/judgment/", (r) => `/judgment/${r.id}`], ["/workflows/", (r) => `/workflow/${r.id}`],
  ["/dispatch/records/", (r) => `/dispatch/${r.id}`], ["/dispatch/cross-tenant-judgments/", (r) => `/cross-judgments/${r.id}`],
  ["/audit-logs/", (r) => `/audit/${r.id}`], ["/social/posts/", (r) => `/social/${r.id}`],
  ["/social/profiles/", (r) => `/social/profile/${r.user_id ?? r.user ?? r.id}`], ["/judgment/appeals/", (r) => `/judgment/appeals/${r.id}`],
];
const DETAIL_CRAWL = 6;
const MAX_PAGES = 10;
const SWEEP_IDS = 60;
const SECRET_KEYS = /^(access|refresh|token|password|secret|signing_secret|key_hash|pending_token|recovery_codes)$/;

// The demo has no two-step flows, so nothing may ask for them (the admin's reminder bar reads these off the login).
const NO_TWO_STEP = /^(mfa_required|mfa_setup_required)$/;

// What the seed wrote in one language, in the other (scripts/demo-translations.json).
const TRANSLATIONS = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "demo-translations.json"), "utf8"));
// Longest key first, so a whole sentence wins over a word inside it. Into English it is all or nothing: a string that
// would still hold Chinese after the replacements stays as it was, whole, rather than half one language and half the
// other (「Meng Po汤」); `scripts/demo-cjk-report.py` then lists it, and the fix is a key for the whole string.
const CJK = /[㐀-鿿]/;
const translator = (lang) => {
  const table = TRANSLATIONS[lang];
  const pattern = new RegExp(Object.keys(table).sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
  const walk = (v) => {
    if (typeof v === "string") {
      const out = v.replace(pattern, (m) => table[m]);
      return lang === "en" && out !== v && CJK.test(out) ? v : out;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk;
};

// A finished life happened long ago, and every date on it has to say so. See `write_lives` in demo-seed.py.
const LIVES = JSON.parse(readFileSync(process.env.DEMO_LIVES, "utf8"));
const WHOLE_STAMP = /^\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d)$/;
const BARE_DATE = /^\d{4}-\d\d-\d\d$/;
const moment = ({ year, month, day }) => {
  const d = new Date(Date.UTC(2000, (month ?? 1) - 1, day ?? 1, 8));
  d.setUTCFullYear(year);
  return d.getTime();
};
const soulOf = (id) => (typeof id === "string" ? (LIVES.souls[id] ? id : LIVES.owner[id]) : undefined);
function ownerIn(row) {
  for (const field of ["soul", "soul_id", "judgment", "judgment_id", "workflow", "workflow_id", "plan", "plan_id", "origin_judgment_id"]) {
    const value = row[field];
    const found = soulOf(value && typeof value === "object" ? value.id : value);
    if (found) return found;
  }
  return soulOf(row.id);
}
const isRecent = (s) => Number(s.slice(0, 4)) >= 2025;
const DAY = 86400000;
/** A stamp's place in its life: its distance from the first stamp, or, for the four the tour follows, the days written in the seed's `PACE`. */
function lifeTime(ms, life) {
  const first = Date.parse(life.first);
  let [from, days] = [first, 0];
  for (const [when, at] of life.pace ?? []) {
    const to = Date.parse(when);
    if (ms <= to) return moment(life) + (days + (at - days) * (to > from ? Math.max(ms - from, 0) / (to - from) : 1)) * DAY;
    [from, days] = [to, at];
  }
  return moment(life) + days * DAY + ms - from;
}
function historize(value, owner) {
  if (Array.isArray(value)) return value.map((v) => historize(v, owner));
  if (value && typeof value === "object") {
    const mine = ownerIn(value) ?? owner;
    const life = mine && LIVES.souls[mine];
    if (life && typeof value.year === "number" && value.year >= 2025) return { ...value, year: life.year + (value.year - 2026), month: life.month, day: life.day };
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, historize(v, mine)]));
  }
  if (typeof value !== "string" || !owner) return value;
  const life = LIVES.souls[owner];
  if (life && /^[A-Z]{2}-2026-\d+$/.test(value)) return value.replace("2026", life.year < 0 ? `${-life.year}BC` : String(life.year));
  if (!isRecent(value)) return value;
  if (!WHOLE_STAMP.test(value) && !BARE_DATE.test(value)) return value;
  const moved = new Date(lifeTime(Date.parse(value), life)).toISOString();
  return BARE_DATE.test(value) ? moved.slice(0, moved.indexOf("T")) : moved;
}
/** A response's owner is its row's soul, or the soul its address names. */
function historizeAll({ lists, docs }) {
  const keyOwner = (key) => key.split(/[/?=&]/).map(soulOf).find(Boolean);
  return {
    lists: Object.fromEntries(Object.entries(lists).map(([k, l]) => [k, { ...l, rows: historize(l.rows, keyOwner(k)) }])),
    docs: Object.fromEntries(Object.entries(docs).map(([k, d]) => [k, { ...d, b: historize(d.b, keyOwner(k)) }])),
  };
}

// The recorder's own sign-in writes a login-log row, and auditing that writes another: neither happened in the story.
const recordersOwn = (row) => row?.resource === "loginlog";
const scrub = (v, origin = API_ORIGIN) => {
  if (Array.isArray(v)) return v.filter((row) => !recordersOwn(row)).map((x) => scrub(x, origin));
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).filter(([k]) => !SECRET_KEYS.test(k)).map(([k, x]) => [k, NO_TWO_STEP.test(k) ? false : scrub(x, origin)]));
  }
  if (typeof v === "string") {
    return v.replaceAll(`${origin}/api/v1`, "/api/v1").replaceAll(API, "/api/v1").replaceAll(origin, "").replaceAll(API_ORIGIN, "").replaceAll("HeadlessChrome", "Chrome");
  }
  return v;
};

function keyOf(url) {
  const u = new URL(url);
  const path = u.pathname.replace(/^\/api\/v1/, "");
  const params = [...u.searchParams.entries()].filter(([k]) => k !== "page" && k !== "page_size").sort();
  const q = params.map(([k, v]) => `${k}=${v}`).join("&");
  return { path, key: q ? `${path}?${q}` : path, page: Number(u.searchParams.get("page") || 1) };
}

const isPage = (b) => b && typeof b === "object" && !Array.isArray(b) && Array.isArray(b.results) && "count" in b;

function remember(rec, url, status, body) {
  const { key, page } = keyOf(url);
  if (status >= 500) {
    rec.errors.add(`${status} ${key}`);
    return;
  }
  if (status === 200 && isPage(body)) {
    const { results, count: _count, next: _next, previous: _previous, ...extra } = body;
    const list = (rec.lists[key] ??= { rows: [], extra, pages: {} });
    list.pages[page] = scrub(results, rec.origin);
    return;
  }
  // A 400 here is the recording's own artefact (a hall-less admin has no tenant context for a hall's inbox), not the screen's.
  if (status === 400) return;
  if (key in rec.docs && status !== 200) return;
  rec.docs[key] = { s: status, b: scrub(body, rec.origin) };
}

function rowsOf(rec, path) {
  const list = rec.lists[path];
  if (list) return Object.keys(list.pages).sort((a, b) => a - b).flatMap((p) => list.pages[p]);
  const doc = rec.docs[path];
  return doc && Array.isArray(doc.b) ? doc.b : [];
}

async function signIn(context, role) {
  const page = await context.newPage();
  await page.goto(`${FRONT}/login`);
  await page.locator('input[name="username"]').fill(ROLES[role]);
  await page.locator('input[name="password"]').fill(PASSWORD);
  const answer = page.waitForResponse((r) => r.url().includes("/auth/login/") && r.request().method() === "POST");
  await page.locator('button[type="submit"]').first().click();
  const res = await answer;
  const body = await res.json();
  if (!res.ok()) throw new Error(`login refused for ${role}: ${res.status()} ${JSON.stringify(body).slice(0, 200)}`);
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  return { page, access: body.access, login: body };
}

async function walk(page, route, rec) {
  await page.goto(`${FRONT}${route}`, { waitUntil: "load", timeout: 45000 }).catch(() => rec.errors.add(`goto ${route}`));
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
  const tabs = page.locator('[role="tab"]');
  const n = Math.min(await tabs.count().catch(() => 0), 12);
  for (let i = 0; i < n; i += 1) {
    await tabs.nth(i).click({ timeout: 2000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  }
}

async function getAll(rec, access, url, language = "zh-Hans") {
  let next = url;
  for (let i = 0; next && i < MAX_PAGES; i += 1) {
    const res = await fetch(next, { headers: { Authorization: `Bearer ${access}`, "Accept-Language": language } });
    if ((res.headers.get("content-type") || "").indexOf("json") < 0) return null;
    const body = await res.json().catch(() => null);
    // A refused sweep records nothing: only a page's own request gets to say a role is refused something.
    rec.swept[res.status] = (rec.swept[res.status] ?? 0) + 1;
    if (!res.ok || body === null) return res.status;
    remember(rec, next, res.status, body);
    next = isPage(body) ? body.next : null;
  }
  return 200;
}

/** Every list the walk saw went only as far as the page a screen asked for: finish them. */
async function finishLists(rec, access) {
  for (const [key, list] of Object.entries(rec.lists)) {
    if (!list.pages[1]) continue;
    const [path, q] = key.split("?");
    await getAll(rec, access, `${rec.api}${path}${q ? `?${q}` : ""}`);
  }
}

async function sweep(rec, access, paths) {
  const flat = paths.filter((p) => !p.includes("{"));
  for (const p of flat) await getAll(rec, access, `${rec.origin}${p}`);
  for (const p of paths.filter((x) => x.includes("{"))) {
    const open = p.indexOf("{");
    const parent = p.slice(0, open).replace(/^\/api\/v1/, "");
    const rows = rowsOf(rec, parent).slice(0, SWEEP_IDS);
    for (const row of rows) {
      let bad = false;
      const url = p.replace(/\{(\w+)\}/g, (_, name, at) => {
        const v = at === open ? row[name] ?? row.code ?? row.id ?? row.pk : bad = true;
        return v;
      });
      if (!bad && !url.includes("undefined")) await getAll(rec, access, `${rec.origin}${url}`);
    }
  }
}

/** What the judging desk asks only once a verdict is picked: the destinations for it, and the flow it would start. */
async function sweepOpenCases(rec, access) {
  for (const row of rowsOf(rec, "/judgment/").filter((r) => r.verdict == null)) {
    for (const verdict of ["PASSED", "FAILED", "PURGATORY"]) {
      await getAll(rec, access, `${rec.api}/judgment/${row.id}/destinations/?candidate_verdict=${verdict}`);
    }
    // The triage queue's card for this case; the demo computes the cursor around it.
    await getAll(rec, access, `${rec.api}/judgment/next/?at=${row.id}`);
    await getAll(rec, access, `${rec.api}/judgment/assignable-officers/?judgment=${row.id}`);
  }
}

const TENANT_CODES = ["CN_DIYU", "EU_HEAVEN_HELL", "EG_DUAT", "GR_HADES"];
const CIVILIZATIONS = ["CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK"];

/**
 * The GETs whose answer depends on a parameter the schema sweep cannot fill (it only fills path ids). Asked here with
 * the values the screens send, so the server answers them, rules and permissions included, rather than the demo
 * imitating those rules. What a visitor's own new rows ask is matched to these in `derived()` (frontend/demo/flows.ts).
 */
async function sweepWithParams(rec, access, login) {
  const tenants = rowsOf(rec, "/tenants/").filter((t) => t.id != null);
  const own = login.user?.tenant;
  const tenantIds = [...new Set([...tenants.map((t) => t.id), ...(own?.id != null ? [own.id] : [])])];
  const codes = [...new Set([...TENANT_CODES, ...tenants.map((t) => t.code).filter(Boolean)])];
  for (const code of codes) await getAll(rec, access, `${rec.api}/dispatch/records/realm-options/?target_tenant_code=${code}`);
  for (const civ of CIVILIZATIONS) await getAll(rec, access, `${rec.api}/workflows/case-types/?civilization=${civ}`);
  for (const id of tenantIds) await getAll(rec, access, `${rec.api}/judgment/handover/officers/?tenant=${id}`);
  // 案卷台 (/desk) and 总簿 (/desk/overview): the counts by source and by civilization, and each group by source. The demo
  // derives these from the rows (`queueCounts` in flows.ts); recorded, they are what that derivation is checked against.
  // `hall-stats/?civilization=` is asked ahead of the server having it: until then it answers the whole hall.
  const SOURCES = ["queue", "city_god", "cross"];
  for (const source of SOURCES) {
    await getAll(rec, access, `${rec.api}/judgment/queue-counts/?source=${source}`);
    for (const group of ["mine", "unclaimed", "others", "deferred"]) {
      await getAll(rec, access, `${rec.api}/judgment/?group=${group}&ordering=created_at&source=${source}`);
    }
  }
  for (const civ of CIVILIZATIONS) {
    await getAll(rec, access, `${rec.api}/judgment/queue-counts/?civilization=${civ}`);
    await getAll(rec, access, `${rec.api}/judgment/?civilization=${civ}&has_verdict=false&ordering=created_at`);
    await getAll(rec, access, `${rec.api}/judgment/hall-stats/?civilization=${civ}`);
  }
  await getAll(rec, access, `${rec.api}/dispatch/records/?ordering=-proposed_at`);
  await getAll(rec, access, `${rec.api}/dispatch/cross-tenant-judgments/?ordering=-create_time`);
  // The annual report's 「去年」 button.
  const year = rec.docs["/judgment/annual/"]?.b?.year;
  if (typeof year === "number") await getAll(rec, access, `${rec.api}/judgment/annual/?year=${year - 1}`);
  // Concluded cases too: the desk and the case page read both for every case, not only the open ones.
  for (const row of rowsOf(rec, "/judgment/")) {
    await getAll(rec, access, `${rec.api}/workflows/flow-preview/?judgment=${row.id}`);
    await getAll(rec, access, `${rec.api}/judgment/${row.id}/citations/`);
  }
  // Seats are chosen only while a bench is PROPOSED (the seed leaves one so); every invited hall, every seat.
  for (const bench of rowsOf(rec, "/dispatch/cross-tenant-judgments/").filter((b) => b.status === "PROPOSED")) {
    for (const code of codes.filter((c) => c !== bench.initiating_tenant_code)) {
      for (const role of ["ADVISOR", "CO_JUDGE", "CHAIRMAN"]) {
        await getAll(rec, access, `${rec.api}/dispatch/cross-tenant-judgments/${bench.id}/seatable-actors/?role=${role}&tenant_code=${code}`);
      }
    }
  }
  // Who each node of each template's working copy resolves to, as the inspector asks it (`node`, and its civilization).
  for (const template of rowsOf(rec, "/workflow/templates/")) {
    const doc = rec.docs[`/workflow/templates/${template.id}/`]?.b ?? template;
    for (const node of Array.isArray(doc.nodes) ? doc.nodes : []) {
      if (node?.id == null) continue;
      await getAll(rec, access, `${rec.api}/workflow/templates/${template.id}/approver-preview/?node=${node.id}`);
      if (doc.civilization) {
        await getAll(rec, access, `${rec.api}/workflow/templates/${template.id}/approver-preview/?civilization=${doc.civilization}&node=${node.id}`);
      }
    }
  }
}

// Business AI (docs/audit/2026-11-12-portfolio-ai-ideas.md part two, points 6 and 7). The demo never calls a model:
// it replays what the backend answered here (frontend/demo/aiReplay.ts). With the assistant switched on for the
// recording hall these are the real model's words; without it, the explainer's computed reason alone and a 503 for
// the audit questions, which the page shows as 「not switched on」.
//
// 「为什么?」 sits on the 403 card, which names the page's codename; the codenames the web has readable names for are
// those (`permission.names` in the lexicon). Only the ones this role lacks can show the card.
const LEXICON = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../packages/core/messages/zh-Hans.json"), "utf8"));
const NAMED_CODENAMES = Object.entries(LEXICON.permission.names).flatMap(([family, actions]) => Object.keys(actions).map((a) => `${family}.${a}`));
async function sweepExplanations(rec, access, login) {
  const held = new Set(login.user?.permissions ?? []);
  if (login.user?.role === "ADMIN") return;
  for (const codename of NAMED_CODENAMES.filter((c) => !held.has(c))) {
    await getAll(rec, access, `${rec.api}/perm/explain/?action=${encodeURIComponent(codename)}`);
  }
}

// The audit page's 「用一句话找记录」: five questions per language, each answer kept under
// `/audit-logs/nl-filter/?question=<q>` (a POST, keyed like a GET so the demo finds it), and the list those filters
// select, asked the way the page asks it.
const AUDIT_ASKS = {
  "zh-Hans": ["所有删除操作", "最近 7 天的登录", "角色与权限的改动", "demo_judge 做过的事", "这个月导出过什么"],
  en: ["all deletions", "sign-ins in the last 7 days", "changes to roles and permissions", "what demo_judge did", "exports this month"],
};
async function recordAsks(rec, access, language) {
  if (!rec.lists["/audit-logs/"] && !Object.keys(rec.lists).some((k) => k.startsWith("/audit-logs/?"))) return;
  for (const question of AUDIT_ASKS[language]) {
    const res = await fetch(`${rec.api}/audit-logs/nl-filter/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Accept-Language": language, "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    const body = await res.json().catch(() => null);
    if (body === null) continue;
    rec.docs[`/audit-logs/nl-filter/?question=${question}`] = { s: res.status, b: scrub(body, rec.origin) };
    if (res.ok && body.filters && Object.keys(body.filters).length) {
      await getAll(rec, access, `${rec.api}/audit-logs/?${new URLSearchParams({ page: "1", page_size: "20", ...body.filters })}`, language);
    }
  }
}

// Business AI on the judging desk and the moderation queue (points 1, 2 and 4): for each open case this role may edit,
// the statute suggestions and a verdict draft per verdict; for a moderator, the pre-screen of both queues. POSTs,
// keyed like a GET (`frontend/demo/aiReplay.ts`). Asked once per language, so each recording holds the model's words
// in its own language. With the assistant off for the hall these are the keyword / template / rule fallbacks.
async function post(rec, access, path, body, language) {
  const res = await fetch(`${rec.api}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access}`, "Accept-Language": language, "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => null);
  return json === null ? null : { s: res.status, b: scrub(json, rec.origin) };
}
async function recordBusinessAi(rec, access, language) {
  for (const row of rowsOf(rec, "/judgment/").filter((r) => r.verdict == null && r.can_edit !== false)) {
    const suggest = await post(rec, access, `/judgment/${row.id}/statute-suggestions/`, {}, language);
    if (suggest) rec.docs[`/judgment/${row.id}/statute-suggestions/`] = suggest;
    if (!suggest || suggest.s !== 200) continue; // no editing rights here: no drafts either
    for (const verdict of ["PASSED", "FAILED", "PURGATORY"]) {
      const draft = await post(rec, access, `/judgment/${row.id}/verdict-draft/`, { verdict }, language);
      if (draft) rec.docs[`/judgment/${row.id}/verdict-draft/?verdict=${verdict}`] = draft;
    }
  }
  if (!Object.keys(rec.lists).some((k) => k.startsWith("/social-moderation/posts/"))) return;
  for (const kind of ["posts", "comments"]) {
    const screen = await post(rec, access, `/social-moderation/${kind}/ai-screen/`, {}, language);
    if (screen) rec.docs[`/social-moderation/${kind}/ai-screen/`] = screen;
  }
}

function finish(rec) {
  const lists = {};
  for (const [key, list] of Object.entries(rec.lists)) lists[key] = { rows: rowsOf(rec, key), extra: list.extra };
  const docs = {};
  for (const [key, doc] of Object.entries(rec.docs)) {
    const empty = doc.s === 200 && Array.isArray(doc.b) && doc.b.length === 0;
    if (!empty) docs[key] = doc;
  }
  return { lists, docs };
}

function schemaPaths() {
  const schema = JSON.parse(readFileSync(process.env.DEMO_SCHEMA, "utf8"));
  return Object.entries(schema.paths)
    .filter(([p, ops]) => ops.get && p.startsWith("/api/v1/"))
    .map(([p]) => p)
    // Soul-app and export paths are not this console's; a blob is not recordable.
    .filter((p) => !/^\/api\/v1\/(me|soul-auth|officer-app)\//.test(p) && !/(export|export_csv|print|file|download)\/?$/.test(p));
}

/** One role: sign in, walk, sweep, ask again in English, write both files. `origin` is the Django this role talks to. */
async function recordRole(browser, role, origin, paths) {
  const started = Date.now();
  const api = `${origin}/api/v1`;
  const rec = { lists: {}, docs: {}, errors: new Set(), swept: {}, origin, api };
  const context = await browser.newContext({ locale: "zh-CN", viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: "soulledger-locale", value: "zh-Hans", url: FRONT }]);
  if (origin !== API_ORIGIN) {
    await context.route(`${API_ORIGIN}/**`, (route) => route.continue({ url: route.request().url().replace(API_ORIGIN, origin) }));
  }
  context.on("response", async (res) => {
    const url = res.url().replace(origin, API_ORIGIN);
    if (!url.startsWith(API) || res.request().method() !== "GET") return;
    const body = await res.json().catch(() => undefined);
    if (body !== undefined) remember(rec, url, res.status(), body);
  });
  const { page, access, login } = await signIn(context, role);
  for (const route of STATIC_ROUTES) await walk(page, route, rec);
  for (const [list, toRoute] of DETAIL_ROUTES) {
    for (const row of rowsOf(rec, list).slice(0, DETAIL_CRAWL)) await walk(page, toRoute(row), rec);
  }
  await page.waitForTimeout(500);
  await finishLists(rec, access);
  await sweep(rec, access, paths);
  await sweepOpenCases(rec, access);
  await sweepWithParams(rec, access, login);
  await sweepExplanations(rec, access, login);
  // English: the same questions again, asked in English. What the backend only has in one language stays until the
  // translations table above covers it; `scripts/demo-cjk-report.py` lists what is left.
  const recEn = { lists: {}, docs: {}, errors: new Set(), swept: {}, origin, api };
  for (const key of [...Object.keys(rec.lists), ...Object.keys(rec.docs)]) {
    const doc = rec.docs[key];
    if (doc && doc.s !== 200) recEn.docs[key] = doc;
    else await getAll(recEn, access, `${api}${key}`, "en");
  }
  // After the English pass above, which re-asks every key as a GET: these are POSTs, asked once per language.
  await recordAsks(rec, access, "zh-Hans");
  await recordAsks(recEn, access, "en");
  await recordBusinessAi(rec, access, "zh-Hans");
  await recordBusinessAi(recEn, access, "en");
  const recordedAt = new Date().toISOString();
  const out = { role, lang: "zh", recordedAt, login: translator("zh")(scrub(login, origin)), ...translator("zh")(historizeAll(finish(rec))) };
  const outEn = { role, lang: "en", recordedAt, login: translator("en")(scrub(login, origin)), ...translator("en")(historizeAll(finish(recEn))) };
  writeFileSync(`${OUT}/${role}.zh.json`, JSON.stringify(out));
  writeFileSync(`${OUT}/${role}.en.json`, JSON.stringify(outEn));
  console.log(`${role}: ${Object.keys(out.lists).length} lists, ${Object.keys(out.docs).length} docs, ` +
    `${Math.round(JSON.stringify(out).length / 1024)} KB, ${Math.round((Date.now() - started) / 1000)} s on ${origin}; swept ${JSON.stringify(rec.swept)}; server errors: ${[...rec.errors].join(" | ") || "none"}`);
  await context.close();
}

const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });
const paths = schemaPaths();
const walkStarted = Date.now();
// The administrator first, alone (see the top of this file).
await recordRole(browser, "admin", API_ORIGIN, paths);
const others = Object.keys(ROLES).filter((role) => role !== "admin");
const ports = (process.env.DEMO_ROLE_PORTS || "").split(",").filter(Boolean);
if (ports.length === 0) {
  for (const role of others) await recordRole(browser, role, API_ORIGIN, paths);
} else {
  const queue = [...others];
  await Promise.all(ports.map(async (port) => {
    for (let role = queue.shift(); role; role = queue.shift()) await recordRole(browser, role, `http://localhost:${port}`, paths);
  }));
}
console.log(`roles: ${Math.round((Date.now() - walkStarted) / 1000)} s (${ports.length || 1} at a time after the administrator)`);
await browser.close();

// The soul entrance (frontend/demo/DemoSoul.tsx): one soul per underworld, signed in through the soul app's own
// login (demo-seed.py `seed_soul_logins`), and what its screens read under `/me/`. No browser: the web has no soul
// pages to walk, so the paths are the ones the screens ask for. Letters live in Synapse and are not here
// (frontend/demo/data/soul-letters.json is written by hand).
const SOUL_PATHS = ["/me/", "/me/life/", "/me/past-lives/", "/me/sentence-plan/", "/me/rebirth-applications/", "/me/social/status/", "/me/social/feed/"];
const SOUL_LOGINS = process.env.DEMO_SOUL_LOGINS ? JSON.parse(readFileSync(process.env.DEMO_SOUL_LOGINS, "utf8")) : {};
for (const [civ, { soul_code, name }] of Object.entries(SOUL_LOGINS)) {
  const res = await fetch(`${API}/soul-auth/login/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ soul_code, password: PASSWORD }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access) throw new Error(`soul login refused for ${civ} (${name}): ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  const recordedAt = new Date().toISOString();
  for (const [lang, language] of [["zh", "zh-Hans"], ["en", "en"]]) {
    const rec = { lists: {}, docs: {}, errors: new Set(), swept: {} };
    for (const path of SOUL_PATHS) {
      const status = await getAll(rec, body.access, `${API}${path}`, language);
      if (status !== 200) rec.errors.add(`${status} ${path}`);
    }
    const out = { role: `soul_${civ}`, lang, recordedAt, login: { user: {} }, ...translator(lang)(historizeAll(finish(rec))) };
    writeFileSync(`${OUT}/soul_${civ}.${lang}.json`, JSON.stringify(out));
    console.log(`soul_${civ} (${name}) ${lang}: ${Object.keys(out.docs).length} docs, ${Object.keys(out.lists).length} lists; refused: ${[...rec.errors].join(" | ") || "none"}`);
  }
}

// The home page's journey preview reads a few KB of the judges' recordings, not the recordings (scripts/demo-home-preview.mjs).
writeHomePreview();
