import { test, expect, deskOf, dossierOf, mockApi, OPENED_JUDGMENT, TEST_USER } from "./fixtures";

/**
 * 案卷台(Design 第三十批 第 2 步):判官登录就到 `/desk`;J 挪到下一件,↵ 打开卷宗(`/judgment/<id>`)。
 * 路由层的 mock 与其他 spec 相同(fixtures.ts);这里钉的是前端的行为。
 */
const JUDGE = {
  id: 7,
  username: "desk_judge",
  display_name: "崔判官",
  email: "desk@soulledger.test",
  role: "JUDGE" as const,
  tenant: TEST_USER.tenant,
};
const CODENAMES = ["soul.read", "judgment.read", "judgment.execute"];

const MINE = { ...OPENED_JUDGMENT, soul_name: "赵志强", court: "第一殿", source: "queue", claimed_by_name: "崔判官" };
const UNCLAIMED = { ...OPENED_JUDGMENT, id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", case_number: "CN-2026-0002", soul_name: "哪吒", court: "第一殿", source: "city_god" };

test.describe("案卷台", () => {
  test("a judge lands on the desk, J moves to the next case, Enter opens it", async ({ page, isMobile }) => {
    test.skip(isMobile, "393 opens a case full-screen on tap; the keys are the desktop desk's");
    const api = await mockApi(page);
    api.on("POST", "/auth/login/", (call) => {
      if (call.body?.username !== JUDGE.username) return { status: 401, body: { detail: "No active account found with the given credentials" } };
      return { body: { access: "e2e.judge.access", refresh: "e2e.judge.refresh", user: { ...JUDGE, permissions: CODENAMES } } };
    });
    api.on("GET", "/perm/role-permissions/", { role: "JUDGE", permissions: CODENAMES, details: [] });
    // Two requests: the stack (`/dossiers/desk/`) and the open case (`/dossiers/:id/`). `desk/` after `:id/`: routes are
    // unshifted (the last registered wins), and `:id` matches `desk` too.
    api.on("GET", "/dossiers/:id/", (call) => ({ body: dossierOf(call.path.includes(UNCLAIMED.id) ? UNCLAIMED : MINE) }));
    api.on("GET", "/dossiers/desk/", deskOf({ mine: [MINE], unclaimed: [UNCLAIMED] }));

    await page.goto("/login");
    await page.getByLabel("账号").fill(JUDGE.username);
    await page.getByLabel("密码").fill("correct-horse-battery");
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page).toHaveURL(/\/desk$/);

    const desk = page.getByTestId("case-desk");
    await expect(desk.getByTestId(`desk-row-${MINE.id}`)).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("desk-overview")).toContainText("无超期");
    await expect(page.getByRole("heading", { level: 1, name: "赵志强" })).toBeVisible();

    await page.keyboard.press("j");
    await expect(desk.getByTestId(`desk-row-${UNCLAIMED.id}`)).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("heading", { level: 1, name: "哪吒" })).toBeVisible();

    // Absence: the desk no longer sends the four group lists or the soul's path it used to.
    expect(api.calls.filter((c) => c.method === "GET" && ((c.path === "/judgment/" && "group" in c.query) || /^\/souls\/[^/]+\/path\/$/.test(c.path)))).toEqual([]);

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/judgment/${UNCLAIMED.id}$`));
  });
});
