import { expect, test, type Page } from "@playwright/test";
import { clean, enter, recording, rows, signOut, watch } from "./support";

/** Claims the first unclaimed case in the queue and returns the soul's name. */
async function claimFirst(page: Page): Promise<string> {
  await page.goto("/judgment");
  const row = page.getByTestId("queue-group-unclaimed").getByTestId("queue-row").filter({ has: page.getByRole("button", { name: "认领", exact: true }) }).first();
  await expect(row).toBeVisible();
  const name = (await row.getByRole("link").first().innerText()).trim();
  await row.getByRole("button", { name: "认领", exact: true }).click();
  await expect(page.getByTestId("queue-group-mine").getByTestId("queue-row").filter({ hasText: name })).toBeVisible();
  return name;
}

async function concludeOpen(page: Page, name: string, verdict: "PASSED" | "FAILED"): Promise<void> {
  await page.getByTestId("queue-group-mine").getByTestId("queue-row").filter({ hasText: name }).getByRole("link").first().click();
  await page.waitForURL(/\/judgment\/[0-9a-f-]{36}/);
  await page.getByRole("radio").and(page.locator(`[value="${verdict}"]`)).check({ force: true });
  await page.getByRole("button", { name: "进入落印确认" }).click();
  // With the flow's stations to pick, there is one more step before the stamp.
  const next = page.getByRole("button", { name: "下一步" });
  const final = page.getByRole("button", { name: /落判并发起|落印并结案|不过 · 落印/ });
  await expect(next.or(final).first()).toBeVisible();
  // v4 S10: a failed original names its reason first (the first the hall offers); the stamp stays grey until then.
  const reasons = page.getByTestId("reject-reasons");
  if (await reasons.isVisible()) await reasons.locator("input:not([disabled])").first().check({ force: true });
  if (await next.isVisible()) await next.click();
  await final.first().click();
}

test("the judge claims a case, concludes it, and a disposition comes out", async ({ page, context }) => {
  const seen = watch(context, page);
  await enter(page, "judge");
  const name = await claimFirst(page);
  await concludeOpen(page, name, "FAILED");
  await expect(page.getByTestId("current-ruling").or(page.getByTestId("concluded-balance")).first()).toBeVisible();

  await page.goto("/judgment");
  await expect(page.getByTestId("queue-group-mine").getByText(name)).toHaveCount(0);
  await page.goto("/disposition");
  await expect(page.locator("main").getByText(name).first()).toBeVisible();
  // A reload keeps the session's world.
  await page.reload();
  await expect(page.locator("main").getByText(name).first()).toBeVisible();
  clean(seen, "the judge's main line");
});

const judgedFlow = () => rows(recording("admin"), "/workflows/").find((w) => w.status === "IN_PROGRESS" && w.case_type !== "REBIRTH_APPLICATION")?.id;

async function decide(page: Page, verdict: string): Promise<void> {
  const radio = page.locator(`input[type="radio"][value="${verdict}"]`).first();
  await radio.locator("xpath=ancestor::label").click();
  await expect(radio).toBeChecked();
  await page.getByRole("button", { name: "提交决定" }).click();
}

test("an approval flow can be walked to its end", async ({ page, context }) => {
  test.setTimeout(60000);
  const seen = watch(context, page);
  await enter(page, "admin");
  await page.goto(`/workflow/${judgedFlow()}`);
  const main = page.locator("main");
  await expect(page.getByRole("button", { name: "提交决定" })).toBeVisible();
  // Each decision moves the flow one station on; a ten-court flow has a dozen of them.
  // `title` carries the raw status (<DomainEnum>); the words 流程完成 also appear in the page's legend.
  const done = page.getByTitle("COMPLETED").filter({ visible: true }).first();
  for (let step = 0; step < 30 && !(await done.isVisible()); step += 1) {
    const before = await main.innerText();
    await decide(page, "PASSED");
    await expect.poll(async () => (await main.innerText()) !== before).toBe(true);
    await page.waitForTimeout(150);
  }
  await expect(done).toBeVisible();
  await expect(page.getByRole("button", { name: "提交决定" })).toHaveCount(0);
  await page.reload();
  await expect(done).toBeVisible();
  clean(seen, "workflow approve");
});

test("an approval flow can be rejected", async ({ page, context }) => {
  const seen = watch(context, page);
  await enter(page, "admin");
  await page.goto(`/workflow/${judgedFlow()}`);
  await page.locator('input[type="radio"][value="FAILED"]').first().locator("xpath=ancestor::label").click();
  const why = page.getByLabel(/告诉灵魂|理由/).first();
  if (await why.isVisible().catch(() => false)) await why.fill("演示:驳回");
  await page.getByRole("button", { name: "提交决定" }).click();
  await expect(page.locator("main")).toContainText("已拒绝");
  await page.goto("/workflow");
  clean(seen, "workflow reject");
});

