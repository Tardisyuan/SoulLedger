/**
 * `/dashboard` 顶部那四张 KPI 卡,在**加载态**与**数据落地后**必须一样高。
 *
 * ── 为什么这条只能是 E2E ────────────────────────────────────────────────────
 *
 * `fff0a38` 修的是一个真缺陷:骨架屏带 `mt-2`、值那一格没有,于是整条 KPI 在
 * 加载时高 8px,数据到达时往上弹回去。**高度**对上了(`h-14` 对 `text-08` 的
 * 56px/1),**外边距**没有。
 *
 * 那条修复自己的提交信息写着「目前无守卫」,而理由是对的:jsdom 不做布局,
 * `getBoundingClientRect()` 在那里恒为 0×0,`offsetHeight` 恒为 0。一条 jest
 * 断言在这上面只能比较两个 0 —— 那正是本仓警告过的「永远不会触发的检查」:
 * 它会在缺陷回来的那天照样是绿的。要量高度就得有布局引擎,也就是这里。
 *
 * ── 怎么捕捉加载态 ──────────────────────────────────────────────────────────
 *
 * 加载态在真实网络里只存在几十毫秒,靠 `waitFor` 是抓不稳的。这里不去抢时间,
 * 而是**把时间停住**:`ApiMock` 的 handler 允许返回 Promise(`MockHandler` 的
 * 类型就是 `MockReply | Promise<MockReply>`,`mockApi` 里 `await mock.resolve()`
 * 之后才 `route.fulfill`),所以给 `/ledger/stats/overview/` 挂一个等在 Node 侧
 * 门闩上的 handler,那条 XHR 就一直悬着,页面停在加载态,想量多久量多久。
 * 量完 `release()`,同一份 `LEDGER_STATS` 才发出去。
 *
 * ── 判据是卡片,不是骨架屏 ──────────────────────────────────────────────────
 *
 * 量的是 `[data-kpi-card]`(整张卡)的高度,不是骨架屏或值那一格的高度。用户
 * 看见的跳动是卡片外沿在动,而卡片高度是「内边距 + 标签 + 间隙 + 内容」的和 ——
 * 只比较内容那一格,恰好会漏掉这次的缺陷,因为出问题的就是**间隙**。
 *
 * `[data-kpi]` 只在数据落地后才存在(`StatCard.tsx` 的三元的另一支),所以
 * 「4 张卡 + 0 个值」是加载态的定义,「4 张卡 + 4 个值」是落地态的定义。
 * 这两条计数同时也是「扫到了东西」的断言:一个没渲染出来的页面给出的是
 * 「0 张卡」而不是「高度相等」。
 */

import { expect, test, LEDGER_STATS, setupAuthenticatedPage } from "./fixtures";

/**
 * 亚像素容差,单位 CSS px。
 *
 * 不是拟合来的,而且**不是从今天的读数往上取整来的** —— 它是「同一个盒子模型算
 * 两次」这件事本身允许的误差。两个状态的内容高度由同一组整数 rem 决定
 * (`h-14` = 3.5rem;`text-08` 的 line-height 是 1),所以理想值是 0;留 0.5 是
 * 因为 `getBoundingClientRect()` 给的是设备像素折算回 CSS px 的浮点数,而
 * mobile-chrome 的 deviceScaleFactor 是 2.75,折算可以在末位上差一点点。
 *
 * 如实说明这个 0.5 的证据强度:三个 project 的绿只证明差值 **≤ 0.5**,没有证明
 * 它是 0 —— 这条断言不打印通过时的读数。真正被量出来的是另一端:去掉 `mt-2`
 * 之后,chromium 与 mobile-chrome 都报 113.9375 → 105.9375,差 **8.00**。
 * 容差比它要拦的缺陷小 16 倍,所以它不可能把这个缺陷放过去。
 */
const SUBPIXEL_SLACK_PX = 0.5;

test("KPI 条在数据落地时不跳:加载态与落地态的卡片一样高", async ({ page }) => {
  const api = await setupAuthenticatedPage(page);

  // Node 侧的门闩。handler 在 Playwright 的进程里跑,所以一个普通的 Promise
  // 就够了 —— 不需要把任何东西送进浏览器。
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  // `on` 是 unshift,后注册的赢,所以这一条盖住 `registerDefaults` 的同名路由。
  api.on("GET", "/ledger/stats/overview/", async () => {
    await held;
    return { body: LEDGER_STATS };
  });

  // 不等 networkidle:那条请求正被我们按住,networkidle 永远不会到。
  await page.goto("/dashboard");

  const cards = page.locator("[data-kpi-card]");
  const values = page.locator("[data-kpi]");

  // ── 加载态 ──
  await expect(cards).toHaveCount(4);
  await expect(values).toHaveCount(0);
  const loading = await cards.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));

  // 量到的必须是真盒子。一个 `display:none` 或还没布局的卡片给出 0,而 0 === 0
  // 会让下面那条断言变成一句废话。
  for (const [i, h] of loading.entries()) {
    expect(h, `加载态第 ${i} 张 KPI 卡的高度是 ${h} —— 量到的不是一个被布局过的盒子`).toBeGreaterThan(0);
  }

  // ── 放行,等数据落地 ──
  release();
  await expect(values).toHaveCount(4);
  await expect(cards).toHaveCount(4);
  const loaded = await cards.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));

  // ── 判决 ──
  for (const [i, after] of loaded.entries()) {
    const before = loading[i];
    expect(
      Math.abs(after - before),
      `第 ${i} 张 KPI 卡:加载时 ${before}px,数据落地后 ${after}px —— ` +
        `差 ${(after - before).toFixed(2)}px。骨架屏与值那一格的**外边距**没对上,` +
        `整条 KPI 会在数据到达的一瞬间弹一下(见 StatCard.tsx 里 mt-2 上的注释)`
    ).toBeLessThanOrEqual(SUBPIXEL_SLACK_PX);
  }
});
