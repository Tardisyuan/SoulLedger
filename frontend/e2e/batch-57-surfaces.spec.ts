import { test, expect, setupAuthenticatedPage, OPENED_JUDGMENT, SOUL_DETAIL, SOULS, type ApiMock } from "./fixtures";

/**
 * 第五十七批的新界面,对着路由 mock、以 ADMIN(fixtures.ts TEST_USER,租户 CN_DIYU)。
 * 三个 project 都跑;窄屏那几条自己设 393 宽,所以在哪个 project 下都量的是同一件事。
 *
 *  - 待发勾魂牒页(S-7)· 土地公管理(S-5 / S-6)
 *  - 灵魂详情:十三站行程条与挪站(S-1 / S-1b)、勾魂卡三步与原地撤销(S-4)
 *  - 审判台:「戊 · 发落」最上面的罪目(D-1)、枉死城块与提前释放(D-2)、埃及四十二条(X-1 / X-2)
 *  - 审判队列:希腊未葬不放「认领」(G-1)· 城隍编辑:诸司折叠与按级预设(D-3)
 */

const page1 = <T,>(results: T[]) => ({ count: results.length, next: null, previous: null, results });

/** 本地日期,往前数 `daysAgo` 天(与页面 `daysOverdue` 同一个「今天」:浏览器与测试进程在同一台机器上)。 */
function localIso(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const SOUL_ID = SOULS[0].id;
const SOUL_PATH = `/souls/${SOUL_ID}/`;

// ── 待发勾魂牒 ───────────────────────────────────────────────────────────────

test.describe("待发勾魂牒", () => {
  const DUE = [
    { id: "a1a1a1a1-0000-4000-8000-000000000001", name: "阳寿最早尽的", soul_code: null, origin_location: "钱塘", fated_death_date: localIso(10), karmic_balance: 12, suggested_escort: "WUCHANG" },
    { id: "a1a1a1a1-0000-4000-8000-000000000002", name: "过多于功的", soul_code: null, origin_location: "", fated_death_date: localIso(3), karmic_balance: -40, suggested_escort: "NIUTOU_MAMIAN" },
    { id: "a1a1a1a1-0000-4000-8000-000000000003", name: "今天才到的", soul_code: null, origin_location: "会稽", fated_death_date: localIso(0), karmic_balance: 0, suggested_escort: "WUCHANG" },
  ];

  test("按阳寿先后列出,过期写「超 N 天」,「发牒」开抽屉、按建议的鬼差发", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    // 页头写后端的总数(`count`),不是返回的行数:列表最多 200 行。
    api.on("GET", "/dispatch/capture-warrants/due/", { count: 250, results: DUE });
    api.on("POST", "/dispatch/capture-warrants/", (call) => ({
      status: 201,
      body: {
        id: "b2b2b2b2-0000-4000-8000-000000000001", soul: call.body.soul, soul_name: DUE[1].name, soul_code: null,
        city_god: null, city_god_name: null, escort: call.body.escort, status: "ISSUED",
        issued_at: "2026-10-29T00:00:00Z", captured_at: null, handed_over_at: null, judgment: null, cancel_reason: "",
        create_time: "2026-10-29T00:00:00Z",
      },
    }));

    await page.goto("/judgment/capture-due");
    await expect(page.locator("h1")).toContainText("待发勾魂牒");
    await expect(page.getByTestId("capture-due-count")).toHaveText("250");

    // 次序就是后端给的阳寿先后(页面不另排);第一行阳寿最早。
    const fated = page.locator('[data-testid^="capture-due-fated-"]');
    await expect(fated).toHaveCount(3);
    await expect(fated.nth(0)).toContainText(DUE[0].fated_death_date);
    await expect(fated.nth(1)).toContainText(DUE[1].fated_death_date);
    await expect(fated.nth(2)).toContainText(DUE[2].fated_death_date);
    await expect(fated.nth(0)).toContainText("超 10 天");
    await expect(fated.nth(1)).toContainText("超 3 天");
    // 今天才到的不写「超 0 天」。
    await expect(fated.nth(2)).not.toContainText("超");

    // 「发牒」不在列表里直接发:开右侧抽屉,鬼差默认是建议的那一位。
    await page.getByTestId(`capture-due-issue-${DUE[1].id}`).click();
    expect(api.countOf("POST", "/dispatch/capture-warrants/")).toBe(0);
    const drawer = page.getByRole("dialog");
    await expect(drawer).toContainText(`勾魂 · ${DUE[1].name}`);
    await expect(drawer).toContainText(`阳寿已到 · ${DUE[1].fated_death_date}`);
    await expect(drawer.getByLabel("鬼差")).toHaveValue("NIUTOU_MAMIAN");
    await expect(drawer.getByTestId("capture-escort-hint")).toHaveText("功多于过，建议黑白无常；过多于功，建议牛头马面。");
    await drawer.getByRole("button", { name: "发勾魂牒" }).click();

    await expect
      .poll(() => api.lastCall("POST", "/dispatch/capture-warrants/")?.body)
      .toEqual({ soul: DUE[1].id, escort: "NIUTOU_MAMIAN" });
    await expect(drawer).toBeHidden();
  });
});

