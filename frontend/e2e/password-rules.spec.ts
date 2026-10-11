import { test, expect, setupAuthenticatedPage } from "./fixtures";

/**
 * 第二十三批:个人资料页「修改密码」逐条列出要求。进页面全是 ○;输入时达标变 ✓、没达标仍是 ○(不标红);
 * 没达标点保存不发请求。三个 project 都跑,mobile-chrome 是 393 宽,末尾断言文档没有横向溢出。
 */
test("profile change-password checklist: ○ on arrival, ✓ while typing, nothing sent when a rule is unmet", async ({ page }) => {
  const api = await setupAuthenticatedPage(page);
  await page.goto("/profile");
  await page.getByRole("button", { name: "修改密码" }).first().click();

  const state = (rule: string) => page.getByTestId(`password-rule-${rule}`).getAttribute("data-state");
  expect(await state("min_length")).toBe("idle");
  expect(await state("not_digits")).toBe("idle");
  expect(await state("not_current")).toBe("idle");

  await page.getByLabel(/^当前密码/).fill("old-password-1");
  await page.locator("#profile-password-new").fill("abc");
  expect(await state("not_digits")).toBe("ok");
  expect(await state("min_length")).toBe("idle");
  await expect(page.getByTestId("password-rules-list")).not.toContainText("!");

  await page.locator("#profile-password-new").fill("N0t-Guessable!2026");
  expect(await state("min_length")).toBe("ok");

  // Too short + saved: no request, the rule turns into "!".
  await page.locator("#profile-password-new").fill("short");
  await page.getByRole("button", { name: "保存" }).click();
  expect(await state("min_length")).toBe("bad");
  expect(api.find("POST", "/auth/change-password/")).toHaveLength(0);

  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
});
