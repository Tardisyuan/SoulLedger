/**
 * @jest-environment node
 *
 * Hand-written CSS hovers only where a mouse is (ux-motion-web rule 18, B3, 2026-11-26).
 *
 * Tailwind 4 already wraps every `hover:` utility in `@media (hover: hover)`. The hand-written CSS is not wrapped
 * for free: on a touch screen a bare `:hover` sticks after a tap, so the row or tab stays lit until the next tap
 * lands elsewhere. The audit found 10 such rules; they were wrapped in `@media (hover: hover) and (pointer: fine)`.
 * This keeps them there: every selector with `:hover` in a `.css` file under frontend/ must sit inside that
 * media query, or be listed below with a reason.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const WEB = path.join(__dirname, "..", "..");
const SKIP = new Set(["node_modules", ".next", "coverage", "e2e", "public", "out"]);
const FINE_POINTER = /@media[^{]*\(\s*hover\s*:\s*hover\s*\)\s*and\s*\(\s*pointer\s*:\s*fine\s*\)/;

/** `file :: selector` (whitespace collapsed) → why it may hover bare. */
const ALLOWED: Record<string, string> = {
  "app/globals.css :: ::-webkit-scrollbar-thumb:hover":
    "a scrollbar thumb is only ever dragged with a pointer that has one; touch scrollbars are overlays that never take this style",
  "app/globals.css :: .kpi-fx, .kpi-fx:hover":
    "inside prefers-reduced-motion: it only takes the hover lift away, it never adds a hover style",
  "src/components/layout/doors.module.css :: .door[aria-current=\"page\"], .door[aria-current=\"true\"], .door:hover":
    "narrow-screen bottom bar: it only takes the (fine-pointer) hover fill away, it never adds a hover style",
};

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...cssFiles(full));
    else if (entry.name.endsWith(".css")) out.push(full);
  }
  return out;
}

/** Every rule prelude with `:hover`, and whether a fine-pointer `@media` encloses it. */
function hoverRules(css: string): { selector: string; wrapped: boolean }[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const stack: string[] = [];
  const found: { selector: string; wrapped: boolean }[] = [];
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "{") {
      const prelude = src.slice(start, i).replace(/\s+/g, " ").trim();
      if (!prelude.startsWith("@") && prelude.includes(":hover")) {
        found.push({ selector: prelude, wrapped: stack.some((p) => FINE_POINTER.test(p)) });
      }
      stack.push(prelude);
      start = i + 1;
    } else if (c === "}") {
      stack.pop();
      start = i + 1;
    } else if (c === ";") {
      start = i + 1;
    }
  }
  return found;
}

const FOUND = cssFiles(WEB).flatMap((full) => {
  const file = path.relative(WEB, full);
  return hoverRules(readFileSync(full, "utf8")).map((r) => ({ key: `${file} :: ${r.selector}`, ...r }));
});

describe("hand-written :hover sits inside @media (hover: hover) and (pointer: fine)", () => {
  it("found the hover rules at all (the walker reads the files it should)", () => {
    expect(FOUND.filter((r) => r.wrapped).length).toBeGreaterThanOrEqual(8);
  });

  it("no bare :hover outside the allow-list", () => {
    expect(FOUND.filter((r) => !r.wrapped && !(r.key in ALLOWED)).map((r) => r.key)).toEqual([]);
  });

  it("every allow-list entry is still a bare :hover — an exemption for nothing is stale", () => {
    const bare = new Set(FOUND.filter((r) => !r.wrapped).map((r) => r.key));
    expect(Object.keys(ALLOWED).filter((k) => !bare.has(k))).toEqual([]);
  });

  it("the walker tells wrapped from bare, nested media included", () => {
    expect(
      hoverRules(`
        a:hover { color: red }
        @media (max-width: 768px) { b:hover { x: y } @media (hover: hover) and (pointer: fine) { c:hover { x: y } } }
        @media (hover: hover) { d:hover { x: y } }
      `)
    ).toEqual([
      { selector: "a:hover", wrapped: false },
      { selector: "b:hover", wrapped: false },
      { selector: "c:hover", wrapped: true },
      { selector: "d:hover", wrapped: false },
    ]);
  });
});
