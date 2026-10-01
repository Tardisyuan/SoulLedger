/**
 * 规范 v3 数据展示层(2026-10-01):领域徽章的框、表格行的悬停 / 选中、批量条的反相。
 *
 * 三件事各守两面:**类名**(该在的在、旧的不在)和**颜色**(新出现的每一对前景 / 底色,
 * 按 globals.css 里两档主题的真实值算,与 `inkOnSurfaceContract.test.ts` 同一套算法)。
 *
 * 渲染路径上的断言在 `SoulsBatchRecycle.test.tsx`(灵魂批量条 + DataTable 选中行)与
 * `JudgmentListPage.test.tsx`(审判队列的批量条与选中行)里;这里放不需要整页的部分。
 *
 * 首版留下的两条已知不合格,2026-10-01 用户拍板后都已处理,这里钉住处理结果:
 *  - 警示色字落在 ink 批量条上只有 深 2.65 / 浅 3.14:1。改为用条本身的字色,意思交给
 *    警示档字形 ◐ + 文字(灵魂批量条「一次只能移交一个」、审判队列「一次最多 100 件」)。
 *  - 浅色、中性皮下,「待我处理」的匾色竖条(civ-neutral)与 v3 选中行的 ink 竖条
 *    1.19:1、ΔE00 4.71,几乎同色。改为选中行**不画竖条**,只靠 7% 底色;行首 3px 竖条
 *    整条让给「待我处理」。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { BATCH_BAR, ROW_HOVER, ROW_SELECTED } from "@/components/ui/data-table";
import { StatusBadge, STATUS_BADGE_BORDER } from "@/src/components/ui/StatusBadge";
import { Button } from "@/src/components/ui/Button";
import {
  FRONTEND_ROOT,
  THEMES,
  TOKENS_BY_THEME,
  contrastRatio,
  deltaE00Rgb,
  mixOklab,
  oklchTripleToRgb,
  resolveTriple,
  type ThemeName,
} from "./support/globalsCssTokens";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "zh-Hans", hydrated: true }),
}));

const AA = 4.5;
const NON_TEXT = 3;
const tok = (theme: ThemeName, name: string) => resolveTriple(TOKENS_BY_THEME[theme], name);
const rgb = (triple: string) => oklchTripleToRgb(triple);
const ratio = (a: string, b: string) => contrastRatio(rgb(a), rgb(b));

/** The two v3 row grounds, mixed the way the browser mixes `color-mix(in oklab, …)`. */
const rowGround = (theme: ThemeName, pct: number) => mixOklab(tok(theme, "--color-ink"), tok(theme, "--color-surface-1"), pct);
/** The inverse button's hover / press grounds: surface-1 mixed into ink. */
const inverseGround = (theme: ThemeName, pct: number) => mixOklab(tok(theme, "--color-surface-1"), tok(theme, "--color-ink"), pct);

