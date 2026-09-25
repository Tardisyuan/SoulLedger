import { test, expect, domainEnum, mockApi, setupAuthenticatedPage, OPENED_JUDGMENT, PROPOSED_DISPATCH, PROPOSED_DISPATCH_DETAIL_ONLY, ROLES, SOULS, TEST_USER, type ApiMock } from "./fixtures";

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
    expect(loginCall?.body).toEqual({ username: TEST_USER.username, password: "correct-horse-battery", remember: false });

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
    // Same §4.6 pair as the dispatch badge below: translated copy in the
    // text node, raw member reachable only via `title`.
    await expect(rows.first()).toContainText("审判中"); // current_state JUDGING
    await expect(domainEnum(rows.first(), "JUDGING")).toBeVisible();
    await expect(rows.first().getByText("JUDGING", { exact: true })).toHaveCount(0);
    await expect(rows.nth(1)).toContainText(SOULS[1].name);
    // karmic_balance is a CHINESE-only instrument; the Egyptian row's balance
    // cell must be the "not applicable" mark. Located by the cell's own
    // `data-missing`, not by a glyph: this used to look for an em dash, which
    // the row did contain — in the death-date column. The balance cell renders
    // the word 不适用 (规范 v1 §2: 「不适用」用字, since 3b1fa189 — it was a
    // middle dot before), so a balance that degraded to a netted `0` stayed
    // green. `app/souls/page.tsx` has exactly one `inapplicable` site, so the
    // count pins the column as well as the kind.
    await expect(rows.first()).toContainText("+42");
    await expect(rows.first().locator('[data-missing="inapplicable"]')).toHaveCount(0);
    await expect(rows.nth(1).locator('[data-missing="inapplicable"]')).toHaveCount(1);
    await expect(rows.nth(1).locator('[data-missing="inapplicable"]')).toHaveText("不适用");

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

    await expect(page.locator("h1")).toHaveText("调度管理");
    await expect(page.getByRole("heading", { name: "待处理提案" })).toBeVisible();

    // Scoped to the pending section: dispatchApi.history() hits the same
    // unfiltered endpoint, so a PROPOSED record legitimately appears in both
    // lists and an unscoped locator is ambiguous.
    // Located by STRUCTURE, not by a decorative class. This was
    // `div.rounded-lg`, and it stopped matching anything when the design
    // system moved these panels to `<PageSection>` and squared the corners —
    // `rounded-lg` does not appear anywhere in app/dispatch/page.tsx any more.
    // The failure read as "the pending card is missing", which is a much more
    // alarming thing than what had happened.
    //
    // `div:has(> div > h3)` is PageSection's own shape: a root div whose first
    // child is the header div holding the title as an h3. That is the
    // component's contract rather than its styling, so a second Tailwind pass
    // does not break it.
    const pendingSection = page.locator(
      'div:has(> div > h3:text-is("待处理提案"))'
    );

    // The pending card must name both civilizations — the whole point of a
    // cross-tenant dispatch is that it leaves one cosmology for another.
    //
    // The row, not the anchor: since 规范 v1 the list is a DataTable with
    // `linkedRows`, so the link wraps only the soul's name and stretches over
    // the row through `::after`. The route and the badge sit in sibling cells
    // of the same `<tr>`. Clicking the row still lands on the link's overlay.
    const pendingCard = pendingSection.locator("tr", {
      has: page.locator(`a[href="/dispatch/${PROPOSED_DISPATCH.id}"]`),
    });
    await expect(pendingCard).toContainText("CN_DIYU → EG_DUAT");
    // §4.6, both halves. The badge carries the translated copy in its text
    // node and the raw member in `title`; asserting the title is what makes
    // this survive a translation edit, and the absence assertion is the half
    // that can't be faked — toContainText alone still passes on the
    // "PROPOSED 待审批" double-render the convention exists to remove.
    await expect(pendingCard).toContainText("待审批");
    await expect(domainEnum(pendingCard, "PROPOSED")).toBeVisible();
    await expect(pendingCard.getByText("PROPOSED", { exact: true })).toHaveCount(0);
    // The card names the soul; it must not print the primary key. This line
    // used to assert the opposite -- `灵魂 #<uuid>` -- and passed, because
    // that is what the card did. `soul_name` was in the same response the
    // whole time and was going unread.
    await expect(pendingCard).toContainText(PROPOSED_DISPATCH.soul_name);
    await expect(
      pendingCard.getByText(PROPOSED_DISPATCH.soul, { exact: false })
    ).toHaveCount(0);
    // The proposal's reason is NOT on this card, and cannot be: the list goes
    // through `DispatchRecordListSerializer`, which does not send `reason`.
    // This line used to assert the opposite and passed, because the fixture
    // carried a field the list response never has. Asserting the absence is
    // what stops that coming back -- and it is also a real finding about the
    // product: the card a reviewer scans first does not say why the dispatch
    // was proposed. That is a design question, not a bug, and it belongs in
    // the open list rather than being papered over by a fixture.
    await expect(
      pendingCard.getByText(PROPOSED_DISPATCH_DETAIL_ONLY.reason)
    ).toHaveCount(0);

    await pendingCard.click();

    // ── Detail ──
    await expect(page).toHaveURL(`/dispatch/${PROPOSED_DISPATCH.id}`);
    await expect(page.locator("h1")).toHaveText("调度详情");
    await expect(page.getByText(PROPOSED_DISPATCH.source_tenant_code)).toBeVisible();
    await expect(page.getByText(PROPOSED_DISPATCH.target_tenant_code)).toBeVisible();
    // Detail goes through `DispatchRecordSerializer`, which does send these --
    // so these two assertions were always right, and they are why the fixture
    // is split rather than trimmed.
    await expect(
      page.getByText(PROPOSED_DISPATCH_DETAIL_ONLY.reason)
    ).toBeVisible();
    await expect(
      page.getByText(PROPOSED_DISPATCH_DETAIL_ONLY.dispatched_by_name)
    ).toBeVisible();

    // ── Approve ──
    // Through the confirmation, same as the rejection test below. The button
    // on the card opens a dialog; the one inside it is what fires the
    // mutation. Both carry the same label, so the second click is scoped to
    // the dialog — an unscoped `getByRole("button", { name: "批准" })` matches
    // two elements once the dialog is open and fails Playwright's strict mode.
    await page.getByRole("button", { name: "批准" }).click();
    const approveConfirm = page.getByRole("dialog");
    await expect(approveConfirm).toBeVisible();
    await approveConfirm.getByRole("button", { name: "批准" }).click();

    await expect.poll(() => api.countOf("POST", `/dispatch/records/${PROPOSED_DISPATCH.id}/approve/`)).toBe(1);
    await expect(page.getByText("已批准")).toBeVisible();
    // approveMutation.onSuccess routes back to the list.
    await expect(page).toHaveURL(/\/dispatch$/);
  });

  test("only PROPOSED dispatches offer approve/reject", async ({ page }) => {
    api.on("GET", "/dispatch/records/:id/", {
      ...PROPOSED_DISPATCH,
      ...PROPOSED_DISPATCH_DETAIL_ONLY,
      status: "EXECUTED",
    });
    await page.goto(`/dispatch/${PROPOSED_DISPATCH.id}`);

    await expect(page.locator("h1")).toHaveText("调度详情");
    await expect(page.getByRole("button", { name: "批准" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "驳回" })).toHaveCount(0);
  });

  test("a rejected approval leaves the dispatch on screen with an error", async ({ page }) => {
    api.on("POST", "/dispatch/records/:id/approve/", () => ({ status: 403, body: { detail: "not your tenant" } }));
    await page.goto(`/dispatch/${PROPOSED_DISPATCH.id}`);

    // Two clicks, not one. Approving opens a confirmation now — see the
    // comment on the button in app/dispatch/[id]/page.tsx: approve is the one
    // of the three actions whose consequence reaches another tenant's ledger,
    // so it was given the same confirm step reject and execute already had.
    // This test predated that change and clicked once, so the mutation never
    // fired and the toast it waited for could not appear. The old failure
    // therefore read as "the error toast is broken" when the error had simply
    // never been requested.
    await page.getByRole("button", { name: "批准" }).click();
    const confirm = page.getByRole("dialog");
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "批准" }).click();

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
  /** The grid cell's accessible name is `${role} — ${codename}` (PermissionMatrixTable). */
  const cell = (role: string, codename: string) => `${role} — ${codename}`;
  const unsaved = (page: import("@playwright/test").Page) => page.getByRole("region", { name: "未保存的改动" });

  test.beforeEach(async ({ page }) => {
    api = await setupAuthenticatedPage(page);
    await page.goto("/permissions");
    await expect(page.getByRole("heading", { name: "权限矩阵" })).toBeVisible();
  });

  test("renders the matrix from live role grants", async ({ page, isMobile }) => {
    test.skip(isMobile, "393 px shows the role-first list; covered below");
    // Checked/unchecked state must come from the API, not from a default.
    await expect(page.getByRole("checkbox", { name: cell("JUDGE", "dispatch.approve") })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: cell("GUARDIAN", "dispatch.approve") })).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: cell("ADMIN", "system.settings") })).toBeChecked();
    // Nothing pending: no unsaved bar, so no save button to press.
    await expect(unsaved(page)).toHaveCount(0);
  });

  test("a removal requires confirmation and sends only that cell with the loaded version", async ({ page, isMobile }) => {
    test.skip(isMobile, "393 px shows the role-first list; covered below");
    // Removing one of JUDGE's three grants ⇒ tier 2 (removal, not to zero).
    await page.getByRole("checkbox", { name: cell("JUDGE", "dispatch.approve") }).click();

    await expect(unsaved(page)).toContainText("未保存 1 项");
    await expect(unsaved(page)).toContainText("＋0 · −1");
    await unsaved(page).getByRole("button", { name: "保存改动" }).click();

    // ── Confirmation names the blast radius ──
    const confirm = page.getByRole("dialog");
    await expect(confirm).toContainText("确认保存权限改动");
    await expect(confirm).toContainText("将被移除：");
    await expect(confirm).toContainText("dispatch.approve");
    await expect(confirm).toContainText("5 名用户当前使用此角色");
    await expect(confirm).toContainText("3 → 2");
    // The per-cell endpoint does not replace wholesale; that warning is gone.
    await expect(confirm).not.toContainText("整体替换");

    await page.getByRole("button", { name: "确认保存" }).click();

    // ── One change, the loaded version as the lock ──
    await expect.poll(() => api.countOf("POST", "/perm/role-permissions/changes/")).toBe(1);
    const body = api.lastCall("POST", "/perm/role-permissions/changes/")?.body;
    expect(body.changes).toEqual([{ role: "JUDGE", permission_id: 3, action: "revoke" }]);
    expect(body.expected_versions).toEqual({ JUDGE: JUDGE_VERSION });
    expect(api.countOf("POST", "/perm/role-permissions/assign/")).toBe(0);

    await expect(confirm).toBeHidden();
    await expect(unsaved(page)).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: cell("JUDGE", "dispatch.approve") })).not.toBeChecked();
  });

  test("clearing every grant demands the role name be typed out", async ({ page, isMobile }) => {
    test.skip(isMobile, "393 px shows the role-first list; covered below");
    // GUARDIAN holds exactly three grants; unchecking all three ⇒ tier 3.
    for (const codename of ["soul.read", "menu.read", "recycle_bin.read"]) {
      await page.getByRole("checkbox", { name: cell("GUARDIAN", codename) }).click();
    }
    await unsaved(page).getByRole("button", { name: "保存改动" }).click();

    const confirm = page.getByRole("dialog");
    await expect(confirm).toContainText("此操作将清空 GUARDIAN 持有的全部权限。");
    await expect(confirm).toContainText("被移除的权限中包含 menu.read");

    const submit = page.getByRole("button", { name: "确认保存" });
    await expect(submit).toBeDisabled();
    const typed = page.getByLabel("输入角色名称 GUARDIAN 以确认：");
    await typed.fill("guardian"); // wrong case
    await expect(submit).toBeDisabled();
    expect(api.countOf("POST", "/perm/role-permissions/changes/")).toBe(0);

    await typed.fill("GUARDIAN");
    await submit.click();
    await expect.poll(() => api.countOf("POST", "/perm/role-permissions/changes/")).toBe(1);
    expect(api.lastCall("POST", "/perm/role-permissions/changes/")?.body.changes).toHaveLength(3);
  });

  test("a partial save: the refused cell stays pending with !, the banner counts both, 定位 focuses it", async ({ page, isMobile }) => {
    test.skip(isMobile, "393 px shows the role-first list; covered below");
    // recycle_bin.restore to JUDGE is ADMIN-only → refused; menu.read to … JUDGE already has it.
    await page.getByRole("checkbox", { name: cell("JUDGE", "recycle_bin.restore") }).click();
    await page.getByRole("checkbox", { name: cell("GUARDIAN", "dispatch.approve") }).click();
    await unsaved(page).getByRole("button", { name: "保存改动" }).click();

    const banner = page.getByRole("alert").filter({ hasText: "部分保存失败" });
    await expect(banner).toContainText("已存 1 项，失败 1 项");
    await expect(banner).toContainText("回收站的恢复与彻底删除仅限 ADMIN");
    const refused = page.getByRole("checkbox", { name: cell("JUDGE", "recycle_bin.restore") });
    await expect(refused).toHaveText("!");
    await expect(page.getByRole("checkbox", { name: cell("GUARDIAN", "dispatch.approve") })).toHaveText("");
    await expect(unsaved(page)).toContainText("未保存 1 项");

    await banner.getByRole("button", { name: "定位" }).click();
    await expect(refused).toBeFocused();
  });

  test("the impact check names the step that would lose its approver; 保存 waits for the acknowledgement", async ({ page, isMobile }) => {
    test.skip(isMobile, "393 px shows the role-first list; covered below");
    api.on("POST", "/perm/role-permissions/impact/", (call) => ({
      body: {
        required_codenames: ["dispatch.approve"],
        conflicts: (call.body?.changes ?? []).some((c: { role: string; permission_id: number; action: string }) => c.role === "JUDGE" && c.permission_id === 3 && c.action === "revoke")
          ? [{ template_id: "t1", template_name: "跨文明调度 · 两级", tenant_id: 1, civilization: "CHINESE", is_active: true, step_order: 2,
               step_name: "判官复核", approver_roles: ["JUDGE"], caused_by: [{ index: 0, role: "JUDGE", permission_id: 3, codename: "dispatch.approve" }] }]
          : [],
        workflow_conflicts: [],
      },
    }));
    const target = page.getByRole("checkbox", { name: cell("JUDGE", "dispatch.approve") });
    await target.click();
    const conflict = page.getByRole("status").filter({ hasText: "冲突提示" });
    await expect(conflict).toContainText("审批流「跨文明调度 · 两级」的第 2 步（判官复核）将无人可批");
    await expect(target).toHaveText("◇");
    const save = unsaved(page).getByRole("button", { name: "保存改动" });
    await expect(save).toBeDisabled();
    await conflict.getByRole("checkbox", { name: "我知道这会让 1 条审批流（含进行中 0 条）无人可批" }).check();
    await expect(save).toBeEnabled();
  });

  test("at 393 px: pick a role, then toggle its rows", async ({ page, isMobile }) => {
    test.skip(!isMobile, "the role-first list is the phone layout");
    await page.getByLabel("角色", { exact: true }).selectOption("GUARDIAN");
    const toggle = page.getByRole("switch", { name: "批准调度 dispatch.approve" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(unsaved(page)).toContainText("未保存 1 项");
    await unsaved(page).getByRole("button", { name: "保存改动" }).click();
    await expect.poll(() => api.lastCall("POST", "/perm/role-permissions/changes/")?.body.changes).toEqual([
      { role: "GUARDIAN", permission_id: 3, action: "grant" },
    ]);
  });

  test("roles: a row opens the drawer; a referenced role's delete lists the workflow", async ({ page }) => {
    await page.getByRole("button", { name: /^角色/ }).first().click();
    await page.locator("tr", { hasText: "GUARDIAN" }).getByRole("button").click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toContainText("创建后不可改；审批流按代码引用");
    await expect(drawer.getByRole("textbox", { name: "显示名称 *" })).toHaveValue("守卫");
    await drawer.getByRole("button", { name: "更多操作" }).click();
    await drawer.getByRole("button", { name: /移入回收站…/ }).click();
    const confirm = page.getByRole("dialog", { name: /将「守卫」移入回收站/ });
    await confirm.getByRole("button", { name: "移入回收站", exact: true }).click();
    await expect(confirm.getByRole("alert")).toContainText("仍被 1 条审批流引用");
    await expect(confirm.getByRole("alert")).toContainText("跨文明调度 · 两级");
    await expect(confirm.getByRole("alert")).toContainText("#2 守卫签收");
  });
});