// ── 土地公 ──────────────────────────────────────────────────────────────────

test.describe("土地公", () => {
  const COUNTY = { id: "c9c9c9c9-0000-4000-8000-000000000001", tenant: 1, name: "钱塘县城隍", rank: "COUNTY", bureaus: [], regions: ["钱塘"], is_default: false, officers: [], open_case_count: 0, create_time: "2026-10-01T00:00:00Z", update_time: "2026-10-01T00:00:00Z" };
  const PROVINCE = { ...COUNTY, id: "c9c9c9c9-0000-4000-8000-000000000002", name: "浙江都城隍", rank: "PROVINCE", regions: ["浙江"] };
  const UNRANKED = { ...COUNTY, id: "c9c9c9c9-0000-4000-8000-000000000003", name: "未定级的城隍", rank: "", regions: [] };
  const OFFICER = { id: 9, name: "崔判官" };
  const WITH_PARENT = {
    id: "d8d8d8d8-0000-4000-8000-000000000001", tenant: 1, name: "西湖土地", regions: ["西湖", "孤山"],
    city_god: COUNTY.id, city_god_name: COUNTY.name, officers: [OFFICER], registration_count: 2,
    create_time: "2026-10-01T00:00:00Z", update_time: "2026-10-01T00:00:00Z",
  };
  const ORPHAN = { ...WITH_PARENT, id: "d8d8d8d8-0000-4000-8000-000000000002", name: "无主土地", regions: [], city_god: null, city_god_name: null, officers: [], registration_count: 0 };

  async function setup(page: Parameters<typeof setupAuthenticatedPage>[0]): Promise<ApiMock> {
    const api = await setupAuthenticatedPage(page);
    api.on("GET", "/death-sync/tudi-gods/", page1([WITH_PARENT, ORPHAN]));
    // 精确路径:默认的 `/judgment/:id/` 会把 `city-gods` 当成一个审判 id。
    api.on("GET", "/judgment/city-gods/", page1([PROVINCE, COUNTY, UNRANKED]));
    api.on("GET", "/judgment/city-gods/officer-choices/", [OFFICER]);
    return api;
  }

  test("列表四栏;新建抽屉的上级城隍只列县城隍与未定级的", async ({ page }) => {
    const api = await setup(page);
    api.on("POST", "/death-sync/tudi-gods/", (call) => ({
      status: 201,
      body: { ...ORPHAN, id: "d8d8d8d8-0000-4000-8000-000000000009", ...call.body, city_god_name: COUNTY.name, officers: [OFFICER] },
    }));

    await page.goto("/death-sync/tudi-gods");
    await expect(page.locator("h1")).toContainText("土地公");
    const first = page.locator("tr", { hasText: WITH_PARENT.name });
    await expect(first).toContainText("西湖、孤山");
    await expect(first).toContainText(OFFICER.name);
    await expect(page.getByTestId(`tudi-god-parent-${WITH_PARENT.id}`)).toHaveText(COUNTY.name);
    // 没有上级:灰字「—」,不是空格子。
    await expect(page.getByTestId(`tudi-god-parent-${ORPHAN.id}`)).toHaveText("—");
    await expect(page.locator("tr", { hasText: ORPHAN.name })).toContainText("没有名下官员");

    await page.getByTestId("tudi-god-create").click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toContainText("新建土地公");
    const parent = drawer.getByLabel("上级城隍");
    await expect(parent.locator("option")).toHaveText(["—", COUNTY.name, UNRANKED.name]);
    await expect(parent.locator("option", { hasText: PROVINCE.name })).toHaveCount(0);

    // 抽屉自己的名字是「新建土地公」,所以按控件找,不按 label 子串。
    await drawer.getByRole("textbox", { name: /^土地公/ }).fill("孤山土地");
    await drawer.getByTestId("tudi-god-region-input").fill("孤山");
    await drawer.getByTestId("tudi-god-region-input").press("Enter");
    await expect(drawer.locator('[data-region-tag="孤山"]')).toBeVisible();
    await parent.selectOption(COUNTY.id);
    await drawer.getByRole("checkbox", { name: OFFICER.name }).check();
    await drawer.getByTestId("tudi-god-save").click();

    await expect
      .poll(() => api.lastCall("POST", "/death-sync/tudi-gods/")?.body)
      .toEqual({ name: "孤山土地", regions: ["孤山"], city_god: COUNTY.id, officer_ids: [OFFICER.id] });
    await expect(drawer).toBeHidden();
  });

  test("行菜单「以土地公名义登记死亡」:土地公已定,选灵魂后登记", async ({ page }) => {
    const api = await setup(page);
    api.on("POST", "/death-sync/tudi-gods/:id/register-death/", () => ({
      status: 201,
      body: { id: "e7e7e7e7-0000-4000-8000-000000000001", status: "PROCESSED", error_code: "" },
    }));

    await page.goto("/death-sync/tudi-gods");
    await page.getByRole("button", { name: `${WITH_PARENT.name} 的操作` }).click();
    await page.getByRole("menuitem", { name: "以土地公名义登记死亡" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("以土地公名义登记死亡");
    await expect(dialog.getByTestId("tudi-register-subtitle")).toHaveText(`${WITH_PARENT.name} · ${COUNTY.name}`);
    await expect(dialog).toContainText(`登记后发给${COUNTY.name}初审`);
    // 土地公已定:没有土地公下拉,只选灵魂。
    await expect(dialog.getByLabel("土地公", { exact: true })).toHaveCount(0);
    await expect(dialog.getByTestId("tudi-register-submit")).toBeDisabled();

    const soul = dialog.getByRole("combobox", { name: "灵魂" });
    await soul.fill("孟");
    await page.getByRole("option", { name: SOULS[0].name }).click();
    await dialog.getByLabel("死于何处").fill("钱塘江边");
    await dialog.getByTestId("tudi-register-submit").click();

    await expect.poll(() => api.countOf("POST", "/death-sync/tudi-gods/:id/register-death/")).toBe(1);
    const call = api.lastCall("POST", "/death-sync/tudi-gods/:id/register-death/")!;
    expect(call.path).toBe(`/death-sync/tudi-gods/${WITH_PARENT.id}/register-death/`);
    expect(call.body).toMatchObject({ soul_lookup: { soul_id: SOULS[0].id }, death_date: localIso(0), death_location: "钱塘江边", cause_of_death: "" });
    expect(typeof call.body.idempotency_key).toBe("string");
    await expect(dialog).toBeHidden();
  });
});

// ── 灵魂详情:十三站与勾魂卡 ──────────────────────────────────────────────────

test.describe("灵魂详情 · 十三站", () => {
  const ON_ROAD = { ...SOUL_DETAIL, diyu_station: "WANGXIANG_TERRACE" };

  test("行程条:第 3 / 13 站 · 望乡台;「挪站…」弹层里现在这一站不可选", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const api = await setupAuthenticatedPage(page);
    api.on("GET", SOUL_PATH, ON_ROAD);
    api.on("POST", "/souls/:id/station/", (call) => ({ body: { ...ON_ROAD, diyu_station: call.body.station } }));

    await page.goto(`/souls/${SOUL_ID}`);
    const strip = page.getByTestId("soul-diyu-station");
    await expect(strip.getByTestId("soul-diyu-station-now")).toHaveText("第 3 / 13 站 · 望乡台");
    const stops = strip.locator("li[data-station]");
    await expect(stops).toHaveCount(13);
    await expect(strip.locator('li[aria-current="step"]')).toHaveCount(1);
    await expect(strip.locator('li[aria-current="step"]')).toHaveAttribute("data-station", "WANGXIANG_TERRACE");
    await expect(strip.locator('li[data-state="passed"]')).toHaveCount(2);
    await expect(strip.locator('li[data-state="ahead"]')).toHaveCount(10);
    // 宽屏(xl)13 个站名都写。
    await expect(stops.nth(0)).toContainText("土地庙");
    await expect(stops.nth(0).getByText("土地庙")).toBeVisible();

    await strip.getByTestId("soul-diyu-station-move").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(`挪站 · ${SOUL_DETAIL.name}`);
    await expect(dialog).toContainText("现在：第 3 站 · 望乡台");
    const target = dialog.getByLabel("挪到");
    await expect(target.locator('option[value="WANGXIANG_TERRACE"]')).toBeDisabled();
    await expect(target.locator('option[value="WANGXIANG_TERRACE"]')).toHaveText("第 3 / 13 站 · 望乡台 · 现在");
    // 默认是下一站。
    await expect(target).toHaveValue("EVIL_DOG_VILLAGE");
    await target.selectOption("FENGDU_CITY");
    await dialog.getByTestId("soul-diyu-station-move-confirm").click();

    await expect.poll(() => api.lastCall("POST", "/souls/:id/station/")?.body).toEqual({ station: "FENGDU_CITY" });
    expect(api.lastCall("POST", "/souls/:id/station/")?.path).toBe(`/souls/${SOUL_ID}/station/`);
    await expect(dialog).toBeHidden();
  });

  test("393 宽:13 格都在,只写当前站名,条不横滚", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    const api = await setupAuthenticatedPage(page);
    api.on("GET", SOUL_PATH, ON_ROAD);

    await page.goto(`/souls/${SOUL_ID}`);
    const strip = page.getByTestId("soul-diyu-station");
    await expect(strip.locator("li[data-station]")).toHaveCount(13);
    await expect(strip.locator('li[aria-current="step"]').getByText("望乡台")).toBeVisible();
    // 其余只留方块,站名只给读屏(sr-only,悬浮看 title)。sr-only 在 Playwright 里算 visible,所以量宽度。
    const hiddenName = await strip.locator('li[data-station="TUDI_TEMPLE"]').getByText("土地庙").boundingBox();
    expect(hiddenName!.width, "非当前站名在 393 宽下仍占位").toBeLessThanOrEqual(1);
    await expect(strip.locator('li[data-station="TUDI_TEMPLE"]')).toHaveAttribute("title", "土地庙");
    const list = strip.locator("ol");
    const overflow = await list.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow, `十三站条在 393 宽下横向溢出 ${overflow}px`).toBeLessThanOrEqual(1);
    const last = await strip.locator('li[data-station="HUANHUN_CLIFF"]').boundingBox();
    expect(last!.x + last!.width, "第 13 格落在屏幕外").toBeLessThanOrEqual(393);
    await expect(strip.getByTestId("soul-diyu-station-move")).toBeVisible();
  });
});

