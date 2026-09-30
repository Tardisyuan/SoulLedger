import fs from "node:fs";
import path from "node:path";
import { test, expect, setupAuthenticatedPage } from "./fixtures";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3333";

/**
 * 规范 v2 补足 C14:「用 egy 语言包里最长的 20 个键跑一遍截图测试,钉住这三条」——
 * 匾题字按实测宽度 40 → 28 → 界面字 20 两行;立柱任一项超阈值整根横排;窄屏底栏两行截断。
 * (第三条的 App 底栏在 mobile/,这里钉的是 Web 393 下的同形底栏。)
 *
 * 字串从 egy.json 现取,不抄进这里:以后谁加了更长的页题或菜单名,它自动进这 20 条。
 * 选的是能落到匾和立柱上的两类 —— `breadcrumb.*`(菜单与路由段)与 Web 页面的 `*.title`;
 * App / 推送 / 通知信的标题(soul_app / soul_push / official_notify)不上 Web 的匾。
 *
 * 怎么让一条任意字串当上匾题与立柱项:菜单名(Menu.name)没有登记译名的路径,在 egy 下
 * 原样显示(`src/lib/menuI18n.ts`),而匾题取面包屑最后一段。所以把 20 条字串做成 20 个
 * 菜单项,被测那条挂在 /about 上,打开 /about。
 *
 * 断言量的是布局(浏览器真排版),截图作为附件留档 —— 像素基线在三个引擎、两种系统上
 * 各不相同,拿它当门禁只会训练人去更新基线。
 */
const EGY = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "packages", "core", "messages", "egy.json"), "utf8")
);

function flatten(o: Record<string, unknown>, prefix = ""): [string, string][] {
  return Object.entries(o).flatMap(([k, v]) =>
    typeof v === "string" ? [[prefix + k, v] as [string, string]] : v && typeof v === "object" ? flatten(v as Record<string, unknown>, `${prefix}${k}.`) : []
  );
}

const LONGEST: [string, string][] = flatten(EGY)
  .filter(([k]) => /^breadcrumb\./.test(k) || (/\.title$/.test(k) && !/^(soul_app|soul_push|official_notify)\./.test(k)))
  .sort((a, b) => [...b[1]].length - [...a[1]].length || a[0].localeCompare(b[0]))
  .slice(0, 20);

const menusFor = (current: number) =>
  LONGEST.map(([, label], i) => ({
    id: 900 + i,
    name: label,
    path: i === current ? "/about" : `/c14-${i}`,
    icon: "",
    order: i,
    component: null,
    roles: [],
    is_active: true,
    parent: null,
    menu_type: "MENU",
    visible: true,
  }));

test.describe("C14 · egy 最长的 20 条标签", () => {
  test("选出来的确实是 20 条,且包含 C14 点名的两条最长真实字串", () => {
    expect(LONGEST).toHaveLength(20);
    const keys = LONGEST.map(([k]) => k);
    expect(keys).toContain("actors.assessors.title");
    expect(keys).toContain("breadcrumb.menu.soul_credentials");
  });

  for (const [i, [key, label]] of LONGEST.entries()) {
    test(`${String(i + 1).padStart(2, "0")} ${key}`, async ({ page }, testInfo) => {
      const api = await setupAuthenticatedPage(page);
      await page.context().addCookies([{ name: "soulledger-locale", value: "egy", url: BASE_URL }]);
      api.on("GET", "/menus/list-public/", menusFor(i));
      await page.goto("/about");

      // ── 匾题字:完整文字在 title 里;前两档一行不溢出,第三档是界面字两行截断。
      const title = page.getByTestId("plaque").locator("[data-tier]");
      await expect(title).toHaveAttribute("title", label);
      await page.evaluate(() => document.fonts.ready);
      const plaque = await title.evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          tier: el.getAttribute("data-tier"),
          overflowX: el.scrollWidth - el.clientWidth,
          clamp: cs.getPropertyValue("-webkit-line-clamp"),
          fontSize: parseFloat(cs.fontSize),
          lines: Math.round(el.clientHeight / parseFloat(cs.lineHeight)),
        };
      });
      if (plaque.tier === "2") {
        expect(plaque.clamp).toBe("2");
        expect(plaque.fontSize).toBe(20);
        expect(plaque.lines).toBeLessThanOrEqual(2);
      } else {
        expect(plaque.overflowX).toBeLessThanOrEqual(1);
        expect(plaque.fontSize).toBe(plaque.tier === "0" ? 40 : 28);
      }

      // ── 立柱(≥ 768)或底栏(< 768)。
      const wide = (page.viewportSize()?.width ?? 0) >= 768;
      if (wide) {
        const pillar = page.getByTestId("pillar");
        // 20 条都超过 8 个拉丁字符 → 整根横排 88。
        await expect(pillar).toHaveAttribute("data-wide", "true");
        const items = await pillar.locator("a > span[title], button > span[title]").evaluateAll((els) =>
          els.map((el) => {
            const cs = getComputedStyle(el);
            return {
              lines: Math.round(el.getBoundingClientRect().height / parseFloat(cs.lineHeight)),
              overflowX: el.scrollWidth - el.clientWidth,
            };
          })
        );
        expect(items.length).toBeGreaterThan(0);
        for (const item of items) {
          expect(item.lines).toBeLessThanOrEqual(2);
          expect(item.overflowX).toBeLessThanOrEqual(1);
        }
        const nav = await pillar.evaluate((el) => el.scrollWidth - el.clientWidth);
        expect(nav).toBeLessThanOrEqual(0);
      } else {
        const cells = await page
          .getByTestId("bottom-bar")
          .locator("span[title]")
          .evaluateAll((els) =>
            els.map((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)))
          );
        expect(cells).toHaveLength(4);
        for (const lines of cells) expect(lines).toBeLessThanOrEqual(2);
      }

      // 长标签不许把整页撑宽(撑宽之后弹层居中会落到可视区外,见 no-route-overflows-the-document)。
      const docOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(docOverflow).toBeLessThanOrEqual(0);

      await testInfo.attach(`c14-${key}`, { body: await page.screenshot(), contentType: "image/png" });
    });
  }
});
