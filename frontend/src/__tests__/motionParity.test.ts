/**
 * @jest-environment node
 *
 * One general motion set on all three surfaces (shaped like sealMotionTokens.test.ts).
 *
 * The durations and curves come from packages/core/tokens/semantic.tokens.json (`ease`, `transition-duration`,
 * `motion`): scripts/build-tokens.mjs writes the web's --ease-* / --transition-duration-* in globals.css and the apps'
 * `motionTokens` in mobile/src/theme.generated.ts (`build-tokens --check` fails on a stale output). What this holds is
 * what the generator cannot see: that each named use the web composes in an --animate-* line or a component rule is
 * the number the apps' `motion` plays for the same use, that no app transition sits off the web's set, and that the
 * apps carry no curve of their own.
 *
 * Read as text: jsdom runs no CSS animations. Mutations seen red: `sheetOut: m.sheetOut` → `180` in theme.ts (the
 * sheet-out pair and the tier set); `fade: m.reveal` → `120` (the reveal pair and the tier set); a literal
 * `Easing.bezier(0, 0, 0.2, 1)` back in feedback.tsx (the no-own-curve check); the row-changed keyframe stop `80%` →
 * `70%` (the highlight recipe).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { HIGHLIGHT_MS } from "@/src/hooks/useRowTransitions";
import { GLOBALS_CSS } from "./support/globalsCssTokens";

const CSS = readFileSync(GLOBALS_CSS, "utf8");
const REPO = path.join(__dirname, "..", "..", "..");
// The apps' table, as they play it (theme.ts maps the generated values onto the names the screens read). Required by
// path: the frontend tsconfig's rootDir stops a static import of mobile/, and jest transforms the file either way.
const { curves, motion } = require(path.join(REPO, "mobile", "src", "theme")) as {
  curves: Record<string, readonly number[]>;
  motion: Record<string, number>;
};

const declared = (name: string) => {
  const m = new RegExp(`^\\s*${name}: ([^;]+);`, "m").exec(CSS);
  if (!m) throw new Error(`${name} is not declared in globals.css`);
  return m[1].trim();
};
const ms = (v: string) => (v.endsWith("ms") ? Number(v.slice(0, -2)) : Number(v.slice(0, -1)) * 1000);
/** The duration a CSS value plays: its first `var(--transition-duration-x)`, resolved. */
const playsFor = (value: string) => {
  const m = /var\((--transition-duration-[\w-]+)\)/.exec(value);
  if (!m) throw new Error(`no duration token in ${value}`);
  return ms(declared(m[1]));
};
const animate = (name: string) => playsFor(declared(`--animate-${name}`));
const rule = (re: RegExp) => {
  const m = re.exec(CSS);
  if (!m) throw new Error(`${re} matches nothing in globals.css`);
  return playsFor(m[0]);
};
const webDurations = new Set(
  [...CSS.matchAll(/^\s*--transition-duration-[\w-]+: ([^;]+);/gm)].map((m) => ms(m[1].trim()))
);

describe("each named use: the web's composition is the apps' number", () => {
  it.each([
    ["sheet in (web drawer-in)", () => animate("drawer-in"), motion.sheetIn],
    ["sheet out (web drawer-out): 160, not 180", () => animate("drawer-out"), motion.sheetOut],
    ["toast in", () => rule(/animation: toast-in var\(--transition-duration-[\w-]+\)/), motion.toastIn],
    ["toast out", () => rule(/opacity var\(--transition-duration-[\w-]+\) var\(--ease-exit\),\s*transform/), motion.toastOut],
    ["collapse in (row-expand) = a section's body", () => animate("row-expand"), motion.sectionIn],
    ["collapse in (row-expand) = a ledger row's growth", () => animate("row-expand"), motion.sectionGrow],
    ["collapse out (row-collapse)", () => animate("row-collapse"), motion.sectionOut],
    ["page / tab change", () => animate("page-enter"), motion.tabFade],
    ["skeleton → content", () => animate("content-in"), motion.fade],
    ["highlight, in all", () => animate("row-changed"), motion.highlight],
    ["loading line (search progress)", () => animate("search-progress"), motion.loadingLine],
    ["loading line (the page wait's top line)", () => rule(/animation: page-head-progress var\(--transition-duration-[\w-]+\)/), motion.loadingLine],
  ])("%s", (_name, web, app) => {
    expect(web()).toBe(app);
  });

  it("the values Design set: sheet 240 / 160, toast 160 / 140, highlight 2000", () => {
    expect([motion.sheetIn, motion.sheetOut, motion.toastIn, motion.toastOut, motion.highlight]).toEqual([240, 160, 160, 140, 2000]);
  });
});

describe("no app transition is off the web's set", () => {
  // Sequences and waits Design numbered on their own: a hold is not a transition, and the cold start, the welcome and the
  // Loader's breath are single choreographies (C18, the welcome, 文明气质 1h). The landing fade is the tail of `highlight`.
  const OWN = new Set([
    "toastHold",
    "toastInfoHold",
    "breath",
    "welcomeIn",
    "welcomeHold",
    "welcomeOut",
    "coldStartDraw",
    "coldStartHold",
    "coldStartInteractive",
    "coldStart",
    "pullMinHold",
    "pullSpin",
    "highlightFade",
  ]);
  it.each(Object.entries(motion).filter(([k]) => !OWN.has(k)))("%s (%d ms)", (_k, v) => {
    expect(webDurations).toContain(v);
  });
});

describe("curves", () => {
  it.each(Object.entries(curves))("%s is the web's --ease-%s", (name, c) => {
    expect(declared(`--ease-${name}`)).toBe(`cubic-bezier(${c.join(", ")})`);
  });

  it("the old enter curve (0,0,.2,1) is gone", () => {
    expect(curves.enter).toEqual([0.2, 0.8, 0.2, 1]);
  });

  it("no app source writes a curve of its own (the cold start's write stroke excepted, C18)", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = path.join(dir, f);
        if (f === "__tests__" || f === "node_modules") continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f)) files.push(p);
      }
    };
    walk(path.join(REPO, "mobile", "src"));
    walk(path.join(REPO, "mobile-officer", "src"));
    expect(files.length).toBeGreaterThan(50);
    const own = files.flatMap((f) =>
      [...readFileSync(f, "utf8").matchAll(/^.*bezier\(\s*\d.*$/gm)].map((m) => `${path.relative(REPO, f)}: ${m[0].trim()}`)
    );
    expect(own).toEqual(["mobile/src/coldStartView.tsx: const EASE_WRITE = Easing.bezier(0.4, 0, 0.2, 1);"]);
  });
});

describe("the changed-row / landing highlight: one recipe, 2 s", () => {
  it("the web's row-changed holds until (highlight − fade) / highlight, then fades", () => {
    const frames = /@keyframes row-changed \{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? "";
    const hold = ((motion.highlight - motion.highlightFade) / motion.highlight) * 100;
    expect(hold).toBe(80);
    expect(frames).toMatch(new RegExp(`from,\\s*${hold}% \\{`));
    expect(frames).toMatch(/to \{\s*background-color: transparent;/);
  });

  it("the row hook drops the class when the animation ends", () => {
    expect(HIGHLIGHT_MS).toBe(motion.highlight);
  });
});
