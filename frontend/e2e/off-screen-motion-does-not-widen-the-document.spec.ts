/**
 * 从屏外滑进来的东西,在滑的那 240ms 里不能把文档撑宽。
 *
 * WHY。`no-route-overflows-the-document.spec.ts` 量的是**静止**的每条路由,
 * 而这一轮新加的两处动效都是从视口之外起步的:
 *
 *   - `SettingsDrawer` 的 `drawer-in` / `drawer-out`,`translateX(100%)` 起手,
 *     元素本体是 `fixed right-0 w-80`;
 *   - `AppLayout` 的移动端抽屉,`-translate-x-full`,这一轮之前它**根本没有过渡**
 *     (`transition-[width]` 里没有 transform),所以那 240ms 从来不存在。
 *
 * 那份静态测试跑完 26 条路由都不会碰到这两个,因为它从不打开抽屉。于是
 * 「加了动效之后文档在动画中途变宽」这件事没有任何东西在看 —— 而它的后果
 * 恰恰是那份文件开头写的那一条:所有 `fixed inset-0` 的遮罩按文档宽度铺开,
 * 弹窗一半落在可视区外,按钮「看得见、点不动」。
 *
 * WHAT IT MEASURES。和那份一样是 `documentElement.scrollWidth` 对
 * `clientWidth`,但是在动画**进行中**采样,不是在两端。两端都是静止态,
 * 静止态本来就不会溢出 —— 会溢出的是中间。
 *
 * 采样用 rAF 连采而不是 `waitForTimeout` 打一枪:240ms 的动画里最宽的那一帧
 * 落在哪里取决于缓动曲线,`ease-exit` 是 `cubic-bezier(0.7, 0, 0.84, 0)`,
 * 前半程几乎不动、后半程猛冲,一枪打在中点会正好错过。
 */
import { expect, test } from "@playwright/test";

import { setupAuthenticatedPage } from "./fixtures";

/**
 * 在接下来的 `frames` 帧里,每帧记一次文档宽度与视口宽度,返回最宽的一帧。
 *
 * 抄的是 `workflow-auto-layout-motion.spec.ts` 的 `startSampling` 形状:先在页面里
 * 装好采样器,再触发动作,最后把结果取回来。反过来做(先触发再装)会漏掉最前面
 * 那几帧,而 `ease-enter` 的位移几乎全在前半程。
 */
async function widestFrameDuring(
  page: import("@playwright/test").Page,
  act: () => Promise<void>,
  frames = 40
) {
  await page.evaluate((n) => {
    const w = window as unknown as { __widths: { scroll: number; client: number }[] };
    w.__widths = [];
    let left = n;
    const tick = () => {
      w.__widths.push({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      });
      if (--left > 0) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, frames);

  await act();

  // 40 帧 ≈ 660ms at 60fps,盖过 240ms 的动画还有富余。
  await page.waitForFunction(
    (n) => (window as unknown as { __widths: unknown[] }).__widths.length >= n,
    frames,
    { timeout: 5000 }
  );

  const samples = await page.evaluate(
    () => (window as unknown as { __widths: { scroll: number; client: number }[] }).__widths
  );
  // 帧数本身要断言,否则一个没跑起来的采样器会以「零个超宽帧」的面目通过。
  expect(samples.length).toBeGreaterThanOrEqual(frames);
  return samples.reduce((worst, s) => (s.scroll - s.client > worst.scroll - worst.client ? s : worst));
}

test.describe("屏外动效不撑宽文档", () => {
  test("设置抽屉滑进来的整个过程里,文档都不比视口宽", async ({ page }) => {
    await setupAuthenticatedPage(page);
    await page.goto("/dashboard");
    await expect(page.locator("body")).not.toBeEmpty();
    await page.waitForLoadState("networkidle");

    const gear = page.getByRole("button", { name: /settings|设置/i }).first();
    await expect(gear).toBeVisible();

    const opening = await widestFrameDuring(page, async () => {
      await gear.click();
    });
    expect(
      opening.scroll,
      `抽屉滑入途中文档 ${opening.scroll}px,视口 ${opening.client}px`
    ).toBeLessThanOrEqual(opening.client);

    await expect(page.getByRole("dialog")).toBeVisible();

    // 退场是另一条曲线(`ease-exit`),也另测一次:滑出去的终点就在屏外。
    const closing = await widestFrameDuring(page, async () => {
      await page.keyboard.press("Escape");
    });
    expect(
      closing.scroll,
      `抽屉滑出途中文档 ${closing.scroll}px,视口 ${closing.client}px`
    ).toBeLessThanOrEqual(closing.client);
  });
});