test.describe("灵魂详情 · 勾魂卡", () => {
  test("三步:发牒 → 拘到;「撤销…」在卡片里原地展开理由框,理由必填", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    const alive = { ...SOUL_DETAIL, current_state: "ALIVE", death_date: null, fated_death_date: { year: 2020, month: 1, day: 1 }, diyu_station: "" };
    api.on("GET", SOUL_PATH, alive);
    api.on("GET", "/dispatch/capture-warrants/due/", { count: 1, results: [
      { id: SOUL_ID, name: SOUL_DETAIL.name, soul_code: null, origin_location: "钱塘", fated_death_date: "2020-01-01", karmic_balance: 42, suggested_escort: "WUCHANG" },
    ] });
    const WARRANT_ID = "b2b2b2b2-0000-4000-8000-0000000000aa";
    let warrants: Record<string, unknown>[] = [];
    const warrant = (status: string, extra: Record<string, unknown> = {}) => ({
      id: WARRANT_ID, soul: SOUL_ID, soul_name: SOUL_DETAIL.name, soul_code: null, city_god: null, city_god_name: null,
      escort: "WUCHANG", status, issued_at: "2026-10-29T01:00:00Z", captured_at: null, handed_over_at: null,
      judgment: null, cancel_reason: "", create_time: "2026-10-29T01:00:00Z", ...extra,
    });
    api.on("GET", "/dispatch/capture-warrants/", () => ({ body: page1(warrants) }));
    api.on("POST", "/dispatch/capture-warrants/", () => {
      warrants = [warrant("ISSUED")];
      return { status: 201, body: warrants[0] };
    });
    api.on("POST", "/dispatch/capture-warrants/:id/cancel/", (call) => {
      warrants = [warrant("CANCELLED", { cancel_reason: call.body.reason })];
      return { body: warrants[0] };
    });

    await page.goto(`/souls/${SOUL_ID}`);
    // 在世:十三站只一行灰字,不画条。
    await expect(page.getByTestId("soul-diyu-station")).toHaveText("十三站 · 不在路上");

    const card = page.getByTestId("soul-capture");
    await expect(card.getByTestId("soul-capture-status")).toHaveText("阳寿已到 · 2020-01-01");
    const steps = card.getByTestId("capture-steps").locator("li");
    await expect(steps).toHaveCount(3);
    await expect(steps.nth(0)).toHaveAttribute("data-state", "current");
    await expect(steps.nth(0)).toContainText("发勾魂牒");
    await expect(card.getByLabel("鬼差")).toHaveValue("WUCHANG");
    await card.getByRole("button", { name: "发勾魂牒" }).click();
    await expect.poll(() => api.lastCall("POST", "/dispatch/capture-warrants/")?.body).toEqual({ soul: SOUL_ID, escort: "WUCHANG" });

    // 发牒之后:第二步「拘到」是当前,主按钮只有一个往下一步走。
    await expect(card.getByTestId("capture-warrant")).toHaveAttribute("data-status", "ISSUED");
    await expect(steps.nth(0)).toHaveAttribute("data-state", "passed");
    await expect(steps.nth(1)).toHaveAttribute("data-state", "current");
    await expect(steps.nth(1)).toContainText("拘到");
    await expect(steps.nth(2)).toHaveAttribute("data-state", "ahead");
    await expect(card.getByRole("button", { name: "拘到" })).toBeVisible();
    await expect(card.getByRole("button", { name: "交接城隍" })).toHaveCount(0);

    // 撤销:原地展开,不叠弹层。
    await card.getByRole("button", { name: "撤销…" }).click();
    const form = card.getByTestId("capture-cancel-form");
    await expect(form).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(card.getByRole("button", { name: "拘到" })).toHaveCount(0);
    await form.getByRole("button", { name: "撤销勾魂牒" }).click();
    await expect(form).toContainText("请写明撤销理由");
    expect(api.countOf("POST", "/dispatch/capture-warrants/:id/cancel/")).toBe(0);

    await form.getByLabel("撤销理由").fill("阳寿登记有误");
    await form.getByRole("button", { name: "撤销勾魂牒" }).click();
    await expect.poll(() => api.lastCall("POST", "/dispatch/capture-warrants/:id/cancel/")?.body).toEqual({ reason: "阳寿登记有误" });
    expect(api.lastCall("POST", "/dispatch/capture-warrants/:id/cancel/")?.path).toBe(`/dispatch/capture-warrants/${WARRANT_ID}/cancel/`);
    // 撤销后一行灰字;阳寿仍已到,可以重新发牒。
    await expect(card.getByTestId("capture-cancelled")).toHaveText("已撤销 · 阳寿登记有误");
    await expect(card.getByTestId("soul-capture-issue")).toBeVisible();
  });
});

