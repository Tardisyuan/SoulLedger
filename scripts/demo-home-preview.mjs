#!/usr/bin/env node
// The demo home page's journey preview (Design 第二十七批, frontend/demo/HomePreview.tsx) draws one recorded soul per
// underworld. The judge recordings are 1.6–3.6 MB each; the page needs a few KB of them. This writes those few KB:
// for each language and underworld, the soul the preview follows and only the fields the journey block reads.
//
//   node scripts/demo-home-preview.mjs           write frontend/demo/data/home-preview.json
//   node scripts/demo-home-preview.mjs --check   exit 1 if the committed file is not what the recordings give
//
// scripts/demo-record.mjs runs it after a re-record; frontend/src/__tests__/demoHomePreview.test.ts runs --check.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DATA = new URL("../frontend/demo/data/", import.meta.url);
const OUT = new URL("home-preview.json", DATA);
const ROLE = { cn: "judge", eu: "judge_eu", eg: "judge_eg", gr: "judge_gr" };
const CIVILIZATION = { cn: "CHINESE", eu: "EUROPEAN", eg: "EGYPTIAN", gr: "GREEK" };

// What the journey block reads (routeTopology / journeyModel / journeyLayout / SoulLedgerProgress `JourneyBlock`).
const KEEP = {
  soul: ["id", "name", "civilization", "current_state"],
  realm: ["id", "realm_code", "civilization", "name_en", "name_local", "order", "level", "region", "fork", "parent_realm", "is_judgment_hall"],
  judgment: ["id", "court", "verdict", "concluded_at", "created_at"],
  disposition: ["id", "executed_at", "created_at", "is_eternal"],
  reincarnation: ["id", "reincarnated_at"],
};
const only = (row, keys) => Object.fromEntries(keys.filter((k) => row[k] !== undefined).map((k) => [k, row[k]]));

/** Every row the recording has for a list path, across its query strings (frontend/demo/store.ts `allRows`). */
function allRows(rec, path) {
  const seen = new Map();
  const add = (row) => {
    const id = row.id == null ? JSON.stringify(row) : String(row.id);
    if (!seen.has(id)) seen.set(id, row);
  };
  for (const row of rec.lists[path]?.rows ?? []) add(row);
  for (const [key, list] of Object.entries(rec.lists)) if (key !== path && key.split("?")[0] === path) list.rows.forEach(add);
  return [...seen.values()];
}

/**
 * The soul the preview follows: of this underworld, with a road already walked and exactly one stop it is at now.
 * The longest walked road wins (more to see); a tie keeps the recording's order. `null` when no soul qualifies.
 */
function pick(rec, skin) {
  let best = null;
  for (const soul of allRows(rec, "/souls/")) {
    if (soul.civilization !== CIVILIZATION[skin]) continue;
    const path = rec.docs[`/souls/${soul.id}/path/`]?.b;
    if (!Array.isArray(path)) continue;
    const now = path.filter((e) => e.left_at === null).length;
    const walked = path.length - now;
    if (now !== 1 || walked < 1) continue;
    if (!best || walked > best.walked) best = { soul, path, walked };
  }
  if (!best) return null;
  const rows = (collection, keys) => (rec.lists[`${collection}?soul=${best.soul.id}`]?.rows ?? []).map((r) => only(r, keys));
  // Its own underworld's realms, plus any other realm its path went through (a transfer is drawn as a branch).
  const visited = new Set(best.path.map((e) => e.realm_id));
  return {
    recordedAt: rec.recordedAt,
    soul: only(best.soul, KEEP.soul),
    path: best.path,
    realms: allRows(rec, "/realms/")
      .filter((r) => r.civilization === CIVILIZATION[skin] || visited.has(r.id))
      .map((r) => only(r, KEEP.realm)),
    judgments: rows("/judgment/", KEEP.judgment),
    dispositions: rows("/disposition/", KEEP.disposition),
    reincarnations: rows("/reincarnation/", KEEP.reincarnation),
  };
}

/**
 * `{ realms: {cn: [...]}, zh: {cn: {soul, path, ...}}, en: {...} }`. The realm rows are the same in both recordings
 * (labels come from the language packs), so they are written once; if the two ever differ, this says so.
 */
function build() {
  const read = (name) => JSON.parse(readFileSync(new URL(name, DATA), "utf8"));
  const out = { realms: {}, zh: {}, en: {} };
  for (const skin of Object.keys(ROLE)) {
    for (const lang of ["zh", "en"]) {
      const shown = pick(read(`${ROLE[skin]}.${lang}.json`), skin);
      if (!shown) {
        out[lang][skin] = null;
        continue;
      }
      const { realms, ...rest } = shown;
      out[lang][skin] = rest;
      if (lang === "zh") out.realms[skin] = realms;
      else if (JSON.stringify(out.realms[skin] ?? []) !== JSON.stringify(realms)) throw new Error(`${skin}: the zh and en recordings disagree on the realms`);
    }
  }
  return `${JSON.stringify(out)}\n`;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const text = build();
  if (process.argv.includes("--check")) {
    let committed = "";
    try {
      committed = readFileSync(OUT, "utf8");
    } catch {
      /* missing: differs */
    }
    if (committed !== text) {
      console.error("frontend/demo/data/home-preview.json is not what the recordings give: run node scripts/demo-home-preview.mjs");
      process.exit(1);
    }
    console.log(`home-preview.json matches the recordings (${Buffer.byteLength(text)} bytes)`);
  } else {
    writeHomePreview();
  }
}

/** Called by scripts/demo-record.mjs once the judges are recorded. */
export function writeHomePreview() {
  const text = build();
  writeFileSync(OUT, text);
  console.log(`home-preview.json: ${Buffer.byteLength(text)} bytes`);
}
