import { test, expect } from "@playwright/test";
import {
  mockApi,
  setupAuthenticatedPage,
  OPENED_JUDGMENT,
  PROPOSED_DISPATCH,
  ROLE_GRANTS,
  ROLES,
  SOULS,
  TEST_USER,
  type ApiMock,
} from "./fixtures";

/**
 * Three end-to-end journeys through the app's highest-stakes screens.
 *
 * All three run against Playwright route mocks rather than a live Django
 * instance — see the header of fixtures.ts for why. That means every
 * assertion is about the FRONT END's behaviour: which request it sent, with
 * what payload, and what it rendered from the answer. Server-side rules
 * (tenant isolation, the optimistic-lock comparison itself) are the backend
 * suite's job; what these pin down is that the UI builds the right request
 * and reacts correctly to each documented response.
 */

// ─────────────────────────────────────────────────────────────────────────
// Path 1 — login → souls list → create soul
// ─────────────────────────────────────────────────────────────────────────

test.describe("Critical path: login and create a soul", () => {
  test("signs in, lands on the console, and creates a soul", async ({ page }) => {
    // Deliberately NOT pre-authenticated: this path is the login itself.
    const api = await mockApi(page);

    await page.goto("/login");
    await page.getByLabel("用户名").fill(TEST_USER.username);
    await page.getByLabel("密码").fill("correct-horse-battery");
    await page.getByRole("button", { name: "登录" }).click();

    // ── The login actually took ──
    await expect(page).toHaveURL(/\/dashboard/);
    const loginCall = api.lastCall("POST", "/auth/login/");
    expect(loginCall?.body).toEqual({ username: TEST_USER.username, password: "correct-horse-battery" });

    // The refresh token must reach a real cookie — middleware.ts reads it
    // server-side on every subsequent navigation, so a token stashed only in
    // JS memory would bounce the user straight back to /login.
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "soulledger_refresh")?.value).toBeTruthy();
    expect(await page.evaluate(() => sessionStorage.getItem("soulledger_access"))).toBeTruthy();

    // ── Souls list renders server data ──
    await page.goto("/souls");
    await expect(page).toHaveURL(/\/souls/);
    await expect(page.locator("h1")).toHaveText("灵魂");

    const rows = page.locator("tbody tr");
    await expect(rows).toHaveCount(SOULS.length);
    await expect(rows.first()).toContainText(SOULS[0].name);
    await expect(rows.first()).toContainText("审判中"); // current_state JUDGING
    await expect(rows.nth(1)).toContainText(SOULS[1].name);
    // karmic_balance is a CHINESE-only instrument; the Egyptian row must
    // show an em dash rather than a netted number.
    await expect(rows.first()).toContainText("+42");
    await expect(rows.nth(1)).toContainText("—");

    // ── Create ──
    await page.getByRole("button", { name: "+ 创建灵魂" }).click();
    // Headless UI's outer [role=dialog] is a zero-size wrapper; the form is
    // the thing that actually renders, and it unmounts when the modal closes.
    const form = page.locator("#soul-create-form");
    await expect(form).toBeVisible();

    await form.getByLabel("名称 *").fill("新入册的旅人");
    await form.getByLabel("文明").selectOption("EGYPTIAN");
    await form.getByLabel("出生日期").fill("1901-05-06");
    await page.getByRole("button", { name: "创建灵魂", exact: true }).click();

    // The payload the form built, field by field.
    await expect.poll(() => api.countOf("POST", "/souls/")).toBe(1);
    expect(api.lastCall("POST", "/souls/")?.body).toEqual({
      name: "新入册的旅人",
      civilization: "EGYPTIAN",
      birth_date: "1901-05-06",
      origin_location: null,
    });

    await expect(page.getByText("灵魂创建成功")).toBeVisible();
    await expect(form).toHaveCount(0);
    // useCreateSoul invalidates soulKeys.all and the modal calls refetch, so
    // the list must have been re-requested rather than left stale.
    await expect.poll(() => api.countOf("GET", "/souls/")).toBeGreaterThan(1);
  });

  test("opens a judgment for a soul that is already under judgment", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);

    await page.goto(`/souls/${SOULS[0].id}`);
    await expect(page.getByText(SOULS[0].name).first()).toBeVisible();

    // The action only exists for current_state === "JUDGING" (page.tsx:503).
    const startJudgment = page.getByRole("button", { name: "开始审判" });
    await expect(startJudgment).toBeVisible();
    await startJudgment.click();

    // No open judgment came back from GET /judgment/?soul=…, so the page must
    // create one rather than reuse a stale id.
    await expect.poll(() => api.countOf("POST", "/judgment/")).toBe(1);
    expect(api.lastCall("POST", "/judgment/")?.body).toEqual({
      soul: SOULS[0].id,
      civilization: "CHINESE",
    });
    await expect(page).toHaveURL(`/judgment/${OPENED_JUDGMENT.id}`);
  });

  test("reuses the open judgment instead of creating a duplicate", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    // Soul.die() already opens a judgment when it moves a soul to JUDGING, so
    // a second POST here would leave the soul with two pending judgments.
    api.on("GET", "/judgment/", { count: 1, next: null, previous: null, results: [OPENED_JUDGMENT] });

    await page.goto(`/souls/${SOULS[0].id}`);
    await page.getByRole("button", { name: "开始审判" }).click();

    await expect(page).toHaveURL(`/judgment/${OPENED_JUDGMENT.id}`);
    expect(api.countOf("POST", "/judgment/")).toBe(0);
  });

  test("a failed create keeps the modal open and reports the error", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    api.on("POST", "/souls/", () => ({ status: 500, body: { detail: "ledger unavailable" } }));

    await page.goto("/souls");
    await page.getByRole("button", { name: "+ 创建灵魂" }).click();

    const form = page.locator("#soul-create-form");
    await form.getByLabel("名称 *").fill("不会被写入的灵魂");
    await page.getByRole("button", { name: "创建灵魂", exact: true }).click();

    await expect(page.getByText("创建失败")).toBeVisible();
    // Still open, so the operator does not lose what they typed.
    await expect(form).toBeVisible();
    await expect(form.getByLabel("名称 *")).toHaveValue("不会被写入的灵魂");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Path 2 — cross-civilization dispatch approval
// ─────────────────────────────────────────────────────────────────────────

test.describe("Critical path: cross-civilization dispatch approval", () => {
  let api: ApiMock;

  test.beforeEach(async ({ page }) => {
    api = await setupAuthenticatedPage(page);
  });

  test("opens a pending proposal and approves it", async ({ page }) => {
    await page.goto("/dispatch");

    await expect(page.locator("h1")).toContainText("调度管理");
    await expect(page.getByRole("heading", { name: "待处理提案" })).toBeVisible();

    // Scoped to the pending section: dispatchApi.history() hits the same
    // unfiltered endpoint, so a PROPOSED record legitimately appears in both
    // lists and an unscoped locator is ambiguous.
    const pendingSection = page
      .locator("div.rounded-lg")
      .filter({ has: page.getByRole("heading", { name: "待处理提案" }) });

    // The pending card must name both civilizations — the whole point of a
    // cross-tenant dispatch is that it leaves one cosmology for another.
    const pendingCard = pendingSection.locator(`a[href="/dispatch/${PROPOSED_DISPATCH.id}"]`);
    await expect(pendingCard).toContainText("CN_DIYU → EG_DUAT");
    await expect(pendingCard).toContainText("待审批");
    await expect(pendingCard).toContainText(`灵魂 #${PROPOSED_DISPATCH.soul}`);
    await expect(pendingCard).toContainText(PROPOSED_DISPATCH.reason);

    await pendingCard.click();

    // ── Detail ──
    await expect(page).toHaveURL(`/dispatch/${PROPOSED_DISPATCH.id}`);
    await expect(page.locator("h1")).toContainText("调度详情");
    await expect(page.getByText(PROPOSED_DISPATCH.source_tenant_code)).toBeVisible();
    await expect(page.getByText(PROPOSED_DISPATCH.target_tenant_code)).toBeVisible();
    await expect(page.getByText(PROPOSED_DISPATCH.reason)).toBeVisible();
    await expect(page.getByText(PROPOSED_DISPATCH.dispatched_by_name)).toBeVisible();

    // ── Approve ──
    await page.getByRole("button", { name: "批准" }).click();

    await expect.poll(() => api.countOf("POST", `/dispatch/records/${PROPOSED_DISPATCH.id}/approve/`)).toBe(1);
    await expect(page.getByText("已批准")).toBeVisible();
    // approveMutation.onSuccess routes back to the list.
    await expect(page).toHaveURL(/\/dispatch$/);
  });

  test("only PROPOSED dispatches offer approve/reject", async ({ page }) => {
    api.on("GET", "/dispatch/records/:id/", { ...PROPOSED_DISPATCH, status: "EXECUTED" });
    await page.goto(`/dispatch/${PROPOSED_DISPATCH.id}`);

    await expect(page.locator("h1")).toContainText("调度详情");
    await expect(page.getByRole("button", { name: "批准" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "驳回" })).toHaveCount(0);
  });

  test("a rejected approval leaves the dispatch on screen with an error", async ({ page }) => {
    api.on("POST", "/dispatch/records/:id/approve/", () => ({ status: 403, body: { detail: "not your tenant" } }));
    await page.goto(`/dispatch/${PROPOSED_DISPATCH.id}`);

    await page.getByRole("button", { name: "批准" }).click();

    await expect(page.getByText("批准失败")).toBeVisible();
    // No navigation — the operator stays where the failure happened.
    await expect(page).toHaveURL(`/dispatch/${PROPOSED_DISPATCH.id}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Path 3 — permission matrix save (typed confirmation + optimistic lock)
// ─────────────────────────────────────────────────────────────────────────

test.describe("Critical path: permission matrix save", () => {
  let api: ApiMock;

  const JUDGE_VERSION = ROLES.find((r) => r.name === "JUDGE")!.version;
  /** MatrixCell's accessible name is `${role} — ${codename}` (page.tsx:999). */
  const cell = (role: string, codename: string) => `${role} — ${codename}`;

  test.beforeEach(async ({ page }) => {
    api = await setupAuthenticatedPage(page);
    await page.goto("/permissions");
    await expect(page.getByRole("heading", { name: "权限矩阵" })).toBeVisible();
  });

  test("renders the matrix from live role grants", async ({ page }) => {
    // Checked/unchecked state must come from the API, not from a default.
    await expect(page.getByRole("checkbox", { name: cell("JUDGE", "dispatch.approve") })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: cell("GUARDIAN", "dispatch.approve") })).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: cell("ADMIN", "system.settings") })).toBeChecked();

    await expect(page.getByText("没有未保存的改动")).toBeVisible();
    await expect(page.getByRole("button", { name: "保存改动" })).toBeDisabled();
  });

  test("a removal requires confirmation and sends the loaded version", async ({ page }) => {
    // Removing one of JUDGE's three grants ⇒ tier 2 (removal, not to zero).
    await page.getByRole("checkbox", { name: cell("JUDGE", "dispatch.approve") }).click();

    await expect(page.getByText("1 个角色有未保存的改动")).toBeVisible();
    const save = page.getByRole("button", { name: "保存改动" });
    await expect(save).toBeEnabled();
    await save.click();

    // ── Confirmation names the blast radius ──
    const confirm = page.getByRole("dialog");
    await expect(confirm).toContainText("确认保存权限改动");
    await expect(confirm).toContainText("将被移除：");
    await expect(confirm).toContainText("dispatch.approve");
    await expect(confirm).toContainText("5 名用户当前使用此角色");
    await expect(confirm).toContainText("3 → 2");

    await page.getByRole("button", { name: "确认保存" }).click();

    // ── The request carries the whole replacement set plus the lock ──
    await expect.poll(() => api.countOf("POST", "/perm/role-permissions/assign/")).toBe(1);
    const assign = api.lastCall("POST", "/perm/role-permissions/assign/");
    expect(assign?.body.role).toBe("JUDGE");
    expect(assign?.body.expected_version).toBe(JUDGE_VERSION);
    // assign_role_permissions replaces the entire grant set, so the payload
    // must be the full remaining list — not a delta.
    expect([...assign?.body.permission_ids].sort((a: number, b: number) => a - b)).toEqual(
      ROLE_GRANTS.JUDGE.filter((id) => id !== 3)
    );

    await expect(confirm).toBeHidden();
    await expect(page.getByText("没有未保存的改动")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: cell("JUDGE", "dispatch.approve") })).not.toBeChecked();
  });

  test("clearing every grant demands the role name be typed out", async ({ page }) => {
    // GUARDIAN holds exactly three grants; unchecking all three ⇒ tier 3.
    for (const codename of ["soul.read", "menu.read", "recycle_bin.read"]) {
      await page.getByRole("checkbox", { name: cell("GUARDIAN", codename) }).click();
    }
    await page.getByRole("button", { name: "保存改动" }).click();

    const confirm = page.getByRole("dialog");
    await expect(confirm).toContainText("此操作将清空 GUARDIAN 持有的全部权限。");
    // menu.read was among the removals, so the navigation warning is due.
    await expect(confirm).toContainText("被移除的权限中包含 menu.read");

    // The gate: submit stays disabled until the exact role name is typed.
    const submit = page.getByRole("button", { name: "确认保存" });
    await expect(submit).toBeDisabled();

    const typed = page.getByLabel("输入角色名称 GUARDIAN 以确认：");
    await typed.fill("guardian"); // wrong case
    await expect(submit).toBeDisabled();
    expect(api.countOf("POST", "/perm/role-permissions/assign/")).toBe(0);

    await typed.fill("GUARDIAN");
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect.poll(() => api.countOf("POST", "/perm/role-permissions/assign/")).toBe(1);
    expect(api.lastCall("POST", "/perm/role-permissions/assign/")?.body.permission_ids).toEqual([]);
  });

  test("a 409 from a concurrent save shows the conflict banner and does not apply the edit", async ({ page }) => {
    // Another admin got there first: the role is now at version 99.
    api.on("POST", "/perm/role-permissions/assign/", (call) => ({
      status: 409,
      body: {
        detail: "版本冲突",
        expected_version: call.body.expected_version,
        current_version: 99,
      },
    }));

    await page.getByRole("checkbox", { name: cell("JUDGE", "dispatch.approve") }).click();
    await page.getByRole("button", { name: "保存改动" }).click();
    await page.getByRole("button", { name: "确认保存" }).click();

    // The banner must quote both versions — "someone changed it" without the
    // numbers gives the admin nothing to reason about.
    const banner = page.getByRole("alert").filter({ hasText: "判官" });
    await expect(banner).toContainText(`版本 ${JUDGE_VERSION} → 99`);
    await expect(page.getByRole("button", { name: "重新加载此角色" })).toBeVisible();

    // The edit is still pending locally and was NOT silently accepted.
    await expect(page.getByText("1 个角色有未保存的改动")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: cell("JUDGE", "dispatch.approve") })).not.toBeChecked();

    // Reloading the role discards the local edit and restores the server state.
    await page.getByRole("button", { name: "重新加载此角色" }).click();
    await expect(page.getByRole("checkbox", { name: cell("JUDGE", "dispatch.approve") })).toBeChecked();
    await expect(page.getByText("没有未保存的改动")).toBeVisible();
    await expect(banner).toHaveCount(0);
  });
});
