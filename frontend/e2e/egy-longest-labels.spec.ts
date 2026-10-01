import fs from "node:fs";
import path from "node:path";
import { test, expect, setupAuthenticatedPage } from "./fixtures";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3333";

/**
 * 规范 v2 补足 C14:「用 egy 语言包里最长的 20 个键跑一遍截图测试,钉住这三条」——
 * 匾题字按实测宽度 40 → 28 → 界面字 20 两行;侧栏项(规范 v3 起:252 里一行、放不下截断、全文在 title)不溢出;窄屏底栏两行截断。
 * (第三条的 App 底栏在 mobile/,这里钉的是 Web 393 下的同形底栏。)
 *
 * 字串从 egy.json 现取,不抄进这里:以后谁加了更长的页题或菜单名,它自动进这 20 条。
 * 选的是能落到匾和侧栏上的两类 —— `breadcrumb.*`(菜单与路由段)与 Web 页面的 `*.title`;
 * App / 推送 / 通知信的标题(soul_app / soul_push / official_notify)不上 Web 的匾。
 * 带 `{{…}}` 占位符的是模板(弹窗标题,如 `sentence_plan.file.title` 的「…: {{soul}}」),
 * 代码里总是带参数调用,从不原样当页题 —— 原样塞进菜单名,匾上就画出一个生的 `{{soul}}`
 * (2026-10-02 截图里的那一条,它恰好是最长的一条)。所以不选。
 *
 * 怎么让一条任意字串当上匾题与侧栏项:菜单名(Menu.name)没有登记译名的路径,在 egy 下
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
  .filter(([, v]) => !/\{\{\w+\}\}/.test(v))
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
    // 没有模板:带占位符的字串不是页题,原样上匾就是一个生的 {{soul}}。
    expect(LONGEST.filter(([, label]) => /\{\{|\}\}/.test(label))).toEqual([]);
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
      await expect(title).not.toContainText("{{");
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

      // ── 侧栏(≥ 769,规范 v3 展开 252)或底栏(≤ 768)。
      const wide = (page.viewportSize()?.width ?? 0) > 768;
      if (wide) {
        const nav = page.getByTestId("global-nav");
        // 一行、放不下就截断;截断了的,全文在 title 里。只量 <nav> 里的菜单项:底部个人区的
        // 角色(DomainEnum 自带 title)不是菜单标签,第一次跑时把它当成了一项。
        const items = await nav.locator("nav a span[title], nav button span[title]").evaluateAll((els) =>
          els.map((el) => {
            const cs = getComputedStyle(el);
            return {
              text: el.textContent ?? "",
              title: el.getAttribute("title") ?? "",
              lines: Math.round(el.getBoundingClientRect().height / parseFloat(cs.lineHeight)),
              clipped: el.scrollWidth - el.clientWidth > 1,
              ellipsis: cs.textOverflow,
            };
          })
        );
        expect(items.length).toBeGreaterThan(0);
        for (const item of items) {
          expect(item.lines).toBeLessThanOrEqual(1);
          expect(item.ellipsis).toBe("ellipsis");
          if (item.clipped) expect(item.title.startsWith(item.text)).toBe(true);
        }
        const navOverflow = await nav.evaluate((el) => el.scrollWidth - el.clientWidth);
        expect(navOverflow).toBeLessThanOrEqual(0);
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