// ── 审判台 ──────────────────────────────────────────────────────────────────

/** 一件可以 PATCH 的审判:GET 回当前状态,PATCH 合并字段(罪目、死因、冤情等级)。 */
function liveJudgment(api: ApiMock, start: Record<string, unknown>) {
  const state = { current: { ...start } };
  const path = `/judgment/${start.id}/`;
  api.on("GET", path, () => ({ body: state.current }));
  api.on("PATCH", path, (call) => {
    state.current = { ...state.current, ...call.body };
    return { body: state.current };
  });
  return state;
}

test.describe("审判台 · 地府", () => {
  test("罪目在「戊 · 发落」最上面;选「杀人」后写「判有罪时送 第九殿 · 平等王」", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    liveJudgment(api, { ...OPENED_JUDGMENT, offence: "" });

    await page.goto(`/judgment/${OPENED_JUDGMENT.id}`);
    const placement = page.getByTestId("placement");
    await expect(placement).toContainText("戊");
    const offence = placement.getByTestId("desk-offence");
    await expect(offence).toBeVisible();
    // 「最上面」:发落一节里第一个可操作的控件就是罪目。
    const firstControlIsOffence = await placement.evaluate((el) => {
      const first = el.querySelector('input:not([type="hidden"]), select, textarea, [role="radio"], [role="combobox"]');
      return !!first && !!el.querySelector('[data-testid="desk-offence"]')?.contains(first);
    });
    expect(firstControlIsOffence, "发落一节的第一个控件不是罪目").toBe(true);
    await expect(placement.getByTestId("desk-offence-route")).toHaveCount(0);

    const box = offence.getByRole("combobox", { name: "罪目" });
    await expect(box).toHaveAttribute("placeholder", "未填 · 按严重度选殿");
    await box.fill("杀");
    // 按殿分组:组头「殿序 · 殿王 · 狱名」。
    await expect(page.locator("[data-option-group]")).toHaveText(["第九殿 · 平等王 · 阿鼻大地狱"]);
    await page.getByRole("option", { name: "杀人" }).click();

    await expect.poll(() => api.lastCall("PATCH", `/judgment/${OPENED_JUDGMENT.id}/`)?.body).toEqual({ offence: "MURDER" });
    const route = placement.getByTestId("desk-offence-route");
    await expect(route).toContainText("判有罪时送 第九殿 · 平等王");
    await expect(route).toContainText("阿鼻大地狱");
  });

  test("枉死城块:冤情不到「重」不能判属实;「属实 · 提前释放…」先二次确认再发", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    const HELD = "2099-12-31";
    const state = liveJudgment(api, {
      ...OPENED_JUDGMENT, untimely: true, held_until: HELD, wrongful_death_cause: "VICTIM", grievance_level: "MINOR",
      grievance_status: "FILED", grievance_plea: "被人推下河", grievance_note: "", grievance_decided_at: null,
    });
    api.on("POST", "/judgment/wangsi/:id/decide/", (call) => {
      state.current = {
        ...state.current, grievance_status: call.body.upheld ? "UPHELD" : "REJECTED", grievance_note: call.body.note,
        grievance_decided_at: "2026-10-29T02:00:00Z", held_until: null,
      };
      return { body: state.current };
    });

    await page.goto(`/judgment/${OPENED_JUDGMENT.id}`);
    const block = page.getByTestId("desk-wangsi");
    await expect(block).toContainText("枉死城");
    await expect(block.getByTestId("wangsi-head-line")).toHaveText(`枉死 · 候至 ${HELD} · 在枉死城`);
    await expect(page.getByTestId("desk-untimely")).toHaveText(`枉死 · 候至 ${HELD} · 在枉死城`);
    await expect(block.getByTestId("wangsi-grievance-status")).toContainText("已申诉 · 待审");

    await block.getByLabel("审核意见").fill("确系被害");
    const uphold = block.getByTestId("wangsi-uphold");
    await expect(uphold).toHaveText("属实 · 提前释放…");
    await expect(uphold).toBeDisabled();
    await expect(block.getByTestId("wangsi-release-gate")).toHaveText("冤情到「重」或以上才能判属实");

    await block.getByTestId("wangsi-level").getByRole("radio", { name: "重", exact: true }).click();
    await expect.poll(() => api.lastCall("PATCH", `/judgment/${OPENED_JUDGMENT.id}/`)?.body).toEqual({ grievance_level: "MAJOR" });
    await expect(block.getByTestId("wangsi-release-gate")).toHaveCount(0);
    await expect(uphold).toBeEnabled();

    await uphold.click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText(`提前释放${OPENED_JUDGMENT.soul_name}？`);
    await expect(confirm).toContainText(`不再候到 ${HELD}`);
    await expect(confirm).toContainText("释放后不能收回。");
    expect(api.countOf("POST", "/judgment/wangsi/:id/decide/")).toBe(0);
    await confirm.getByRole("button", { name: "属实 · 提前释放", exact: true }).click();

    await expect.poll(() => api.lastCall("POST", "/judgment/wangsi/:id/decide/")?.body).toEqual({ upheld: true, deliver: false, note: "确系被害" });
    expect(api.lastCall("POST", "/judgment/wangsi/:id/decide/")?.path).toBe(`/judgment/wangsi/${OPENED_JUDGMENT.id}/decide/`);
    await expect(confirm).toBeHidden();
    await expect(block.getByTestId("wangsi-head-line")).toContainText("已提前释放");
    await expect(block.getByTestId("wangsi-grievance-status")).toContainText("属实 · 已提前释放");
  });
});

