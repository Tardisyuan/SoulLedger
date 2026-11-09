import { expect, test, type Page } from "@playwright/test";
import { clean, enter, expectSealHandedOver, handOff, recording, rows, watch, watchHandOff, type Role } from "./support";

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

test("signing out says farewell in Greece's words, then comes back to the four cards", async ({ page }) => {
  await enter(page, "judge_gr");
  await page.getByTestId("user-menu").click();
  await page.getByRole("button", { name: "登出", exact: true }).click();
  await page.getByRole("alertdialog").or(page.getByRole("dialog")).getByRole("button").last().click();
  // /goodbye first (AppLayout's handleLogout): named, the Greek line; it goes home by itself after six seconds.
  await expect(page).toHaveURL(/\/goodbye$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^再会，.+/);
  await expect(page.getByText("渡船已经离岸。")).toBeVisible();
  await expect(page).toHaveURL((u) => u.pathname === "/", { timeout: 10_000 });
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
      await expect(page.getByTestId("rebirths-not-applicable")).toContainText(/没有转生|No rebirth/);
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

// The cover used to end with its seal at a spot written into the CSS (252px + 40px across, 80px down), while the band's
// real seal sat 190px further right: the two jumped apart at the hand-over. Now the cover's last frame has the seal on
// the console's own, and the console (not the landing page) under it.
const WAYS_IN: [string, string][] = [...SKINS.map(([skin]): [string, string] => [skin, `landing-card-${skin}`]), ["admin", "demo-enter-admin"], ["moderator", "demo-enter-moderator"]];
for (const [way, testId] of WAYS_IN) {
  test(`${way}: the cover's seal lands on the console's own`, async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await watchHandOff(page);
    await page.getByTestId(testId).click();
    expectSealHandedOver(await handOff(page));
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

test("from one underworld to another: the seal covers it, no cross-fade of the old page, no cut afterwards", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("landing-card-cn").click();
  await expect(page.getByTestId("demo-entrance")).toHaveCount(0, { timeout: 6000 });
  // The finished tour's card, where the other three seals are.
  await page.evaluate(() => sessionStorage.setItem("soulledger_demo_tour", JSON.stringify({ step: 0, finished: true })));
  await page.reload();
  await page.waitForLoadState("networkidle");
  const other = page.getByTestId("demo-tour-other-eu");
  await expect(other).toBeVisible();
  const from = new URL(page.url()).pathname;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  // It used to cross-fade the cn page into the cn page in eu's colours, and cut to the eu page 0.5–1 s later.
  await page.evaluate(() => {
    const seen = { seal: false, fadeFrames: 0, waitingAfter: 0, oldCivAfter: 0, pathAtGone: "" };
    (window as unknown as { __switch: typeof seen }).__switch = seen;
    let after = 0;
    const tick = () => {
      const sealUp = !!document.querySelector("[data-testid='demo-entrance']");
      if (sealUp) seen.seal = true;
      if (document.getAnimations().some((a) => String((a.effect as KeyframeEffect | null)?.pseudoElement ?? "").startsWith("::view-transition"))) seen.fadeFrames++;
      if (seen.seal && !sealUp) {
        if (!after) seen.pathAtGone = location.pathname;
        after++;
        if (document.documentElement.dataset.civ !== "eu") seen.oldCivAfter++;
        if (document.querySelector("[data-civ-loading], [data-testid='permissions-pending']")) seen.waitingAfter++;
      }
      if (after < 30) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await other.hover();
  await other.click();
  await expect(page.getByTestId("demo-entrance")).toBeVisible();
  await expect(page.getByTestId("demo-entrance")).toHaveCount(0, { timeout: 6000 });
  await page.waitForTimeout(1000);
  const seen = await page.evaluate(() => (window as unknown as { __switch: { pathAtGone: string } }).__switch);
  expect(seen).toEqual({ seal: true, fadeFrames: 0, waitingAfter: 0, oldCivAfter: 0, pathAtGone: expect.not.stringMatching(new RegExp(`^${from}$`)) });
  // Nothing arrived after the seal went: the page it uncovered is the page that stays.
  expect(new URL(page.url()).pathname).toBe(seen.pathAtGone);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
});

// The two buttons under the cards used to sign in with no cover: the landing page stood, button spinning, until the
// console replaced it (about 1 s on a desktop, 3.5 s on a slow phone).
for (const [role, civ] of [["admin", null], ["moderator", "cn"]] as const) {
  test(`${role}: the way in is covered until the console is up${civ ? `, by ${civ}'s seal` : ", by a neutral cover"}`, async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    // From the click on, every frame: the landing page in view with no cover over it is the defect.
    await page.evaluate(() => {
      const seen = { seal: false, bare: 0 };
      (window as unknown as { __entry: typeof seen }).__entry = seen;
      const tick = () => {
        const sealUp = !!document.querySelector("[data-testid='demo-entrance']");
        const landing = !!document.querySelector("[data-testid='landing-civs']");
        if (sealUp) seen.seal = true;
        if (landing && !sealUp) seen.bare++;
        if (landing || sealUp) requestAnimationFrame(tick);
      };
      document.addEventListener("click", () => requestAnimationFrame(tick), { capture: true, once: true });
    });
    await page.getByTestId(`demo-enter-${role}`).click();
    const cover = page.getByTestId("demo-entrance");
    await expect(cover).toBeVisible();
    if (civ) await expect(cover).toHaveAttribute("data-civ", civ);
    else {
      await expect(cover).toHaveAttribute("data-neutral", "");
      await expect(cover).not.toHaveAttribute("data-civ", /./);
      await expect(cover.locator("[data-brand-mark]")).toHaveCount(1);
    }
    await expect(cover).toHaveCount(0, { timeout: 8000 });
    await expect(page).not.toHaveURL(/\/$/);
    await expect(page.getByTestId("user-menu")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __entry: object }).__entry)).toEqual({ seal: true, bare: 0 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  });
}

// 「回放这一生」used to stop only at stops with a date. 屈原 has no station-change events, so the replay was one court:
// the thirteen stations went dark for 1.2 s and the map snapped back. Now it walks the road, a stop at a time.
test("China: replaying 屈原's life walks the stations one by one", async ({ page }) => {
  await enter(page, "judge");
  await page.getByTestId("demo-tour-collapse").click();
  const button = page.getByTestId("underworld-map-replay");
  await button.scrollIntoViewIfNeeded();
  const states = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-testid='underworld-map'] g.node[id]"))
        .map((n) => `${n.id}:${n.getAttribute("data-state")}`)
        .join(","),
    );
  const now = await states();
  await button.click();
  const card = page.getByTestId("underworld-map-replay-card");
  await expect(card).toContainText(/1 \/ \d+/);
  const total = Number((await card.textContent())?.match(/1 \/ (\d+)/)?.[1]);
  expect(total).toBeGreaterThanOrEqual(10);
  // The first stop is the first station on the road, and what lies beyond it is dark.
  const map = page.getByTestId("underworld-map");
  await expect(map.locator("g.node#TUDI_TEMPLE")).toHaveAttribute("data-state", "current");
  await expect(map.locator("g.node#HUANHUN_CLIFF")).toHaveAttribute("data-state", "ahead");
  const seen = new Set([await states()]);
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(600);
    seen.add(await states());
  }
  // Moving on its own: the current stop changes over time, and none of these is the map as it is now.
  expect(seen.size).toBeGreaterThanOrEqual(4);
  await expect(card).toContainText(/[3-9] \//);
  expect(seen.has(now)).toBe(false);
  await card.click();
  await expect(card).toHaveCount(0);
  expect(await states()).toBe(now);
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
