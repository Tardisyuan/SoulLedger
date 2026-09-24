/**
 * Token contract for the shared data-grid's enum badges.
 *
 * History: the badges used to be a 10 % tint of their status token, and the
 * light-mode status tokens were re-measured against exactly that tint depth —
 * a 16 % fill (d5af1e9) dropped error text to 4.37:1. 规范 v1 §2 removed the
 * fill: a badge is its text colour plus a same-colour 1 px border, over the
 * row's own ground. So the contract is now:
 *
 * - no tone declares a background at all (a fill is the thing that could
 *   silently pull text under AA again);
 * - the text and the border name the same token, and it is a declared token;
 * - that token is one inkOnSurfaceContract measures on every text ground
 *   (≥ 4.5:1), so the grid's badges inherit that proof instead of restating it.
 */
import { ENUM_TONE_CLASSES } from "@/components/ui/data-grid/columns";

import { ROOT_TOKENS } from "./support/globalsCssTokens";

/** The text colours inkOnSurfaceContract holds to AA on canvas / surface-1 / surface-2. */
const MEASURED_TEXT = new Set([
  "--color-ink",
  "--color-ink-muted",
  "--color-ink-subtle",
  "--color-accent",
  "--color-danger",
  "--color-success",
  "--color-warning",
]);

const TONES = Object.entries(ENUM_TONE_CLASSES);
const tokenOf = (prefix: "text" | "border", classes: string) =>
  new RegExp(`${prefix}-\\[oklch\\(var\\((--[\\w-]+)\\)\\)\\]`).exec(classes)?.[1];

/** Follow one alias hop (`--color-status-error` → `--color-danger`). */
const canonical = (token: string) => /^var\((--[\w-]+)\)$/.exec(ROOT_TOKENS[token] ?? "")?.[1] ?? token;

describe("data-grid enum badge token contract", () => {
  it("has the grid's five tones (an emptied map would pass everything)", () => {
    expect(TONES.map(([tone]) => tone).sort()).toEqual(["error", "info", "neutral", "success", "warning"]);
  });

  it.each(TONES)("tone %s declares no background", (_tone, classes) => {
    expect(classes).not.toMatch(/\bbg-/);
  });

  it.each(TONES)("tone %s draws text and border in one declared token", (_tone, classes) => {
    const text = tokenOf("text", classes);
    expect(text).toBeDefined();
    expect(tokenOf("border", classes)).toBe(text);
    expect(ROOT_TOKENS[text!]).toBeDefined();
  });

  it.each(TONES)("tone %s uses a text colour whose contrast is measured", (_tone, classes) => {
    expect(MEASURED_TEXT.has(canonical(tokenOf("text", classes)!))).toBe(true);
  });
});
