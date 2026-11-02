import { expect, test, type Page } from "@playwright/test";
import { clean, enter, recording, rows, watch, type Role } from "./support";

const SKINS: [string, Role][] = [["cn", "judge"], ["eu", "judge_eu"], ["eg", "judge_eg"], ["gr", "judge_gr"]];

for (const [skin, role] of SKINS) {
  test(`${skin}: a card enters as that civilization's judge, in its colour`, async ({ page, context }) => {
    const seen = watch(context, page);
    await page.goto("/");
    await page.getByTestId(`landing-card-${skin}`).click();
    await page.waitForURL((u) => u.pathname !== "/");
    await expect(page.locator("html")).toHaveAttribute("data-civ", skin);
    await expect(page.getByTestId("demo-tour")).toBeVisible();
    await expect(page.locator("main")).toBeVisible();
    expect(rows(recording(role), "/judgment/").length).toBeGreaterThan(3);
    clean(seen, `enter ${skin}`);
  });

  test(`${skin}: the tour runs to its end, and the steps light something up`, async ({ page, context }) => {
    test.setTimeout(90000);
    const seen = watch(context, page);
    await page.goto("/");
    await page.getByTestId(`landing-card-${skin}`).click();
    const card = page.getByTestId("demo-tour");
    await expect(card).toBeVisible();
    let steps = 0;
    const dark: string[] = [];
    await page.getByTestId("demo-tour-back").click();
    const total = skin === "cn" || skin === "gr" ? 6 : 5;
    for (; steps < total; steps += 1) {
      await expect(page.getByTestId("demo-tour-progress")).toContainText(`${steps + 1} / ${total}`);
      await expect(page.getByTestId("demo-tour-next")).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(100);
      const lit = await page.locator(".demo-tour-target").first().waitFor({ timeout: 6000 }).then(() => true, () => false);
      if (!lit) dark.push(`${steps + 1}:${new URL(page.url()).pathname}`);
      await page.getByTestId("demo-tour-next").click();
    }
    expect(steps).toBe(skin === "cn" || skin === "gr" ? 6 : 5);
    expect(dark, "steps with nothing highlighted").toEqual([]);
    await expect(page.locator('[data-testid="demo-tour"][data-finished]')).toBeVisible();
    await page.getByTestId("demo-tour-stay").click();
    await expect(card).toHaveCount(0);
    clean(seen, `tour ${skin}`);
  });
}

test("the tour survives a reload and a wrong page, and folds to a chip", async ({ page, context }) => {
  const seen = watch(context, page);
  await enter(page, "judge_eg");
  await page.getByTestId("demo-tour-back").click();
  await page.getByTestId("demo-tour-next").click();
  await expect(page.getByTestId("demo-tour-progress")).toContainText("2 / 5");
  await page.reload();
  await expect(page.getByTestId("demo-tour-progress")).toContainText("2 / 5");
  await page.goto("/notifications");
  await expect(page.getByTestId("demo-tour-back")).toBeVisible();
  await page.getByTestId("demo-tour-collapse").click();
  await expect(page.getByTestId("demo-tour-badge")).toContainText("2/5");
  await expect(page.locator(".demo-tour-target")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("demo-tour-badge")).toBeVisible();
  await page.getByTestId("demo-tour-badge").click();
  await page.getByTestId("demo-tour-back").click();
  await expect(page.getByTestId("demo-tour-next")).toBeVisible();
  clean(seen, "tour resilience");
});

for (const role of ["admin", "moderator"] as Role[]) {
  test(`${role} gets no tour`, async ({ page }) => {
    await enter(page, role);
    await page.waitForTimeout(500);
    await expect(page.getByTestId("demo-tour")).toHaveCount(0);
  });
}

test("signing out comes back to the four cards", async ({ page }) => {
  await enter(page, "judge_gr");
  await page.getByTestId("user-menu").click();
  await page.getByRole("button", { name: "登出", exact: true }).click();
  await page.getByRole("alertdialog").or(page.getByRole("dialog")).getByRole("button").last().click();
  await expect(page.getByTestId("landing-civs")).toBeVisible();
});

const openCase = (role: Role, want: (j: Record<string, unknown>) => boolean) => rows(recording(role), "/judgment/").find(want);
async function deskOf(page: Page, role: Role, want: (j: Record<string, unknown>) => boolean) {
  const row = openCase(role, want);
  expect(row, "a case in the recording").toBeTruthy();
  await enter(page, role);
  await page.goto(`/judgment/${row?.id}`);
  await expect(page.locator("main")).toBeVisible();
}

test("Egypt: the forty-two denials are heard on an open case", async ({ page }) => {
  await deskOf(page, "judge_eg", (j) => j.verdict == null && j.claimed_by != null);
  await page.getByRole("tab", { name: "供词" }).first().click();
  const panel = page.getByTestId("negative-confessions");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("confession-row")).toHaveCount(42);
  await expect(page.getByTestId("confession-tally")).not.toHaveText(/^0/);
  await expect(page.getByTestId("weighing-scale")).toBeVisible();
});

test("Egypt: a concluded case shows its weighing", async ({ page }) => {
  await deskOf(page, "judge_eg", (j) => j.verdict === "FAILED");
  await expect(page.locator("main")).toContainText(/称|心|羽/);
});

test("Europe: sentences land in Dante's circles and terraces", async ({ page }) => {
  await enter(page, "judge_eu");
  await page.goto("/disposition");
  await expect(page.locator("main")).toContainText(/色欲|欺诈/);
  await page.goto("/realms");
  await expect(page.locator("main")).toContainText(/炼狱/);
});

test("Greece: three judges at the fork; the unburied wait on the bank", async ({ page }) => {
  const flow = rows(recording("judge_gr"), "/workflows/").find((w) => w.case_type !== "REBIRTH_APPLICATION");
  await enter(page, "judge_gr");
  await page.goto(`/workflow/${flow?.id}`);
  await expect(page.locator("main")).toContainText(/拉达曼|Rhadamanth|埃阿科斯|Aeacus|米诺斯|Minos/);
  await page.goto("/judgment");
  await expect(page.locator("main")).toContainText("Alcestis");
});

test("China: the ten courts, the stations, Meng Po", async ({ page }) => {
  await enter(page, "judge");
  await page.goto("/realms");
  await expect(page.locator("main")).toContainText("第五殿");
  await page.goto(`/souls/${rows(recording("judge"), "/souls/").find((s) => String(s.name).startsWith("曹操"))?.id}`);
  await expect(page.getByTestId("soul-diyu-station")).toBeVisible();
  await page.goto("/rebirths");
  await expect(page.locator("main")).toContainText("屈原");
});