describe("row states (v3 .ds-tr)", () => {
  it("hover is ink 4% into surface-1, selected is ink 7% into surface-1 — no stripe, no surface-2, no accent", () => {
    expect(ROW_HOVER).toBe("hover:bg-[color-mix(in_oklab,oklch(var(--color-ink))_4%,oklch(var(--color-surface-1)))]");
    expect(ROW_SELECTED).toBe("bg-[color-mix(in_oklab,oklch(var(--color-ink))_7%,oklch(var(--color-surface-1)))]");
    expect(`${ROW_HOVER} ${ROW_SELECTED}`).not.toMatch(/--color-(main|civ|accent|surface-2)\b/);
  });

  it("a selected row draws no leading stripe — the 3px left bar belongs to「待我处理」alone", () => {
    // 2026-10-01 拍板。v3 的 .ds-tr.selected 带 3px ink inset;在浅色 + 中性皮下它与
    // 「待我处理」的 civ-neutral 竖条几乎同色,所以选中只靠底色。
    expect(ROW_SELECTED).not.toMatch(/shadow|inset|border-l/);
    // 那个理由本身也钉住:如果哪天 civ-neutral 与 ink 拉开了,这里会红,提醒重新评估。
    const ink = rgb(tok("light", "--color-ink"));
    const mine = rgb(tok("light", "--color-civ-neutral"));
    expect(contrastRatio(ink, mine)).toBeLessThan(1.5);
    expect(deltaE00Rgb(ink, mine)).toBeLessThan(10);
  });

  const TEXT = ["--color-ink", "--color-ink-muted", "--color-ink-subtle", "--color-accent", "--color-danger", "--color-success", "--color-warning"];
  const CELLS = THEMES.flatMap((theme) => [4, 7].flatMap((pct) => TEXT.map((fg) => [theme, pct, fg] as const)));

  it("the matrix is the size it should be", () => {
    expect(CELLS).toHaveLength(2 * 2 * 7);
  });

  it.each(CELLS)("%s: text %s%% row ground carries %s at ≥ 4.5:1", (theme, pct, fg) => {
    expect(ratio(tok(theme, fg), rowGround(theme, pct))).toBeGreaterThanOrEqual(AA);
  });

  it.each(THEMES)("%s: selected sits further from rest than hover does", (theme) => {
    const s1 = tok(theme, "--color-surface-1");
    const hov = rowGround(theme, 4);
    const sel = rowGround(theme, 7);
    // Three distinct steps, in order of how far each is from surface-1.
    expect(ratio(sel, s1)).toBeGreaterThan(ratio(hov, s1));
    expect(ratio(hov, s1)).toBeGreaterThan(1);
  });

  it("KNOWN COLLISION: light + neutral skin, the 「待我处理」 bar and the selected inset are near-identical", () => {
    // Pinned as still colliding so that a fix turns this red and the note in data-table.tsx gets updated.
    const ink = rgb(tok("light", "--color-ink"));
    const mine = rgb(tok("light", "--color-civ-neutral"));
    expect(contrastRatio(ink, mine)).toBeLessThan(1.5);
    expect(deltaE00Rgb(ink, mine)).toBeLessThan(10);
  });
});

