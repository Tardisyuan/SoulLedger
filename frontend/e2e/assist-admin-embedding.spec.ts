import { test, expect, setupAuthenticatedPage } from "./fixtures";

/**
 * 助手管理 · 向量模型 (canvas 「助手管理 · RAG」 1b/1c, narrow 1j/1k) in a real layout engine: the block
 * sits under 供应商, carries its 「需要重建」 state, and neither width scrolls sideways — jsdom has no layout.
 */
for (const [width, height] of [[1440, 900], [393, 852]] as const) {
  test(`${width}: the 向量模型 block, its rebuild notice, and no horizontal scroll`, async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    await page.setViewportSize({ width, height });
    await page.goto("/admin/assistant");

    const block = page.getByRole("region", { name: "向量模型" });
    await expect(block).toBeVisible();
    await expect(page.getByTestId("aa-rebuild-notice")).toContainText("向量是用旧模型生成的，需要重建");
    await expect(block.getByTestId("aa-emb-progress")).toHaveText("0 / 60 条已生成向量");
    await expect(block.getByLabel("检索条数 k")).toHaveValue("5");
    await expect(block.getByLabel("相似度门槛")).toHaveValue("0.56");
    await expect(block.getByTestId("aa-emb-fallback")).toBeVisible();

    // Under 供应商, above 限额.
    const [provider, emb, limits] = await Promise.all(
      ["供应商", "向量模型", "限额"].map((name) => page.getByRole("region", { name }).boundingBox())
    );
    expect(emb!.y).toBeGreaterThan(provider!.y);
    expect(limits!.y).toBeGreaterThan(emb!.y);

    // A model change is held back until tested; the test result lands inside the block.
    await block.getByLabel("模型名").fill("qwen3-embedding:8b");
    await expect(page.getByTestId("aa-draft-count")).toHaveText("未保存 1 项");
    await expect(page.getByRole("button", { name: "保存" })).toBeDisabled();
    await block.getByRole("button", { name: "测试连接" }).click();
    await expect(block.getByTestId("aa-emb-test")).toContainText("连通 · 维度与设置一致");
    expect(api.lastCall("POST", "/assist-admin/embedding/test/")?.body).toEqual({ embedding_model: "qwen3-embedding:8b" });
    expect(api.lastCall("POST", "/assist-admin/embedding/rebuild/")).toBeUndefined();

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
}
