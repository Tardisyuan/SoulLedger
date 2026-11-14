/**
 * What the demo answers GETs with: the recording (`data/<role>.<lang>/`, a boot bucket and one per domain, loaded as
 * reads reach them: `settle`; or the older single `data/<role>.<lang>.json`, read the same way until the main session
 * re-records — scripts/demo-record.mjs, scripts/demo-recording-io.mjs) under an overlay of what this browser session changed. The recording is never edited. The overlay is what sessionStorage keeps, so a reload
 * keeps your changes, a new tab or another visitor starts clean, and signing in or out drops it (`resetOverlay`).
 *
 * Changes spread by id: a row patched by its UUID reads patched wherever that object appears, in any list, detail or
 * nested field, so one write moves every screen that shows the row. Integer ids are only unique per table, so
 * their patches stay in their own collection.
 */
export type DemoRole = "admin" | "judge" | "judge_eu" | "judge_eg" | "judge_gr" | "moderator";
export const DEMO_USERNAMES: Record<DemoRole, string> = {
  admin: "demo_admin",
  judge: "demo_judge",
  judge_eu: "demo_judge_eu",
  judge_eg: "demo_judge_eg",
  judge_gr: "demo_judge_gr",
  moderator: "demo_moderator",
};

type Row = Record<string, unknown>;
interface ListRecord {
  rows: Row[];
  extra: Row;
}
export interface Recording {
  role: DemoRole;
  lang: DemoLang;
  recordedAt: string;
  login: { user: Row };
  lists: Record<string, ListRecord>;
  docs: Record<string, { s: number; b: unknown }>;
}
export interface Overlay {
  patches: Record<string, Row>;
  deleted: string[];
  added: Record<string, Row[]>;
  docs: Record<string, unknown>;
  seq: number;
}
export interface Answer {
  status: number;
  data: unknown;
}

const OVERLAY_KEY = "soulledger_demo_overlay";
const ROLE_KEY = "soulledger_demo_role";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAMP = /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)/g;
const PAGING = new Set(["page", "page_size"]);
const NO_FILTER = new Set(["page", "page_size", "ordering", "search", "q", "format"]);

const blank = (): Overlay => ({ patches: {}, deleted: [], added: {}, docs: {}, seq: 0 });
export const isUuid = (id: string) => UUID.test(id);

function storageGet(store: "session" | "local", key: string): string | null {
  try {
    return (store === "session" ? sessionStorage : localStorage).getItem(key);
  } catch {
    return null;
  }
}

let overlay: Overlay = (() => {
  try {
    return { ...blank(), ...JSON.parse(storageGet("session", OVERLAY_KEY) || "{}") };
  } catch {
    return blank();
  }
})();
export const getOverlay = () => overlay;

export function saveOverlay(): void {
  try {
    sessionStorage.setItem(OVERLAY_KEY, JSON.stringify(overlay));
  } catch {
    // ponytail: past the 5 MB quota the session's changes just stop surviving a reload; they still work until then.
  }
}

export function resetOverlay(): void {
  overlay = blank();
  try {
    sessionStorage.removeItem(OVERLAY_KEY);
  } catch {
    /* no storage: nothing to clear */
  }
}

/**
 * What a visitor leaves in the browser besides the overlay: remembered filters and columns (`soulledger.<page>.filters`),
 * recent searches, the claim queue's "deferred this session" (`soulledger-queue-…`, session storage), drafts
 * (`soulledger_…`). The keys use all three separators; the preferences (theme, language, density, nav mode), the
 * role and the demo's own entrance flags stay.
 */
const VISITOR_STATE = /^soulledger[._-](?!theme|last_tenant|demo_role|demo_tour|demo-|density|locale|nav-mode)/;

export function clearVisitorState(): void {
  for (const kind of ["localStorage", "sessionStorage"] as const) {
    try {
      const area = window[kind];
      for (const key of Object.keys(area)) if (VISITOR_STATE.test(key)) area.removeItem(key);
    } catch {
      /* no storage: nothing to clear */
    }
  }
}

