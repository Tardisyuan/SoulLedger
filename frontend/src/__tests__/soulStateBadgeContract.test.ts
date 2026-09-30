/**
 * (v1) Every soul lifecycle state got its OWN colour. v2 C15 retired that —
 * domain badges are ink on ink3 now — but the defect below is why the table is one file.
 *
 * WHY THIS FILE EXISTS. `app/souls/page.tsx` and `app/souls/[id]/page.tsx` each
 * carried a `STATE_COLORS` map; `diff` of the two ranges exited 0. Both painted
 * DISPOSED and LOST with the identical `--color-surface-3` / `--color-ink-muted`
 * pair, so two of six states were indistinguishable from each other and from a
 * state the UI does not recognise — while `--color-status-disposed` and
 * `--color-status-lost` sat declared in globals.css and used by neither page.
 * `app/ledger/page.tsx::STATE_DOT` had the same defect, was fixed, and the fix
 * reached neither copy.
 *
 * The distinctness assertion is the one that would have caught it, and it is
 * the one a value-by-value review keeps missing: nothing looks wrong about a
 * line that holds a valid class string.
 *
 * NO CLASS NAME IS WRITTEN OUT IN THIS FILE. tailwind.config.js scans
 * `./src/**` — tests included — so a utility spelled here becomes a real CSS
 * rule. The utilities are parsed apart instead, the way
 * `statusTokenLayering.test.ts` does it and for the same reason.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  SOUL_STATE_BADGE_CLASSES,
  SOUL_STATE_GLYPH,
  UNKNOWN_SOUL_STATE_BADGE_CLASS,
  soulStateBadgeClass,
} from "@/src/lib/soulStateBadge";
import { VERDICT_BADGE_CLASSES, VERDICT_GLYPH } from "@/src/lib/verdictGlyph";
import { ROOT_TOKENS, readSoulStates } from "./support/globalsCssTokens";

/** `{utility: [token, alpha]}` for every `x-[oklch(var(--t)/a)]` in a class string. */
function utilities(classes: string): Record<string, [string, string]> {
  const out: Record<string, [string, string]> = {};
  for (const m of classes.matchAll(/(\w[\w-]*)-\[oklch\(var\((--[\w-]+)\)(?:\/([\d.]+))?\)\]/g)) {
    out[m[1]] = [m[2], m[3] ?? "1"];
  }
  return out;
}

const STATES = readSoulStates();

describe("the table covers the states the API can actually send", () => {
  it("has exactly the `Soul.current_state` union as its keys", () => {
    // Read out of packages/core/src/api/souls.ts rather than listed here: a
    // seventh state added to the contract has to be given a colour, not
    // silently fall to the unknown-state fill.
    expect(Object.keys(SOUL_STATE_BADGE_CLASSES).sort()).toEqual([...STATES].sort());
    expect(STATES.length).toBe(6);
  });
});

/**
 * 规范 v2 补足 C15 / B8 推翻了 v1「每个状态穿自己的颜色」:领域枚举徽章一律 ink 字 +
 * 1px ink3 框,**颜色不参与**;「还要处理」的两种(灵魂「审判中」= 样张的「待审」、
 * 判决「待定」)加 s2 底。区分全靠字形与文字 —— 所以 v1 那条「六个状态六种颜色」
 * 的断言改成了「六个状态六个字形」,而颜色这一侧改成断言**缺席**:任何
 * `--color-status-*` / `--color-verdict-*` / 危险色回到徽章里都是红的。
 */
const INK = ["--color-ink", "1"];
const INK3 = ["--color-line-strong", "1"];
const S2 = ["--color-surface-2", "1"];
const PENDING_STATES = ["JUDGING"];
const PENDING_VERDICTS = ["PURGATORY"];

