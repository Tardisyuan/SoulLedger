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
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const FRONT = process.env.DEMO_FRONT || "http://localhost:3333";
const API_ORIGIN = process.env.DEMO_API_ORIGIN || "http://localhost:8000";
const API = `${API_ORIGIN}/api/v1`;
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../frontend/demo/data");
const PASSWORD = "demo-only-not-a-secret";
const ROLES = { admin: "demo_admin", judge: "demo_judge", moderator: "demo_moderator" };
const STATIC_ROUTES = `/dashboard /about /actors /admin/assistant /admin/assistant/usage /admin/stats /audit /audit/logins
  /audit/permissions /audit/sessions /audit/stats /city-god-cases /city-gods /corpus /cross-judgments /death-sync
  /death-sync/api-keys /death-sync/tudi-gods /death-sync/webhooks /dispatch /dispatch/propose /disposition /events /halls
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

const scrub = (v) => {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).filter(([k]) => !SECRET_KEYS.test(k)).map(([k, x]) => [k, NO_TWO_STEP.test(k) ? false : scrub(x)]));
  }
  if (typeof v === "string") return v.replaceAll(API, "/api/v1").replaceAll(API_ORIGIN, "");
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
    list.pages[page] = scrub(results);
    return;
  }
  // A 400 here is the recording's own artefact (a hall-less admin has no tenant context for a hall's inbox), not the screen's.
  if (status === 400) return;
  if (key in rec.docs && status !== 200) return;
  rec.docs[key] = { s: status, b: scrub(body) };
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

async function getAll(rec, access, url) {
  let next = url;
  for (let i = 0; next && i < MAX_PAGES; i += 1) {
    const res = await fetch(next, { headers: { Authorization: `Bearer ${access}`, "Accept-Language": "zh-Hans" } });
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
    await getAll(rec, access, `${API}${path}${q ? `?${q}` : ""}`);
  }
}

async function sweep(rec, access, paths) {
  const flat = paths.filter((p) => !p.includes("{"));
  for (const p of flat) await getAll(rec, access, `${API_ORIGIN}${p}`);
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
      if (!bad && !url.includes("undefined")) await getAll(rec, access, `${API_ORIGIN}${url}`);
    }
  }
}

/** What the judging desk asks only once a verdict is picked: the destinations for it, and the flow it would start. */
async function sweepOpenCases(rec, access) {
  for (const row of rowsOf(rec, "/judgment/").filter((r) => r.verdict == null)) {
    for (const verdict of ["PASSED", "FAILED", "PURGATORY"]) {
      await getAll(rec, access, `${API}/judgment/${row.id}/destinations/?candidate_verdict=${verdict}`);
    }
    await getAll(rec, access, `${API}/workflows/flow-preview/?judgment=${row.id}`);
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

const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });
let paths = null;
for (const role of Object.keys(ROLES)) {
  const started = Date.now();
  const rec = { lists: {}, docs: {}, errors: new Set(), swept: {} };
  const context = await browser.newContext({ locale: "zh-CN", viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: "soulledger-locale", value: "zh-Hans", url: FRONT }]);
  context.on("response", async (res) => {
    const url = res.url();
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
  paths ??= schemaPaths();
  await sweep(rec, access, paths);
  await sweepOpenCases(rec, access);
  const out = { role, recordedAt: new Date().toISOString(), login: scrub(login), ...finish(rec) };
  writeFileSync(`${OUT}/${role}.json`, JSON.stringify(out));
  console.log(`${role}: ${Object.keys(out.lists).length} lists, ${Object.keys(out.docs).length} docs, ` +
    `${Math.round(JSON.stringify(out).length / 1024)} KB, ${Math.round((Date.now() - started) / 1000)} s; swept ${JSON.stringify(rec.swept)}; server errors: ${[...rec.errors].join(" | ") || "none"}`);
  await context.close();
}
await browser.close();
