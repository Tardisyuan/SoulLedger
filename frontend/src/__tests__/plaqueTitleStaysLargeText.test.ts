/**
 * 匾题字必须始终是 WCAG 意义上的「大号文字」。
 *
 * 为什么这条规则存在。规范 v3 的四个文明匾色里,**深色埃及 #5f7fbe 与深色希腊
 * #5a8480 上的白字达不到 4.5:1** —— 实测 3.99:1 与 4.16:1,与 v3 自己令牌页上
 * 写的两个数逐位相同。v3 没有当它是缺陷,而是把这两格标成「仅 ≥15px 粗体」,
 * 也就是退到 WCAG 的大号文字门槛 3:1。`ledgerPaletteContract` 因此对这两格只
 * 断言 ≥3,并同时断言它确实 <4.5。
 *
 * 那条放松是有代价的,而代价落在这里:**只要匾题字掉到大号文字以下,这两个
 * 文明的页头就成了真正的对比度不足**,而色板那份测试看不见字号,它只量颜色。
 * 在这份测试之前,那个代价只是 globals.css 里的一句注释 —— 一条写下来的约定,
 * 没有任何东西执法。
 *
 * 门槛用 WCAG 的定义,不用 v3 那句「≥15px 粗体」:大号文字 = ≥18.66px(14pt)
 * 常规字重,**或** ≥14px 粗体(≥700)。v3 的说法比 WCAG 严,按它写会让这份
 * 测试拒绝掉本来合规的档位;按 WCAG 写则两种都放行,而 3:1 的前提仍然成立。
 *
 * 读的是 `Plaque.tsx` 的 TIER_CLASS 与 `globals.css` 的字阶,不是抄来的数字:
 * 新加一档、或把某一档的字号调小,这里都会红。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { FRONTEND_ROOT } from "./support/globalsCssTokens";

const CSS = readFileSync(path.join(FRONTEND_ROOT, "app", "globals.css"), "utf8");
const PLAQUE = readFileSync(
  path.join(FRONTEND_ROOT, "src", "components", "plaque", "Plaque.tsx"),
  "utf8",
);

/** `--text-<name>: 20px;` → 20。找不到就抛,不要静默当成 0 放行。 */
function px(name: string): number {
  const m = new RegExp(`^\\s*--text-${name}:\\s*(\\d+(?:\\.\\d+)?)px;`, "m").exec(CSS);
  if (m === null) {
    throw new Error(`--text-${name} 不在 globals.css 里 —— 修这个读取器,不要删掉这条检查`);
  }
  return Number(m[1]);
}

/** 同名的 `--text-<name>--font-weight`,没声明就是继承来的常规字重。 */
function weight(name: string): number {
  const m = new RegExp(`^\\s*--text-${name}--font-weight:\\s*(\\d+);`, "m").exec(CSS);
  return m === null ? 400 : Number(m[1]);
}

/** Plaque.tsx 的 TIER_CLASS 里每一档用的 `text-*` 档名,按档序。 */
function tierScales(): string[] {
  const block = /const TIER_CLASS = \[([\s\S]*?)\] as const;/.exec(PLAQUE);
  if (block === null) {
    throw new Error("Plaque.tsx 里找不到 TIER_CLASS —— 匾改了结构,跟着改这个读取器");
  }
  return block[1]
    .split("\n")
    .map((line) => /\btext-([a-z0-9-]+)\b/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined);
}

/** WCAG 2.2 §1.4.3 的大号文字:≥18.66px 常规,或 ≥14px 粗体。 */
const isLargeText = (size: number, w: number) => size >= 18.66 || (size >= 14 && w >= 700);

describe("匾题字始终是大号文字(深色埃及 / 希腊的白字只有 3:1 可用)", () => {
  const scales = tierScales();

  it("读到了匾的全部三档,而不是零档", () => {
    // 零档会让下面的 it.each 一条都不跑、整份测试照样绿 —— 正是这份测试要防的那种失效。
    expect(scales).toEqual(["display", "xl", "lg"]);
  });

  it.each(scales.map((name, tier) => [tier, name] as const))(
    "第 %s 档(text-%s)够大",
    (_tier, name) => {
      const size = px(name);
      const w = weight(name);
      expect({ name, size, weight: w, large: isLargeText(size, w) }).toEqual({
        name,
        size,
        weight: w,
        large: true,
      });
    },
  );

  it("判据本身是活的:18px 常规不算大号,14px 粗体算", () => {
    // 没有这一条,把 isLargeText 写成 `() => true` 上面全部照样绿。
    expect(isLargeText(18, 400)).toBe(false);
    expect(isLargeText(14, 700)).toBe(true);
    expect(isLargeText(13.9, 700)).toBe(false);
  });
});