test.describe("审判台 · 埃及称心", () => {
  const EG_ID = "e9e9e9e9-e9e9-4e9e-8e9e-e9e9e9e9e9e9";
  const EG_CASE = { ...OPENED_JUDGMENT, id: EG_ID, case_number: "EG-2026-0001", civilization: "EGYPTIAN", judgment_method: "HEART_WEIGHING" };
  /** 42 条:§1 如实、§2 不实,其余未记。 */
  function confessions() {
    const items = Array.from({ length: 42 }, (_, i) => {
      const n = i + 1;
      return {
        ordinal: n, statute_id: `f0f0f0f0-0000-4000-8000-${String(n).padStart(12, "0")}`, code: `NC_${n}`,
        assessor: `陪审神${n}`, text: `我没有犯第 ${n} 条罪`, truthful: n === 1 ? true : n === 2 ? false : null,
        note: n === 2 ? "书吏另有记载" : "", recorded_at: n <= 2 ? "2026-10-28T00:00:00Z" : null,
      };
    });
    return { applies: true, concluded: false, items, tally: { truthful: 1, untruthful: 1, unheard: 40, total: 42 } };
  }

  async function openConfessions(page: Parameters<typeof setupAuthenticatedPage>[0]) {
    const api = await setupAuthenticatedPage(page);
    api.on("GET", `/judgment/${EG_ID}/`, EG_CASE);
    api.on("GET", "/judgment/:id/negative-confessions/", confessions());
    api.on("PUT", "/judgment/:id/negative-confessions/:ordinal/", confessions());
    await page.goto(`/judgment/${EG_ID}`);
    await page.getByRole("tab", { name: "供词" }).click();
    const panel = page.getByTestId("negative-confessions");
    await expect(panel).toContainText("四十二条否定告白");
    return { api, panel };
  }

  test("四十二条按条序分两栏;「只看未记」收起已记的;逐条记", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { api, panel } = await openConfessions(page);

    const columns = panel.getByTestId("confession-column");
    await expect(columns).toHaveCount(2);
    await expect(columns.nth(0).getByTestId("confession-row")).toHaveCount(21);
    await expect(columns.nth(1).getByTestId("confession-row")).toHaveCount(21);
    await expect(columns.nth(0).getByTestId("confession-row").first()).toContainText("§ 1");
    await expect(columns.nth(1).getByTestId("confession-row").first()).toContainText("§ 22");
    // 宽屏两栏并排。
    const [left, right] = [await columns.nth(0).boundingBox(), await columns.nth(1).boundingBox()];
    expect(right!.x).toBeGreaterThan(left!.x + left!.width - 1);
    await expect(panel.getByTestId("confession-tally")).toContainText("如实 1 · 不实 1 · 未记 40");
    // 备注只在「不实」那一条展开。
    await expect(panel.getByRole("textbox", { name: "备注" })).toHaveCount(1);

    const only = panel.getByRole("button", { name: "只看未记" });
    await expect(only).toHaveAttribute("aria-pressed", "false");
    await only.click();
    await expect(only).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByTestId("confession-row")).toHaveCount(40);
    await expect(panel.locator('[data-testid="confession-row"][data-truthful="true"]')).toHaveCount(0);
    await expect(panel.locator('[data-testid="confession-row"][data-truthful="false"]')).toHaveCount(0);
    await expect(columns.nth(0).getByTestId("confession-row").first()).toContainText("§ 3");

    await panel.getByRole("radiogroup", { name: "第 3 位判官 陪审神3" }).getByRole("radio", { name: "如实" }).click();
    await expect
      .poll(() => api.lastCall("PUT", "/judgment/:id/negative-confessions/:ordinal/")?.body)
      .toEqual({ truthful: true, note: "" });
    expect(api.lastCall("PUT", "/judgment/:id/negative-confessions/:ordinal/")?.path).toBe(`/judgment/${EG_ID}/negative-confessions/3/`);
  });

  test("393 宽:两栏叠成一栏,分段每段 44px 高,合计只写三个数", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    const { panel } = await openConfessions(page);

    const columns = panel.getByTestId("confession-column");
    await expect(columns).toHaveCount(2);
    const [left, right] = [await columns.nth(0).boundingBox(), await columns.nth(1).boundingBox()];
    expect(Math.abs(right!.x - left!.x), "窄屏下第二栏没有叠到第一栏下面").toBeLessThanOrEqual(1);
    expect(right!.y).toBeGreaterThanOrEqual(left!.y + left!.height - 1);
    const radio = panel.getByRole("radiogroup", { name: "第 3 位判官 陪审神3" }).getByRole("radio", { name: "未记" });
    const box = await radio.boundingBox();
    expect(box!.height, `窄屏分段高 ${box!.height}px,不到 44`).toBeGreaterThanOrEqual(43.5);
    await expect(panel.getByTestId("confession-tally").getByText("1 · 1 · 40")).toBeVisible();
    const overflow = await panel.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow, `四十二条在 393 宽下横向溢出 ${overflow}px`).toBeLessThanOrEqual(1);
  });
});

