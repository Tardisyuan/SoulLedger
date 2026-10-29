import { test, expect, mockApi, seedAuthState, setupAuthenticatedPage, OPENED_JUDGMENT, PERMISSIONS, SOUL_DETAIL, SOULS, TEST_USER, type ApiMock } from "./fixtures";

/**
 * 数据范围 B8:管理员在角色抽屉里把「判官」配成「本机构」→ 判官登录 → 灵魂与审判只剩本机构的;
 * 本人创建 / 认领的范围外那几条仍在;直接打开范围外的详情是「无权查看或已不存在」。
 *
 * 和其它 spec 一样是路由 mock(fixtures.ts 文件头说了为什么),所以「按范围过滤」是 mock 在做 ——
 * 它照 `apps/perm/data_scope.py` 的规则(本机构 ∪ 本人创建 ∪ 认领)按**存下来的**配置回答。
 * 这里钉住的是前端那一半:抽屉发出的配置真的被后来的读取用上,列表画的就是服务器给的那几条,
 * 404 的详情页说的是那一句、不是报错也不给重试。服务器侧的规则由后端的数据范围测试守着。
 */

const HOME = 11; // 判官所在机构
const PEER = 12; // 平级机构
const JUDGE_ROLE_ID = 2; // fixtures ROLES 里 JUDGE 的 id

const JUDGE_USER = {
  id: 7,
  username: "cui_judge",
  display_name: "崔判官",
  email: "cui@soulledger.test",
  role: "JUDGE" as const,
  tenant: TEST_USER.tenant,
};
const JUDGE_CODENAMES = ["soul.read", "judgment.read", "judgment.claim"];

/** Who owns a row, kept beside the payload — the list serializers do not send these, so the bodies stay the API's shape. */
interface Owner { org: number; creator?: number; claimer?: number }

const soul = (n: number, name: string) => ({ ...SOULS[0], id: `5c0a1e00-0000-4000-8000-00000000000${n}`, name });
const S_HOME = soul(1, "本机构的灵魂");
const S_PEER = soul(2, "平级机构的灵魂");
const S_PEER_MINE = soul(3, "判官登记的灵魂");
const SOUL_OWNERS = new Map<string, Owner>([
  [S_HOME.id, { org: HOME }],
  [S_PEER.id, { org: PEER }],
  [S_PEER_MINE.id, { org: PEER, creator: JUDGE_USER.id }],
]);

const judgment = (n: number, soulName: string, claimedBy: number | null) => ({
  ...OPENED_JUDGMENT,
  id: `1d9e0000-0000-4000-8000-00000000000${n}`,
  case_number: `CN-2026-010${n}`,
  soul_name: soulName,
  court: "第一殿",
  claimed_by: claimedBy,
  claimed_by_name: claimedBy ? JUDGE_USER.display_name : null,
  karmic_balance: 0,
  evidence_count: 0,
});
const J_HOME = judgment(1, "本机构的案子", null);
const J_PEER = judgment(2, "平级机构的案子", null);
const J_PEER_CLAIMED = judgment(3, "判官认领的案子", JUDGE_USER.id);
const J_PEER_CREATED = judgment(4, "判官开的案子", null);
const JUDGMENT_OWNERS = new Map<string, Owner>([
  [J_HOME.id, { org: HOME }],
  [J_PEER.id, { org: PEER }],
  [J_PEER_CLAIMED.id, { org: PEER, claimer: JUDGE_USER.id }],
  [J_PEER_CREATED.id, { org: PEER, creator: JUDGE_USER.id }],
]);

const page1 = (results: unknown[]) => ({ count: results.length, next: null, previous: null, results });
const NOT_FOUND = { status: 404, body: { detail: "Not found." } };