export const currentRole =(): DemoRole =>
  (storageGet("session", ROLE_KEY) || storageGet("local", ROLE_KEY) || "judge") as DemoRole;

export function setRole(role: DemoRole): void {
  try {
    sessionStorage.setItem(ROLE_KEY, role);
    localStorage.setItem(ROLE_KEY, role);
  } catch {
    /* falls back to the default role */
  }
}

export type DemoLang = "zh" | "en";
/** A language the recording has for the one the app asks in. Kemet reads the English recording. */
export const langOf = (acceptLanguage: unknown): DemoLang => (String(acceptLanguage ?? "").startsWith("zh") ? "zh" : "en");

/** Timestamps move with the calendar: a case recorded as "two hours ago" reads that way whenever the demo is opened. */
function shifted(raw: Recording): Recording {
  return shiftAnnual(shiftStamps(raw, raw.recordedAt), yearsSince(raw.recordedAt));
}

const yearsSince = (recordedAt: string) => new Date(Date.now()).getUTCFullYear() - new Date(recordedAt).getUTCFullYear();
const WHOLE_DATE = /^\d{4}-\d\d-\d\d$/;

/**
 * The stamp mover for a recording made at `recordedAt`: a copy of a value with every stamp in it moved. It walks the
 * value (keys too) instead of the old `JSON.stringify` → regex → `JSON.parse` of the whole recording, which was one
 * 490 ms long task for the administrator on an M3 (fe-perf.md P4); the recording is now moved one answer at a time,
 * the first time it is read (`entry`).
 */
function stampMover(recordedAt: string): <T>(value: T) => T {
  const delta = Date.now() - Date.parse(recordedAt);
  // Every stamp moves by the same amount, so the spread between them is kept. Whole days for a bare date (the census's
  // `day`), and only dates near the recording: 1283-05-01 is someone's birthday, not a stamp.
  const days = Math.round(delta / 86400000) * 86400000;
  const recent = new Date(recordedAt).getUTCFullYear() - 2;
  const text = (s: string): string => {
    // A stamp from long ago is a life's history, not "two hours ago": it stays put.
    const out = s.includes("T") ? s.replace(STAMP, (t) => (Number(t.slice(0, 4)) < recent ? t : new Date(Date.parse(t) + delta).toISOString())) : s;
    if (out.length !== 10 || !WHOLE_DATE.test(out) || Number(out.slice(0, 4)) < recent) return out;
    return new Date(Date.parse(out) + days).toISOString().slice(0, 10);
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return text(v);
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== "object") return v;
    const out: Row = {};
    for (const [k, x] of Object.entries(v as Row)) out[text(k)] = walk(x);
    return out;
  };
  return walk as <T>(value: T) => T;
}

/** Every stamp in `value` moved as `shifted` moves a recording made at `recordedAt` (the home page's preview extract too). */
export function shiftStamps<T>(value: T, recordedAt: string): T {
  return stampMover(recordedAt)(value);
}

const ANNUAL = "/judgment/annual/";
const annualKey = (key: string, years: number) => key.replace(/([?&]year=)(\d+)/, (_, p: string, y: string) => `${p}${Number(y) + years}`);
function annualDoc(doc: { s: number; b: unknown }, years: number) {
  const b = doc.b as Row | null;
  return b && typeof b.year === "number" ? { ...doc, b: { ...b, year: b.year + years } } : doc;
}

/** The annual report names its year as a number, not a stamp: it moves with the calendar too, and so do the `?year=` it was asked with. */
function shiftAnnual(rec: Recording, years: number): Recording {
  if (!years) return rec;
  const docs: Recording["docs"] = {};
  for (const [key, doc] of Object.entries(rec.docs)) {
    if (pathOfKey(key) !== ANNUAL) docs[key] = doc;
    else docs[annualKey(key, years)] = annualDoc(doc, years);
  }
  return { ...rec, docs };
}

