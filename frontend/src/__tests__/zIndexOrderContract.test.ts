/**
 * 层级顺序(v3 令牌表 Z-index):吸顶 20 / 导航 30 / Toast 50 / 抽屉 60 / 弹窗 70 / 盖印确认 80。
 *
 * 读 `app/globals.css` 的 `@theme` 里那排 `--z-index-*`,断的是**数值**与**顺序**:Toast 在抽屉与弹窗
 * 之下(此前是 90,压在弹窗之上),确认层在弹窗之上;v3 没有的两档(移动端导航面板、进度条)
 * 只断它们夹在哪两档之间。
 */
import { readFileSync } from "node:fs";
import { GLOBALS_CSS } from "./support/globalsCssTokens";

const CSS = readFileSync(GLOBALS_CSS, "utf8");

const z = (name: string): number => {
  const m = new RegExp(`--z-index-${name}:\\s*(\\d+);`).exec(CSS);
  if (!m) throw new Error(`--z-index-${name} not declared in globals.css`);
  return Number(m[1]);
};

describe("z-index 令牌(v3)", () => {
  it("六档就是 v3 的数", () => {
    expect({
      sticky: z("sticky"),
      masthead: z("masthead"),
      toast: z("toast"),
      drawer: z("drawer"),
      dialog: z("dialog"),
      confirm: z("confirm"),
    }).toEqual({ sticky: 20, masthead: 30, toast: 50, drawer: 60, dialog: 70, confirm: 80 });
  });

  it("筛选栏是吸顶那一档,遮罩与顶栏是导航那一档", () => {
    expect(z("filters")).toBe(z("sticky"));
    expect(z("scrim")).toBe(z("masthead"));
  });

  it("Toast 压在导航之上、抽屉与弹窗之下;v3 没有的两档夹在原来的位置", () => {
    expect(z("masthead")).toBeLessThan(z("sidebar"));
    expect(z("sidebar")).toBeLessThan(z("toast"));
    expect(z("sidebar")).toBeLessThan(z("progress"));
    expect(z("progress")).toBeLessThan(z("drawer"));
    expect(z("toast")).toBeLessThan(z("drawer"));
    expect(z("toast")).toBeLessThan(z("dialog"));
  });
});
