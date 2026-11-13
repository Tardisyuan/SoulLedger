import fs from "node:fs";
import path from "node:path";
import { test, expect, setupAuthenticatedPage } from "./fixtures";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3333";

/**
 * 规范 v2 补足 C14:「用 egy 语言包里最长的 20 个键跑一遍截图测试,钉住这三条」——
 * 面包屑的当前段(第三十批「卷宗」起匾 / 标题行撤掉了,菜单名落在工具条的面包屑上:一行、放不下截断、全文在 title)
 * 与页头的 `<h1>`(长的就换行,不横向溢出);门栏(第三十批第 4 步起取代侧栏与底栏)的门字一行、不溢出。
 * (App 底栏在 mobile/。)
 *
 * 字串从 egy.json 现取,不抄进这里:以后谁加了更长的页题或菜单名,它自动进这 20 条。
 * 选的是能落到匾和侧栏上的两类 —— `breadcrumb.*`(菜单与路由段)与 Web 页面的 `*.title`;
 * App / 推送 / 通知信的标题(soul_app / soul_push / official_notify)不上 Web 的匾。
 * 带 `{{…}}` 占位符的是模板(弹窗标题,如 `sentence_plan.file.title` 的「…: {{soul}}」),
 * 代码里总是带参数调用,从不原样当页题 —— 原样塞进菜单名,匾上就画出一个生的 `{{soul}}`
 * (2026-10-02 截图里的那一条,它恰好是最长的一条)。所以不选。
 *
 * 怎么让一条任意字串当上面包屑末段:菜单名(Menu.name)没有登记译名的路径,在 egy 下
 * 原样显示(`src/lib/menuI18n.ts`)。所以把 20 条字串做成 20 个菜单项,被测那条挂在 /about 上,打开 /about。
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
    // actors.assessors.title:2026-11-06 措辞审查撤回过它的 egy,v4 第十八批(2026-11-09)Design 重给了
    // 「Djadjat En Maat (42 Netjeru)」,所以它又回到最长的一组里。
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

      // ── 面包屑末段:完整文字在 title 里,一行截断(末段与 <h1> 相同时不画,那时 <h1> 就是它)。
      await page.evaluate(() => document.fonts.ready);
      const h1 = page.getByTestId("page-head").locator("h1");
      await expect(h1).toHaveCount(1);
      const crumb = page.getByTestId("global-topbar").locator("[aria-current='page']");
      if ((await h1.textContent())?.trim() === label) {
        await expect(crumb).toHaveCount(0);
      } else {
        await expect(crumb).toHaveAttribute("title", label);
        await expect(crumb).not.toContainText("{{");
        const clip = await crumb.evaluate((el) => ({ lines: Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)), ellipsis: getComputedStyle(el).textOverflow }));
        expect(clip.lines).toBeLessThanOrEqual(1);
        expect(clip.ellipsis).toBe("ellipsis");
      }
      // ── 页头的 <h1>:换行而不横向溢出。
      expect(await h1.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);

      // ── 门栏(第三十批第 4 步,取代侧栏与底栏):≥ 769 立在左边 64 宽,≤ 768 到底部。菜单名不再上门栏 ——
      // 门上是固定的门名(第三十八批:egy 是图标 + Sesh Ba / Remetj 这样的词,11px 一行、不省略),所以这里钉门名:一行、不折、不截、门栏不横向溢出。
      const rail = page.getByTestId("door-rail");
      const glyphs = await rail.locator("[data-testid='door-label']:visible").evaluateAll((els) =>
        els.map((el) => ({
          lines: Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)),
          clipped: el.scrollWidth - el.clientWidth > 1,
        }))
      );
      expect(glyphs.length).toBeGreaterThan(0);
      for (const g of glyphs) {
        expect(g.lines).toBeLessThanOrEqual(1);
        expect(g.clipped).toBe(false);
      }
      expect(await rail.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);

      // 长标签不许把整页撑宽(撑宽之后弹层居中会落到可视区外,见 no-route-overflows-the-document)。
      const docOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(docOverflow).toBeLessThanOrEqual(0);

      await testInfo.attach(`c14-${key}`, { body: await page.screenshot(), contentType: "image/png" });
    });
  }
});
