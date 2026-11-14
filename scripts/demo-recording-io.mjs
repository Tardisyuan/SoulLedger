// The demo recordings on disk (2026-11-14, expert design wave 2: docs/audit/2026-11-14-expert-design/raw/fe-perf.md P5/P6).
//
// One role's recording used to be one file, `frontend/demo/data/<role>.<lang>.json` (admin 7.2 MB, 960 KB gzip), and
// the sign-in waited for all of it. Now it is a directory of buckets, `<role>.<lang>/`:
//   boot.json        role, lang, recordedAt, login, the manifest, and the answers under BOOT's prefixes
//   <bucket>.json    { lists, docs } for one domain; a domain too big for one chunk is split by row id, `<bucket>.<n>.json`
// A path's bucket is the longest prefix of it in `manifest.prefixes` (else `manifest.fallback`), and, when the manifest
// shards that bucket, `.<fnv1a(id) % shards>` by the segment after the prefix if it is an id. frontend/demo/store.ts
// (`bucketOf`) reads the manifest by the same rule; keep the two in step.
//
// Inside a bucket, two kinds of reference (fe-perf.md P6):
//   - an answer identical to an earlier one of the same table is written `{ "=": "<that key>" }`;
//   - a list row that two or more lists of the same path carry byte for byte (the statute list asked as
//     `/judgment/statutes/` and `?ordering=code`, the same rows in another order; `/judgment/` under each filter) is
//     kept once in the bucket's `rows`, under `<path>#<id>`, and each list says `{ "&": "<path>#<id>" }` in its place.
//     The administrator's lists carried 663 of 2089 KB this way.
// Each bucket also says where its keys stood in the whole recording (`at`: { lists: [n…], docs: [n…] }, one number per
// key in the bucket's order), so a reader of all the keys sees them in the recorded order whatever order the buckets
// arrived in: 「工程视角」's `insideCase` takes the first plan in key order, and the recorder picked it the same way.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

export const PREFIXES = {
  "/auth/": "boot",
  "/menus/": "boot",
  "/perm/": "boot",
  "/tenants/": "boot",
  "/notifications/": "boot",
  "/judgment/statutes/": "statutes",
  "/judgment/": "judgment",
  "/dossiers/": "judgment",
  "/souls/": "souls",
  "/soul-accounts/": "souls",
  "/workflows/": "workflows",
  "/workflow/": "workflows",
  "/nodes/": "nodes",
  "/actors/": "nodes",
  "/realms/": "nodes",
};
export const FALLBACK = "ops";
/** The order the console prefetches them in once it is up: what the tours open first. */
const ORDER = ["souls", "judgment", "workflows", "statutes", "nodes", "ops"];
/** A bucket over this (gzip) is split by row id into chunks of about SHARD_TARGET. */
const SHARD_OVER = 120 * 1024;
const SHARD_TARGET = 90 * 1024;
const MAX_SHARDS = 32;
/** Answers shorter than this are not worth a reference. */
const DEDUPE_MIN = 256;
const ID = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** FNV-1a, 32 bit. The same function as store.ts's `fnv1a`. */
export function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** The bucket a path (no query) is in. The same rule as store.ts's `bucketOf`. */
export function bucketOf(manifest, path) {
  let best = "";
  for (const prefix of Object.keys(manifest.prefixes)) if (path.startsWith(prefix) && prefix.length > best.length) best = prefix;
  const name = best ? manifest.prefixes[best] : manifest.fallback;
  const shards = manifest.shards?.[name];
  if (!shards) return name;
  const base = best || `/${path.split("/")[1] ?? ""}/`;
  const id = path.slice(base.length).split("/")[0];
  return ID.test(id) ? `${name}.${fnv1a(id) % shards}` : name;
}

const gz = (value) => gzipSync(JSON.stringify(value)).length;
const pathOf = (key) => key.split("?")[0];

/** `{ lists, docs }` of one recording → `{ boot, buckets: { name: { lists, docs } } }`, deduplicated. */
export function splitRecording(rec) {
  const manifest = { prefixes: PREFIXES, fallback: FALLBACK, shards: {}, buckets: [] };
  // Sizes first, unsharded, to decide which buckets to shard.
  const sizes = {};
  const plain = assign(rec, manifest);
  for (const [name, bucket] of Object.entries(plain)) sizes[name] = gz(bucket);
  for (const [name, size] of Object.entries(sizes)) {
    if (name !== "boot" && size > SHARD_OVER) manifest.shards[name] = Math.min(MAX_SHARDS, Math.ceil(size / SHARD_TARGET));
  }
  const buckets = assign(rec, manifest);
  for (const bucket of Object.values(buckets)) {
    const { lists, rows } = poolRows(bucket.lists);
    bucket.lists = dedupe(lists);
    bucket.docs = dedupe(bucket.docs);
    if (Object.keys(rows).length) bucket.rows = rows;
  }
  const rank = (name) => {
    const i = ORDER.indexOf(name.split(".")[0]);
    return (i < 0 ? ORDER.length : i) * 1000 + Number(name.split(".")[1] ?? -1);
  };
  manifest.buckets = Object.keys(buckets).filter((n) => n !== "boot").sort((a, b) => rank(a) - rank(b));
  const { boot = { lists: {}, docs: {}, at: { lists: [], docs: [] } }, ...rest } = buckets;
  return { boot: { role: rec.role, lang: rec.lang, recordedAt: rec.recordedAt, login: rec.login, manifest, ...boot }, buckets: rest };
}

