import { test, expect, setupAuthenticatedPage, OPENED_JUDGMENT, SOUL_DETAIL, SOUL_LEDGER } from "./fixtures";

/**
 * The judgment triage queue (BRIEF §4.2) — the loop the whole feature exists
 * to close: open the queue, rule on a case, land on the next one without a
 * navigation.
 *
 * Mocked at the route layer like the other specs (see fixtures.ts), so what is
 * pinned down here is the front end's behaviour: that it asks
 * `GET /judgment/next/` for the cursor, that a verdict key advances the console
 * on its own, and that the verdict is POSTed at once. There is no undo window
 * (removed 2026-09-25, 「落判即提交,不可撤回」, as on the desk): once
 * `POST .../conclude/` has created the disposition, changing it is the ADMIN
 * correction, not something this console offers.
 */

const FIRST = { ...OPENED_JUDGMENT, court: "第一殿" };
const SECOND = {
  ...OPENED_JUDGMENT,
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  soul_name: "第二位待判者",
  court: "第二殿",
};

/** The `next` cursor body: JudgmentViewSet.next_pending's response shape. */
function cursor(judgment: typeof FIRST | null, remaining: number) {
  return {
    total: 2,
    remaining,
    skipped: 2 - remaining,
    position: judgment ? 2 - remaining + 1 : null,
    judgment,
    soul: judgment ? { ...SOUL_DETAIL, name: judgment.soul_name } : null,
    ledger: judgment ? SOUL_LEDGER : null,
    prior_cycles: [],
    realm_options: [
      {
        id: "realm-1",
        realm_code: "DY_01_HEAVEN",
        civilization: "CHINESE",
        display_name: "天道",
        name_local: "天道",
        realm_type: "HEAVEN",
        tier: 1,
        is_eternal: false,
      },
    ],
  };
}

test.describe("Critical path: the judgment triage queue", () => {
  test("opens the queue, rules on a case, and advances to the next", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);

    // The cursor answers from a live worklist: whatever is not skipped.
    // (RecordedCall.query is a flat map, so a repeated `skip` keeps only the
    // last value — enough here, since the console never holds more than one.)
    api.on("GET", "/judgment/next/", (call) => {
      const skipped = call.query.skip ?? "";
      const queue = [FIRST, SECOND].filter((j) => !skipped.includes(j.id));
      return { body: cursor(queue[0] ?? null, queue.length) };
    });
    api.on("POST", "/judgment/:id/conclude/", (call) => ({
      body: { ...FIRST, verdict: call.body?.verdict, is_final: true },
    }));

    // ── Enter the queue from the judgment list ──
    await page.goto("/judgment");
    await page.getByRole("link", { name: "进入分诊队列" }).click();
    await expect(page).toHaveURL(/\/judgment\/queue/);

    // ── One case, with its whole decision surface ──
    await expect(page.getByRole("heading", { name: "审判分诊队列" })).toBeVisible();
    await expect(page.getByText(FIRST.soul_name)).toBeVisible();
    await expect(page.getByText("第 1 / 共 2 条")).toBeVisible();
    await expect(page.getByRole("heading", { name: "功过账簿" })).toBeVisible();
    await expect(page.getByText("天道")).toBeVisible();
    // A queue, not a list: the next case is not on screen.
    await expect(page.getByText(SECOND.soul_name)).toHaveCount(0);

    // ── Rule on it with the keyboard ──
    await page.keyboard.press("1");

    // Advances immediately, and the verdict is sent at once — no undo offered.
    await expect(page.getByText(SECOND.soul_name)).toBeVisible();
    await expect(page.getByText("第 2 / 共 2 条")).toBeVisible();
    await expect.poll(() => api.countOf("POST", "/judgment/:id/conclude/")).toBe(1);
    expect(api.lastCall("POST", "/judgment/:id/conclude/")?.body).toEqual({
      verdict: "PASSED",
      notes: "",
      create_workflow: false,
    });
    await expect(page.getByRole("button", { name: "撤销" })).toHaveCount(0);

    // ── Leaving sends nothing more ──
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/judgment$/);
    expect(api.countOf("POST", "/judgment/:id/conclude/")).toBe(1);
  });

  test("a case claimed by another officer says who, and is set aside for the sitting", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    api.on("GET", "/judgment/next/", (call) => {
      const raw = call.query.skip ?? "";
      const queue = [FIRST, SECOND].filter((j) => !raw.includes(j.id));
      return { body: cursor(queue[0] ?? null, queue.length) };
    });
    api.on("POST", "/judgment/:id/conclude/", () => ({
      status: 409,
      body: { error: "claimed", code: "claimed_by_other", claimed_by: 7, claimed_by_name: "崔判官" },
    }));

    await page.goto("/judgment/queue");
    await expect(page.getByText(FIRST.soul_name)).toBeVisible();

    await page.keyboard.press("2");

    await expect(page.getByText(/崔判官/)).toBeVisible();
    await expect(page.getByText(SECOND.soul_name)).toBeVisible();
    await expect(page.getByText("已延后 1")).toBeVisible();
  });
});
