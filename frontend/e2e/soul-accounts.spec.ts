import {
  test,
  expect,
  domainEnum,
  setupAuthenticatedPage,
  CREDENTIALS_PENDING,
  CREDENTIALS_REVEALED,
  REBIRTH_APPLICATIONS,
  REVEALED_PASSWORD,
  SOUL_ACCOUNT,
  SOUL_DETAIL,
  REBIRTH_WORKFLOW,
} from "./fixtures";

/**
 * Officer-side soul accounts against the route mock, as ADMIN (fixtures.ts
 * TEST_USER). ADMIN short-circuits every codename, so permission withholding
 * is pinned in the jest suites (SoulCredentialsPage / SoulAccountCard /
 * RebirthApplicationsPage), not here.
 */

const credentialRow = (page: import("@playwright/test").Page, id: string) => page.locator(`li[data-credential-id="${id}"]`);

test.describe("Pending initial passwords", () => {
  test("lists what awaits delivery, per status, with the reason and the way out", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    await page.goto("/soul-credentials");

    await expect(page.locator("h1")).toContainText("待交付初始密码");
    const pending = credentialRow(page, CREDENTIALS_PENDING[0].id);
    await expect(pending).toContainText(SOUL_ACCOUNT.soul_code);
    await expect(pending).toContainText("第 1 世");
    await expect(pending).toContainText("无可用联系方式");
    await expect(domainEnum(pending, "PENDING")).toHaveText("待交付");
    await expect(pending.getByText("PENDING", { exact: true })).toHaveCount(0);
    expect(api.lastCall("GET", "/soul-accounts/credentials/")?.query.status).toBe("PENDING");

    await page.getByRole("button", { name: "已查看，待交付", exact: true }).click();
    const revealed = credentialRow(page, CREDENTIALS_REVEALED[0].id);
    await expect(revealed).toContainText("发送失败（SMTPException），已尝试 3 次");
    await expect(revealed.getByRole("button", { name: "标记已交付" })).toBeVisible();
    await expect(revealed.getByRole("button", { name: "查看密码" })).toHaveCount(0);

    await page.getByRole("button", { name: "已作废", exact: true }).click();
    const expired = page.locator("li[data-credential-id]");
    await expect(expired).toHaveCount(1);
    await expect(expired).toContainText("初始密码已过期");
    await expect(expired.getByRole("link", { name: "去重置" })).toHaveAttribute("href", `/souls/${SOUL_DETAIL.id}#soul-account`);
  });

  test("reveals the password once; closing the dialog loses it for good", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    await page.goto("/soul-credentials");

    await credentialRow(page, CREDENTIALS_PENDING[0].id).getByRole("button", { name: "查看密码" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("只能查看一次");
    await expect(dialog).not.toContainText(REVEALED_PASSWORD.password);
    expect(api.countOf("POST", "/soul-accounts/credentials/:id/reveal/")).toBe(0);

    await dialog.getByRole("button", { name: "我已准备好，查看" }).click();
    await expect(dialog.getByTestId("revealed-password")).toHaveText(REVEALED_PASSWORD.password);
    expect(api.countOf("POST", "/soul-accounts/credentials/:id/reveal/")).toBe(1);

    // An outside click must not throw the one copy away.
    await page.mouse.click(5, 5);
    await expect(dialog.getByTestId("revealed-password")).toBeVisible();

    await dialog.getByRole("button", { name: "我已记下，关闭" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText(REVEALED_PASSWORD.password)).toHaveCount(0);

    // A second reveal is refused by the server; the page says why and shows nothing.
    api.on("POST", "/soul-accounts/credentials/:id/reveal/", () => ({
      status: 409,
      body: { detail: "明文已被查看过或已发送,不能再次查看;如需交付请重置。", code: "credential_not_revealable" },
    }));
    await credentialRow(page, CREDENTIALS_PENDING[0].id).getByRole("button", { name: "查看密码" }).click();
    await expect(page.getByRole("dialog")).not.toContainText(REVEALED_PASSWORD.password);
    await page.getByRole("dialog").getByRole("button", { name: "我已准备好，查看" }).click();
    await expect(page.getByText("该密码已被查看过（可能是其他官员），不能再次查看；如需交付请到灵魂详情页重置")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText(REVEALED_PASSWORD.password)).toHaveCount(0);
  });

  test("marks a viewed password delivered", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    await page.goto("/soul-credentials");
    await page.getByRole("button", { name: "已查看，待交付", exact: true }).click();
    await credentialRow(page, CREDENTIALS_REVEALED[0].id).getByRole("button", { name: "标记已交付" }).click();
    await expect(page.getByText("已标记为线下交付")).toBeVisible();
    expect(api.lastCall("POST", "/soul-accounts/credentials/:id/mark-delivered/")?.path).toBe(
      `/soul-accounts/credentials/${CREDENTIALS_REVEALED[0].id}/mark-delivered/`
    );
  });
});