test("a proposed dispatch can be approved, and it leaves the waiting list", async ({ page, context }) => {
  const seen = watch(context, page);
  const proposed = rows(recording("admin"), "/dispatch/records/").find((d) => d.status === "PROPOSED");
  await enter(page, "admin");
  await page.goto(`/dispatch/${proposed?.id}`);
  await expect(page.locator("main")).toContainText("待审批");
  await page.getByRole("button", { name: "批准" }).click();
  await page.getByRole("dialog").or(page.getByRole("alertdialog")).getByRole("button", { name: "批准" }).click();
  await expect(page.locator("main")).toContainText("已批准");
  await page.goto("/dispatch");
  await expect(page.locator("main")).toContainText(String(proposed?.soul_name));
  await page.goto(`/dispatch/${proposed?.id}`);
  await expect(page.locator("main")).toContainText("已批准");
  clean(seen, "dispatch approval");
});

test("a post and a comment can be written, and stay after a reload", async ({ page, context }) => {
  const seen = watch(context, page);
  await enter(page, "judge");
  await page.goto("/social");
  await page.getByPlaceholder("今天想说点什么").filter({ visible: true }).fill("第五殿今日无事,奈何桥水位如常。");
  await page.getByRole("button", { name: "发布" }).click();
  const card = page.locator("main").getByText("第五殿今日无事,奈何桥水位如常。").first();
  await expect(card).toBeVisible();
  await page.reload();
  await expect(card).toBeVisible();
  await card.click();
  await page.waitForURL(/\/social\/[0-9a-f-]{36}/);
  await page.getByPlaceholder("写评论…").fill("收到,已转告摆渡人。");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator("main").getByText("收到,已转告摆渡人。").first()).toBeVisible();
  clean(seen, "social");
});

test("the moderator hides a reported post and lifts a mute", async ({ page, context }) => {
  const seen = watch(context, page);
  await enter(page, "moderator");
  await page.goto("/moderation");
  const before = rows(recording("moderator"), "/social-moderation/reports/").filter((r) => r.status === "OPEN")[0];
  const item = page.locator("main li").filter({ hasText: String(before.content_excerpt).slice(0, 8) }).first();
  await item.getByRole("button").first().click();
  const detail = page.getByRole("region", { name: "审阅详情" });
  await detail.getByLabel("隐藏 / 删除理由（会告诉作者）").selectOption("ABUSE");
  await detail.getByRole("button", { name: /^隐藏/ }).click();
  await expect(page.locator("main li").filter({ hasText: String(before.content_excerpt).slice(0, 8) })).toHaveCount(0);
  await page.getByRole("radio", { name: /^已处理/ }).click();
  await expect(page.locator("main")).toContainText(String(before.content_excerpt).slice(0, 8));

  await page.getByRole("radio", { name: /^禁言\s*(，\d+ 条)?$/ }).first().click();
  await page.getByRole("button", { name: "解除禁言" }).first().click();
  await page.getByRole("dialog").or(page.getByRole("alertdialog")).getByRole("button", { name: "解除禁言" }).click();
  await expect(page.getByRole("button", { name: "解除禁言" })).toHaveCount(0);
  clean(seen, "moderation");
});