// ── The recording on disk: one file (old) or a directory of buckets (scripts/demo-recording-io.mjs) ─────────────────

/** Which bucket holds a path, as `boot.json` says. The same rule as scripts/demo-recording-io.mjs's `bucketOf`. */
export interface Manifest {
  prefixes: Record<string, string>;
  fallback: string;
  shards?: Record<string, number>;
  /** Every bucket but boot, in the order they are prefetched. */
  buckets: string[];
}
type Ref = { "=": string };
interface Bucket {
  lists?: Record<string, ListRecord | Ref>;
  docs?: Record<string, { s: number; b: unknown } | Ref>;
  /** Rows two or more lists of one path carry identically, by `<path>#<id>`; a list says `{ "&": key }` in their place. */
  rows?: Record<string, Row>;
  /** Where each key (in the bucket's order) stood in the whole recording, so all the keys read in the recorded order. */
  at?: Record<"lists" | "docs", number[]>;
}
interface Boot extends Bucket {
  role: DemoRole;
  lang: DemoLang;
  recordedAt: string;
  login: { user: Row };
  /** Absent in the old single-file format: everything is already here. */
  manifest?: Manifest;
}

const ID_SEGMENT = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** FNV-1a, 32 bit; the recorder's `fnv1a`. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** The bucket a path (no query) is in: the longest prefix the manifest names, then the row id's shard if it has shards. */
export function bucketOf(manifest: Manifest, path: string): string {
  let best = "";
  for (const prefix of Object.keys(manifest.prefixes)) if (path.startsWith(prefix) && prefix.length > best.length) best = prefix;
  const name = best ? manifest.prefixes[best] : manifest.fallback;
  const shards = manifest.shards?.[name];
  if (!shards) return name;
  const base = best || `/${path.split("/")[1] ?? ""}/`;
  const id = path.slice(base.length).split("/")[0];
  return ID_SEGMENT.test(id) ? `${name}.${fnv1a(id) % shards}` : name;
}

type Table = "lists" | "docs";
/**
 * One role's recording as far as it has loaded. `rec.lists` / `rec.docs` are proxies over the buckets that have arrived:
 * an answer is resolved (references) and moved (stamps) the first time it is read and cached, and a read of a key whose
 * bucket has not arrived — or a listing of all the keys while some have not — notes the bucket in `wanted`, which
 * `settle` loads before it asks again. Reads are pure, so asking again is safe; writes wait for every bucket.
 */
interface Loaded {
  role: DemoRole;
  lang: DemoLang;
  rec: Recording;
  manifest: Manifest | null;
  raw: Record<Table, Record<string, unknown>>;
  pool: Record<string, Row>;
  cache: Record<Table, Map<string, unknown>>;
  poolCache: Map<string, unknown>;
  index: Record<Table, Map<string, string[]>>;
  /** Each key's place in the whole recording; `sorted` is the keys in that order, until the next bucket arrives. */
  place: Record<Table, Map<string, number>>;
  sorted: Record<Table, string[] | null>;
  have: Set<string>;
  loading: Map<string, Promise<void>>;
  wanted: Set<string>;
  move: <T>(value: T) => T;
  years: number;
}
const byRec = new WeakMap<Recording, Loaded>();
const roles: Record<string, Promise<Loaded>> = {};

const file = (role: DemoRole, lang: DemoLang, name: string) => import(`./data/${role}.${lang}/${name}.json`).then((m) => m.default as Bucket);

const isRef = (v: unknown): v is Ref => !!v && typeof (v as Ref)["="] === "string";

function touch(u: Loaded, path: string): void {
  // Only an API path names a bucket: `toJSON`, `then` and the like are someone probing the object.
  if (!u.manifest || !path.startsWith("/")) return;
  const name = bucketOf(u.manifest, path);
  if (!u.have.has(name)) u.wanted.add(name);
}

function wantAll(u: Loaded): void {
  for (const name of u.manifest?.buckets ?? []) if (!u.have.has(name)) u.wanted.add(name);
}

