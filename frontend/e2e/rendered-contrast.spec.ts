/**
 * 渲染后的文字对比度(WCAG 1.4.3:正文 4.5、大字 3),在真浏览器里量。
 *
 * 为什么是 E2E:jsdom 里的 axe 关了 color-contrast(a11yEngineBaseline.test.tsx),
 * inkOnSurfaceContract 只算 token 对 —— opacity 叠加、继承来的底、main 作字色,只有渲染后才算得出。
 * 用的是已在依赖里的 `axe-core`(不是 `@axe-core/playwright`,那个没装,也不为它加依赖):
 * 把它的源码 evaluate 进页面,只跑 `color-contrast` 一条规则。axe 自己处理 opacity、
 * 祖先背景与字号 / 字重(大字门槛);压在渐变 / 斜纹上的字它判不了,记为 incomplete,这里不管。
 *
 * 宽度由 project 给:chromium 1280、mobile-chrome 393(Pixel 5)。主题用 emulateMedia
 * (没存过选择时跟随系统)。租户是夹具的 CN_DIYU,即 cn;另三个文明由 inkOnSurfaceContract 算。
 */
import { readFileSync } from "node:fs";
import { test, expect, setupAuthenticatedPage, mockApi, OPENED_JUDGMENT, SOULS, PROPOSED_DISPATCH } from "./fixtures";

const AXE_SOURCE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

/**
 * 待 Design 定(2026-10-29),与 inkOnSurfaceContract.test.ts 的 PENDING_DESIGN 是同一批位置;
 * 比值在那份里按 token 钉住。命中这些选择器(元素或其祖先)的违规不算红,别的一律红。
 * 实测(2026-10-29,unRAID):axe 今天只报出第一条(393 深色底栏当前项 3.12:1,权限 / 灵魂详情 /
 * 调拨详情三页);身份带小字压着纹样层、键帽与「禁授」压着边框 / 斜纹,axe 判为 incomplete。
 * 后三条留着,是因为 axe 哪天能判了,红的应是「已知待 Design」而不是新缺陷;达标与否由 jest 那份管。
 */
const PENDING_DESIGN = [
  { id: "bottom-bar-current", selector: '[data-testid="bottom-bar"] [aria-current]', why: "底栏当前项字色 main(深色 cn 3.13)" },
  { id: "identity-small-0.7", selector: ".identity-case[data-case] > span, .identity-brand span", why: "身份带 11 · 0.7 小字" },
  { id: "keycap-0.7", selector: "kbd.opacity-70", why: "键帽 opacity-70" },
  { id: "perm-deny-stripe", selector: '[class*="repeating-linear-gradient"]', why: "权限页「禁授」字压斜纹" },
] as const;

const ROUTES: [string, string, boolean][] = [
  ["login", "/login", false],
  ["dashboard", "/dashboard", true],
  ["judgment-detail", `/judgment/${OPENED_JUDGMENT.id}`, true],
  ["soul-detail", `/souls/${SOULS[0].id}`, true],
  ["permissions", "/permissions", true],
  ["users", "/users", true],
  ["disposition", "/disposition", true],
  ["dispatch-detail", `/dispatch/${PROPOSED_DISPATCH.id}`, true],
];

type Finding = { target: string; text: string; message: string; allowedBy: string | null };

for (const colorScheme of ["light", "dark"] as const) {
  for (const [name, route, auth] of ROUTES) {
    test(`${name} · ${colorScheme}: no text below WCAG AA contrast outside the pending-Design list`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      if (auth) await setupAuthenticatedPage(page);
      else await mockApi(page);
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${colorScheme}\\b`));
      await page.evaluate(AXE_SOURCE);

      const findings: Finding[] = await page.evaluate(async (allow) => {
        type AxeNode = { target: unknown[]; any: { message: string }[] };
        type Axe = { run: (ctx: Document, opts: object) => Promise<{ violations: { nodes: AxeNode[] }[] }> };
        const axe = (window as unknown as { axe: Axe }).axe;
        const r = await axe.run(document, { runOnly: { type: "rule", values: ["color-contrast"] }, resultTypes: ["violations"] });
        return r.violations.flatMap((v) =>
          v.nodes.map((n) => {
            const sel = String(n.target[n.target.length - 1]);
            const el = document.querySelector(sel);
            const hit = allow.find((a) => el?.closest(a.selector));
            return { target: sel, text: (el?.textContent ?? "").trim().slice(0, 40), message: n.any[0]?.message ?? "", allowedBy: hit?.id ?? null };
          })
        );
      }, PENDING_DESIGN as unknown as { id: string; selector: string }[]);

      expect(findings.filter((f) => f.allowedBy === null)).toEqual([]);
    });
  }
}
