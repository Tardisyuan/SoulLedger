/**
 * @jest-environment node
 *
 * 品牌色两项(Design 第三批回复,2026-10-03):`--brand-mark` #ECAA3D、`--brand-ground` #10120F。
 * 它们只给品牌标、图标、冷启动,所以真正的使用者不在 CSS 里,而在生成出来的图标与 App 冷启动:
 * - `mobile/scripts/build-app-icon.mjs` 从 globals.css 读这两个令牌(不再自带字面量);
 * - 它生成的 `app/icon.svg` 与 `docs/soulledger-mark.svg` 必须正好是这两个颜色;
 * - App 冷启动深色时的金标(`app.splash-mark` 的深色值,第六十一批 一)与令牌同值;浅色加深一级,不在这里。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

function token(name: string): string {
  const m = read("frontend/app/globals.css").match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6});`));
  if (!m) throw new Error(`${name} missing from globals.css`);
  return m[1].toUpperCase();
}

describe("brand tokens", () => {
  const mark = token("--brand-mark");
  const ground = token("--brand-ground");

  it("hold Design's two values", () => {
    expect(mark).toBe("#ECAA3D");
    expect(ground).toBe("#10120F");
  });

  it("are what the icon script reads, not a second copy", () => {
    const src = read("mobile/scripts/build-app-icon.mjs");
    expect(src).toMatch(/GOLD = brandToken\("--brand-mark"\)/);
    expect(src).toMatch(/INK = brandToken\("--brand-ground"\)/);
    expect(src).not.toMatch(/#ECAA3D|#10120F/i);
  });

  it.each(["frontend/app/icon.svg", "docs/soulledger-mark.svg"])("%s is drawn in them", (file) => {
    const svg = read(file);
    const fills = [...svg.matchAll(/(?:fill|color)="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1].toUpperCase());
    expect(new Set(fills)).toEqual(new Set([ground, mark]));
  });

  it("cold start paints the mark in the same gold on dark (the App's splash token, 第六十一批 一)", () => {
    expect(read("mobile/src/theme.ts")).toMatch(new RegExp(`mark: "${mark}"`, "i"));
    const generated = read("mobile/src/theme.generated.ts");
    const dark = generated.match(/export const splash = \{\s*"dark": \{\s*"ground": "(#[0-9A-F]{6})",\s*"mark": "(#[0-9A-F]{6})"/i);
    expect(dark?.[2]?.toUpperCase()).toBe(mark);
    expect(read("mobile/src/coldStart.tsx")).toMatch(/mark=\{pair\.mark\}/);
  });
});
