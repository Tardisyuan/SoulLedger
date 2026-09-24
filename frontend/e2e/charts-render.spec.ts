/**
 * 图表**画出了数据标记**,而不只是画出了坐标轴和图例。
 *
 * WHY THIS IS AN E2E TEST AND NOT A JEST TEST。`src/__tests__/DashboardPage.test.tsx`
 * 里有一行:
 *
 *     jest.mock("@/src/components/charts/LazyDashboardCharts", ...)
 *
 * **2026-09-24 起 dashboard 没有饼图了**(规范 v1 §3.4:图例账代替饼图,
 * 各文明是账行不是柱)。页上仍用 recharts 的只剩「地域分布」柱状图,所以下面
 * 的计数断言改对着它;饼图那一半改成了对图例账的断言 —— 零值是一行,不是一块色。
 * 下面几段说的是饼图时代的事,道理对柱状图一样成立,留着。
 *
 * 整个图表模块被替换成桩。1689 个通过的单元测试对「饼图能不能画出来」一个字都
 * 没说 —— 它们断言的是「组件收到了正确的 props」,而不是「浏览器里出现了图形」。
 * 那两件事之间隔着 recharts、SVG 布局、以及一整套挂载动画。
 *
 * jsdom 也补不上这一段:它没有布局引擎,`ResponsiveContainer` 量到的宽高是 0,
 * 而 recharts 在 0 尺寸下本来就什么都不画。所以这个守卫只能跑在真浏览器里。
 *
 * WHAT IT ASSERTS AND WHY IT IS SHAPED THIS WAY。断言的是
 * `.recharts-pie-sector path` 与 `.recharts-bar-rectangle path` 的**数量**,不是
 * 容器的存在。这个区分是本守卫的全部意义:
 *
 *     <g class="recharts-pie-sector"><g class="recharts-shape"></g></g>
 *
 * 上面这段是「图表坏掉」时的真实 DOM —— 扇区容器在、图例在、坐标轴在,唯独
 * `<path>` 一个都没有。任何检查「图表容器是否存在」或「图例是否渲染」的断言
 * 都会在这种状态下通过。
 *
 * 数量对齐的是**非零**数据点:recharts 给每个 datum 建一个容器,但 count 为 0 的
 * 那个不产生图形 —— 这是对的,一个 0% 的扇区本就不该占面积。所以断言写成
 * 「非零项有几个,path 就该有几条」,而不是写死一个数字。
 *
 * A FALSE ALARM THIS TEST EXISTS BECAUSE OF。2026-08-28 我曾据此断定「应用里每个
 * 图表都是空的」,一路查到 recharts 版本、试过升级、准备提交 `isAnimationActive
 * ={false}`。全部证据都为真(接口有数据、DOM 里没有 path、关掉动画立刻出图、
 * 生产构建同样复现、升到 3.10.1 不解决),**结论却是错的**:那个无头预览环境的
 * 页面永远是 `visibilityState: "hidden"`,而隐藏标签页的 `requestAnimationFrame`
 * 不触发 —— 实测 15.7 秒 0 帧。动画不推进,标记就永远不生成。
 *
 * 所以这个文件顺带也是那件事的守卫:它跑在 Playwright 的真实浏览器里,rAF 正常,
 * 如果这里红了,那才是图表真的坏了。**「我在哪个环境里量的」和「我量到了什么」
 * 同样重要。**
 */

import { expect, test, LEDGER_STATS, setupAuthenticatedPage } from "./fixtures";

/** 一份刻意含零值、也含多租户的统计,让两个图都有东西可画。
 *
 * `tenants` 在共享的 `LEDGER_STATS` 里是空数组,柱状图因此无图可画;这里就地覆盖
 * 而不是改那份 fixture —— 别的 spec 依赖它现在的形状。 */
const STATS_WITH_MARKS = {
  ...LEDGER_STATS,
  total_souls: 84,
  state_distribution: [
    { state: "ALIVE", label: "在世", count: 60 },
    { state: "JUDGING", label: "审判中", count: 18 },
    { state: "DISPOSED", label: "已处置", count: 5 },
    { state: "REINCARNATING", label: "轮回中", count: 1 },
    // 零值刻意保留:它不该产生 path,而这正是「数量对齐非零项」的原因。
    { state: "LOST", label: "迷失", count: 0 },
  ],
  tenants: [
    {
      tenant_id: 1,
      tenant_code: "CN_DIYU",
      tenant_name: "Chinese Afterlife",
      total_souls: 60,
      state_breakdown: { ALIVE: 60 },
    },
    {
      tenant_id: 2,
      tenant_code: "EU_HEAVEN_HELL",
      tenant_name: "European Afterlife",
      total_souls: 24,
      state_breakdown: { ALIVE: 24 },
    },
  ],
};

/** 地域分布 is the one recharts chart left on the page; one realm is zero on purpose. */
const REALMS = [
  { realm_code: "DIYU_5", realm_name: "第五殿", civilization: "CHINESE", count: 40 },
  { realm_code: "INF_9", realm_name: "Ninth Circle", civilization: "EUROPEAN", count: 24 },
  { realm_code: "DUAT_1", realm_name: "First Hour", civilization: "EGYPTIAN", count: 0 },
];
const NON_ZERO_STATES = STATS_WITH_MARKS.state_distribution.filter(
  (s) => s.count > 0
).length;
const REALMS_WITH_SOULS = REALMS.filter((r) => r.count > 0).length;

test.describe("dashboard 的图表", () => {
  test("地域柱状图画出 <path>,不是只画出坐标轴", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    api.on("GET", "/ledger/stats/overview/", { ...STATS_WITH_MARKS, souls_by_realm: REALMS });

    await page.goto("/dashboard");

    // 数据确实进了页面 —— 否则下面是在对一个没拿到数据的页面测「没有图形」。
    await expect(page.getByText("n = 84")).toBeVisible();

    /* 分两段等:先「图表代码到位、series 挂上了」,再「画出了几条 path」。
     * recharts 是按需取的 551KB chunk,负载下单是下载就可能吃掉 3.5–4.3 秒,
     * 挂上之后 path 还要约 460ms(animationBegin 400ms)—— 2026-09-18 实测,
     * 两段合在一个 5 秒窗口里会偶发 `Received: 0`。第一段红 = 图表没挂上,
     * 第二段红 = 挂上了却没画东西。 */
    await expect(page.locator(".recharts-bar")).not.toHaveCount(0);
    await expect(page.locator(".recharts-bar-rectangle path")).toHaveCount(REALMS_WITH_SOULS);
  });

  test("没有饼图;图例账里零值是一行,不是一块色", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    api.on("GET", "/ledger/stats/overview/", STATS_WITH_MARKS);

    await page.goto("/dashboard");
    const ledger = page.locator("[data-legend-ledger]");
    await expect(ledger).toBeVisible();

    await expect(page.locator(".recharts-pie")).toHaveCount(0);
    // The proportion bar draws only non-zero states…
    await expect(ledger.locator('[aria-hidden="true"] > span')).toHaveCount(NON_ZERO_STATES);
    // …while every state, LOST at 0 included, keeps its ledger row with the number in text.
    await expect(ledger.locator('[data-legend-row="LOST"]')).toContainText("0%");
    await expect(ledger.locator('[data-legend-row="ALIVE"]')).toContainText("60");
  });
});
