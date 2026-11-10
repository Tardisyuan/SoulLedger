/**
 * What the demo answers GETs with: the recording (`data/<role>.json`, scripts/demo-record.mjs) under an overlay of what
 * this browser session changed. The recording is never edited. The overlay is what sessionStorage keeps, so a reload
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
const BARE_DATE = /"(\d{4}-\d\d-\d\d)"/g;
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

export const currentRole = (): DemoRole =>
  (storageGet("session", ROLE_KEY) || storageGet("local", ROLE_KEY) || "judge") as DemoRole;

export function setRole(role: DemoRole): void {
  try {
    sessionStorage.setItem(ROLE_KEY, role);
    localStorage.setItem(ROLE_KEY, role);
  } catch {
    /* falls back to the default role */
  }
}

const loaded: Record<string, Promise<Recording>> = {};
export type DemoLang = "zh" | "en";
/** A language the recording has for the one the app asks in. Kemet reads the English recording. */
export const langOf = (acceptLanguage: unknown): DemoLang => (String(acceptLanguage ?? "").startsWith("zh") ? "zh" : "en");

/** Timestamps move with the calendar: a case recorded as "two hours ago" reads that way whenever the demo is opened. */
function shifted(raw: Recording): Recording {
  return shiftAnnual(shiftStamps(raw, raw.recordedAt), new Date(Date.now()).getUTCFullYear() - new Date(raw.recordedAt).getUTCFullYear());
}

/** Every stamp in `value` moved as `shifted` moves a recording made at `recordedAt` (the home page's preview extract too). */
export function shiftStamps<T>(value: T, recordedAt: string): T {
  const delta = Date.now() - Date.parse(recordedAt);
  // Every stamp moves by the same amount, so the spread between them is kept. Whole days for a bare date (the census's
  // `day`), and only dates near the recording: 1283-05-01 is someone's birthday, not a stamp.
  const days = Math.round(delta / 86400000) * 86400000;
  const recent = new Date(recordedAt).getUTCFullYear() - 2;
  const text = JSON.stringify(value)
    // A stamp from long ago is a life's history, not "two hours ago": it stays put.
    .replace(STAMP, (s) => (Number(s.slice(0, 4)) < recent ? s : new Date(Date.parse(s) + delta).toISOString()))
    .replace(BARE_DATE, (whole, date: string) =>
      Number(date.slice(0, 4)) < recent ? whole : `"${new Date(Date.parse(date) + days).toISOString().slice(0, 10)}"`,
    );
  return JSON.parse(text) as T;
}

/** The annual report names its year as a number, not a stamp: it moves with the calendar too, and so do the `?year=` it was asked with. */
function shiftAnnual(rec: Recording, years: number): Recording {
  if (!years) return rec;
  const docs: Recording["docs"] = {};
  for (const [key, doc] of Object.entries(rec.docs)) {
    if (pathOfKey(key) !== "/judgment/annual/") {
      docs[key] = doc;
      continue;
    }
    const b = doc.b as Row | null;
    const moved = b && typeof b.year === "number" ? { ...doc, b: { ...b, year: b.year + years } } : doc;
    docs[key.replace(/([?&]year=)(\d+)/, (_, p: string, y: string) => `${p}${Number(y) + years}`)] = moved;
  }
  return { ...rec, docs };
}

export function recording(role: DemoRole, lang: DemoLang): Promise<Recording> {
  return (loaded[`${role}.${lang}`] ??= import(`./data/${role}.${lang}.json`).then((m) => shifted(m.default as Recording)));
}

/**
 * The soul app's screens (`DemoSoul`): what one soul of each civilization reads under `/me/`, recorded by signing in
 * as that soul (`data/soul_<civ>.<lang>.json`, scripts/demo-record.mjs). `null` until it has been recorded.
 */
export function soulRecording(civ: string, lang: DemoLang): Promise<Recording | null> {
  const name = `soul_${civ}`;
  // The same template as `recording`'s, so the bundler's context is the same set of files, recorded or not.
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

function isDeleted(v: unknown, scope?: string): boolean {
  const id = idOf(v);
  if (id === null) return false;
  return overlay.deleted.includes(id) || (scope !== undefined && overlay.deleted.includes(`${scope}#${id}`));
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
  const bare = rec.lists[path];
  for (const row of bare?.rows ?? []) seen.set(idOf(row) ?? JSON.stringify(row), row);
  for (const [key, list] of Object.entries(rec.lists)) {
    if (key === path || pathOfKey(key) !== path) continue;
    for (const row of list.rows) {
      const id = idOf(row) ?? JSON.stringify(row);
      if (!seen.has(id)) seen.set(id, row);
    }
  }
  return [...seen.values()];
}

function matches(row: Row, query: URLSearchParams): boolean {
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
  const known = Object.keys(rec.lists).some((k) => pathOfKey(k) === path);
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
  const doc = rec.docs[key] ?? rec.docs[path] ?? Object.entries(rec.docs).find(([k]) => pathOfKey(k) === path)?.[1];
  if (doc && doc.s !== 200) return { status: doc.s, data: doc.b };
  if (doc || inParent || addedRow) {
    if (Array.isArray(doc?.b)) return { status: 200, data: [...((overlay.added[path] ?? []) as unknown[]), ...(overlaid(doc.b, path) as unknown[])] };
    const scope = parent?.collection;
    if (parent && isDeleted({ id: parent.id }, scope)) return { status: 404, data: { detail: "Not found." } };
    // A row's list form under its detail form: a detail recorded for the row wins, and the row fills what it lacks.
    return { status: 200, data: mergeScoped(overlaid(doc?.b ?? addedRow ?? inParent, scope), parent) };
  }
  if (overlay.added[path]?.length) return { status: 200, data: overlaid(overlay.added[path], path) };
  // A row of a recorded list that the list does not have — an id from an older recording (every re-seed mints new
  // ones), or one typed by hand — is a 404, as the server would say. An empty 200 here made detail pages crash on the
  // fields they expect (2026-11-08: /souls/<old id> → "Cannot read properties of undefined (reading 'map')").
  if (parent && /^(\d+|[0-9a-f]{8}-[0-9a-f-]{27})$/.test(parent.id) && Object.keys(rec.lists).some((k) => pathOfKey(k) === parent.collection)) {
    return { status: 404, data: { detail: "Not found." } };
  }
  console.info("[demo] nothing recorded for GET", key);
  return { status: 200, data: emptyLike() };
}

function mergeScoped(body: unknown, parent: { collection: string; id: string } | null): unknown {
  if (!parent || !body || typeof body !== "object") return body;
  return { ...(body as Row), ...overlay.patches[`${parent.collection}#${parent.id}`] };
}
