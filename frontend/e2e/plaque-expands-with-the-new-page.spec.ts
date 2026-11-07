/**
 * 壳里的软导航:从滚过的页点侧栏进另一页,新页在顶上画出来的那一帧,标题行已经是展开的(2026-11-08)。
 *
 * 标题行(`Plaque`)在 AppLayout 里,跨页不重新挂载:旧页滚过 60 时它是收起的(44)。Next 在新页提交时把
 * 滚动设回 0(layout-router 的 layout effect),浏览器在下一帧画之前派发 scroll;标题行若只在 scroll
 * 处理里排一次普通优先级的 setState,那次重渲染落在画完之后 —— 新页在顶上、标题行还是收起的,画出来
 * 一帧,下一帧才长回 96 / 76。演示站从落地页进壳时撞到过同一个形状(`demo/DemoEntrances.tsx` 的 scrollTo(0))。
 *
 * 逐帧采样:在每一帧的 rAF 里记「路径、scrollY、有没有 data-compact」—— rAF 在 scroll 事件之后、画之前,
 * 读到的就是这一帧要画的状态。判据:路径已是新页、scrollY 为 0 的帧里,没有一帧是收起的。
 */
import { expect, test, setupAuthenticatedPage } from "./fixtures";

type Frame = { path: string; y: number; compact: boolean };

test("从滚过的页点侧栏进另一页:新页在顶上时标题行没有一帧是收起的", async ({ page }) => {
  await setupAuthenticatedPage(page);
  await page.goto("/dashboard");
  const band = page.getByTestId("plaque");
  await expect(band).toBeVisible();

  // 页面够长才收得起(余量判据,Plaque.tsx):在 React 根之外垫高 body,软导航时它留着,新页也一样长。
  await page.evaluate(() => {
    const pad = document.createElement("div");
    pad.style.height = "3000px";
    document.body.appendChild(pad);
    window.scrollTo({ top: 400, behavior: "instant" });
  });
  await expect(band).toHaveAttribute("data-compact", "");

  await page.evaluate(() => {
    const frames: Frame[] = [];
    (window as unknown as { __frames: Frame[] }).__frames = frames;
    const tick = () => {
      const b = document.querySelector("[data-testid='plaque']");
      frames.push({ path: location.pathname, y: scrollY, compact: !!b?.hasAttribute("data-compact") });
      if (frames.length < 600) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await page.locator("nav[aria-label='导航菜单']:visible").getByRole("link", { name: "灵魂" }).click();
  await expect(page).toHaveURL(/\/souls$/);
  await expect(band).not.toHaveAttribute("data-compact");

  // 新页落地后再多看一段,覆盖晚到的提交(加载边界 → 列表)。
  await page.waitForFunction(() => {
    const f = (window as unknown as { __frames: Frame[] }).__frames;
    const first = f.findIndex((x) => x.path === "/souls");
    return first >= 0 && f.length - first >= 30;
  });
  const frames = await page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames);
  const arrived = frames.filter((f) => f.path === "/souls" && f.y === 0);
  expect(arrived.length).toBeGreaterThan(0);
  expect(
    arrived.filter((f) => f.compact),
    JSON.stringify(frames.filter((f) => f.path === "/souls").slice(0, 12))
  ).toEqual([]);
  // 旧页上确实是收起的 —— 不然上面那条量的是一条从来没收起的标题行。
  expect(frames.some((f) => f.path === "/dashboard" && f.compact)).toBe(true);
});