function entry(u: Loaded, table: Table, key: string): unknown {
  const raw = u.raw[table];
  if (!(key in raw)) {
    touch(u, pathOfKey(key));
    return undefined;
  }
  const cached = u.cache[table].get(key);
  if (cached !== undefined) return cached;
  const stored = raw[key];
  let value: unknown;
  if (isRef(stored)) value = entry(u, table, stored["="]);
  else if (table === "lists") {
    const list = stored as ListRecord;
    value = { ...u.move({ ...list, rows: [] }), rows: list.rows.map((row) => poolRow(u, row)) };
  } else {
    value = u.move(stored);
    if (u.years && pathOfKey(key) === ANNUAL) value = annualDoc(value as { s: number; b: unknown }, u.years);
  }
  u.cache[table].set(key, value);
  return value;
}

function poolRow(u: Loaded, row: Row): unknown {
  const key = row && typeof row === "object" ? row["&"] : undefined;
  if (typeof key !== "string") return u.move(row);
  if (!u.poolCache.has(key)) u.poolCache.set(key, u.move(u.pool[key]));
  return u.poolCache.get(key);
}

function tableProxy(u: Loaded, table: Table): Record<string, never> {
  return new Proxy(u.raw[table], {
    get: (target, key) => (typeof key === "string" ? entry(u, table, key) : Reflect.get(target, key)),
    has: (target, key) => {
      if (typeof key === "string" && !(key in target)) touch(u, pathOfKey(key));
      return Reflect.has(target, key);
    },
    ownKeys: () => {
      wantAll(u);
      return (u.sorted[table] ??= Object.keys(u.raw[table]).sort((a, b) => u.place[table].get(a)! - u.place[table].get(b)!));
    },
  }) as Record<string, never>;
}

function merge(u: Loaded, bucket: Bucket): void {
  for (const table of ["lists", "docs"] as const) {
    const rename = (key: string) => (table === "docs" && u.years && pathOfKey(key) === ANNUAL ? annualKey(key, u.years) : key);
    Object.entries(bucket[table] ?? {}).forEach(([k, v], i) => {
      const key = rename(k);
      u.place[table].set(key, bucket.at?.[table][i] ?? u.place[table].size);
      if (!(key in u.raw[table])) {
        const path = pathOfKey(key);
        const keys = u.index[table].get(path);
        if (keys) keys.push(key);
        else u.index[table].set(path, [key]);
      }
      u.raw[table][key] = isRef(v) ? { "=": rename(v["="]) } : v;
    });
    u.sorted[table] = null;
  }
  Object.assign(u.pool, bucket.rows);
}

function start(role: DemoRole, lang: DemoLang, boot: Boot): Loaded {
  const blankTable = () => Object.create(null) as Record<string, unknown>;
  const move = stampMover(boot.recordedAt);
  const u: Loaded = {
    role,
    lang,
    rec: undefined as unknown as Recording,
    manifest: boot.manifest ?? null,
    raw: { lists: blankTable(), docs: blankTable() },
    pool: {},
    cache: { lists: new Map(), docs: new Map() },
    poolCache: new Map(),
    index: { lists: new Map(), docs: new Map() },
    place: { lists: new Map(), docs: new Map() },
    sorted: { lists: null, docs: null },
    have: new Set(["boot"]),
    loading: new Map(),
    wanted: new Set(),
    move,
    years: yearsSince(boot.recordedAt),
  };
  merge(u, boot);
  u.rec = {
    role: boot.role ?? role,
    lang: boot.lang ?? lang,
    recordedAt: move(boot.recordedAt),
    login: move(boot.login),
    lists: tableProxy(u, "lists") as unknown as Recording["lists"],
    docs: tableProxy(u, "docs") as unknown as Recording["docs"],
  };
  byRec.set(u.rec, u);
  return u;
}