test("the admin creates a user and a role", async ({ page, context }) => {
  const seen = watch(context, page);
  await enter(page, "admin");
  await page.goto("/users");
  await page.getByRole("button", { name: /创建用户/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/用户名/).fill("demo_new_officer");
  await dialog.getByLabel(/邮箱/).fill("new@underworld.example");
  await dialog.getByLabel(/^密码|初始密码/).first().fill("Demo-Only-Passw0rd!");
  await dialog.getByRole("button", { name: /创建|保存|确定/ }).last().click();
  await expect(page.locator("main")).toContainText("demo_new_officer");
  await page.reload();
  await expect(page.locator("main")).toContainText("demo_new_officer");

  await page.goto("/permissions");
  await page.getByRole("radio", { name: /^角色/ }).first().click();
  await page.getByRole("button", { name: /创建角色/ }).click();
  const roleDialog = page.getByRole("dialog");
  await roleDialog.locator("input").first().fill("FERRYMAN");
  await roleDialog.locator("input").nth(1).fill("摆渡人");
  await roleDialog.getByRole("button", { name: /创建|保存|确定/ }).last().click();
  await expect(page.locator("main")).toContainText("摆渡人");
  clean(seen, "users and roles");
});

test("signing out and back in brings the seed back", async ({ page }) => {
  await enter(page, "judge");
  const name = await claimFirst(page);
  await expect(page.getByTestId("queue-group-mine").getByText(name)).toBeVisible();
  await signOut(page);
  await enter(page, "judge");
  await page.goto("/judgment");
  await expect(page.getByTestId("queue-group-unclaimed").getByText(name)).toBeVisible();
  await expect(page.getByTestId("queue-group-mine").getByText(name)).toHaveCount(0);
});

test("two visitors do not see each other's changes", async ({ browser }) => {
  const one = await (await browser.newContext()).newPage();
  const two = await (await browser.newContext()).newPage();
  await enter(one, "judge");
  await enter(two, "judge");
  const name = await claimFirst(one);
  await two.goto("/judgment");
  await expect(two.getByTestId("queue-group-unclaimed").getByText(name)).toBeVisible();
});

test("a second tab starts from the seed", async ({ context, page }) => {
  await enter(page, "judge");
  const name = await claimFirst(page);
  const tab = await context.newPage();
  await tab.goto("/judgment");
  await expect(tab.getByTestId("queue-group-unclaimed").getByText(name)).toBeVisible();
});

test("a disposition can be carried out, and the realm's list moves", async ({ page, context }) => {
  const seen = watch(context, page);
  await enter(page, "admin");
  await page.goto("/disposition");
  const before = await page.locator("main").innerText();
  await page.getByRole("button", { name: "执行处置", disabled: false }).first().click();
  await page.getByRole("dialog").or(page.getByRole("alertdialog")).getByRole("button", { name: /确认|执行/ }).last().click();
  await expect.poll(async () => (await page.locator("main").innerText()) !== before).toBe(true);
  clean(seen, "disposition execute");
});

test("the assistant answers, and says it is a demo", async ({ page, context }) => {
  const seen = watch(context, page);
  await enter(page, "judge");
  await page.getByTestId("officer-assist-entry").click();
  const box = page.getByPlaceholder("问一个关于这套后台的问题");
  await box.fill("我的队列有多少?");
  await box.press("Enter");
  await expect(page.getByTestId("assist-stream-text").or(page.getByText("这是演示环境")).first()).toContainText("这是演示环境");
  clean(seen, "assistant");
});

test("an export downloads a CSV of the list", async ({ page, context }) => {
  const seen = watch(context, page);
  await enter(page, "judge");
  await page.goto("/souls");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /导出/ }).first().click();
  await download;
  clean(seen, "export");
});

test("the triage queue counts down as cases are ruled on", async ({ page, context }) => {
  const seen = watch(context, page);
  const total = (recording("judge").docs["/judgment/next/"].b as { total: number }).total;
  await enter(page, "judge");
  await page.goto("/judgment/queue");
  await expect(page.locator("main")).toContainText(`第 1 / 共 ${total} 条`);
  await expect(page.locator("main")).toContainText(`剩余 ${total}`);
  await page.keyboard.press("1");
  await expect(page.locator("main")).toContainText(`剩余 ${total - 1}`, { timeout: 15000 });
  await expect(page.locator("main")).toContainText("已裁决 1");
  await expect(page.locator("main")).toContainText(`第 2 / 共 ${total} 条`);
  clean(seen, "triage queue");
});

test("the bell lists unread notifications, and reading them clears the badge", async ({ page, context }) => {
  const seen = watch(context, page);
  await enter(page, "judge");
  await page.goto("/dashboard");
  const bell = page.getByRole("button", { name: /^通知中心 \(\d+\)$/ });
  const before = Number(/\((\d+)\)/.exec((await bell.getAttribute("aria-label")) ?? "")?.[1]);
  expect(before).toBeGreaterThan(0);
  await bell.click();
  await expect(page.getByRole("link", { name: /查看全部/ }).first()).toBeVisible();
  await page.goto("/notifications");
  await page.getByRole("button", { name: "标为已读" }).first().click();
  await expect(page.getByRole("button", { name: `通知中心 (${before - 1})` })).toBeVisible();
  await page.getByRole("button", { name: "全部已读" }).click();
  await expect(page.getByRole("button", { name: "通知中心", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "通知中心", exact: true })).toBeVisible();
  clean(seen, "bell");
});

test("the souls died on different days, and the dashboard's trend is not a flat line", async ({ page, context }) => {
  const seen = watch(context, page);
  const deaths = rows(recording("admin"), "/souls/").map((s) => JSON.stringify(s.death_date)).filter((d) => d !== "null");
  expect(new Set(deaths).size).toBeGreaterThan(deaths.length * 0.8);
  const events = rows(recording("admin"), "/events/").map((e) => String(e.create_time ?? e.created_at ?? e.timestamp).slice(0, 10));
  // The recording keeps the newest 200 events. Since judges got this week's verdicts (edd6dae45) those 200 fall on
  // 4 days, not 6+; what this guards is spread_time working at all (broken, every event lands on one day).
  expect(new Set(events).size).toBeGreaterThan(3);
  await enter(page, "admin");
  await page.goto("/dashboard");
  await expect(page.locator("main svg polyline").first()).toBeAttached();
  const lines = await page.locator("main svg polyline").evaluateAll((els) => els.map((e) => e.getAttribute("points") ?? ""));
  const shapes = lines.map((l) => new Set(l.trim().split(/\s+/).map((p) => p.split(",")[1])).size);
  expect(Math.max(...shapes)).toBeGreaterThan(3);
  clean(seen, "time");
});

