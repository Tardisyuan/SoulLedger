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
  await expect(page.locator("main")).toContainText("Katerina Doukas");
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

const NO_REBIRTH = /轮回|转世|转生|rebirth|reincarnat/i;
/** Copy that really does say there is none, and the app's fixed labels that apply to every civilization. */
const SAYS_THERE_IS_NONE = /没有转生|没有转世|无转世|no rebirth/i;
for (const role of ["judge_eu", "judge_eg"] as Role[]) {
  test.describe(`${role}: its afterlife has no wheel`, () => {
    const rec = recording(role);
    const pick = (list: string, want: (r: Record<string, unknown>) => boolean) => rows(rec, list).find(want)?.id;
    const routes = [
      "/dashboard",
      "/disposition",
      "/notifications",
      "/social",
      "/sentence-requests",
      `/judgment/${pick("/judgment/", (j) => j.verdict != null)}`,
      `/souls/${pick("/souls/", (s) => s.current_state !== "ALIVE")}`,
    ];
    test("the sidebar has no door to it", async ({ page }) => {
      await enter(page, role);
      await page.goto("/dashboard");
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("button", { name: "灵魂业务" }).or(page.getByRole("link", { name: "灵魂管理" })).first()).toBeVisible();
      await expect(page.locator('a[href="/rebirths"], a[href="/rebirth-applications"]')).toHaveCount(0);
      expect((await page.locator("aside, nav").allInnerTexts()).join("\n")).not.toMatch(NO_REBIRTH);
    });
    // v4 第八批第 7 条: the door is gone, and a direct link says so instead of showing the six paths.
    test("/rebirths opened directly: a page saying there is no rebirth here", async ({ page }) => {
      await enter(page, role);
      await page.goto("/rebirths");
      await expect(page.getByTestId("rebirths-not-applicable")).toContainText(/没有转世|No rebirth/);
      await expect(page.locator("main table")).toHaveCount(0);
    });
    for (const route of routes) {
      test(route.replace(/[0-9a-f-]{36}/, "<id>"), async ({ page }) => {
        await enter(page, role);
        await page.goto(route);
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(300);
        const lines = (await page.locator("main").innerText()).split("\n");
        expect(lines.filter((line) => NO_REBIRTH.test(line) && !SAYS_THERE_IS_NONE.test(line))).toEqual([]);
      });
    }
  });
}

for (const [role, name] of [["judge", "屈原"], ["judge_eu", "Francesca da Rimini"], ["judge_eg", "Nefertari"], ["judge_gr", "Penelope"]] as [Role, string][]) {
  test(`${name} lived in one stretch of history: no 2026 on the soul, its case or its flow`, async ({ page }) => {
    const rec = recording(role);
    const soul = rows(rec, "/souls/").find((s) => String(s.name).startsWith(name));
    const judgment = rows(rec, "/judgment/").find((j) => j.soul === soul?.id);
    const flow = rows(rec, "/workflows/").find((w) => w.soul === soul?.id);
    // The case itself says when, and it is that life's: a reborn soul's death is cleared, but its case is not.
    expect(String(judgment?.case_number)).not.toContain("null");
    expect(Math.abs(new Date(String(judgment?.created_at)).getUTCFullYear())).toBeGreaterThan(50);
    expect(new Date(String(judgment?.created_at)).getUTCFullYear()).toBeLessThan(2000);
    await enter(page, role);
    await page.getByTestId("demo-tour-skip").click().catch(() => {});
    for (const route of [`/souls/${soul?.id}`, `/judgment/${judgment?.id}`, `/workflow/${flow?.id}`]) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(300);
      const lines = (await page.locator("main").innerText()).split("\n");
      expect(lines.filter((line) => /2026/.test(line)), route).toEqual([]);
    }
  });
}

