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
 * 在动画自己的时间轴上均匀取 13 个点,而不是 `waitForTimeout` 打一枪:240ms 的动画里
 * 最宽的那一刻落在哪里取决于缓动曲线,`ease-exit` 是 `cubic-bezier(0.7, 0, 0.84, 0)`,
 * 前半程几乎不动、后半程猛冲,一枪打在中点会正好错过。
 */

import { expect, test, setupAuthenticatedPage } from "./fixtures";

/**
 * 在这次动画的时间轴上逐点测文档宽度与视口宽度,返回最宽的一点。
 * 以前是 rAF 按帧连采(2026-09-18 起由 animationend / 卸载收尾);为什么改成
 * 拨动动画时间,见函数体开头。
 */
async function widestFrameDuring(
  page: import("@playwright/test").Page,
  act: () => Promise<void>,
  animation: "drawer-in" | "drawer-out"
) {
  // SEEK, DON'T WAIT FOR FRAMES (2026-09-25). The rAF sampler this replaced
  // failed 12 of 15 with `--repeat-each=15` at load 4.7, 8 of them with ZERO
  // samples. Cause: in one rendering update the browser dispatches
  // `animationend` BEFORE it runs rAF callbacks, so when parallel workers
  // leave a page one rendering update for the whole 240ms, the first frame
  // after the click both ends the animation and is the only sample. The
  // assertion then measured nothing, and the ≥3 floor below turned that into
  // a red that had nothing to do with overflow.
  //
  // Now a MutationObserver catches the class change in the same task React
  // commits it — before any timer, including SettingsDrawer's 240ms unmount
  // (MOUNT_LINGER_MS) — pauses the CSS animation and seeks it through 13
  // evenly spaced points of its own duration, reading the document width at
  // each (reading scrollWidth forces the layout for that currentTime). Then
  // it rewinds and plays, so the page carries on as the user sees it.
  // Deterministic, and it covers the fast half of `ease-exit` that a
  // mid-point snapshot would miss (see the header).
  await page.evaluate((name) => {
    const w = window as unknown as {
      __widths: { scroll: number; client: number }[];
      __seeked: boolean;
    };
    w.__widths = [];
    w.__seeked = false;
    const seek = () => {
      const el = document.querySelector(`.animate-${name}`);
      const anim = el
        ?.getAnimations()
        .find((a) => (a as CSSAnimation).animationName === name);
      if (!anim) return false;
      anim.pause();
      const total = Number(anim.effect?.getComputedTiming().duration ?? 0);
      for (let i = 0; i <= 12; i++) {
        anim.currentTime = (total * i) / 12;
        w.__widths.push({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        });
      }
      anim.currentTime = 0;
      anim.play();
      return true;
    };
    const observer = new MutationObserver(() => {
      if (seek()) {
        w.__seeked = true;
        observer.disconnect();
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  }, animation);

  await act();

  // The seek never happening (class never applied, animation renamed) fails
  // here with a timeout that names the animation, not as a silent green.
  await page.waitForFunction(() => (window as unknown as { __seeked: boolean }).__seeked, null, {
    timeout: 10_000,
  });

  const samples = await page.evaluate(
    () => (window as unknown as { __widths: { scroll: number; client: number }[] }).__widths
  );
  // Still asserted: a sampler that collected nothing must not pass as
  // "zero overflowing frames". 13 are taken; 3 is the floor it guards.
  expect(samples.length, `${animation}: 采样器没跑起来,下面的最宽帧无从谈起`).toBeGreaterThanOrEqual(3);
  return samples.reduce((worst, s) => (s.scroll - s.client > worst.scroll - worst.client ? s : worst));
}

test.describe("屏外动效不撑宽文档", () => {
  test("设置抽屉滑进来的整个过程里,文档都不比视口宽", async ({ page }) => {
    await setupAuthenticatedPage(page);
    await page.goto("/dashboard");
    await expect(page.locator("body")).not.toBeEmpty();
    await page.waitForLoadState("networkidle");

    // Settings lives in the user menu since 规范 v1; open the menu, then the drawer.
    await page.getByTestId("user-menu").click();
    const gear = page.getByRole("button", { name: /settings|设置/i }).first();
    await expect(gear).toBeVisible();

    const opening = await widestFrameDuring(
      page,
      async () => {
        await gear.click();
      },
      "drawer-in"
    );
    expect(
      opening.scroll,
      `抽屉滑入途中文档 ${opening.scroll}px,视口 ${opening.client}px`
    ).toBeLessThanOrEqual(opening.client);

    await expect(page.getByRole("dialog")).toBeVisible();

    // 退场是另一条曲线(`ease-exit`),也另测一次:滑出去的终点就在屏外。
    const closing = await widestFrameDuring(
      page,
      async () => {
        await page.keyboard.press("Escape");
      },
      "drawer-out"
    );
    expect(
      closing.scroll,
      `抽屉滑出途中文档 ${closing.scroll}px,视口 ${closing.client}px`
    ).toBeLessThanOrEqual(closing.client);
  });
});
