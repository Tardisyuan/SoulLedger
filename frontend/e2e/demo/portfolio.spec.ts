import { expect, test } from "@playwright/test";
import { clean, enter, recording, rows, watch } from "./support";

// 2026-11-12 作品集建议 A1:演示首页有「这是怎么做的」(正式版落地页的同一个组件),导览结尾的链接到得了它。
test("the home page shows how it was built: architecture, test counts, the two app recordings", async ({ page, context }) => {
  const seen = watch(context, page);
  await page.goto("/");
  // The section was found and then replaced before the scroll (detached, twice in one run, 2026-11-14): the server's
  // page was thrown away when a provider's context changed before its lazy chunk had hydrated. app/page.tsx now draws
  // it in the browser only (`ssr: false`; the cause is read from React's source, not reproduced). If it is replaced anyway, the failure says what
  // the console said.
  await page.waitForLoadState("networkidle");
  const section = page.locator("#how-built");
  await section.scrollIntoViewIfNeeded().catch((e: Error) => {
    throw new Error(`${e.message}\nconsole errors: ${seen.errors.join(" | ") || "none"}`);
  });
  await expect(section.getByTestId("landing-architecture")).toBeVisible();
  await expect(section.getByTestId("landing-numbers").locator("dd")).toHaveCount(5);
  await expect(section.locator("video")).toHaveCount(2);
  clean(seen, "home how-built");
});

// A3:第二条导览,以管理员身份,每一步点亮界面上真实的东西。
test("the safeguards tour enters as the administrator and lights up something on each of its seven steps", async ({ page, context }) => {
  test.setTimeout(90000);
  const seen = watch(context, page);
  await page.goto("/");
  await page.getByTestId("demo-home-guard").click();
  await page.waitForURL((u) => u.pathname === "/tenants");
  const card = page.locator('[data-testid="demo-tour"][data-tour="guard"]');
  await expect(card).toBeVisible();
  const routes = ["/tenants", "/permissions", "/permissions", "/permissions", "/audit", "/recycle-bin", "/admin/assistant"];
  const dark: string[] = [];
  for (const [i, route] of routes.entries()) {
    await expect(page.getByTestId("demo-tour-progress")).toContainText(`${i + 1} / 7`);
    await expect(page.getByTestId("demo-tour-next")).toBeVisible({ timeout: 10000 });
    expect(new URL(page.url()).pathname).toBe(route);
    const lit = await page.locator(".demo-tour-target").first().waitFor({ timeout: 6000 }).then(() => true, () => false);
    if (!lit) dark.push(`${i + 1}:${route}`);
    await page.getByTestId("demo-tour-next").click();
  }
  expect(dark, "steps with nothing highlighted").toEqual([]);
  await expect(page.locator('[data-testid="demo-tour"][data-finished]')).toBeVisible();
  await expect(page.locator('[data-testid^="demo-tour-other-"]')).toHaveCount(4);
  clean(seen, "guard tour");
});

// A4:越权试验回放的是录下来的真实 403,不是演示编的成功。
test("the overreach step replays the judge's recorded 403, with the reason and where it is enforced", async ({ page, context }) => {
  const seen = watch(context, page);
  await page.goto("/");
  await page.getByTestId("demo-home-guard").click();
  await page.waitForURL((u) => u.pathname === "/tenants");
  await page.getByTestId("demo-tour-next").click();
  await page.getByTestId("demo-tour-next").click();
  await expect(page.getByTestId("demo-tour-progress")).toContainText("3 / 7");
  await page.getByTestId("demo-overreach-try-vertical").click();
  const answer = page.getByTestId("demo-overreach-answer-vertical");
  await expect(page.getByTestId("demo-overreach-status-vertical")).toHaveText("403");
  await expect(answer).toContainText("You do not have permission to perform this action.");
  await expect(answer).toContainText("demo_judge");
  await expect(answer).toContainText("CanReadPermissionCatalogue");
  // Still the administrator's console: the probe changed no one's sign-in.
  await expect(page.locator("main table").first()).toBeVisible();
  clean(seen, "overreach");
});