/** Boot first; a role without a `<role>.<lang>/` directory still has its single recording (until it is re-recorded). */
function loadRole(role: DemoRole, lang: DemoLang): Promise<Loaded> {
  return (roles[`${role}.${lang}`] ??= file(role, lang, "boot").then(
    (boot) => start(role, lang, boot as Boot),
    () => import(`./data/${role}.${lang}.json`).then((m) => start(role, lang, m.default as Boot)),
  ));
}

function loadBucket(u: Loaded, name: string): Promise<void> {
  if (u.have.has(name)) return Promise.resolve();
  let pending = u.loading.get(name);
  if (!pending) {
    const done = () => {
      u.have.add(name);
      u.loading.delete(name);
    };
    pending = file(u.role, u.lang, name).then(
      (bucket) => {
        merge(u, bucket);
        done();
      },
      () => {
        // ponytail: a bucket the manifest names but the build lacks reads as nothing recorded, rather than failing every read.
        console.warn("[demo] no recording bucket", `${u.role}.${u.lang}/${name}`);
        done();
      },
    );
    u.loading.set(name, pending);
  }
  return pending;
}

const loadAll = (u: Loaded) => Promise.all((u.manifest?.buckets ?? []).map((name) => loadBucket(u, name)));

/** The whole recording: every bucket loaded. What writes and the pages that read across recordings use. */
export async function recording(role: DemoRole, lang: DemoLang): Promise<Recording> {
  const u = await loadRole(role, lang);
  await loadAll(u);
  return u.rec;
}

/** Only `boot`: what the sign-in answers from (login, menus, permissions, tenants). */
export const bootRecording = async (role: DemoRole, lang: DemoLang): Promise<Recording> => (await loadRole(role, lang)).rec;

/**
 * `compute` (a pure read) on the buckets it needs: the ones `paths` are in up front, then whatever it reached for that
 * had not arrived, and again, until it reaches for nothing new. Each round loads at least one more bucket, so it ends.
 */
export async function settle<T>(role: DemoRole, lang: DemoLang, compute: (rec: Recording) => T, paths: string[] = []): Promise<T> {
  const u = await loadRole(role, lang);
  if (u.manifest) {
    const first = new Set(paths.flatMap((p) => [p, collectionOf(p)?.collection].filter((x): x is string => !!x)).map((p) => bucketOf(u.manifest!, p)));
    await Promise.all([...first].map((name) => loadBucket(u, name)));
  }
  for (;;) {
    u.wanted.clear();
    const out = compute(u.rec);
    const more = [...u.wanted].filter((name) => !u.have.has(name));
    if (more.length === 0) return out;
    await Promise.all(more.map((name) => loadBucket(u, name)));
  }
}

/** After the sign-in: the other buckets one at a time, each when the page is idle, in the manifest's order. */
export function prefetch(role: DemoRole, lang: DemoLang): void {
  const idle = (): Promise<void> =>
    new Promise((resolve) => (typeof requestIdleCallback === "function" ? requestIdleCallback(() => resolve(), { timeout: 2000 }) : setTimeout(resolve, 200)));
  void loadRole(role, lang).then(async (u) => {
    for (const name of u.manifest?.buckets ?? []) {
      await idle();
      await loadBucket(u, name);
    }
  });
}

/** The keys a table has for one path: by the index on a loaded recording (noting the path's bucket), else by scanning. */
function keysOf(rec: Recording, table: Table, path: string): string[] {
  const u = byRec.get(rec);
  if (!u) return Object.keys(rec[table]).filter((k) => pathOfKey(k) === path);
  touch(u, path);
  return u.index[table].get(path) ?? [];
}

/**
 * The soul app's screens (`DemoSoul`): what one soul of each civilization reads under `/me/`, recorded by signing in
 * as that soul (`data/soul_<civ>.<lang>.json`, scripts/demo-record.mjs). `null` until it has been recorded.
 */
