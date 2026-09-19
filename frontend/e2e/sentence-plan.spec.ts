import { test, expect, setupAuthenticatedPage, OPENED_JUDGMENT, SENTENCE_PLAN, SOULS } from "./fixtures";

/**
 * 受刑计划的 Web 端(docs/ARCHITECTURE-sentence-plan.md §9 阶段 4),对着路由 mock、以 ADMIN
 * (fixtures.ts TEST_USER,租户 CN_DIYU = 这份计划的原属)。
 * 「非原属看不到批准按钮」「没有 judgment.execute 看不到按钮」要换角色 / 租户,钉在 jest
 * (SentencePlanPanels.test.tsx)。
 */

test.describe("Sentence plan", () => {
  test("the soul page shows every stop and which one the soul is at", async ({ page }) => {
    await setupAuthenticatedPage(page);
    await page.goto(`/souls/${SOULS[0].id}`);

    const card = page.getByTestId("sentence-plan-card");
    await expect(card.getByRole("heading", { name: "受刑计划" })).toBeVisible();
    const stops = card.locator("li[data-node-order]");
    await expect(stops).toHaveCount(3);
    await expect(stops.nth(0)).toContainText("已完成");
    await expect(stops.nth(1)).toContainText("受刑中");
    await expect(stops.nth(1)).toHaveAttribute("aria-current", "step");
    await expect(card.locator('li[aria-current="step"]')).toHaveCount(1);
    await expect(stops.nth(2)).toContainText("未开始");
    await expect(card.getByText("执行中")).toBeVisible();
    // 待决定的请求在面板里也看得到,原属(ADMIN)有批准按钮。
    await expect(card.locator(`li[data-request-id="${SENTENCE_PLAN.requests[0].id}"]`)).toContainText("减去第 3 站");
  });

  test("the original judge accepts a pending request from the inbox", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    await page.goto("/sentence-requests");

    await expect(page.locator("h1")).toContainText("受刑请求");
    const row = page.locator(`li[data-plan-id="${SENTENCE_PLAN.id}"]`);
    await expect(row).toContainText(SENTENCE_PLAN.soul_name);
    await expect(row).toContainText("减去第 3 站");
    await expect(row).toContainText("炼狱一站已由另案抵偿");

    await row.getByRole("button", { name: "批准" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("已开始的站不受影响");
    await dialog.getByLabel("理由（可选，提出方看得到）").fill("同意");
    await dialog.getByRole("button", { name: "批准" }).click();

    await expect
      .poll(() => api.lastCall("POST", "/sentence-plans/:id/requests/:id/decide/")?.body)
      .toEqual({ decision: "ACCEPT", reason: "同意" });
    expect(api.lastCall("POST", "/sentence-plans/:id/requests/:id/decide/")?.path).toBe(
      `/sentence-plans/${SENTENCE_PLAN.id}/requests/${SENTENCE_PLAN.requests[0].id}/decide/`
    );
    await expect(dialog).toBeHidden();
  });

  /*
   * 情况 2.2(§4.1):TEST_USER 是 CN_DIYU 的 ADMIN,所以这里把计划换成「原属埃及、中国是第 2 站、
   * 灵魂还没到中国」—— 中国是执行地,能提请求(原属是决定方,看不到按钮,钉在 jest)。
   */
  test("a stop's judge files an amend request from the soul page, and the panel refreshes", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    const [home, stop2, stop3] = SENTENCE_PLAN.nodes;
    const abroad = {
      ...SENTENCE_PLAN,
      tenant_code: "EG_DUAT",
      requests: [],
      nodes: [
        { ...home, tenant_code: "EG_DUAT", status: "ACTIVE", realm_code: "EG_HALL_TWO_TRUTHS", completed_at: null },
        { ...stop2, tenant_code: "CN_DIYU", status: "PENDING", realm_code: "DY_COURT_01_QINGUANG", disposition_id: null, activated_at: null },
        stop3,
      ],
    };
    api.on("GET", "/sentence-plans/", { count: 1, next: null, previous: null, results: [abroad] });
    api.on("GET", "/realms/", {
      count: 1, next: null, previous: null,
      results: [{ id: 5, realm_code: "DY_COURT_05_YANLUO", civilization: "CHINESE", is_eternal: false }],
    });
    api.on("POST", "/sentence-plans/:id/requests/", { status: 201, body: { id: "r-new", kind: "AMEND", status: "PENDING" } });

    await page.goto(`/souls/${SOULS[0].id}`);
    const card = page.getByTestId("sentence-plan-card");
    await card.getByRole("button", { name: "提出请求" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("向原审判官提出请求");

    // 减:只有未开始的两站可选;减第 3 站(欧洲)。
    await expect(dialog.getByRole("checkbox")).toHaveCount(2);
    await dialog.getByRole("checkbox").nth(1).check();
    // 加:只能加本文明(中国)的站。
    await dialog.getByRole("button", { name: "再加一站" }).click();
    await dialog.getByLabel("界域").selectOption("DY_COURT_05_YANLUO");
    await dialog.getByLabel("刑期（年）").fill("4");
    await dialog.getByLabel("理由", { exact: true }).first().fill("补刑");
    await dialog.getByLabel("理由", { exact: true }).last().fill("阎罗殿另审");
    const listed = api.countOf("GET", "/sentence-plans/");
    await dialog.getByRole("button", { name: "提交请求" }).click();

    await expect
      .poll(() => api.lastCall("POST", "/sentence-plans/:id/requests/")?.body)
      .toEqual({
        kind: "AMEND",
        changes: { add: [{ realm_code: "DY_COURT_05_YANLUO", sentence_years: 4, reason: "补刑" }], remove: [stop3.id] },
        reason: "阎罗殿另审",
      });
    expect(api.lastCall("POST", "/sentence-plans/:id/requests/")?.path).toBe(`/sentence-plans/${SENTENCE_PLAN.id}/requests/`);
    await expect(dialog).toBeHidden();
    // 写完失效计划根:面板重新取(收件箱用同一个根)。
    await expect.poll(() => api.countOf("GET", "/sentence-plans/")).toBeGreaterThan(listed);
  });

  test("the home judge opens a joint judgment on the case and seats a co-judge", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    const CJ_ID = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
    let participants: unknown[] = [];
    const bench = () => ({
      id: CJ_ID, title: "张三联审", description: "定外地各站", initiating_tenant: 1, initiating_tenant_code: "CN_DIYU",
      status: "PROPOSED", concluded_at: null, conclusion_type: null, judgment: OPENED_JUDGMENT.id, participants,
      create_time: "2026-09-20T00:00:00Z", update_time: "2026-09-20T00:00:00Z",
    });
    api.on("POST", "/dispatch/cross-tenant-judgments/", () => ({ status: 201, body: bench() }));
    api.on("GET", "/dispatch/cross-tenant-judgments/:id/", () => ({ body: bench() }));
    // 只回被问的那个文明的神祇(服务端的规则钉在 test_sentence_plan_phase4.py)。
    api.on("GET", "/dispatch/cross-tenant-judgments/:id/seatable-actors/", (call) => ({
      body: call.query.tenant_code === "EG_DUAT" && call.query.role === "CO_JUDGE"
        ? [{ id: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a1", role: "JUDGE", name: "Osiris", name_zh: "奥西里斯", name_en: "Osiris", name_egy: "Wesir" }]
        : [],
    }));
    api.on("POST", "/dispatch/cross-tenant-judgments/:id/participate/", (call) => {
      participants = [{
        id: "p-eg", judgment: CJ_ID, participant_tenant: 3, participant_tenant_code: call.body.participant_tenant_code,
        participant_actor: call.body.participant_actor ?? null, participant_actor_name: call.body.participant_actor ? "Osiris" : null,
        role: call.body.role, joined_at: "2026-09-20T00:00:00Z",
        node_order: call.body.node_order ?? null, sentence_realm_code: "", sentence_years: null, sentence_is_eternal: false,
        sentence_memory_reset: "", sentence_notes: "", sentence_submitted_at: null,
      }];
      return { body: bench() };
    });

    await page.goto(`/judgment/${OPENED_JUDGMENT.id}`);
    await page.getByRole("button", { name: "开联审" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("标题").fill("张三联审");
    await dialog.getByLabel("说明").fill("定外地各站");
    await dialog.getByRole("button", { name: "开联审" }).click();

    await expect
      .poll(() => api.lastCall("POST", "/dispatch/cross-tenant-judgments/")?.body)
      .toEqual({ title: "张三联审", description: "定外地各站", judgment: OPENED_JUDGMENT.id });
    await expect(page).toHaveURL(new RegExp(`/cross-judgments/${CJ_ID}$`));

    const seat = page.getByRole("form", { name: "请文明入席" });
    await expect(seat.getByTestId("seat-stop")).toHaveText("排第 2 站");
    await seat.getByLabel("文明", { exact: true }).selectOption("EG_DUAT");
    await seat.getByLabel("席位上的神祇（可选）").selectOption({ label: "奥西里斯" });
    expect(api.lastCall("GET", "/dispatch/cross-tenant-judgments/:id/seatable-actors/")?.query).toEqual({
      tenant_code: "EG_DUAT", role: "CO_JUDGE",
    });
    await seat.getByRole("button", { name: "入席" }).click();

    await expect
      .poll(() => api.lastCall("POST", "/dispatch/cross-tenant-judgments/:id/participate/")?.body)
      .toEqual({
        participant_tenant_code: "EG_DUAT", role: "CO_JUDGE",
        participant_actor: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a1", node_order: 2,
      });
    // 入席后详情重取:埃及成了第 2 站,还没填。
    const stops = page.getByRole("region", { name: "受刑计划各站" });
    await expect(stops.locator('li[data-stop="2"]')).toContainText("尚未填写");
  });
});