describe("batch bar (v3 .ds-batch, inverted)", () => {
  it("is solid ink with surface-1 text", () => {
    expect(BATCH_BAR.split(" ").sort()).toEqual(["bg-[oklch(var(--color-ink))]", "text-[oklch(var(--color-surface-1))]"].sort());
  });

  it("the inverse button is borderless surface-1 text with its own surface-1 focus ring", () => {
    render(<Button variant="inverse">x</Button>);
    const cls = screen.getByRole("button").className.split(/\s+/);
    expect(cls).toEqual(expect.arrayContaining([
      "text-[oklch(var(--color-surface-1))]",
      "border-transparent",
      "bg-transparent",
      "focus-visible:outline-[oklch(var(--color-surface-1))]!",
    ]));
    // Absence: the secondary frame and the ink text would vanish into / clash with the bar.
    expect(cls).not.toContain("border-[oklch(var(--color-line-strong))]");
    expect(cls).not.toContain("text-[oklch(var(--color-ink))]");
  });

  it.each(THEMES)("%s: label, hover, press and focus ring all read on the ink bar", (theme) => {
    const ink = tok(theme, "--color-ink");
    const s1 = tok(theme, "--color-surface-1");
    expect(ratio(s1, ink)).toBeGreaterThanOrEqual(AA);
    expect(ratio(s1, inverseGround(theme, 12))).toBeGreaterThanOrEqual(AA);
    expect(ratio(s1, inverseGround(theme, 24))).toBeGreaterThanOrEqual(AA);
    // The ring sits 2px outside the button, on the bar itself.
    expect(ratio(s1, ink)).toBeGreaterThanOrEqual(NON_TEXT);
    // …and the global ring would not: --color-focus is ink in both themes.
    expect(ratio(tok(theme, "--color-focus"), ink)).toBeLessThan(NON_TEXT);
  });

  it.each(THEMES)("%s: warning colour on the ink bar would fail AA — which is why the bar's warnings do not use it", (theme) => {
    expect(ratio(tok(theme, "--color-warning"), tok(theme, "--color-ink"))).toBeLessThan(AA);
  });

  it.each([
    ["src/components/souls/SoulBatchBar.tsx", "souls.batch.transfer_one_only"],
    ["src/components/judgment/JudgmentClaimQueue.tsx", "judgment.claim.batch_limit"],
  ])("%s: the bar warning (%s) is bar-coloured text with the ◐ glyph, not warning colour", (file, key) => {
    const src = readFileSync(path.join(__dirname, "..", "..", file), "utf8");
    const at = src.indexOf(`t("${key}"`);
    expect(at).toBeGreaterThan(0);
    // 那句文字所在的 <span> 开头 —— 往回找最近的 <span(跳过 ◐ 那个 aria-hidden 的)。
    const before = src.slice(Math.max(0, at - 260), at);
    const outer = before.lastIndexOf('<span role="status"') >= 0 ? before.slice(before.lastIndexOf('<span role="status"')) : before.slice(before.lastIndexOf('<span className="text-xs">'));
    expect(outer.length).toBeGreaterThan(0);
    expect(outer).not.toMatch(/--color-warning/);
    expect(outer).toMatch(/<span aria-hidden="true">◐ <\/span>/);
  });

  // Every file that draws a batch bar, found by the constant rather than listed.
  const SRC_DIRS = ["app", "src/components", "components"];
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : /\.tsx$/.test(name) ? [full] : [];
    });
  const BARS = SRC_DIRS.flatMap((d) => walk(path.join(FRONTEND_ROOT, d)))
    .map((file) => ({ file: path.relative(FRONTEND_ROOT, file), src: readFileSync(file, "utf8") }))
    .filter(({ src }) => src.includes("${BATCH_BAR}"));

  it("finds the three batch bars", () => {
    expect(BARS.map((b) => b.file).sort()).toEqual([
      "src/components/judgment/JudgmentClaimQueue.tsx",
      "src/components/moderation/SensitiveWordsSection.tsx",
      "src/components/souls/SoulBatchBar.tsx",
    ]);
  });

  it.each(BARS.map((b) => [b.file, b.src] as const))("%s: every button on the bar is inverse, and nothing on it is inked", (_file, src) => {
    const start = src.indexOf("${BATCH_BAR}");
    const bar = src.slice(start, src.indexOf("</div>", start));
    const variants = [...bar.matchAll(/variant="(\w+)"/g)].map((m) => m[1]);
    expect(variants.length).toBeGreaterThan(1);
    expect(variants.filter((v) => v !== "inverse")).toEqual([]);
    // Ink-family text on an ink ground is 1:1 (ink) or ~2–3:1 (subtle / muted).
    expect(bar).not.toMatch(/text-\[oklch\(var\(--color-ink(-\w+)?\)\)\]/);
    expect(bar).not.toMatch(/bg-\[oklch\(var\(--color-(canvas|surface-\d)\)\)\]/);
  });
});

describe("domain status badges (v3: neutral-line frame, still square)", () => {
  it("StatusBadge keeps its tone text but draws a --color-line frame, not a tone frame", () => {
    const { container } = render(<StatusBadge namespace="x" value="y" tone="success" />);
    const cls = (container.firstElementChild as HTMLElement).className.split(/\s+/);
    expect(cls).toContain(STATUS_BADGE_BORDER);
    expect(cls).toContain("text-[oklch(var(--color-success))]");
    expect(cls).not.toContain("border-[oklch(var(--color-success))]");
    expect(cls.filter((c) => c.startsWith("rounded"))).toEqual([]);
  });

  it.each(THEMES)("%s: the line frame is decorative (glyph + text carry the meaning) — measured, not required", (theme) => {
    // WCAG 1.4.11 does not apply to a border the text already identifies. Recorded so a change is visible.
    const r = ratio(tok(theme, "--color-line"), tok(theme, "--color-surface-1"));
    expect(r).toBeGreaterThan(1.3);
    expect(r).toBeLessThan(NON_TEXT);
  });
});
