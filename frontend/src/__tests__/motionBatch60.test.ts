/**
 * @jest-environment node
 *
 * Design v4 batch 60 on the web, read as text (jsdom runs no CSS animations):
 *   P3 — a choreography's steps use only 80 / 160 / 240 / 320 (the seal's 200 excepted), their starts are 40 apart
 *        (`--transition-duration-stagger`, motion.choreography), and the whole, first start to last end, is ≤ 480
 *        (motion.choreography-max). Every rule that staggers by `--i` or by the stagger token is in the list below.
 *   P5 — the case desk's row slide-out is strike 80 → slide + fade 160 on the exit curve → collapse 160, 400 in all,
 *        and that is SEAL_LEAVE_MS.
 * Mutations seen red: the journey's `min(var(--i, 0), 4)` → `var(--i, 0)` (cap); the route row's stagger token →
 * `--transition-duration-press` (stagger); the desk's slide `--transition-duration-fast` → `200ms` (row-out).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { GLOBALS_CSS } from "./support/globalsCssTokens";

const FRONTEND = path.join(__dirname, "..", "..");
const CSS = readFileSync(GLOBALS_CSS, "utf8");
const DESK = readFileSync(path.join(FRONTEND, "src/components/desk/desk.module.css"), "utf8");
// SEAL_LEAVE_MS, read from source: importing CaseDesk pulls the whole desk into a node test.
const SEAL_LEAVE_MS = Number(/export const SEAL_LEAVE_MS = (\d+);/.exec(readFileSync(path.join(FRONTEND, "src/components/desk/CaseDesk.tsx"), "utf8"))?.[1]);
const { motionTokens } = require(path.join(FRONTEND, "..", "mobile", "src", "theme.generated")) as { motionTokens: Record<string, number> };

const TIERS = new Set([80, 160, 240, 320]);
const SEAL = 200;

const declared = (name: string) => {
  const m = new RegExp(`^\\s*${name}: (\\d+)ms;`, "m").exec(CSS);
  if (!m) throw new Error(`${name} is not declared in ms in globals.css`);
  return Number(m[1]);
};

/** A CSS time (`160ms`, `0.3s`, `var(--transition-duration-x)`, `calc(min(var(--i, 0), 4) * var(--…) + var(--…))`) in ms. */
function ms(expr: string, i = 0): number {
  const src = expr
    .replace(/min\(var\(--i, 0\), (\d+)\)/g, (_, n) => String(Math.min(i, Number(n))))
    .replace(/var\(--i, 0\)/g, String(i))
    .replace(/var\((--transition-duration-[\w-]+)\)/g, (_, v) => String(declared(v)))
    .replace(/(\d+(?:\.\d+)?)ms/g, "$1")
    .replace(/(\d+(?:\.\d+)?)s\b/g, (_, s) => String(Number(s) * 1000))
    .replace(/calc/g, "");
  if (!/^[\d\s.+*()-]+$/.test(src)) throw new Error(`cannot read the time ${expr} (${src})`);
  return Function(`return (${src});`)() as number;
}

/** Top-level space split, keeping `calc(…)` / `cubic-bezier(…)` whole. */
function words(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s.trim()) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

const isTime = (w: string) => /^(\d+(\.\d+)?m?s|var\(--transition-duration-[\w-]+\)|calc\(.*\))$/.test(w);

function body(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no rule \`${selector}\``);
  return css.slice(at + selector.length + 2, css.indexOf("}", at));
}

/** Each animation of a rule: its duration and delay expressions (an `animation-delay` line overrides). */
function animations(css: string, selector: string): { dur: string; delay: string }[] {
  const b = body(css, selector);
  const shorthand = /animation:\s*([^;]+);/.exec(b)?.[1];
  if (!shorthand) throw new Error(`\`${selector}\` has no animation`);
  const own = /animation-delay:\s*([^;]+);/.exec(b)?.[1];
  return shorthand.split(/,\s*(?![^(]*\))/).map((one) => {
    const times = words(one).filter(isTime);
    return { dur: times[0], delay: own ?? times[1] ?? "0ms" };
  });
}