/** The server's side of it: stored role scopes, who is signed in, and visibility by both. */
function serveByScope(api: ApiMock) {
  const scopes: Record<number, { default: { scope: string; orgs: number[] }; overrides: unknown[] }> = {};
  let judgeSignedIn = false;

  const visible = (owner: Owner | undefined) => {
    if (!owner) return false;
    if (!judgeSignedIn) return true; // ADMIN 跳过范围
    const scope = scopes[JUDGE_ROLE_ID]?.default.scope ?? "ALL"; // 没有配置行 = 全部
    if (scope === "ALL") return true;
    // 本人创建或被指派的,任何范围下都可见(设计「要点」第二条)。
    if (owner.creator === JUDGE_USER.id || owner.claimer === JUDGE_USER.id) return true;
    return scope === "ORG" && owner.org === HOME;
  };

  api.on("GET", "/perm/roles/:id/data-scope/", (call) => ({
    body: scopes[Number(call.path.split("/")[3])] ?? { default: { scope: "ALL", orgs: [] }, overrides: [] },
  }));
  api.on("PUT", "/perm/roles/:id/data-scope/", (call) => {
    scopes[Number(call.path.split("/")[3])] = call.body;
    return { body: call.body };
  });

  api.on("POST", "/auth/login/", (call) => {
    if (call.body?.username !== JUDGE_USER.username) return { status: 401, body: { detail: "No active account found with the given credentials" } };
    judgeSignedIn = true;
    return { body: { access: "e2e.judge.access", refresh: "e2e.judge.refresh", user: { ...JUDGE_USER, permissions: JUDGE_CODENAMES } } };
  });
  api.on("GET", "/perm/role-permissions/", () => ({
    body: judgeSignedIn
      ? { role: "JUDGE", permissions: JUDGE_CODENAMES, details: PERMISSIONS.filter((p) => JUDGE_CODENAMES.includes(p.codename)) }
      : { role: TEST_USER.role, permissions: PERMISSIONS.map((p) => p.codename), details: PERMISSIONS },
  }));

  const souls = [S_HOME, S_PEER, S_PEER_MINE];
  api.on("GET", "/souls/", (call) =>
    ({ body: page1(call.query.has_date_problem === "true" ? [] : souls.filter((s) => visible(SOUL_OWNERS.get(s.id)))) })
  );
  for (const s of souls) {
    api.on("GET", `/souls/${s.id}/`, () => (visible(SOUL_OWNERS.get(s.id)) ? { body: { ...SOUL_DETAIL, id: s.id, name: s.name } } : NOT_FOUND));
  }

  const judgments = [J_HOME, J_PEER, J_PEER_CLAIMED, J_PEER_CREATED];
  const seen = () => judgments.filter((j) => visible(JUDGMENT_OWNERS.get(j.id)));
  const groupOf = (j: (typeof judgments)[number]) => (j.claimed_by === null ? "unclaimed" : j.claimed_by === JUDGE_USER.id ? "mine" : "others");
  api.on("GET", "/judgment/", (call) => {
    if (call.query.has_verdict === "true") return { body: page1([]) }; // 全部未结案
    const rows = seen();
    return { body: page1(call.query.group ? rows.filter((j) => groupOf(j) === call.query.group) : rows) };
  });
  api.on("GET", "/judgment/queue-counts/", () => {
    const rows = seen();
    const n = (g: string) => rows.filter((j) => groupOf(j) === g).length;
    return { body: { mine: n("mine"), unclaimed: n("unclaimed"), others: n("others"), deferred: 0, total: rows.length } };
  });
  for (const j of judgments) {
    api.on("GET", `/judgment/${j.id}/`, () => (visible(JUDGMENT_OWNERS.get(j.id)) ? { body: j } : NOT_FOUND));
  }
}