test("a sentence request can be decided", async ({ page, context }) => {
  const seen = watch(context, page);
  await enter(page, "judge");
  await page.goto("/sentence-requests");
  const main = page.locator("main");
  await expect(main.getByRole("button", { name: /批准|同意/ }).first()).toBeVisible();
  const before = await main.getByRole("button", { name: /批准|同意/ }).count();
  await main.getByRole("button", { name: /批准|同意/ }).first().click();
  const dialog = page.getByRole("dialog").or(page.getByRole("alertdialog"));
  if (await dialog.isVisible().catch(() => false)) {
    const why = dialog.locator("textarea").first();
    if (await why.isVisible().catch(() => false)) await why.fill("演示:准");
    await dialog.getByRole("button", { name: /批准|同意|确认/ }).last().click();
  }
  await expect(main.getByRole("button", { name: /批准|同意/ })).toHaveCount(before - 1);
  clean(seen, "sentence requests");
});

test("the recycle bin has entries, and restoring one puts the soul back", async ({ page, context }) => {
  const seen = watch(context, page);
  await enter(page, "admin");
  await page.goto("/recycle-bin");
  await expect(page.locator("main")).toContainText("无名氏甲");
  const row = page.locator("main tr").filter({ hasText: "无名氏甲" });
  await row.getByRole("button", { name: /恢复/ }).click();
  const dialog = page.getByRole("dialog").or(page.getByRole("alertdialog"));
  if (await dialog.isVisible().catch(() => false)) await dialog.getByRole("button", { name: /恢复|确认/ }).last().click();
  await expect(page.locator("main")).not.toContainText("无名氏甲");
  await page.goto("/souls");
  await expect(page.locator("main")).toContainText("无名氏甲");
  clean(seen, "recycle bin");
});

test("capture warrants are due", async ({ page, context }) => {
  const seen = watch(context, page);
  await enter(page, "judge");
  await page.goto("/judgment/capture-due");
  await expect(page.locator("main")).toContainText("李靖");
  clean(seen, "capture due");
});

test("a letter can be read and answered", async ({ page, context }) => {
  const seen = watch(context, page);
  // The hall's inbox is the administrator's in the demo: the moderator keeps the circle only, and no judge holds soul_inbox.
  await enter(page, "admin");
  await page.goto("/soul-inbox");
  const main = page.locator("main");
  await main.getByText("未读", { exact: true }).first().click();
  await expect(main).toContainText("托梦");
  const box = main.locator("textarea").filter({ visible: true }).first();
  await box.fill("已阅。待结案后再议。");
  await main.getByRole("button", { name: /发送|回信|回复/ }).filter({ visible: true }).first().click();
  await expect(main).toContainText("已阅。待结案后再议。");
  clean(seen, "inbox");
});

test("each soul's values sit under their own column headers", async ({ page, context }) => {
  const seen = watch(context, page);
  await enter(page, "judge");
  // By name: which page of the list a soul lands on follows the seed's random ages, not the soul.
  await page.goto("/souls?q=项羽");
  await expect(page.locator("main tbody tr").first()).toBeVisible();
  const headers = (await page.locator("main").getByRole("columnheader").allInnerTexts()).map((h) => h.trim());
  const column = headers.findIndex((h) => h.includes("死亡时间"));
  expect(column).toBeGreaterThan(0);
  const named = page.locator("main tbody tr").filter({ hasText: "项羽" }).first();
  await expect(named.locator("td").nth(column)).toContainText("前202年");
  clean(seen, "souls columns");
});

// A link from an older recording (every re-seed mints new ids) or a mistyped id: the soul is simply not there, as on
// the server — not a 500 from a page that got an empty 200 (2026-11-08, /souls/c7b8d72b-… on the live demo).
test("a soul id the recording does not have is a not-found page, not a crash", async ({ page }) => {
  await enter(page, "judge");
  await page.goto("/souls/c7b8d72b-ffa4-4138-a766-aa73ffb1fbbc");
  const main = page.locator("main");
  await expect(main).toContainText(/灵魂未找到|无权查看或已不存在|不存在/);
  await expect(main).not.toContainText(/Cannot read properties|系统发生错误/);
});