type Step = { start: number; dur: number };
/** A choreography: fixed steps, or one rule played by every `--i` (here 0–11, more than any list draws). */
const CHOREOGRAPHIES: Record<string, () => Step[]> = {
  "landing emblem: line, then ticks": () =>
    [".emblem-fx .emblem2 :is(.e-l, .e-l2, .e-halo):not([class*=\"em2-\"])", ".emblem-fx .emblem2 .e-t:not([class*=\"em2-\"])"].map((sel) => {
      const [a] = animations(CSS, sel);
      return { start: ms(a.delay), dur: ms(a.dur) };
    }),
  "goodbye: title, line, status": () =>
    [".goodbye-title", ".goodbye-line", ".goodbye-status"].map((sel) => {
      const [a] = animations(CSS, sel);
      return { start: ms(a.delay), dur: ms(a.dur) };
    }),
  "route row, segment by segment": () => indexed(".route-row .route-walked"),
  "journey, segment by segment": () => indexed(".journey-walked"),
};
function indexed(sel: string): Step[] {
  const [a] = animations(CSS, sel);
  return Array.from({ length: 12 }, (_, i) => ({ start: ms(a.delay, i), dur: ms(a.dur, i) }));
}

describe("P3: choreography — four tiers, 40 apart, ≤ 480", () => {
  it("the token: 40 stagger, 480 cap, on both outputs", () => {
    expect(declared("--transition-duration-stagger")).toBe(40);
    expect(motionTokens.choreography).toBe(40);
    expect(motionTokens.choreographyMax).toBe(480);
  });

  describe.each(Object.entries(CHOREOGRAPHIES))("%s", (_name, steps) => {
    it("each step is 80 / 160 / 240 / 320 (or the seal's 200)", () => {
      expect(steps().filter((s) => !TIERS.has(s.dur) && s.dur !== SEAL)).toEqual([]);
    });

    it("the starts are one stagger apart", () => {
      const starts = [...new Set(steps().map((s) => s.start))].sort((a, b) => a - b);
      expect(starts.length).toBeGreaterThan(1);
      expect(starts.slice(1).map((s, k) => s - starts[k])).toEqual(starts.slice(1).map(() => motionTokens.choreography));
    });

    it("first start to last end is at most choreography-max", () => {
      const all = steps();
      const whole = Math.max(...all.map((s) => s.start + s.dur)) - Math.min(...all.map((s) => s.start));
      expect(whole).toBeLessThanOrEqual(motionTokens.choreographyMax);
    });
  });

  it("every rule that staggers is in that list", () => {
    const listed = new Set([".route-row .route-walked", ".journey-walked", ".emblem-fx .emblem2 .e-t:not([class*=\"em2-\"])", ".goodbye-line", ".goodbye-status"]);
    const staggering = [...CSS.matchAll(/(^|\n)([^\n{}]+?) \{([^}]*)\}/g)]
      .filter((m) => /var\(--i\b|--transition-duration-stagger\)/.test(m[3]) && /animation/.test(m[3]))
      .map((m) => m[2].trim());
    expect(staggering.filter((sel) => !listed.has(sel))).toEqual([]);
    expect(staggering.length).toBe(listed.size);
  });
});

describe("P5: the case desk's row slide-out is 80 / 160 / 160, 400 in all", () => {
  const strike = animations(DESK, ".row[data-leaving] .rowName::after");
  const [out, collapse] = animations(DESK, ".row[data-leaving]");
  const [li] = animations(DESK, ".rows li:has(> .row[data-leaving])");

  it("strike 80, then slide + fade 160 on the exit curve, then collapse 160", () => {
    expect([ms(strike[0].dur), ms(strike[0].delay)]).toEqual([80, 0]);
    expect([ms(out.dur), ms(out.delay)]).toEqual([160, 80]);
    expect(body(DESK, ".row[data-leaving]")).toMatch(/desk-row-out var\(--transition-duration-fast\) var\(--ease-exit\)/);
    expect([ms(collapse.dur), ms(collapse.delay)]).toEqual([160, 240]);
    expect([ms(li.dur), ms(li.delay)]).toEqual([160, 240]);
    // Absence: batch 46's 200 middle step.
    expect(DESK).not.toMatch(/desk-row-out 200ms/);
  });

  it("ends when CaseDesk takes the row off the stack (SEAL_LEAVE_MS)", () => {
    expect(ms(collapse.delay) + ms(collapse.dur)).toBe(SEAL_LEAVE_MS);
    expect(SEAL_LEAVE_MS).toBe(400);
  });
});
