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
    // A concluded case leaves the pending worklist, as it does on the server.
    // The console used to hold a verdict for an 8s undo window and skip the
    // case locally meanwhile, so this mock never had to know; now the verdict
    // is sent at once and the next cursor read must not see that case again.
    const concluded = new Set<string>();
    api.on("GET", "/judgment/next/", (call) => {
      const skipped = call.query.skip ?? "";
      const queue = [FIRST, SECOND].filter((j) => !skipped.includes(j.id) && !concluded.has(j.id));
      return { body: cursor(queue[0] ?? null, queue.length) };
    });
    api.on("POST", "/judgment/:id/conclude/", (call) => {
      concluded.add(FIRST.id);
      return { body: { ...FIRST, verdict: call.body?.verdict, is_final: true } };
    });

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

/**
 * The /judgment claim queue and the desk's evidence admission, in a real
 * browser. jsdom cannot press Space on a button — it has no activation
 * behaviour — so the one claim the unit suite can only describe (the evidence
 * toggle is a native button, so Space on the focused row is its own click and
 * nothing else) is exercised here.
 */
test.describe("Claim queue and evidence admission", () => {
  const MINE = { ...OPENED_JUDGMENT, court: "第五殿", claimed_by: 1, claimed_by_name: "阎罗", karmic_balance: 347, evidence_count: 12 };
  const OPEN = {
    ...OPENED_JUDGMENT,
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    soul_name: "第二位待判者",
    court: "第一殿",
    claimed_by: null,
    claimed_by_name: null,
    karmic_balance: 0,
    evidence_count: 0,
  };

  test("groups carry the server's counts; J focuses a row and C claims it", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    api.on("GET", "/judgment/", (call) => {
      const byGroup: Record<string, unknown[]> = { mine: [MINE], unclaimed: [OPEN], others: [], deferred: [] };
      const results = call.query.group ? byGroup[call.query.group] ?? [] : [];
      return { body: { count: results.length, next: null, previous: null, results } };
    });
    api.on("GET", "/judgment/queue-counts/", { mine: 1, unclaimed: 3, others: 0, deferred: 2, total: 6 });
    api.on("POST", "/judgment/:id/claim/", { ...OPEN, claimed_by: 1 });

    await page.goto("/judgment");
    await expect(page.getByRole("link", { name: OPEN.soul_name })).toBeVisible();
    await expect(page.getByTestId("group-count-unclaimed")).toContainText("3");
    await expect(page.getByTestId("group-count-deferred")).toContainText("2");

    await page.keyboard.press("j");
    await page.keyboard.press("j");
    await expect(page.getByRole("link", { name: OPEN.soul_name })).toBeFocused();
    await page.keyboard.press("c");
    await expect.poll(() => api.countOf("POST", "/judgment/:id/claim/")).toBe(1);
    expect(api.lastCall("POST", "/judgment/:id/claim/")?.path).toContain(OPEN.id);
  });

  test("Space on the focused evidence toggle asks for a reason; a space typed in the verdict text does not", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    api.on("GET", "/judgment/:id/", {
      ...OPENED_JUDGMENT,
      citations: [],
      evidence_json: {},
      evidence_admissions: [],
      admitted_balance: { reading_kind: "BALANCE", balance: 42, not_admitted_count: 0, not_admitted_net: 0, reason_code: null },
    });
    api.on("GET", "/souls/:id/karma/", {
      ...SOUL_LEDGER,
      record_count: 1,
      records: [{
        id: "11111111-1111-4111-8111-111111111111", type: "MERIT", category: "CHARITY", description: "救溺 · 胥江",
        original_weight: 120, effective_weight: 120, years_elapsed: 0, decay_factor: 1, civilization: "CHINESE",
        recorded_at: "2026-06-02T00:00:00Z", event_date: null, is_milestone: false,
      }],
    });
    api.on("PUT", "/judgment/:id/evidence/:record/", (call) => ({
      body: { admission: { record: "11111111-1111-4111-8111-111111111111", ...call.body }, admitted_balance: { reading_kind: "BALANCE", balance: -78, not_admitted_count: 1, not_admitted_net: 120, reason_code: null } },
    }));

    await page.goto(`/judgment/${OPENED_JUDGMENT.id}`);
    const toggle = page.getByRole("checkbox", { name: "采信「救溺 · 胥江」" });
    await expect(toggle).toBeVisible();

    await page.getByLabel("备注", { exact: true }).fill("功过相抵 ");
    await page.getByLabel("备注", { exact: true }).press("Space");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await toggle.focus();
    await page.keyboard.press("Space");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("textbox").fill("无旁证");
    await dialog.getByRole("button", { name: "不采信" }).click();
    await expect.poll(() => api.countOf("PUT", "/judgment/:id/evidence/:record/")).toBe(1);
    expect(api.lastCall("PUT", "/judgment/:id/evidence/:record/")?.body).toEqual({ admitted: false, reason: "无旁证" });
  });
});
