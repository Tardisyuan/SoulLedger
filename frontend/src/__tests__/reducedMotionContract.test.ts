/**
 * @jest-environment node
 *
 * The operator who asked their OS to reduce motion gets what they asked for.
 *
 * WHAT WENT UNCAUGHT. Measured 2026-09-01: the stylesheet shipped **159
 * transition utilities, 24 `animate-pulse` skeletons and 8 `animate-spin`
 * spinners**, four `motion-reduce:` utilities in the entire component tree, and
 * **not one `prefers-reduced-motion` block**. Every skeleton pulsed and every
 * spinner turned regardless of the preference, on a console people sit in front
 * of all day. Nothing was red, because nothing was looking.
 *
 * WHY THE RULE COLLAPSES INSTEAD OF REMOVING. `animation: none` and
 * `transition: none` stop `animationend` / `transitionend` from ever firing,
 * and @headlessui's panels wait for exactly those events before unmounting —
 * so the version of this rule that "just turns motion off" leaves dialogs
 * mounted forever for the users who most need them to behave. 1ms is one
 * frame: imperceptible, and the events still fire.
 *
 * READ AS TEXT. The rule is a media query over the universal selector; there
 * is no token to import and no component to render that would prove it. jsdom
 * does not evaluate media queries, so a render test here would assert nothing.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const CSS = readFileSync(
  path.join(__dirname, "..", "..", "app", "globals.css"),
  "utf8"
);

/** The `@media (prefers-reduced-motion: reduce)` block that carries `*`. */
function universalReducedMotionBlock(): string | null {
  const re = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g;
  for (const match of CSS.matchAll(re)) {
    // Walk braces from the block's opening brace to find its end.
    let depth = 0;
    let i = match.index! + match[0].length - 1;
    const start = i;
    for (; i < CSS.length; i++) {
      if (CSS[i] === "{") depth++;
      else if (CSS[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    const body = CSS.slice(start + 1, i);
    if (/(^|\s|,)\*(\s|,|:|\{)/.test(body)) return body;
  }
  return null;
}

describe("the stylesheet honours prefers-reduced-motion", () => {
  it("has a block that reaches every element, not only one component", () => {
    // Before this existed, the single reduced-motion block in the file covered
    // the nprogress bar and nothing else.
    expect(universalReducedMotionBlock()).not.toBeNull();
  });

  it("collapses animation and transition, and the scroll behaviour with them", () => {
    const body = universalReducedMotionBlock() ?? "";
    expect(body).toMatch(/animation-duration:\s*1ms\s*!important/);
    expect(body).toMatch(/animation-iteration-count:\s*1\s*!important/);
    expect(body).toMatch(/transition-duration:\s*1ms\s*!important/);
    // A smooth-scrolled jump is the same vestibular trigger as a slide, and
    // pagination and anchor links do jump.
    expect(body).toMatch(/scroll-behavior:\s*auto\s*!important/);
  });

  it("does NOT use `none`, which would strip the events components wait on", () => {
    const body = universalReducedMotionBlock() ?? "";
    // `animation: none` / `transition: none` never fire animationend /
    // transitionend. @headlessui's Dialog and Transition unmount on those.
    expect(body).not.toMatch(/animation:\s*none/);
    expect(body).not.toMatch(/transition:\s*none/);
    expect(body).not.toMatch(/transition-duration:\s*0s/);
  });

  it("still has motion to suppress, so the rule is not decorative", () => {
    // If these ever hit zero the rule above is dead weight and should be
    // argued for rather than inherited. Counted over the same three source
    // roots the eslint design-guard covers.
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    const root = path.join(__dirname, "..", "..");
    const count = (pattern: string) => {
      try {
        return execFileSync(
          "grep",
          ["-rho", "--include=*.tsx", "-e", pattern, "app", "src", "components"],
          { cwd: root, encoding: "utf8" }
        ).trim().split("\n").filter(Boolean).length;
      } catch {
        return 0;
      }
    };
    expect(count("animate-pulse") + count("animate-spin")).toBeGreaterThan(10);
  });
});

// 落地页主视觉的描线(2026-11-09,emblemFx.ts):纯 CSS 动画,页面一打开就画。上面那条全局规则只把它压到 1ms,
// 而它带 150 / 900ms 的延迟与 `backwards` —— 减少动态效果时延迟里线是藏着的,随后一下冒出来。所以单独取消。
describe("the landing emblem draw-in", () => {
  it("is a CSS animation on the main lines and ticks, cancelled for wait / done and for reduced motion", () => {
    expect(CSS).toMatch(/\.emblem-fx \.emblem2 :is\(\.e-l, \.e-l2\):not\(\[class\*="em2-"\]\) \{\s*animation: emblem-draw /);
    expect(CSS).toMatch(/\.emblem-fx \.emblem2 \.e-t:not\(\[class\*="em2-"\]\) \{\s*animation: emblem-tick-in /);
    expect(CSS).toMatch(/\.emblem2:is\(\.fx-wait, \.fx-done\)[^{]*\{\s*animation-name: none;/);
    const reduced = [...CSS.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join("\n");
    expect(reduced).toMatch(/\.emblem-fx \.emblem2 :is\(\.e-l, \.e-l2, \.e-t\)[^{]*\{\s*animation-name: none;/);
    expect(reduced).toMatch(/\.emblem-sheen \{\s*display: none;/);
  });
});