export function soulRecording(civ: string, lang: DemoLang): Promise<Recording | null> {
  const name = `soul_${civ}`;
  // The same template as the single-file recordings' (`loadRole`), so the bundler's context is the same set of files, recorded or not.
  return (soulLoaded[`${name}.${lang}`] ??= import(`./data/${name}.${lang}.json`).then(
    (m) => (soulReady[`${name}.${lang}`] = shifted(m.default as Recording)),
    () => (soulReady[`${name}.${lang}`] = null),
  ));
}
const soulLoaded: Record<string, Promise<Recording | null>> = {};
const soulReady: Record<string, Recording | null> = {};
/** What `soulRecording` has already resolved to, in the same render: `undefined` while it is still loading. */
export const soulRecordingNow = (civ: string, lang: DemoLang): Recording | null | undefined => soulReady[`soul_${civ}.${lang}`];

export const nextSeq = () => ++overlay.seq;

/** A UUID's own shape, so a stand-in id reads like the real ones. */
export const newId = () => `dec0de00-0000-4000-8000-${String(nextSeq()).padStart(12, "0")}`;

export function patchRow(collection: string, id: string | number, fields: Row): void {
  const key = isUuid(String(id)) ? String(id) : `${collection}#${id}`;
  overlay.patches[key] = { ...overlay.patches[key], ...fields };
}

export function deleteRow(collection: string, id: string | number): void {
  overlay.deleted.push(isUuid(String(id)) ? String(id) : `${collection}#${id}`);
}

/** Takes a row out of one list only, whatever kind of id it has. */
export function dropFromList(collection: string, id: string | number): void {
  overlay.deleted.push(`${collection}#${id}`);
}

export function addRow(collection: string, row: Row): void {
  (overlay.added[collection] ??= []).unshift(row);
}

/** Applies UUID patches and deletions everywhere in a body. `scope` is the collection a body's top-level rows belong to. */
function overlaid(value: unknown, scope?: string): unknown {
  if (Array.isArray(value)) {
    return value.filter((v) => !isDeleted(v, scope)).map((v) => overlaid(v, scope));
  }
  if (!value || typeof value !== "object") return value;
  const row = value as Row;
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[k] = overlaid(v);
  return { ...out, ...patchFor(row, scope) };
}

