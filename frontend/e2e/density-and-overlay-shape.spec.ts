import { test, expect, setupAuthenticatedPage, OPENED_JUDGMENT } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * 「舒适 / 紧凑」与弹层圆角(用户 2026-11-08 报:切换看不出效果;右上角弹层圆角不统一)。
 *
 * 紧凑此前只改了 `--table-row-h` 等变量,而表格单元格是调用方的 `py-3`:/souls 的行 47 → 47 一像素不动。
 * 这里在真浏览器里量:精确指针下切到紧凑,四个列表页每一条数据行都等于 `--table-row-h`(36),
 * 且比舒适时矮。触屏(mobile-chrome)不受紧凑影响,变量仍是 64。
 * 弹层:通知、用户菜单、⌘K 搜索、toast 的 computed border-radius 都是 6px(v4 `--radius-panel`)。
 */

const DENSITY_KEY = "soulledger-density";
const PAGES = ["/souls", "/judgment", "/users", "/organizations"];
const page1 = (results: unknown[]) => ({ count: results.length, next: null, previous: null, results });
const ORGS = [
  { id: 1, name: "酆都", code: "FD", parent: null, level: 1, sort: 1 },
  { id: 2, name: "第五殿", code: "FD-5", parent: 1, level: 2, sort: 1 },
];
const CASES = [
  { ...OPENED_JUDGMENT, claimed_by: null },
  { ...OPENED_JUDGMENT, id: "dddddddd-dddd-4ddd-8ddd-ddddddddddde", case_number: "CN-2026-0002", claimed_by: null },
];

/** 数据行:tbody 里不是分组头、也不是 colSpan 的空状态 / 加载格。 */
async function rowHeights(page: Page) {
  const rows = page.locator("main table tbody > tr:not([data-group-head]):not(:has(> [colspan]))");
  await expect(rows.first()).toBeVisible();
  return rows.evaluateAll((els) => els.filter((el) => (el as HTMLElement).offsetParent).map((el) => el.getBoundingClientRect().height));
}

const token = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test.describe("紧凑 · 表格行高走 --table-row-h", () => {
  for (const path of PAGES) {
    test(`${path}:紧凑下每条数据行等于 --table-row-h,且比舒适矮`, async ({ page, isMobile }) => {
      const api = await setupAuthenticatedPage(page);
      // 夹具默认这两页是空的:给几行,才有行可量。
      api.on("GET", "/organizations/", page1(ORGS));
      api.on("GET", "/judgment/", page1(CASES));
      await page.goto(path);
      const comfy = await rowHeights(page);

      await page.evaluate((k) => localStorage.setItem(k, "compact"), DENSITY_KEY);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
      const compact = await rowHeights(page);
      const rowH = await token(page, "--table-row-h");

      if (isMobile) {
        // 触屏的 64 是点按下限,紧凑不碰它。
        expect(rowH).toBe("64px");
        return;
      }
      expect(rowH).toBe("36px");
      // `+1`:行的下边框(border-collapse 下算进 <tr> 的盒子;舒适时同理是 46 + 1)。
      for (const h of compact) expect(Math.round(h)).toBeLessThanOrEqual(37);
      expect(Math.max(...compact)).toBeLessThan(Math.min(...comfy));
    });
  }
});

test.describe("弹层圆角 · 6px", () => {
  test("通知、用户菜单、全局搜索、toast 的圆角都是 --radius-panel", async ({ page, isMobile }) => {
    await setupAuthenticatedPage(page);
    await page.goto("/dashboard");
    const radius = (sel: string) =>
      page.locator(sel).first().evaluate((el) => getComputedStyle(el).borderTopLeftRadius + " " + getComputedStyle(el).borderBottomRightRadius);

    await page.getByTestId("global-topbar").getByRole("button", { name: /^通知/ }).click();
    const notif = page.locator('[role="dialog"]').filter({ hasText: "通知" }).first();
    await expect(notif).toBeVisible();
    expect(await notif.evaluate((el) => getComputedStyle(el).borderRadius)).toBe("6px");
    await page.keyboard.press("Escape");

    // ≤ 768 the toolbar has no user menu (fe-mobile 3.1): its items are in the door bar's 「我」 sheet, which is a bottom
    // sheet with square corners, not a popover.
    if (!isMobile) {
      await page.getByTestId("user-menu").click();
      const menu = page.locator('[role="dialog"]').filter({ has: page.locator('a[href="/profile"]') }).first();
      await expect(menu).toBeVisible();
      expect(await menu.evaluate((el) => getComputedStyle(el).borderRadius)).toBe("6px");
      await page.keyboard.press("Escape");
    }

    if (!isMobile) {
      // ≤ 768 搜索是全屏,不圆。
      await expect(page.locator('[data-testid^="global-search-entry"]:visible')).toBeVisible();
      await page.keyboard.press("ControlOrMeta+k");
      await expect(page.getByTestId("global-search")).toBeVisible();
      expect(await radius('[data-testid="global-search"]')).toBe("6px 6px");
      await page.keyboard.press("Escape");
    }

    // toast 由 Toast.tsx 直接写 DOM;这里量的是 globals.css 里 `.toast` 那条规则本身。
    await page.evaluate(() => {
      const el = document.createElement("div");
      el.className = "toast";
      el.id = "probe-toast";
      el.textContent = "probe";
      document.body.appendChild(el);
    });
    expect(await radius("#probe-toast")).toBe("6px 6px");
  });
});