function assign(rec, manifest) {
  const out = {};
  for (const table of ["lists", "docs"]) {
    Object.entries(rec[table]).forEach(([key, value], n) => {
      const bucket = (out[bucketOf(manifest, pathOf(key))] ??= { lists: {}, docs: {}, at: { lists: [], docs: [] } });
      bucket[table][key] = value;
      bucket.at[table].push(n);
    });
  }
  return out;
}

/** The second and later of identical answers become `{ "=": <first key> }`. One level: a reference never points at one. */
export function dedupe(table) {
  const first = new Map();
  const out = {};
  for (const [key, value] of Object.entries(table)) {
    const text = JSON.stringify(value);
    const seen = text.length >= DEDUPE_MIN ? first.get(text) : undefined;
    if (seen) out[key] = { "=": seen };
    else {
      out[key] = value;
      if (text.length >= DEDUPE_MIN) first.set(text, key);
    }
  }
  return out;
}

/** Rows two or more lists of one path carry identically go to a pool; the lists keep `{ "&": <pool key> }`. */
export function poolRows(lists) {
  const text = (row) => JSON.stringify(row);
  const poolKey = (key, row) => (row && row.id != null ? `${pathOf(key)}#${row.id}` : null);
  const first = new Map();
  const count = new Map();
  for (const [key, list] of Object.entries(lists)) {
    for (const row of list.rows ?? []) {
      const k = poolKey(key, row);
      if (!k) continue;
      const t = text(row);
      if (!first.has(k)) first.set(k, t);
      if (first.get(k) === t) count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  const rows = {};
  const out = {};
  for (const [key, list] of Object.entries(lists)) {
    if (!list.rows) {
      out[key] = list;
      continue;
    }
    out[key] = {
      ...list,
      rows: list.rows.map((row) => {
        const k = poolKey(key, row);
        if (!k || count.get(k) < 2 || first.get(k) !== text(row)) return row;
        rows[k] = row;
        return { "&": k };
      }),
    };
  }
  return { lists: out, rows };
}

/** A bucket's references back to what they stand for. */
export function resolve(table, rows = {}) {
  const out = {};
  for (const [key, value] of Object.entries(table)) {
    const entry = value && typeof value["="] === "string" ? table[value["="]] : value;
    out[key] = entry && Array.isArray(entry.rows) ? { ...entry, rows: entry.rows.map((r) => (r && typeof r["&"] === "string" ? rows[r["&"]] : r)) } : entry;
  }
  return out;
}

const singlePath = (dir, role, lang) => `${dir}/${role}.${lang}.json`;
const bucketDir = (dir, role, lang) => `${dir}/${role}.${lang}`;

/** Writes `<role>.<lang>/` from a whole recording and removes the single file it came from. */
export function writeBucketed(dir, rec) {
  const { boot, buckets } = splitRecording(rec);
  const out = bucketDir(dir, rec.role, rec.lang);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/boot.json`, JSON.stringify(boot));
  for (const [name, bucket] of Object.entries(buckets)) writeFileSync(`${out}/${name}.json`, JSON.stringify(bucket));
  rmSync(singlePath(dir, rec.role, rec.lang), { force: true });
  return { boot: gz(boot), buckets: Object.fromEntries(Object.entries(buckets).map(([n, b]) => [n, gz(b)])) };
}

/** One role's whole recording, from either format, references resolved. */
export function readRecording(dir, role, lang) {
  const single = singlePath(dir, role, lang);
  if (existsSync(single)) return JSON.parse(readFileSync(single, "utf8"));
  const read = (name) => JSON.parse(readFileSync(`${bucketDir(dir, role, lang)}/${name}.json`, "utf8"));
  const { manifest, ...boot } = read("boot");
  const { rows: _rows, at: _at, lists: _lists, docs: _docs, ...head } = boot;
  const placed = { lists: [], docs: [] };
  for (const bucket of [boot, ...manifest.buckets.map(read)]) {
    const resolved = { lists: resolve(bucket.lists, bucket.rows), docs: resolve(bucket.docs) };
    for (const table of ["lists", "docs"]) Object.entries(resolved[table]).forEach(([k, v], i) => placed[table].push([bucket.at[table][i], k, v]));
  }
  const inOrder = (entries) => Object.fromEntries(entries.sort((a, b) => a[0] - b[0]).map(([, k, v]) => [k, v]));
  return { ...head, lists: inOrder(placed.lists), docs: inOrder(placed.docs) };
}