test.describe("Data scope: a judge set to 本机构 sees only that organization", () => {
  test("configure in the role drawer, sign in as the judge, see the scoped lists and a 404 detail", async ({ page }) => {
    // ── 管理员(无殿 ADMIN,唯一能写范围的人)在角色抽屉里配「本机构」──
    const api = await setupAuthenticatedPage(page);
    serveByScope(api);
    await seedAuthState(page, { ...TEST_USER, tenant: null });

    // Before: no config row = 全部 — the admin's own list has all three.
    await page.goto("/souls");
    for (const s of [S_HOME, S_PEER, S_PEER_MINE]) await expect(page.getByText(s.name, { exact: true }).filter({ visible: true })).toBeVisible();

    await page.goto("/permissions");
    await page.getByRole("button", { name: /^角色/ }).first().click();
    await page.locator("tr", { hasText: "JUDGE" }).getByRole("button").click();
    const drawer = page.getByRole("dialog");
    const scope = drawer.getByRole("region", { name: "数据范围" });
    await expect(scope.getByRole("radio", { name: "全部" })).toBeChecked();
    await scope.getByRole("radio", { name: "本机构", exact: true }).check();
    await scope.getByRole("button", { name: "保存数据范围" }).click();
    await expect.poll(() => api.lastCall("PUT", "/perm/roles/:id/data-scope/")?.path).toBe(`/perm/roles/${JUDGE_ROLE_ID}/data-scope/`);
    expect(api.lastCall("PUT", "/perm/roles/:id/data-scope/")?.body).toEqual({ default: { scope: "ORG", orgs: [] }, overrides: [] });
    await expect(page.getByText("数据范围已保存，对方刷新后生效")).toBeVisible();

    // ── 换人:清掉管理员的会话(seedAuthState 的 init script 挂在这一页上,所以判官用同一上下文的新页)──
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.context().clearCookies();
    await page.close();
    const judge = await page.context().newPage();
    await mockApi(judge, api);

    await judge.goto("/login");
    await judge.getByLabel("账号").fill(JUDGE_USER.username);
    await judge.getByLabel("密码").fill("correct-horse-battery");
    await judge.getByRole("button", { name: "登录" }).click();
    await expect(judge).toHaveURL(/\/dashboard/);

    // ── 灵魂:本机构的 + 自己登记的;平级机构的不在 ──
    await judge.goto("/souls");
    await expect(judge.getByText(S_HOME.name, { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(judge.getByText(S_PEER_MINE.name, { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(judge.getByText(S_PEER.name, { exact: true })).toHaveCount(0);

    // ── 审判:本机构的 + 自己认领的 + 自己开的;平级机构的不在 ──
    await judge.goto("/judgment");
    await expect(judge.getByRole("link", { name: J_HOME.soul_name }).filter({ visible: true })).toBeVisible();
    await expect(judge.getByRole("link", { name: J_PEER_CLAIMED.soul_name }).filter({ visible: true })).toBeVisible();
    await expect(judge.getByRole("link", { name: J_PEER_CREATED.soul_name }).filter({ visible: true })).toBeVisible();
    await expect(judge.getByText(J_PEER.soul_name, { exact: true })).toHaveCount(0);

    // ── 范围外的详情:一句「无权查看或已不存在」,不是报错、不给重试 ──
    await judge.goto(`/judgment/${J_PEER.id}`);
    await expect(judge.getByText("无权查看或已不存在")).toBeVisible();
    await expect(judge.getByRole("button", { name: "重试" })).toHaveCount(0);
    await expect(judge.getByText(J_PEER.soul_name)).toHaveCount(0);

    await judge.goto(`/souls/${S_PEER.id}`);
    await expect(judge.getByText("无权查看或已不存在")).toBeVisible();
    await expect(judge.getByText("灵魂未找到")).toHaveCount(0);
    await expect(judge.getByText("Not found.")).toHaveCount(0);

    // 范围内的那一条照常打开 —— 上面的 404 是范围,不是详情页坏了。
    await judge.goto(`/judgment/${J_HOME.id}`);
    await expect(judge.getByText("无权查看或已不存在")).toHaveCount(0);
    await expect(judge.getByText(J_HOME.case_number).first()).toBeVisible();
  });
});