// 2026-11-14 用户定(叙事传输):走完一生,访客自己撞一次租户隔离 —— 结束卡上的按钮问的是录下的横向越权,答 404。
// 埃及殿走,而探针是中国殿判官要欧洲殿的灵魂:它只读录音,与当前是哪一殿无关。首页第一张卡标「从这里开始」,只此一张。
test("the walked tour ends on 「试着打开别的殿的案卷」, which replays the recorded 404 from another hall", async ({ page, context }) => {
  test.setTimeout(90000);
  const seen = watch(context, page);
  await page.goto("/");
  await expect(page.getByTestId("landing-start-here")).toHaveCount(1);
  await expect(page.getByTestId("landing-card-cn").getByTestId("landing-start-here")).toBeVisible();
  await page.getByTestId("landing-card-eg").click();
  await expect(page.getByTestId("demo-tour")).toBeVisible();
  for (let step = 1; step <= 5; step += 1) {
    await expect(page.getByTestId("demo-tour-progress")).toContainText(`${step} / 5`);
    await expect(page.getByTestId("demo-tour-next")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("demo-tour-next").click();
  }
  const end = page.locator('[data-testid="demo-tour"][data-finished]');
  await expect(end).toBeVisible();
  await end.getByTestId("demo-tour-try-overreach").click();
  const status = end.getByTestId("demo-overreach-status-lateral");
  await expect(status).toHaveText("404");
  await expect(status).toHaveAttribute("data-tone", "muted");
  await expect(end.getByTestId("demo-overreach-answer-lateral")).toContainText(`/souls/${rows(recording("judge_eu"), "/souls/")[0].id}/`);
  await expect(end.getByTestId("demo-tour-try-overreach")).toHaveCount(0);
  await expect(end.locator("[data-probe]")).toHaveCount(1);
  clean(seen, "tour try overreach");
});

// A5:案子页上的「并发与事务」,试一下得到的是 409 already_concluded,不是第二份裁决。
test("a case's 「并发与事务」 explains the lock and replays the second conclusion as a 409", async ({ page, context }) => {
  const seen = watch(context, page);
  await enter(page, "judge");
  const open = rows(recording("judge"), "/judgment/").find((j) => !j.is_final && j.verdict == null)!;
  await page.goto(`/judgment/${open.id}`);
  await page.getByTestId("demo-txn-open").click();
  const card = page.getByTestId("demo-txn");
  await expect(card).toContainText("select_for_update");
  await page.getByTestId("demo-txn-try").click();
  await expect(page.getByTestId("demo-txn-status")).toHaveText("409");
  await expect(page.getByTestId("demo-txn-result")).toContainText("already_concluded");
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await expect(page.locator("main")).toBeVisible();
  clean(seen, "transactions card");
});

test("the 「并发与事务」 link is only on a case's own page", async ({ page }) => {
  await enter(page, "judge");
  await page.goto("/judgment");
  await expect(page.getByTestId("demo-banner")).toBeVisible();
  await expect(page.getByTestId("demo-txn-open")).toHaveCount(0);
});

test("the administrator from the roles row opens on the 总簿, with no tour and the hint", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("demo-home-guard").click();
  await page.waitForURL((u) => u.pathname === "/tenants");
  await page.goto("/");
  await page.getByTestId("demo-enter-admin").click();
  await page.waitForURL((u) => u.pathname === "/desk/overview");
  await page.getByTestId("demo-entrance").waitFor({ state: "detached" });
  await expect(page.getByTestId("demo-tour")).toHaveCount(0);
  await expect(page.getByTestId("demo-admin-hint")).toBeVisible();
});

test("the finished tour's 「这是怎么做的」 lands on that section, not on a missing anchor", async ({ page, context }) => {
  const seen = watch(context, page);
  await enter(page, "judge_eu");
  await page.getByTestId("demo-tour-skip").click();
  await expect(page.getByTestId("demo-tour")).toHaveCount(0);
  await page.getByTestId("demo-tour-badge").click();
  await page.getByTestId("demo-tour-how-built").click();
  await page.waitForURL((u) => u.pathname === "/" && u.hash === "#how-built");
  await expect(page.locator("#how-built")).toBeInViewport();
  clean(seen, "tour how-built link");
});
