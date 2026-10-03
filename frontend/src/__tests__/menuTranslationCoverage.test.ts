/**
 * Every sidebar menu the backend migrations create has a translation key in `menuI18n.ts`, and
 * that key exists in all three bundles. Without one the sidebar shows the menu's Chinese `name`
 * in every language: `/moderation`(0017)shipped that way and stayed so until a user saw
 * 「朋友圈审核」under English (2026-10-03). Nothing failed, because a missing key falls back
 * silently by design (see the file's own docstring).
 *
 * The paths are read from the migrations, so a new `add_*_menu` migration is covered without
 * anyone remembering this file. Hidden menus (0009's HIDDEN_FROM_SIDEBAR) never reach the sidebar.
 */
import fs from "fs";
import path from "path";
import zh from "@soulledger/core/messages/zh-Hans.json";
import en from "@soulledger/core/messages/en.json";
import egy from "@soulledger/core/messages/egy.json";
import { menuTranslationKey } from "@/src/lib/menuI18n";

const MIGRATIONS = path.join(__dirname, "..", "..", "..", "backend", "apps", "menus", "migrations");

type Bundle = Record<string, unknown>;
const get = (b: Bundle, key: string): unknown =>
  key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], b);

const sources = fs
  .readdirSync(MIGRATIONS)
  .filter((f) => /^\d{4}_.*\.py$/.test(f))
  .map((f) => fs.readFileSync(path.join(MIGRATIONS, f), "utf8"));

const hidden = new Set(
  [...(sources.join("\n").match(/HIDDEN_FROM_SIDEBAR\s*=\s*\[([^\]]*)\]/)?.[1] ?? "").matchAll(/"(\/[^"]*)"/g)].map(
    (m) => m[1]
  )
);
/** Paths a later migration moved away from; the row lives on under its new path. */
const RETIRED = new Set(["/karma"]); // 0011_move_karma_menu_to_ledger → /ledger

// Two shapes: the `add_*_menu` migrations write `"path": "/x"`; 0009 regrouped the original
// menus as `"/x": ("<group>", <order>)`, and those are the only record of the first menus' paths.
const PATH_SHAPES = [/"path":\s*"(\/[^"]*)"/g, /^\s*"(\/[^"]*)":\s*\(/gm];
const sidebarPaths = [
  ...new Set(sources.flatMap((s) => PATH_SHAPES.flatMap((re) => [...s.matchAll(re)].map((m) => m[1])))),
].filter((p) => !hidden.has(p) && !RETIRED.has(p));

describe("sidebar menu translations", () => {
  it("reads the migrations at all", () => {
    expect(hidden).toEqual(new Set(["/welcome", "/profile", "/notifications"]));
    expect(sidebarPaths).toEqual(expect.arrayContaining(["/moderation", "/admin/assistant", "/souls"]));
  });

  it.each(sidebarPaths)("%s has a key present in zh-Hans, en and egy", (p) => {
    const key = menuTranslationKey({ path: p, name: "", menu_type: "MENU" });
    expect(key).not.toBeNull();
    for (const bundle of [zh, en, egy] as Bundle[]) expect(typeof get(bundle, key!)).toBe("string");
  });
});