// ── 审判队列 ────────────────────────────────────────────────────────────────

test.describe("审判队列 · 希腊过河", () => {
  test("未葬的希腊案不放「认领」,写「未葬，不得过河」;别的案子照常可认领", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    const UNBURIED = {
      ...OPENED_JUDGMENT, id: "a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7", case_number: "GR-2026-0001",
      soul_name: "未葬的水手", civilization: "GREEK", ferry_barred: "UNBURIED", claimed_by: null,
    };
    const OPEN = { ...OPENED_JUDGMENT, id: "a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a8", soul_name: "可认领的亡魂", ferry_barred: "", claimed_by: null };
    api.on("GET", "/judgment/", (call) => ({ body: page1(call.query.group === "unclaimed" ? [UNBURIED, OPEN] : []) }));

    await page.goto("/judgment");
    const barred = page.locator("tr", { hasText: UNBURIED.soul_name });
    await expect(barred.getByTestId("claim-held")).toHaveText("未葬，不得过河");
    await expect(barred.getByTestId("ferry-mark")).toContainText("未葬");
    await expect(barred.getByRole("button", { name: "认领", exact: true })).toHaveCount(0);

    const open = page.locator("tr", { hasText: OPEN.soul_name });
    await expect(open.getByRole("button", { name: "认领", exact: true })).toBeVisible();
    await expect(open.getByTestId("claim-held")).toHaveCount(0);
  });
});

