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

import { expect, test, setupAuthenticatedPage } from "./fixtures";

/**
 * 在这次动画跑完之前,每帧记一次文档宽度与视口宽度,返回最宽的一帧。
 *
 * 抄的是 `workflow-auto-layout-motion.spec.ts` 的 `startSampling` 形状:先在页面里
 * 装好采样器,再触发动作,最后把结果取回来。反过来做(先触发再装)会漏掉最前面
 * 那几帧,而 `ease-enter` 的位移几乎全在前半程。
 *
 * **不是固定帧数**,这一点和那份文件同一天(2026-09-18)一起改。原先写死 40 帧,
 * 注释按「40 帧 ≈ 660ms at 60fps」推断它盖得住 240ms 的动画 —— 两个前提都不成立:
 * headless firefox 的 rAF 明显快于 60fps(那份 spec 里实测 90 帧只要 821–1315ms),
 * 而窗口是在**点击之前**开的,点击本身的往返在负载下要 97–873ms。窗口因此可能在
 * 动画开始前就关掉,而这条用例断的是「不发生」—— 采不到动画中途的帧,它照样绿,
 * 什么都没验证。
 *
 * 现在由页面自己的完成信号收尾,两条曲线各一个,而且**两个信号不一样**,这是
 * 实测逼出来的(2026-09-18,chromium 与 firefox 同样):
 *
 *   - 入场:`drawer-in` 的 `animationend` 会发,实测在按下后约 270ms 到,
 *     窗口里因此有 19–34 帧;
 *   - 退场:**`drawer-out` 的 `animationend` 从来不发**。`SettingsDrawer` 在
 *     `MOUNT_LINGER_MS`(= `--transition-duration-settle` = 240ms)后把抽屉从
 *     DOM 里卸掉,实测卸载发生在按下 Escape 后 254/256ms,元素先没了,事件就
 *     再也不会派发。所以退场等的是「抽屉那个元素不在了」—— 它走完并离场,
 *     这同样是动画结束,只是由卸载来报信。
 *
 * 退场**不能**用 `[role="dialog"]` 消失来判:`useDrawerA11y` 在 `open` 变 false
 * 的那一次提交里就把 role 拿掉了(实测按下 Escape 后约 8ms,动画还没开始),
 * 用它做信号会在 2 帧后就收工 —— 正是这份文件要防的那种「窗口关得太早、
 * 什么都没采到还是绿的」。
 *
 * 两个信号都不来时 10 秒超时,失败信息指向「动画没跑完」,而不是变成一次静默
 * 的绿。
 */
async function widestFrameDuring(
  page: import("@playwright/test").Page,
  act: () => Promise<void>,
  animation: "drawer-in" | "drawer-out"
) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __widths: { scroll: number; client: number }[];
      __widthsStop: boolean;
      __anims: string[];
    };
    w.__widths = [];
    w.__widthsStop = false;
    w.__anims = [];
    document.addEventListener(
      "animationend",
      (e) => w.__anims.push((e as AnimationEvent).animationName),
      true
    );
    const tick = () => {
      if (w.__widthsStop) return;
      w.__widths.push({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await act();

  await page.waitForFunction(
    (name) => {
      const w = window as unknown as { __anims: string[] };
      if (w.__anims.includes(name)) return true;
      // 退场:元素先被卸载,`animationend` 因此不会到(见上)。两个类名都要问,
      // 采样开始时抽屉还开着(`animate-drawer-in`),只问退场那个会立刻为真。
      return (
        name === "drawer-out" &&
        document.querySelector(".animate-drawer-in, .animate-drawer-out") === null
      );
    },
    animation,
    { timeout: 10_000 }
  );

  const samples = await page.evaluate(() => {
    const w = window as unknown as {
      __widths: { scroll: number; client: number }[];
      __widthsStop: boolean;
    };
    w.__widthsStop = true;
    return w.__widths;
  });
  // 帧数本身要断言,否则一个没跑起来的采样器会以「零个超宽帧」的面目通过。
  // 240ms 的动画里至少该有几帧;门槛写小,它挡的是「零帧」不是「帧率不够」。
  expect(samples.length, "采样器没跑起来,下面的最宽帧无从谈起").toBeGreaterThanOrEqual(3);
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