test.describe("Soul account card on the soul page", () => {
  test("shows this life's account and chain, and resets without clearing contacts", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    await page.goto(`/souls/${SOUL_DETAIL.id}`);

    const card = page.locator("section#soul-account");
    await expect(card).toContainText("灵魂账号");
    await expect(card).toContainText(SOUL_ACCOUNT.soul_code);
    await expect(card).toContainText("首次登录须改密");
    await expect(card.getByTestId("soul-account-chain").locator("li")).toHaveCount(1);
    // This life has an account: reset, not provision.
    await expect(card.getByRole("button", { name: "开通本世账号" })).toHaveCount(0);

    await card.getByRole("button", { name: "重置初始密码" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("未交付的旧密码立即作废");
    await dialog.getByRole("button", { name: "重置初始密码" }).click();
    await expect(page.getByText("已重置；无可用联系方式，新密码已进入待交付列表")).toBeVisible();
    const reset = api.lastCall("POST", "/soul-accounts/accounts/:id/reset-credential/");
    expect(reset?.path).toBe(`/soul-accounts/accounts/${SOUL_ACCOUNT.id}/reset-credential/`);
    expect(reset?.body).toEqual({});
  });
});

test.describe("Rebirth applications", () => {
  test("lists applications and shows the current step by role, without asking for the workflow", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    await page.goto("/rebirth-applications");

    await expect(page.locator("h1")).toContainText("转生申请");
    const row = page.locator(`li[data-application-id="${REBIRTH_APPLICATIONS[0].id}"]`);
    await expect(row).toContainText("人道");
    await expect(domainEnum(row, "UNDER_REVIEW")).toHaveText("审批中");

    await row.getByRole("button", { name: "查看详情" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("评估");
    await expect(dialog).toContainText("审判者");
    expect(api.countOf("GET", "/workflows/:id/")).toBe(0);
    await expect(dialog).toContainText(REBIRTH_APPLICATIONS[0].statement);
    await expect(dialog).toContainText("尚未决定");
    // TEST_USER is ADMIN, the first node names JUDGE, and ADMIN gets no bypass.
    await expect(dialog.getByTestId("cross-civilization-decision")).toHaveCount(0);
    await expect(dialog.getByRole("link", { name: "打开审批流程" })).toHaveAttribute(
      "href",
      `/workflow/${REBIRTH_APPLICATIONS[0].workflow}`
    );
  });

  test("rejecting on the rebirth workflow requires a reason for the soul, apart from the notes", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    await page.goto(`/workflow/${REBIRTH_APPLICATIONS[0].workflow}`);

    await page.getByLabel("通过", { exact: true }).check();
    await expect(page.getByLabel(/给灵魂的驳回理由/)).toHaveCount(0);

    await page.getByLabel("拒绝", { exact: true }).check();
    const reason = page.getByLabel(/给灵魂的驳回理由/);
    await expect(reason).toBeVisible();
    await expect(page.getByText("此理由对灵魂可见;内部备注不可见。最多 2000 字。")).toBeVisible();

    // The backend's refusal lands beside the field.
    api.on("POST", "/workflows/:id/approve_node/", () => ({
      status: 400,
      body: { error: "rejection_reason_for_soul is required", detail: "驳回转生申请必须填写给灵魂的驳回理由" },
    }));
    await reason.fill("功过未清");
    await page.getByLabel("备注", { exact: true }).fill("内部:证据不足");
    await page.getByRole("button", { name: "提交决定" }).click();
    await expect(page.getByText("驳回转生申请必须填写给灵魂的驳回理由")).toBeVisible();
    expect(api.lastCall("POST", "/workflows/:id/approve_node/")?.body).toEqual({
      node_id: REBIRTH_WORKFLOW.current_node,
      verdict: "REJECTED",
      notes: "内部:证据不足",
      rejection_reason_for_soul: "功过未清",
    });
  });
});
