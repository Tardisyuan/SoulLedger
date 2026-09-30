import { test, expect, setupAuthenticatedPage } from "./fixtures";

/**
 * 助手管理 · 供应商 (canvas provider-platforms 1a/2c/3a/4b, narrow 5a) in a real layout engine: preset summary,
 * fetch → pick → reference price, the test result inside the block, the right-hand 「连通测试」 gone, and no
 * horizontal scroll — a long model id and the fetch button beside the model field are what could push it at 393.
 */
for (const [width, height] of [[1440, 900], [393, 852]] as const) {
  test(`${width}: the 供应商 block from platform to test, without horizontal scroll`, async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    await page.setViewportSize({ width, height });
    await page.goto("/admin/assistant");

    const block = page.getByRole("region", { name: "供应商" });
    await expect(block).toBeVisible();
    await expect(page.getByRole("region", { name: "连通测试" })).toHaveCount(0);
    await expect(block.getByLabel("平台")).toHaveValue("deepseek");
    await expect(block.getByTestId("aa-preset-summary")).toHaveText("OpenAI 兼容 · https://api.deepseek.com");
    await expect(block.getByTestId("aa-price-note")).toContainText("参考价 · 来源 LiteLLM · 2026-09-28");

    // The fetch button stays on the model field's row (5a: it never wraps under it).
    const [field, button] = await Promise.all([
      block.getByLabel("模型名").boundingBox(),
      block.getByRole("button", { name: "获取模型" }).boundingBox(),
    ]);
    expect(button!.x).toBeGreaterThan(field!.x + field!.width - 1);
    expect(button!.y + button!.height).toBeGreaterThan(field!.y);

    await block.getByRole("button", { name: "获取模型" }).click();
    const list = block.getByTestId("aa-model-list");
    await expect(list).toContainText("共 2 个");
    const long = "deepseek-v4-pro-with-a-deliberately-long-model-identifier";
    await list.getByRole("button", { name: new RegExp(long) }).click();
    await expect(block.getByLabel("模型名")).toHaveValue(long);
    await expect(block.getByTestId("aa-price-note")).toContainText("参考价 · 来源 LiteLLM · 2026-09-30");
    expect(api.lastCall("POST", "/assist-admin/config/models/")?.body).toEqual({});

    await block.getByRole("button", { name: "测试连接" }).click();
    await expect(block.getByTestId("aa-test-result")).toContainText("连通 · 工具 ✓");
    expect(api.lastCall("POST", "/assist-admin/config/test/")?.body).toEqual({ model: long });
    await expect(page.getByRole("button", { name: "保存" })).toBeEnabled();

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
}