function idOf(v: unknown): string | null {
  const id = (v as Row | null)?.id;
  return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

/** Lists that record deletions: deleting a post by its uuid must not take its 「已处理 · 已删除」 row with it. */
const RECORDS_DELETIONS = new Set(["/social-moderation/handled/"]);

function isDeleted(v: unknown, scope?: string): boolean {
  const id = idOf(v);
  if (id === null) return false;
  if (scope !== undefined && overlay.deleted.includes(`${scope}#${id}`)) return true;
  return !(scope !== undefined && RECORDS_DELETIONS.has(scope)) && overlay.deleted.includes(id);
}

function patchFor(row: Row, scope?: string): Row | undefined {
  const id = idOf(row);
  if (id === null) return undefined;
  return overlay.patches[id] ?? (scope !== undefined ? overlay.patches[`${scope}#${id}`] : undefined);
}

function canonicalQuery(query: URLSearchParams): string {
  return [...query.entries()]
    .filter(([k]) => !PAGING.has(k))
    .sort()
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

const pathOfKey = (key: string) => key.split("?")[0];

/** Every row the recording has for a list path, across all the query strings it was asked with. */
export function allRows(rec: Recording, path: string): Row[] {
  const seen = new Map<string, Row>();
  const keys = keysOf(rec, "lists", path);
  const bare = keys.includes(path) ? rec.lists[path] : undefined;
  for (const row of bare?.rows ?? []) seen.set(idOf(row) ?? JSON.stringify(row), row);
  for (const key of keys) {
    if (key === path) continue;
    for (const row of rec.lists[key].rows) {
      const id = idOf(row) ?? JSON.stringify(row);
      if (!seen.has(id)) seen.set(id, row);
    }
  }
  return [...seen.values()];
}

export function matches(row: Row, query: URLSearchParams): boolean {
  for (const [k, v] of query.entries()) {
    if (NO_FILTER.has(k) || v === "") continue;
    // Filters that are not a column, read the way the server reads them (apps/events/views.py, apps/audit): a day range
    // on the row's own time, both ends inclusive, and 「不含系统事件」 = actor empty or "system". Unread, an unrecorded
    // day showed every event, system ones too, under 「近 7 天 · 不含系统事件」.
    if (k === "start_date" || k === "end_date") {
      const stamp = row.create_time ?? row.created_at ?? row.timestamp;
      if (typeof stamp !== "string") continue;
      const day = stamp.slice(0, stamp.indexOf("T") > 0 ? stamp.indexOf("T") : 10);
      if (k === "start_date" ? beforeDay(day, v) : beforeDay(v, day)) return false;
      continue;
    }
    if (k === "exclude_system") {
      if ((v === "1" || v === "true") && "actor" in row && (!row.actor || row.actor === "system")) return false;
      continue;
    }
    const field = k.replace(/(__in|__iexact|__exact)$/, "");
    if (!(field in row)) continue;
    const cell = row[field];
    const wanted = v.split(",");
    const actual = cell && typeof cell === "object" ? idOf(cell) : String(cell);
    if (!wanted.includes(String(actual))) return false;
  }
  const words = query.get("search") ?? query.get("q");
  return !words || JSON.stringify(row).toLowerCase().includes(words.toLowerCase());
}

/** `a` is an earlier calendar day than `b`. Both `YYYY-MM-DD`, or the ISO extended year (`-000276-03-03`) a shifted
 * recording holds — which a string compare gets wrong. Unparseable never counts as earlier. */
function beforeDay(a: string, b: string): boolean {
  const key = (d: string) => /^([+-]?\d+)-(\d\d)-(\d\d)/.exec(d)?.slice(1).map(Number);
  const [x, y] = [key(a), key(b)];
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return false;
}

function ordered(rows: Row[], ordering: string | null): Row[] {
  if (!ordering) return rows;
  const desc = ordering.startsWith("-");
  const field = ordering.replace(/^-/, "").split(",")[0];
  return [...rows].sort((a, b) => {
    const cmp = String(a[field] ?? "").localeCompare(String(b[field] ?? ""), undefined, { numeric: true });
    return desc ? -cmp : cmp;
  });
}

function pageOf(rows: Row[], query: URLSearchParams, extra: Row): Answer {
  const size = Number(query.get("page_size")) || 20;
  const page = Number(query.get("page")) || 1;
  const hasNext = page * size < rows.length;
  const next = new URLSearchParams(query);
  next.set("page", String(page + 1));
  const prev = new URLSearchParams(query);
  prev.set("page", String(page - 1));
  return {
    status: 200,
    data: {
      ...extra,
      count: rows.length,
      next: hasNext ? `?${next}` : null,
      previous: page > 1 ? `?${prev}` : null,
      results: rows.slice((page - 1) * size, page * size),
    },
  };
}

/** A list the recording never saw and an unknown path both read empty, whichever shape the caller expects. */
export function emptyLike(): unknown {
  return Object.assign([] as unknown[], { count: 0, next: null, previous: null, results: [] });
}

/** The rows of a list as they stand now, with this session's additions, changes and deletions. */
export function rowsNow(rec: Recording, path: string): Row[] {
  const recorded = allRows(rec, path);
  const doc = rec.docs[path]?.b;
  return overlaid([...(overlay.added[path] ?? []), ...(recorded.length === 0 && Array.isArray(doc) ? (doc as Row[]) : recorded)], path) as Row[];
}

/** A computed list, filtered and paged like any other. */
export const listOf = (rows: Row[], query: URLSearchParams, extra: Row): Answer =>
  pageOf(ordered(rows.filter((row) => matches(row, query)), query.get("ordering")), query, extra);

function collectionOf(path: string): { collection: string; id: string } | null {
  const m = /^(.*\/)([^/]+)\/$/.exec(path);
  return m ? { collection: m[1], id: m[2] } : null;
}

function listAnswer(rec: Recording, path: string, query: URLSearchParams, q: string): Answer | null {
  const key = q ? `${path}?${q}` : path;
  const known = keysOf(rec, "lists", path).length > 0;
  const added = overlay.added[path] ?? [];
  if (!known && added.length === 0) return null;
  const exact = rec.lists[key];
  const base = exact ? exact.rows : allRows(rec, path).filter((row) => matches(row, query));
  const rows = [
    ...(overlaid(added, path) as Row[]).filter((row) => matches(row, query)),
    ...(overlaid(base, path) as Row[]).filter((row) => !exact || !patchFor(row, path) || matches(row, query)),
  ];
  // A row a change moved INTO this filter: patched, not listed, and now matching every field the filter names.
  const moved = q === "" ? [] : Object.keys(overlay.patches).length === 0 ? [] : (overlaid(allRows(rec, path), path) as Row[])
    .filter((row) => patchFor(row, path) && matches(row, query) && !rows.some((r) => idOf(r) === idOf(row)))
    .filter((row) => [...query.keys()].some((k) => !NO_FILTER.has(k) && k in row));
  return pageOf(ordered([...moved, ...rows], query.get("ordering")), query, exact?.extra ?? rec.lists[path]?.extra ?? {});
}

/** The answer to a GET. Never throws and never leaves the browser. */
export function read(rec: Recording, path: string, query: URLSearchParams): Answer {
  if (path in overlay.docs) return { status: 200, data: overlaid(overlay.docs[path], path) };
  const q = canonicalQuery(query);
  const list = listAnswer(rec, path, query, q);
  if (list) return list;

  const key = q ? `${path}?${q}` : path;
  const parent = collectionOf(path);
  const inParent = parent ? allRows(rec, parent.collection).find((r) => idOf(r) === parent.id) : undefined;
  const addedRow = parent ? overlay.added[parent.collection]?.find((r) => idOf(r) === parent.id) : undefined;
  const anyKey = keysOf(rec, "docs", path)[0];
  const doc = rec.docs[key] ?? rec.docs[path] ?? (anyKey === undefined ? undefined : rec.docs[anyKey]);
  if (doc && doc.s !== 200) return { status: doc.s, data: doc.b };
  if (doc || inParent || addedRow) {
    if (Array.isArray(doc?.b)) return { status: 200, data: [...((overlay.added[path] ?? []) as unknown[]), ...(overlaid(doc.b, path) as unknown[])] };
    const scope = parent?.collection;
    if (parent && isDeleted({ id: parent.id }, scope)) return { status: 404, data: { type: "about:blank", title: "Not Found", status: 404, code: "not_found", detail: "Not found." } };
    // A row's list form under its detail form: a detail recorded for the row wins, and the row fills what it lacks.
    return { status: 200, data: mergeScoped(overlaid(doc?.b ?? addedRow ?? inParent, scope), parent) };
  }
  if (overlay.added[path]?.length) return { status: 200, data: overlaid(overlay.added[path], path) };
  // A row of a recorded list that the list does not have — an id from an older recording (every re-seed mints new
  // ones), or one typed by hand — is a 404, as the server would say. An empty 200 here made detail pages crash on the
  // fields they expect (2026-11-08: /souls/<old id> → "Cannot read properties of undefined (reading 'map')").
  if (parent && /^(\d+|[0-9a-f]{8}-[0-9a-f-]{27})$/.test(parent.id) && keysOf(rec, "lists", parent.collection).length > 0) {
    return { status: 404, data: { type: "about:blank", title: "Not Found", status: 404, code: "not_found", detail: "Not found." } };
  }
  console.info("[demo] nothing recorded for GET", key);
  return { status: 200, data: emptyLike() };
}

function mergeScoped(body: unknown, parent: { collection: string; id: string } | null): unknown {
  if (!parent || !body || typeof body !== "object") return body;
  return { ...(body as Row), ...overlay.patches[`${parent.collection}#${parent.id}`] };
}