describe("domain badges carry no status colour (C15)", () => {
  it.each(readSoulStates())("%s is ink on an ink3 frame", (state) => {
    const found = utilities(SOUL_STATE_BADGE_CLASSES[state as keyof typeof SOUL_STATE_BADGE_CLASSES]);
    expect(found.text).toEqual(INK);
    expect(found.border).toEqual(INK3);
    // Equality on the key set: "ink is present" stays true while a status fill sits beside it.
    const pending = PENDING_STATES.includes(state);
    expect(Object.keys(found).sort()).toEqual(pending ? ["bg", "border", "text"] : ["border", "text"]);
    if (pending) expect(found.bg).toEqual(S2);
  });

  it.each(Object.keys(VERDICT_BADGE_CLASSES))("verdict %s is ink on an ink3 frame, ✕ included", (verdict) => {
    const found = utilities(VERDICT_BADGE_CLASSES[verdict as keyof typeof VERDICT_BADGE_CLASSES]);
    expect(found.text).toEqual(INK);
    expect(found.border).toEqual(INK3);
    const pending = PENDING_VERDICTS.includes(verdict);
    expect(Object.keys(found).sort()).toEqual(pending ? ["bg", "border", "text"] : ["border", "text"]);
  });

  it("no badge class names a status, verdict or danger token", () => {
    const all = [...Object.values(SOUL_STATE_BADGE_CLASSES), ...Object.values(VERDICT_BADGE_CLASSES)].join(" ");
    expect(all).not.toMatch(/--color-(status|verdict|danger|success|warning|accent|chart)/);
  });
});

describe("glyphs carry the distinction colour no longer does", () => {
  it("every state has its own glyph, and no two share one", () => {
    const glyphs = STATES.map((s) => SOUL_STATE_GLYPH[s as keyof typeof SOUL_STATE_GLYPH]);
    expect(glyphs.every(Boolean)).toBe(true);
    expect(new Set(glyphs).size).toBe(STATES.length);
  });

  it("draws C15's glyphs for the real enum", () => {
    expect(SOUL_STATE_GLYPH).toEqual({ ALIVE: "○", JUDGING: "◇", DISPOSED: "▣", REINCARNATING: "↻", LOST: "◌", SETTLED: "◎" });
    expect(VERDICT_GLYPH).toEqual({ PASSED: "✓", FAILED: "✕", PURGATORY: "◇", RETRY: "↺" });
  });

  // 灵魂详情页把判决与状态画在同一页。C15 两处都画 ◇,意思都是「还要处理」,
  // 且都带 s2 底 —— 那是唯一允许的共用字形;别的相交会让两件事读成一件。
  it("verdicts and states share only ◇, and only between the two pending values", () => {
    const stateGlyphs = new Set(Object.values(SOUL_STATE_GLYPH));
    const shared = Object.values(VERDICT_GLYPH).filter((g) => stateGlyphs.has(g));
    expect(shared).toEqual(["◇"]);
    expect(SOUL_STATE_GLYPH.JUDGING).toBe("◇");
    expect(VERDICT_GLYPH.PURGATORY).toBe("◇");
  });
});


describe("the unknown-state fill is not one of the six", () => {
  it("names neither a lifecycle token nor any state's colour", () => {
    expect(Object.values(SOUL_STATE_BADGE_CLASSES)).not.toContain(UNKNOWN_SOUL_STATE_BADGE_CLASS);
    for (const [, [token]] of Object.entries(utilities(UNKNOWN_SOUL_STATE_BADGE_CLASS))) {
      expect(ROOT_TOKENS[token]).toBeDefined();
      expect(token.startsWith("--color-status-")).toBe(false);
    }
  });

  it("is what an absent or unrecognised state resolves to", () => {
    // The detail page used to fall back to `"ALIVE"`, so a soul that failed to
    // load wore a living soul's green beside the words for 「未记录」.
    expect(soulStateBadgeClass(undefined)).toBe(UNKNOWN_SOUL_STATE_BADGE_CLASS);
    expect(soulStateBadgeClass(null)).toBe(UNKNOWN_SOUL_STATE_BADGE_CLASS);
    expect(soulStateBadgeClass("ASCENDED")).toBe(UNKNOWN_SOUL_STATE_BADGE_CLASS);
    expect(soulStateBadgeClass("alive")).toBe(UNKNOWN_SOUL_STATE_BADGE_CLASS);
  });

  it("still resolves every real state to that state's classes", () => {
    for (const state of STATES) {
      expect(soulStateBadgeClass(state)).toBe(
        SOUL_STATE_BADGE_CLASSES[state as keyof typeof SOUL_STATE_BADGE_CLASSES]
      );
    }
  });
});

describe("the two pages read this table rather than carrying their own", () => {
  it.each(["app/souls/page.tsx", "app/souls/[id]/page.tsx"])("%s declares no state colour map", (file) => {
    // The merge is the thing that made the collapse visible; a copy growing
    // back would hide it again, and neither page would fail anything.
    const source = readFileSync(path.join(__dirname, "..", "..", file), "utf8");
    expect(source).not.toMatch(/^const STATE_COLORS\b/m);
    expect(source).toContain("soulStateBadgeClass");
  });
});
