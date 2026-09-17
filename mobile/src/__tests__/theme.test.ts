import fs from "fs";
import path from "path";

import { OKLCH, oklchToHex, paletteFor, type CivCode, type ColorScheme } from "../theme";

/** Last declaration of `name` in a block whose selector is exactly `selector`, comments stripped. */
function declared(css: string, selector: string, name: string): string | undefined {
  let found: string | undefined;
  for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (block[1].trim().replace(/\s+/g, " ") !== selector) continue;
    for (const decl of block[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      if (decl[1] === name) found = decl[2].trim();
    }
  }
  return found;
}

const css = fs
  .readFileSync(path.join(__dirname, "..", "..", "..", "frontend", "app", "globals.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

const ROOT: Record<ColorScheme, string> = { dark: ":root", light: ".light" };
const NEUTRAL: Record<ColorScheme, string> = { dark: ":root:not([data-civ])", light: ".light:not([data-civ])" };
const CIVS: CivCode[] = ["cn", "eu", "eg", "gr"];

describe.each(["dark", "light"] as ColorScheme[])("the %s table is the web's ink layer", (scheme) => {
  const table = OKLCH[scheme];

  it("shared inks", () => {
    const names = {
      ink: "--color-ink",
      inkMuted: "--color-ink-muted",
      inkSubtle: "--color-ink-subtle",
      hairline: "--color-hairline",
      error: "--color-status-error",
      success: "--color-status-success",
    } as const;
    for (const [key, name] of Object.entries(names)) {
      expect([key, table.shared[key as keyof typeof names]]).toEqual([key, declared(css, ROOT[scheme], name)]);
    }
  });

  it("the neutral ground (no civilization known)", () => {
    expect(table.neutral.canvas).toBe(declared(css, NEUTRAL[scheme], "--color-canvas"));
    expect(table.neutral.surface1).toBe(declared(css, NEUTRAL[scheme], "--color-surface-1"));
    expect(table.neutral.surface2).toBe(declared(css, NEUTRAL[scheme], "--color-surface-2"));
    expect(table.neutral.accent).toBe(declared(css, ROOT[scheme], "--civ-ink"));
    expect(table.neutral.mark).toBe(declared(css, ":root", "--civ-mark"));
  });

  it.each(CIVS)("civilization %s", (civ) => {
    const token = { canvas: "canvas", surface1: "surface-1", surface2: "surface-2", accent: "ink", mark: "mark" };
    for (const [key, part] of Object.entries(token)) {
      const expected = declared(css, ROOT[scheme], `--color-civ-${part}-${civ}`);
      expect(expected).toBeDefined();
      expect([key, table[civ][key as keyof typeof token]]).toEqual([key, expected]);
    }
  });
});

describe("paletteFor", () => {
  it("skins by the soul's civilization", () => {
    expect(paletteFor("CHINESE", "dark").canvas).toBe(oklchToHex(OKLCH.dark.cn.canvas));
    expect(paletteFor("EGYPTIAN", "light").accent).toBe(oklchToHex(OKLCH.light.eg.accent));
    expect(paletteFor("GREEK", "dark").civ).toBe("gr");
    expect(paletteFor("EUROPEAN", "dark").civ).toBe("eu");
  });

  it("gives four different grounds, none of them the neutral one", () => {
    const canvases = ["CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK"].map((c) => paletteFor(c, "dark").canvas);
    expect(new Set(canvases).size).toBe(4);
    expect(canvases).not.toContain(paletteFor(null, "dark").canvas);
  });

  it("an unknown civilization gets the neutral ground, not another civilization's", () => {
    const unknown = paletteFor("ATLANTEAN", "dark");
    expect(unknown.civ).toBeNull();
    expect(unknown.canvas).toBe(oklchToHex(OKLCH.dark.neutral.canvas));
  });
});

describe("oklchToHex", () => {
  it("hits the fixed points", () => {
    expect(oklchToHex("1 0 0")).toBe("#ffffff");
    expect(oklchToHex("0 0 0")).toBe("#000000");
    // CSS Color 4 reference: oklch(0.627955 0.257683 29.2339) is sRGB red.
    expect(oklchToHex("0.627955 0.257683 29.2339")).toBe("#ff0000");
  });
});