// ── 城隍编辑 ────────────────────────────────────────────────────────────────

test.describe("城隍编辑 · 诸司", () => {
  test("七组诸司默认收起,组头写已选 / 共有;「按县城隍预设」替换前先确认", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    const GOD = {
      id: "c9c9c9c9-0000-4000-8000-0000000000aa", tenant: 1, name: "钱塘县城隍", rank: "COUNTY", bureaus: ["YINYANG"],
      regions: ["钱塘"], is_default: false, officers: [], open_case_count: 0,
      create_time: "2026-10-01T00:00:00Z", update_time: "2026-10-01T00:00:00Z",
    };
    api.on("GET", "/judgment/city-gods/", page1([GOD]));
    api.on("GET", "/judgment/city-gods/officer-choices/", []);
    api.on("PATCH", "/judgment/city-gods/:id/", (call) => ({ body: { ...GOD, ...call.body } }));

    await page.goto("/city-gods");
    await page.getByTestId(`city-god-edit-${GOD.id}`).click();
    const drawer = page.getByRole("dialog");
    const bureaus = drawer.getByTestId("city-god-bureaus");
    const ministries = bureaus.locator("button[data-ministry]");
    await expect(ministries).toHaveCount(7);
    for (let i = 0; i < 7; i++) await expect(ministries.nth(i)).toHaveAttribute("aria-expanded", "false");
    const count = (m: string) => bureaus.locator(`button[data-ministry="${m}"]`).getByTestId("ministry-count");
    await expect(count("HEAD")).toHaveText("1 / 1");
    await expect(count("PERSONNEL")).toHaveText("0 / 4");
    await expect(bureaus.locator('input[data-bureau="GONGCAO"]')).toBeHidden();

    await bureaus.locator('button[data-ministry="PERSONNEL"]').click();
    await expect(bureaus.locator('button[data-ministry="PERSONNEL"]')).toHaveAttribute("aria-expanded", "true");
    await expect(bureaus.locator('input[data-bureau="GONGCAO"]')).toBeVisible();

    // 预设按钮跟着级别走。
    const preset = bureaus.getByTestId("city-god-bureau-preset");
    await expect(preset).toHaveText("按县城隍预设");
    await drawer.getByTestId("city-god-rank").getByRole("radio", { name: "府城隍" }).click();
    await expect(preset).toHaveText("按府城隍预设");
    await drawer.getByTestId("city-god-rank").getByRole("radio", { name: "县城隍" }).click();

    // 已勾了 1 司且与预设不同:先确认。
    await preset.click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("会替换现在勾选的 1 司");
    await confirm.getByRole("button", { name: "按县城隍预设" }).click();
    await expect(confirm).toBeHidden();
    await expect(count("HEAD")).toHaveText("1 / 1");
    await expect(count("PERSONNEL")).toHaveText("2 / 4");
    await expect(count("REVENUE")).toHaveText("2 / 4");
    await expect(count("WORKS")).toHaveText("1 / 4");

    await drawer.getByTestId("city-god-save").click();
    await expect
      .poll(() => api.lastCall("PATCH", "/judgment/city-gods/:id/")?.body?.bureaus)
      .toEqual(["YINYANG", "GONGCAO", "JIBU", "TUDI", "KAOJIE", "JISI", "XINGXUN", "JUBU", "ANBU", "SHUYUN"]);
    expect(api.lastCall("PATCH", "/judgment/city-gods/:id/")?.body?.rank).toBe("COUNTY");
  });
});
