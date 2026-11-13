import { expect, test } from "@playwright/test";
import { clean, recording, rows, watch } from "./support";

// 第三十八批第二入口:首页的「看租户隔离与审批流」打开 /#inside;两殿各列自己的灵魂,一件跨殿审判走四步。
test("the second entrance opens the two halls on the same request and walks the cross-hall case", async ({ page, context }) => {
  const seen = watch(context, page);
  await page.goto("/");
  await page.getByTestId("demo-home-inside").click();
  await expect(page).toHaveURL(/#inside$/);
  const inside = page.getByTestId("demo-inside");
  await expect(inside).toHaveAttribute("data-civ", "all");
  await expect(page.getByTestId("demo-inside-request")).toHaveText("GET /api/v1/souls/?page=1");

  // Each column is its own judge's recorded list: the other hall's first soul is in neither's rows.
  const cn = rows(recording("judge"), "/souls/");
  const eu = rows(recording("judge_eu"), "/souls/");
  const cnHall = page.getByTestId("demo-inside-hall-cn");
  const euHall = page.getByTestId("demo-inside-hall-eu");
  await expect(cnHall.getByTestId("demo-inside-row")).toHaveCount(4);
  await expect(cnHall.getByTestId("demo-inside-row").first()).toContainText(String(cn[0].name));
  await expect(cnHall).not.toContainText(String(eu[0].name).slice(0, 60));
  await expect(euHall.getByTestId("demo-inside-row").first()).toContainText(String(eu[0].name));
  await expect(page.getByTestId("demo-inside-count-cn")).toContainText(String(cn.length));
  // The probe is the recorded answer or says it is not recorded; never a number the page made up.
  const probe = cnHall.getByTestId("demo-inside-probe");
  await expect(probe).toContainText(`/souls/${eu[0].id}/`);
  const recorded = recording("judge").docs[`/souls/${eu[0].id}/`];
  if (recorded) await expect(probe.getByTestId("demo-inside-probe-status")).toContainText(String(recorded.s));
  else await expect(probe.getByTestId("demo-inside-probe-pending")).toBeVisible();

  // Four steps, prev / next / restart.
  const steps = page.getByTestId("demo-inside-steps").locator("li");
  await expect(steps).toHaveCount(4);
  await expect(steps.nth(0)).toHaveAttribute("data-state", "now");
  await expect(page.getByTestId("demo-inside-prev")).toBeDisabled();
  for (let i = 1; i < 4; i += 1) await page.getByTestId("demo-inside-next").click();
  await expect(steps.nth(3)).toHaveAttribute("data-state", "now");
  await expect(page.getByTestId("demo-inside-next")).toBeDisabled();
  await expect(page.getByTestId("demo-inside-away-evidence")).toContainText("200");
  await page.getByTestId("demo-inside-restart").click();
  await expect(steps.nth(0)).toHaveAttribute("data-state", "now");

  await page.getByTestId("demo-inside-home").click();
  await expect(page.getByTestId("demo-home-inside")).toBeVisible();
  clean(seen, "inside");
});

test("at 393 the halls switch in place and the step buttons stay on screen", async ({ page, context }) => {
  const seen = watch(context, page);
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/#inside");
  await expect(page.getByTestId("demo-inside-hall-cn")).toBeVisible();
  await expect(page.getByTestId("demo-inside-hall-eu")).toBeHidden();
  await page.getByTestId("demo-inside-pick-eu").click();
  await expect(page.getByTestId("demo-inside-hall-eu")).toBeVisible();
  await expect(page.getByTestId("demo-inside-hall-cn")).toBeHidden();
  await expect(page.getByTestId("demo-inside-next")).toBeInViewport();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(393);
  clean(seen, "inside 393");
});
