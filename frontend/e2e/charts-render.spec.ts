/**
 * 图表**画出了数据标记**,而不只是画出了坐标轴和图例。
 *
 * WHY THIS IS AN E2E TEST AND NOT A JEST TEST。`src/__tests__/DashboardPage.test.tsx`
 * 里有一行:
 *
 *     jest.mock("@/src/components/charts/LazyDashboardCharts", ...)
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

const NON_ZERO_STATES = STATS_WITH_MARKS.state_distribution.filter(
  (s) => s.count > 0
).length;
const TENANTS_WITH_SOULS = STATS_WITH_MARKS.tenants.filter(
  (t) => t.total_souls > 0
).length;

test.describe("dashboard 的图表", () => {
  test("饼图与柱状图画出 <path>,不是只画出坐标轴和图例", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    api.on("GET", "/ledger/stats/overview/", STATS_WITH_MARKS);

    await page.goto("/dashboard");

    // KPI 先到,证明数据确实进了页面 —— 否则下面两条断言可能是在对着一个
    // 根本没拿到数据的页面测「没有图形」,那会以正确的理由给出正确的结果,
    // 而它守不住任何东西。
    await expect(page.getByText("84").first()).toBeVisible();

    /* 分两段等,而且**第二段的 5 秒不再被下载时间吃掉** —— 这一句此前写的是
     * 「懒加载 + 挂载动画都在 toHaveCount 的自动重试窗口里」,那是一句没有量过
     * 的话,而它是假的。2026-09-18 实测(mobile-chrome,机器同时在跑别的套件):
     *
     *   - 图表代码是按需取的:`LazyDashboardPieChart` 要到数据回来、组件第一次
     *     渲染时才发出 `import("recharts")`,而那个 chunk 是 551KB(gzip 142KB)。
     *     单进程的 `next start` 在负载下发这一个文件要 **3.5–4.3 秒**(同一时刻
     *     用 curl 取同一个文件是 0.6–2.9 秒,所以慢在服务端,不在浏览器);
     *   - 扇区容器挂上之后,`<path>` 还要再等 **约 460ms** 才出现 —— recharts 的
     *     `animationBegin` 默认 400ms;
     *   - 这两段加起来超过 `toHaveCount` 默认的 5 秒,于是这条用例在高负载下
     *     偶发变红,报的是 `Received: 0`。失败样本里容器尺寸一律是 311×240、
     *     path 也总在容器之后 460ms 出现,**页面本身没有缺陷**。
     *
     * 所以:先等「图表代码到位、series 挂上了」,再等「画出了几条 path」。
     * **如实说明代价:两段各有 5 秒,总允许时间因此放宽到约 10 秒。** 换来的是
     * 两件事分开报错 —— 第一段红 = 图表没挂上(代码没到 / 组件炸了),第二段红
     * = 挂上了却没画东西,也就是本文件开头那段「容器在、path 一条都没有」的
     * 真缺陷。
     */
    await expect(page.locator(".recharts-pie")).not.toHaveCount(0);
    await expect(page.locator(".recharts-bar")).not.toHaveCount(0);

    await expect(page.locator(".recharts-pie-sector path")).toHaveCount(
      NON_ZERO_STATES
    );
    await expect(page.locator(".recharts-bar-rectangle path")).toHaveCount(
      TENANTS_WITH_SOULS
    );

    // 想过再加一条「图形占了地方吗」的几何断言,写了、也试着让它红,**没能红**,
    // 所以删掉了 —— 一个造不出失败场景的断言,没有被证明有效。留下试过的两条路,
    // 免得下一个人重走:
    //
    //   `outerRadius={0}`      → recharts 一条 path 都不出,上面的计数断言先红,
    //                            几何断言根本走不到。
    //   `innerRadius=outerRadius` → 零厚度圆环,四条断言全绿。因为 `getBBox()` 量的
    //                            是路径的**包围盒范围**,不是可见面积;一段零厚度
    //                            弧线的包围盒照样很大。
    //
    // 换句话说,`getBBox` 回答不了「用户看得见吗」。真要守这一层,得比对像素
    // (Playwright 的截图对比),那是另一件事,不是往这个文件里塞一行 expect。
  });

  test("零值数据点不产生图形", async ({ page }) => {
    /** 上一条断言的另一半。若哪天 recharts 开始给 0 值也画一条零宽 path,
     * 上一条会因为数量对不上而红,但读的人未必知道是这个原因 —— 这一条把
     * 「0 不该占面积」单独说出来。 */
    const api = await setupAuthenticatedPage(page);
    api.on("GET", "/ledger/stats/overview/", {
      ...STATS_WITH_MARKS,
      // 一个非零 + 两个零,而不是从前的「三个都是零」。改法的理由在下面。
      state_distribution: [
        { state: "ALIVE", label: "在世", count: 7 },
        { state: "JUDGING", label: "审判中", count: 0 },
        { state: "LOST", label: "迷失", count: 0 },
      ],
      total_souls: 7,
    });

    await page.goto("/dashboard");
    await expect(page.getByText("7").first()).toBeVisible();

    /* 「零值不画」要靠一条**自带前提**的断言来说,而不是靠 `toHaveCount(0)`。
     *
     * 这一条此前的形状是「三个数据点都是 0,断言 path 数为 0」。那句断言在图表
     * 代码还没下载完的时候就已经成立 —— 它可以在骨架屏上通过,一个字都没有验证。
     * 而先等 `.recharts-pie` 挂上也不够:recharts 的 `animationBegin` 默认 400ms,
     * 容器挂上之后 path 还要约 460ms 才出现,`toHaveCount(0)` 在这段空窗里照样
     * 立刻成立。这两点都是变异实测出来的 —— 把页面改成「零值也当 1 画」
     * (`value: Math.max(s.count, 1)`),两个版本都还是绿的;连「等同屏的柱状图
     * 先画出 2 条 path」也只在 6 次里红 3 次,因为两个图谁先画完并不保证。
     *
     * 现在数据里留一个非零项,断言 **path 恰好一条**:这句话只有在「画图阶段
     * 已经发生」时才可能成立(零条不等于一条),而它同时就是「两个零值没有各
     * 占一条」。同一变异下 6 次全红(Expected 1,Received 3)。
     */
    await expect(page.locator(".recharts-pie-sector path")).toHaveCount(1);
  });
});