for (const route of ["queue", "open"]) {
  test(`1280x800: the tour card does not cover the verdict keys (${route})`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await enter(page, "judge_eg");
    const open = rows(recording("judge_eg"), "/judgment/").find((j) => j.verdict == null && j.claimed_by != null)?.id;
    await page.goto(route === "queue" ? "/judgment/queue" : `/judgment/${open}`);
    await page.waitForLoadState("networkidle");
    const key = page.getByText("重审", { exact: true }).filter({ visible: true }).first();
    await key.scrollIntoViewIfNeeded();
    await expect(page.getByTestId("demo-tour")).toBeVisible();
    await page.waitForTimeout(700);
    const covered = await key.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return !!top?.closest("[data-testid='demo-tour']");
    });
    expect(covered).toBe(false);
  });
}

test("the seal goes once the console is under it, and Esc skips it", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  // A slow machine, where the sign-in outlasts the seal: the seal used to go at 700 ms and leave the landing page up for
  // about a second more (CPU x4: seal gone at 1476 ms, URL changed at 2228 ms, the soul's page at 3073 ms).
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  // Watched in the page, every frame: a check from the test runner polls too slowly to see a gap of a few hundred ms.
  await page.evaluate(() => {
    const seen = { seal: false, landingAfter: 0, waitingAfter: 0, gone: false };
    (window as unknown as { __seal: typeof seen }).__seal = seen;
    let after = 0;
    const tick = () => {
      const sealUp = !!document.querySelector("[data-testid='demo-entrance']");
      if (sealUp) seen.seal = true;
      if (seen.seal && !sealUp) {
        seen.gone = true;
        after++;
        if (document.querySelector("[data-testid^='landing-card-']")) seen.landingAfter++;
        if (document.querySelector("[data-civ-loading], [data-testid='permissions-pending']")) seen.waitingAfter++;
      }
      if (after < 30) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.getByTestId("landing-card-cn").click();
  await expect(page.getByTestId("demo-entrance")).toBeVisible();
  await expect(page.getByTestId("demo-entrance")).toHaveCount(0, { timeout: 6000 });
  await expect(page).not.toHaveURL(/\/$/);
  await page.waitForTimeout(1000);
  // Frames after the seal went in which the landing page, or a route still waiting, was what showed.
  expect(await page.evaluate(() => (window as unknown as { __seal: object }).__seal)).toEqual({ seal: true, landingAfter: 0, waitingAfter: 0, gone: true });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await page.goto("/");
  await page.getByTestId("landing-card-cn").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("demo-entrance")).toHaveCount(0, { timeout: 300 });
});

test("Greece: the tour's second step lights the crossing line, the third the judges' fork", async ({ page }) => {
  await enter(page, "judge_gr");
  // A judge lands on the protagonist's page: the first step is already where it points, no 回到这一步 to press.
  await page.getByTestId("demo-tour-next").click();
  await expect(page.getByTestId("soul-ferry-passage")).toHaveClass(/demo-tour-target/);
  await page.getByTestId("demo-tour-next").click();
  await expect(page).toHaveURL(/\/workflow\//);
  await expect(page.locator(".demo-tour-target")).toContainText("Rhadamanthus");
});

// v4 第十批第 1 条: the band under the cards shows the soul app in a phone, and leads back to the same underworld's judge.
for (const [skin, rebirth] of [["cn", true], ["eg", false]] as const) {
  test(`${skin}: the soul entrance draws the app at its own size, and goes back to the judge`, async ({ page, context }) => {
    const seen = watch(context, page);
    await page.goto("/");
    await page.getByTestId(`demo-soul-${skin}`).click();
    await expect(page.getByTestId("demo-soul")).toHaveAttribute("data-civ", skin);
    await expect(page.getByTestId("demo-soul-note")).toHaveText("这是灵魂端 App 里的样子。正式网页只给官员和管理员用。");
    const phone = await page.getByTestId("demo-soul-phone").boundingBox();
    expect(phone && [Math.round(phone.width), Math.round(phone.height)]).toEqual([393, 852]);
    // 转生 only where souls go round.
    await expect(page.getByTestId("demo-soul-phone").getByRole("button", { name: "转生" })).toHaveCount(rebirth ? 1 : 0);
    await page.getByTestId("demo-soul-back").click();
    await page.waitForURL((u) => u.pathname !== "/");
    await expect(page.locator("html")).toHaveAttribute("data-civ", skin);
    clean(seen, `soul entrance ${skin}`);
  });
}
