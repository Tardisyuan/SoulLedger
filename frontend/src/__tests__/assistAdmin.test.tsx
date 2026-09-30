/**
 * 助手管理 (canvas 「灵魂簿 官员端 · 助手管理」 1a–1f), rendered through the real
 * route files with the real zh-Hans bundle. The transport is core's real `api`
 * instance with its verbs spied on, so `assistAdminErrorCode` reads real
 * axios-shaped errors and the request bodies asserted here are the ones sent.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { AxiosError, AxiosHeaders } from "axios";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "@soulledger/core/api/client";
import type { AssistAdminBackup, AssistAdminConfig, AssistAdminEmbedding, AssistAdminUsage } from "@soulledger/core/api/assist-admin";
import { I18nProvider } from "@/src/contexts/I18nContext";
import { installStreamFetch, refuse, type StreamAsk, type StreamScript } from "./support/assistStreamFetch";

jest.mock("@/src/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: jest.fn() }),
}));

const mockTenant = { user: { id: 1, username: "yanluo", role: "ADMIN", permissions: [] as string[] } };
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => mockTenant }));

let mockPath = "/admin/assistant";
jest.mock("next/navigation", () => ({
  usePathname: () => mockPath,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}));

import ConfigRoute from "@/app/admin/assistant/page";
import UsageRoute from "@/app/admin/assistant/usage/page";

const get = jest.spyOn(api, "get");
const post = jest.spyOn(api, "post");
const patch = jest.spyOn(api, "patch");
const del = jest.spyOn(api, "delete");

const SECRET = "sk-live-do-not-render-9f3a";

/** backend/apps/soul_assist/platforms.py's table as the config API returns it. */
const PLATFORMS: AssistAdminConfig["platforms"] = [
  { id: "deepseek", provider: "openai_compatible", base_url: "https://api.deepseek.com", tools: "yes", needs_key: true },
  { id: "anthropic", provider: "anthropic", base_url: "https://api.anthropic.com", tools: "yes", needs_key: true },
  { id: "doubao", provider: "openai_compatible", base_url: "https://ark.cn-beijing.volces.com/api/v3", tools: "model", needs_key: true },
  { id: "siliconflow", provider: "openai_compatible", base_url: "https://api.siliconflow.cn/v1", tools: "model", needs_key: true },
  { id: "ollama", provider: "openai_compatible", base_url: "http://localhost:11434/v1", tools: "model", needs_key: false },
  { id: "custom", provider: null, base_url: null, tools: "model", needs_key: true },
];

function makeConfig(over: Partial<AssistAdminConfig> = {}): AssistAdminConfig {
  return {
    enabled: true, switch: true, env_enabled: true, platform: "custom", platforms: PLATFORMS, provider: "openai_compatible", base_url: "https://llm.example/v1",
    model: "assist-medium", effort: "", fallbacks: false, soul_per_hour: 30, officer_per_hour: 30, monthly_cap: 300,
    eval_spend_cap: 5, prices: { "assist-medium": { input: 3, output: 15 }, "assist-large": { input: 6, output: 30 } },
    api_key: { set: true, last4: "8f3c", set_at: "2026-09-02T00:00:00Z", source: "page" },
    api_key_slot: "custom:llm.example",
    api_keys: { "custom:llm.example": { set: true, last4: "8f3c", set_at: "2026-09-02T00:00:00Z", source: "page" } },
    eval_soul_account: "11111111-1111-1111-1111-111111111111", eval_officer: 9,
    month_rolls_over_at: "每月 1 日 08:00(北京时间)", overridden: [],
    read_only: { max_concurrent: 8, timeout_seconds: 22, stream_total_seconds: 60, primary_first_token_seconds: 12,
      history_turns: 20, retention_days: 30 },
    ...over,
  };
}

const HALLS = [
  { id: 3, code: "CN_DIYU", display_name: "第五殿", souls_homed: 1204, assistant_enabled: true },
  { id: 4, code: "EG_DUAT", display_name: "真理大厅", souls_homed: 88, assistant_enabled: false },
];

const NO_REASONS = { connection: 0, timeout: 0, rate_limited: 0, server_error: 0, quota: 0, circuit_open: 0 };
const USAGE: AssistAdminUsage = {
  month: "2026-09", spent: 184.2, cap: 300, unpriced_models: ["mystery-model"], requests: 16742,
  by_status: { ok: 15000, empty: 1500, unavailable: 100, busy: 42, rate_limited: 100, not_configured: 0, stopped: 0,
    interrupted: 0 },
  fallbacks: { count: 0, by_reason: { connection: 0, timeout: 0, rate_limited: 0, server_error: 0, quota: 0, circuit_open: 0 } },
  by_provider: [],
  failure_rates: { unavailable: 0.006, rate_limited: 0.0085, empty: 0.118 },
  by_retrieval: { vector: 14000, fallback: 100, fallback_low_similarity: 400 },
  by_day: [{ date: "2026-09-01", requests: 500, answered: 480, input_tokens: 1000, output_tokens: 200, cache_read_tokens: 0, cost: 6.1,
    primary_cost: 6.1, backup_cost: 0, fallbacks: 0, fallback_reasons: NO_REASONS }],
  by_side: [{ side: "soul", requests: 12000, answered: 11000, input_tokens: 9, output_tokens: 1, cache_read_tokens: 0, cost: 120 }],
  by_hall: [{ tenant_id: 3, code: "CN_DIYU", requests: 9000, answered: 8800, input_tokens: 5, output_tokens: 5, cache_read_tokens: 0, cost: 99 }],
  phase4: { corpus_tokens: 61480, corpus_threshold: 80000, corpus_reached: false, empty_share: 0.118, empty_threshold: 0.15, empty_reached: false },
};

const CORPUS = {
  entries: [
    { id: "rebirth-apply", locale: "zh-Hans", audience: "soul", screens: ["applications"], civilizations: [], tokens: 400 },
    { id: "past-lives", locale: "zh-Hans", audience: "soul", screens: ["life"], civilizations: ["CHINESE", "GREEK"], tokens: 300 },
    { id: "duat-scales", locale: "en", audience: "soul", screens: ["sentence"], civilizations: ["EGYPTIAN"], tokens: 200 },
    { id: "officer-roles", locale: "zh-Hans", audience: "officer", screens: ["users", "permissions"], civilizations: [], tokens: 1000 },
  ],
  prompts: [{ locale: "zh-Hans", audience: "officer", tokens: 61480 }],
  total_tokens: 61480,
  threshold: 80000,
};

let config = makeConfig();

const BREAKER = { open: false, open_until: null, consecutive_failures: 0, threshold: 3, open_seconds: 60 };
const NO_BACKUP: AssistAdminBackup = {
  configured: false, platform: null, provider: null, base_url: null, model: null, effort: null, fallbacks: null, prices: {},
  api_key: { set: false, last4: null, set_at: null, source: "page" }, api_key_slot: null, breaker: BREAKER, primary_first_token_seconds: 12,
};
const GLM_BACKUP: AssistAdminBackup = {
  ...NO_BACKUP, configured: true, platform: "doubao", provider: "openai_compatible", base_url: "https://ark.cn-beijing.volces.com/api/v3",
  model: "glm-4.6", effort: "", fallbacks: false, prices: { "glm-4.6": { input: 1, output: 2 } },
  api_key: { set: true, last4: "d0b4", set_at: "2026-10-01T00:00:00Z", source: "page" }, api_key_slot: "doubao",
};
let backup = NO_BACKUP;

function makeEmbedding(status: Partial<AssistAdminEmbedding["status"]> = {}, over: Partial<AssistAdminEmbedding> = {}): AssistAdminEmbedding {
  return {
    embedding_url: "http://192.168.2.2:11434", embedding_model: "qwen3-embedding:4b-q4_K_M", embedding_dims: null,
    retrieval_k: 5, retrieval_min_similarity: 0.56, overridden: [],
    status: {
      entries: 60, embedded: 60, needs_rebuild: false, model: "qwen3-embedding:4b-q4_K_M",
      last_rebuild_at: "2026-09-28T08:02:00Z", last_rebuild_model: "qwen3-embedding:4b-q4_K_M",
      last_error: null, last_error_at: null, rebuild_running: false, ...status,
    },
    ...over,
  };
}
let embedding = makeEmbedding();

function refusal(status: number, data: Record<string, unknown>) {
  const response = { status, data, statusText: "", headers: {}, config: { headers: new AxiosHeaders() } };
  return new AxiosError("refused", "ERR_BAD_REQUEST", undefined, undefined, response as never);
}

function renderRoute(Route: () => ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider initialLocale="zh-Hans">
        <Route />
      </I18nProvider>
    </QueryClientProvider>
  );
}

async function renderConfig() {
  const view = renderRoute(ConfigRoute);
  await screen.findAllByLabelText("模型名");
  await screen.findByTestId("aa-backup");
  return view;
}

// 「模型名」 and 「测试连接」 appear in 供应商 and again in 向量模型: scope each by its region.
const region = (name: string) => screen.getByRole("region", { name });
const providerModel = () => within(region("供应商")).getByLabelText("模型名");
const providerTest = () => within(region("供应商")).getByRole("button", { name: "测试连接" });

const saveButton = () => screen.getByRole("button", { name: "保存" });
const draftCount = () => screen.getByTestId("aa-draft-count").textContent;
const calls = (spy: jest.SpyInstance, url: string) => spy.mock.calls.filter(([u]) => u === url);

beforeEach(() => {
  mockTenant.user.role = "ADMIN";
  mockPath = "/admin/assistant";
  config = makeConfig();
  embedding = makeEmbedding();
  get.mockReset().mockImplementation(async (url: string) => {
    if (url === "/assist-admin/config/") return { data: config };
    if (url === "/assist-admin/halls/") return { data: HALLS };
    if (url === "/assist-admin/usage/") return { data: USAGE };
    if (url === "/assist-admin/corpus/") return { data: CORPUS };
    if (url === "/assist-admin/embedding/") return { data: embedding };
    if (url === "/assist-admin/config/backup/") return { data: backup };
    return { data: [] };
  });
  backup = NO_BACKUP;
  post.mockReset();
  patch.mockReset();
  del.mockReset();
});

describe("ADMIN only", () => {
  it.each([["MODERATOR"], ["JUDGE"]])("%s gets the no-permission page, no request and no config value", async (role) => {
    mockTenant.user.role = role;
    const { container } = renderRoute(ConfigRoute);
    expect(await screen.findByText("您没有权限访问此页面或执行此操作。")).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("8f3c");
    expect(container.textContent).not.toContain("assist-medium");
    renderRoute(UsageRoute);
    expect(get).not.toHaveBeenCalled();
  });
});

describe("the config draft", () => {
  it("counts changed keys, forgets a key set back to its saved value, and discards", async () => {
    await renderConfig();
    expect(draftCount()).toBe("没有未保存的改动");
    fireEvent.change(providerModel(), { target: { value: "assist-large" } });
    expect(draftCount()).toBe("未保存 1 项");
    fireEvent.change(screen.getByLabelText("灵魂端 · 每账号每小时"), { target: { value: "40" } });
    expect(draftCount()).toBe("未保存 2 项");
    fireEvent.change(screen.getByLabelText("灵魂端 · 每账号每小时"), { target: { value: "30" } });
    expect(draftCount()).toBe("未保存 1 项");
    fireEvent.click(screen.getByRole("button", { name: "放弃" }));
    expect(draftCount()).toBe("没有未保存的改动");
    expect(providerModel()).toHaveValue("assist-medium");
    expect(saveButton()).toBeDisabled();
  });

  it("keeps Save disabled, with the reason under it, until this exact draft passed the test", async () => {
    await renderConfig();
    const reason = "连接配置改过，先在「供应商」里「测试连接」测通这份草稿才能保存。";
    fireEvent.change(providerModel(), { target: { value: "assist-large" } });
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText(reason)).toBeInTheDocument();

    post.mockResolvedValueOnce({ data: { ok: true, error_kind: null, latency_ms: 1840, tokens: { input: 2310, output: 186 }, tools: true, provider: "openai_compatible", model: "assist-large" } });
    fireEvent.click(providerTest());
    await screen.findByText("连通 · 工具 ✓");
    expect(post).toHaveBeenCalledWith("/assist-admin/config/test/", { model: "assist-large" });
    expect(saveButton()).toBeEnabled();
    expect(screen.queryByText(reason)).not.toBeInTheDocument();

    // A different draft is a different connection: the old pass no longer counts.
    fireEvent.change(providerModel(), { target: { value: "assist-xl" } });
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText(reason)).toBeInTheDocument();
    fireEvent.change(providerModel(), { target: { value: "assist-large" } });
    expect(saveButton()).toBeEnabled();

    patch.mockResolvedValueOnce({ data: makeConfig({ model: "assist-large" }) });
    fireEvent.click(saveButton());
    await waitFor(() => expect(draftCount()).toBe("没有未保存的改动"));
    expect(patch).toHaveBeenCalledWith("/assist-admin/config/", { model: "assist-large" });
  });

  it("shows the backend's untested_connection refusal instead of a generic failure", async () => {
    await renderConfig();
    fireEvent.change(screen.getByLabelText("官员端 · 每账号每小时"), { target: { value: "50" } });
    patch.mockRejectedValueOnce(refusal(400, { detail: "x", code: "unpriced_model" }));
    fireEvent.click(saveButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("设了月度上限，就要给当前模型填单价。");
    expect(draftCount()).toBe("未保存 1 项");
  });

  it("the master switch is part of the draft", async () => {
    await renderConfig();
    fireEvent.click(screen.getByRole("switch", { name: "总开关" }));
    expect(draftCount()).toBe("未保存 1 项");
    expect(patch).not.toHaveBeenCalled();
  });

  it("with the deployment switch off, the master switch is greyed and says why", async () => {
    config = makeConfig({ env_enabled: false, enabled: false });
    await renderConfig();
    const master = screen.getByRole("switch", { name: "总开关" });
    expect(master).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(master);
    expect(draftCount()).toBe("没有未保存的改动");
    expect(screen.getByText(/部署方已关闭助手/)).toBeInTheDocument();
  });

  it("says when the month rolls over, in Beijing time", async () => {
    await renderConfig();
    expect(screen.getByText(/每月 1 日早上 8 点（北京时间）/)).toBeInTheDocument();
  });

  it("lists the read-only settings with their reasons, as a <dl>, not inputs", async () => {
    await renderConfig();
    const dl = screen.getByText("全局并发上限").closest("dl") as HTMLElement;
    expect(within(dl).getByText("22 秒")).toBeInTheDocument();
    expect(within(dl).getByText(/必须小于 App 的 25 秒/)).toBeInTheDocument();
    expect(within(dl).queryByRole("textbox")).toBeNull();
  });
});

describe("the API key is write-only", () => {
  it("never renders the typed key: not after typing, not after testing, not after saving", async () => {
    const { container } = await renderConfig();
    expect(screen.getByTestId("aa-key-state")).toHaveTextContent("8f3c");
    fireEvent.click(screen.getByRole("button", { name: "更换" }));
    const input = screen.getByLabelText("粘贴新 key");
    expect(input).toHaveAttribute("type", "password");
    fireEvent.change(input, { target: { value: SECRET } });
    expect(container.textContent).not.toContain(SECRET);
    expect(screen.getByText("连接配置改过，先在「供应商」里「测试连接」测通这份草稿才能保存。")).toBeInTheDocument();

    post.mockResolvedValueOnce({ data: { ok: true, error_kind: null, latency_ms: 900, tokens: {}, tools: true, provider: "openai_compatible", model: "assist-medium" } });
    fireEvent.click(providerTest());
    await screen.findByText("连通 · 工具 ✓");
    expect(post).toHaveBeenCalledWith("/assist-admin/config/test/", { api_key: SECRET });

    config = makeConfig({ api_key: { set: true, last4: "9f3a", set_at: "2026-09-29T00:00:00Z", source: "page" } });
    patch.mockResolvedValueOnce({ data: config });
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByTestId("aa-key-state")).toHaveTextContent("9f3a"));
    expect(patch).toHaveBeenCalledWith("/assist-admin/config/", { api_key: SECRET });
    expect(container.innerHTML).not.toContain(SECRET);
    expect(screen.queryByLabelText("粘贴新 key")).toBeNull();
  });

  it("clearing the key is saveable without a test (a leaked key must be clearable at once)", async () => {
    await renderConfig();
    fireEvent.click(screen.getByRole("button", { name: "清除" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "清除" }));
    expect(draftCount()).toBe("未保存 1 项");
    expect(saveButton()).toBeEnabled();
  });

  it("moving to an address with no key saved for it is refused with the reason", async () => {
    await renderConfig();
    fireEvent.change(within(region("供应商")).getByLabelText("Base URL"), { target: { value: "https://other.example/v1" } });
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText(/换了供应商或地址，要同时填新的 API key/)).toBeInTheDocument();
    expect(screen.getByTestId("aa-key-state")).toHaveTextContent("尚未填写");
  });

  it("keys are per platform: the key row follows the selected platform's slot, and a saved one needs no re-paste", async () => {
    config = makeConfig({
      api_keys: {
        "custom:llm.example": { set: true, last4: "8f3c", set_at: "2026-09-02T00:00:00Z", source: "page" },
        deepseek: { set: true, last4: "d5e6", set_at: "2026-09-20T00:00:00Z", source: "page" },
      },
    });
    await renderConfig();
    const keyState = () => screen.getByTestId("aa-key-state");
    expect(keyState()).toHaveTextContent("•••• 8f3c");
    fireEvent.change(within(region("供应商")).getByLabelText("平台"), { target: { value: "deepseek" } });
    expect(keyState()).toHaveTextContent("已保存•••• d5e6");
    expect(keyState()).not.toHaveTextContent("8f3c");
    expect(screen.queryByText(/换了供应商或地址，要同时填新的 API key/)).toBeNull();
    expect(within(region("供应商")).getByRole("button", { name: "获取模型" })).toBeEnabled();
    // A platform with nothing saved says so, and asks for a key.
    fireEvent.change(within(region("供应商")).getByLabelText("平台"), { target: { value: "anthropic" } });
    expect(keyState()).toHaveTextContent("尚未填写");
    expect(keyState()).not.toHaveTextContent("••••");
    expect(screen.getByText(/换了供应商或地址，要同时填新的 API key/)).toBeInTheDocument();
  });
});

describe("per-hall switches", () => {
  it("write at once, outside the draft, and a failure offers a retry of the same value", async () => {
    await renderConfig();
    const sw = await screen.findByRole("switch", { name: "第五殿 · 问一问" });
    patch.mockRejectedValueOnce(refusal(500, {}));
    fireEvent.click(sw);
    expect(await screen.findByText("失败")).toBeInTheDocument();
    expect(patch).toHaveBeenLastCalledWith("/assist-admin/halls/3/", { assistant_enabled: false });

    patch.mockResolvedValueOnce({ data: { ...HALLS[0], assistant_enabled: false } });
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("已保存")).toBeInTheDocument();
    expect(patch).toHaveBeenCalledTimes(2);
    expect(patch).toHaveBeenLastCalledWith("/assist-admin/halls/3/", { assistant_enabled: false });
    expect(screen.getByRole("switch", { name: "第五殿 · 问一问" })).toHaveAttribute("aria-checked", "false");
    expect(draftCount()).toBe("没有未保存的改动");
  });

  it("are greyed while the master switch (in the draft) is off", async () => {
    await renderConfig();
    await screen.findByRole("switch", { name: "第五殿 · 问一问" });
    fireEvent.click(screen.getByRole("switch", { name: "总开关" }));
    const sw = screen.getByRole("switch", { name: "第五殿 · 问一问" });
    expect(sw).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(sw);
    expect(calls(patch, "/assist-admin/halls/3/")).toHaveLength(0);
  });
});

describe("eval: preview first, spend only on confirm", () => {
  it("preview → confirm dialog with count and cost → start sends the token", async () => {
    await renderConfig();
    post.mockResolvedValueOnce({
      data: { asks: 24, max_asks: 100, estimated_cost: 0.55, spend_cap: 5, problems: [], confirm_token: "tok-123",
        candidates: [{ candidate: 0, provider: "openai_compatible", model: "assist-medium", asks: 24, input_tokens: 1, output_tokens: 1, estimated_cost: 0.55 }] },
    });
    fireEvent.click(screen.getByRole("button", { name: "开跑…" }));
    const dialog = await screen.findByRole("dialog");
    expect(post).toHaveBeenCalledWith("/assist-admin/eval/preview/", { side: "soul", candidates: [{}] });
    expect(within(dialog).getByTestId("aa-quote-asks")).toHaveTextContent("约 24 条");
    expect(within(dialog).getByTestId("aa-quote-cost")).toHaveTextContent("0.5500 / 5.00");
    expect(calls(post, "/assist-admin/eval/runs/")).toHaveLength(0);

    post.mockResolvedValueOnce({ data: { id: 7, created_at: "2026-09-29T00:00:00Z", status: "queued", candidates: [], summary: [] } });
    fireEvent.click(within(dialog).getByRole("button", { name: "开跑" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/assist-admin/eval/runs/", { confirm_token: "tok-123" }));
  });

  it("a quote with problems cannot be confirmed", async () => {
    await renderConfig();
    post.mockResolvedValueOnce({ data: { asks: 0, max_asks: 100, estimated_cost: 0, spend_cap: 5, problems: ["no_cases"], confirm_token: null, candidates: [] } });
    fireEvent.click(screen.getByRole("button", { name: "开跑…" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("这一端没有启用的评测题。")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "开跑" })).toBeDisabled();
  });

  it("A/B sends the saved config and the draft connection side by side", async () => {
    await renderConfig();
    fireEvent.change(providerModel(), { target: { value: "assist-large" } });
    fireEvent.click(screen.getByLabelText("对比：A 已保存 · B 草稿"));
    post.mockResolvedValueOnce({ data: { asks: 48, max_asks: 100, estimated_cost: 1, spend_cap: 5, problems: [], confirm_token: "t", candidates: [] } });
    fireEvent.click(screen.getByRole("button", { name: "开跑…" }));
    await screen.findByRole("dialog");
    expect(post).toHaveBeenCalledWith("/assist-admin/eval/preview/", { side: "soul", candidates: [{}, { model: "assist-large" }] });
  });
});

describe("eval identities", () => {
  it("a missing eval soul disables the soul side with the reason; the button creates identities", async () => {
    config = makeConfig({ eval_soul_account: null });
    await renderConfig();
    expect(screen.getByTestId("aa-identity-soul")).toHaveTextContent("缺少");
    expect(screen.getByTestId("aa-identity-officer")).toHaveTextContent("就绪");
    // Scoped: 试问 above carries the same side buttons and the same reason line.
    const evalRegion = screen.getByRole("region", { name: "评测" });
    expect(within(evalRegion).getByRole("button", { name: "开跑…" })).toBeDisabled();
    expect(within(evalRegion).getByText("缺少评测灵魂，先创建评测身份。")).toBeInTheDocument();

    // The officer side is not blocked by the soul's absence.
    fireEvent.click(within(evalRegion).getByRole("button", { name: "官员端" }));
    expect(within(evalRegion).getByRole("button", { name: "开跑…" })).toBeEnabled();

    post.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "创建评测身份" }));
    expect(await screen.findByRole("button", { name: "创建中…" })).toBeDisabled();
    expect(post).toHaveBeenCalledWith("/assist-admin/eval/identities/");
  });

  it("a failed create says so and offers a retry", async () => {
    config = makeConfig({ eval_officer: null });
    await renderConfig();
    post.mockRejectedValueOnce(refusal(500, {}));
    fireEvent.click(screen.getByRole("button", { name: "创建评测身份" }));
    expect(await screen.findByText(/创建失败/)).toBeInTheDocument();
    post.mockResolvedValueOnce({ data: { eval_soul_account: "x", eval_officer: 9, officer_username: "assist-eval-officer", officer_role: "MODERATOR", description: "done" } });
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(calls(post, "/assist-admin/eval/identities/")).toHaveLength(2));
  });

  it("with both present there is no create button", async () => {
    await renderConfig();
    expect(screen.queryByRole("button", { name: "创建评测身份" })).toBeNull();
  });
});

describe("usage page", () => {
  beforeEach(() => {
    mockPath = "/admin/assistant/usage";
  });

  it("draws the 80% line, warns about unpriced models, and offers the chart as a table", async () => {
    renderRoute(UsageRoute);
    expect(await screen.findByTestId("aa-spent")).toHaveTextContent("184.20 / 300.00");
    expect(screen.getByTestId("aa-alert-line")).toHaveStyle({ left: "80%" });
    expect(screen.getByText("80% 提醒")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("mystery-model");
    expect(screen.getByText("11.8% / 15.0%")).toBeInTheDocument();
    expect(screen.getByTestId("aa-day-bars")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "以表格查看" }));
    expect(screen.getByText("2026-09-01")).toBeInTheDocument();
    expect(screen.queryByTestId("aa-day-bars")).toBeNull();
    expect(screen.getByRole("link", { name: "实际用量" })).toHaveAttribute("aria-current", "page");
  });

  it("no cap: no meter and no 80% line; no unpriced models: no warning", async () => {
    const noCap = { ...USAGE, cap: null, unpriced_models: [] };
    get.mockImplementation(async () => ({ data: noCap }));
    renderRoute(UsageRoute);
    expect(await screen.findByTestId("aa-spent")).toHaveTextContent("未设上限");
    expect(screen.queryByTestId("aa-alert-line")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("试问 (plan §3.3), streamed", () => {
  const tryRegion = () => screen.getByRole("region", { name: "试问" });
  let asks: StreamAsk[];
  let scripts: StreamScript[];
  beforeEach(() => ({ asks, scripts } = installStreamFetch()));
  const DONE = {
    event: "done", side: "soul", answer: "你已有一份转生申请正在审批。", tools_called: ["me", "rebirth"], retrieval: "vector", retrieved_entries: [],
    latency_ms: 2410, tokens: { input: 2700, output: 205 }, provider: "openai_compatible", model: "assist-medium",
    provider_role: "primary", fallback_reason: null,
  };
  const ask = async (question: string) => {
    fireEvent.change(within(tryRegion()).getByLabelText("问题"), { target: { value: question } });
    fireEvent.click(within(tryRegion()).getByRole("button", { name: "问" }));
    await waitFor(() => expect(asks.length).toBeGreaterThan(0));
    return asks[asks.length - 1];
  };

  it("asks as the eval soul with the saved config and shows the answer, tool names and the technical line", async () => {
    await renderConfig();
    const region = tryRegion();
    expect(within(region).getByText("以 问一问评测灵魂 身份提问")).toBeInTheDocument();
    const a = await ask("  我为什么不能申请？ ");
    expect(a.url).toMatch(/\/assist-admin\/try\/$/);
    expect(a.body).toEqual({ side: "soul", question: "我为什么不能申请？", stream: true });
    // Waiting: 「已等 x s」, and nothing about text yet.
    await act(async () => a.send({ event: "meta", conversation_id: "x" }));
    expect(within(region).getByTestId("aa-try-tech")).toHaveTextContent(/^已等 \d+\.\d s$/);
    await act(async () => a.send({ event: "delta", text: "你已有一份" }));
    // Streaming: first text and 「已出 n 字」; 已等 is gone.
    expect(within(region).getByTestId("aa-try-tech")).toHaveTextContent(/^首字 \d+\.\d s · 已出 5 字$/);
    expect(within(region).getByRole("button", { name: "停止回答" })).toBeInTheDocument();
    await act(async () => a.send(DONE));
    const result = await within(region).findByTestId("aa-try-result");
    await waitFor(() => expect(result).toHaveTextContent("工具调用 · 2"));
    expect(result).toHaveTextContent("你已有一份转生申请正在审批。");
    expect(within(result).getByText("me()")).toBeInTheDocument();
    expect(within(result).getByText("rebirth()")).toBeInTheDocument();
    expect(result).toHaveTextContent("2,410 ms · 2,905 tok");
    expect(within(region).getByTestId("aa-try-tech")).toHaveTextContent(/· 主供应商$/);
    expect(within(region).getByTestId("aa-try-tech")).not.toHaveTextContent("备用");
    expect(result.textContent).not.toContain("8f3c");
    // Absence: no draft, so no candidate and no draft note.
    expect(within(region).queryByText(/用未保存的连接草稿提问/)).toBeNull();
  });

  it("answered by the backup after the primary's first-text budget: the line says so (this page only)", async () => {
    await renderConfig();
    const a = await ask("Q");
    await act(async () => a.send({ event: "delta", text: "好" }, { ...DONE, answer: "好", provider_role: "backup", fallback_reason: "timeout" }));
    await waitFor(() => expect(within(tryRegion()).getByTestId("aa-try-tech")).toHaveTextContent("备用 · 主供应商 12 s 无首字，已改用备用"));
  });

  it("stop: 「■ 停止」 aborts; the line says where it stopped", async () => {
    await renderConfig();
    const a = await ask("Q");
    await act(async () => a.send({ event: "delta", text: "一半" }));
    fireEvent.click(within(tryRegion()).getByRole("button", { name: "停止回答" }));
    await waitFor(() => expect(a.aborted()).toBe(true));
    await waitFor(() => expect(within(tryRegion()).getByTestId("aa-try-tech")).toHaveTextContent(/首字 \d+\.\d s · 停止于 \d+\.\d s$/));
    expect(within(tryRegion()).getByText("已停止")).toBeInTheDocument();
    expect(within(tryRegion()).getByRole("button", { name: "问" })).toBeInTheDocument();
  });

  it("Esc in the question stops it too", async () => {
    await renderConfig();
    const a = await ask("Q");
    fireEvent.keyDown(within(tryRegion()).getByLabelText("问题"), { key: "Escape" });
    await waitFor(() => expect(a.aborted()).toBe(true));
  });

  it("interrupted after text: the platform's reason and 「已出字，不换备用」", async () => {
    await renderConfig();
    const a = await ask("Q");
    await act(async () =>
      a.send({ event: "delta", text: "一半" }, { event: "error", kind: "interrupted", text_sent: true, detail: "平台关闭了连接" })
    );
    await waitFor(() =>
      expect(within(tryRegion()).getByTestId("aa-try-tech")).toHaveTextContent(/中断于 \d+\.\d s · 平台关闭了连接 · 已出字，不换备用$/)
    );
    expect(within(tryRegion()).getByText("回答中断")).toBeInTheDocument();
  });

  it("sends the unsaved connection draft as the candidate, and the officer side when chosen", async () => {
    await renderConfig();
    fireEvent.change(providerModel(), { target: { value: "assist-large" } });
    const region = tryRegion();
    fireEvent.click(within(region).getByRole("button", { name: "官员端" }));
    expect(within(region).getByText("以 assist-eval-officer 身份提问")).toBeInTheDocument();
    expect(within(region).getByText(/用未保存的连接草稿提问/)).toBeInTheDocument();
    const a = await ask("队列里有几件？");
    expect(a.body).toEqual({ side: "officer", question: "队列里有几件？", candidate: { model: "assist-large" }, stream: true });
    await act(async () => a.send({ event: "delta", text: "3" }, { ...DONE, side: "officer", answer: "3", tools_called: [], model: "assist-large" }));
    await waitFor(() => expect(within(region).getByTestId("aa-try-result")).toHaveTextContent("没有调用工具"));
  });

  it("is disabled with the reason when that side's eval identity is missing, and sends nothing", async () => {
    config = makeConfig({ eval_officer: null });
    await renderConfig();
    const region = tryRegion();
    expect(within(region).getByLabelText("问题")).not.toBeDisabled();
    fireEvent.click(within(region).getByRole("button", { name: "官员端" }));
    expect(within(region).getByLabelText("问题")).toBeDisabled();
    const button = within(region).getByRole("button", { name: "问" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-describedby", "aa-try-missing");
    expect(within(region).getByText("缺少评测官员，先创建评测身份。")).toBeInTheDocument();
    expect(asks).toEqual([]);
  });

  it("names a refusal by its code", async () => {
    await renderConfig();
    scripts.push(refuse(429, { detail: "x", code: "rate_limited" }));
    await ask("Q");
    expect(await within(tryRegion()).findByRole("alert")).toHaveTextContent("试问太频繁，请稍后再试。");
    expect(within(tryRegion()).queryByTestId("aa-try-result")).toBeNull();
  });
});

describe("help corpus · read-only (plan §5)", () => {
  const corpusRegion = () => screen.getByRole("region", { name: "帮助语料 · 只读" });
  // The key column is an inline IdentifierChip (§4.6 registry): the whole key is its title and clipboard value.
  const ids = () => within(corpusRegion()).getAllByRole("row").slice(1).map((r) => r.querySelector("td button")?.getAttribute("title"));

  it("shows the prompt estimate against the 80k threshold and every entry", async () => {
    await renderConfig();
    const region = await waitFor(corpusRegion);
    expect(within(region).getByTestId("aa-corpus-threshold")).toHaveTextContent("最大一份提示约 61,480 / 80,000 token（阶段 4 阈值） 未到阈值");
    expect(within(region).getByTestId("aa-corpus-summary")).toHaveTextContent("4 条 · 共 1,900 token");
    expect(ids()).toEqual(["rebirth-apply", "past-lives", "duat-scales", "officer-roles"]);
    // Read-only: the only buttons are the four copy-the-key chips; nothing on the section writes.
    expect(within(region).getAllByRole("button").map((b) => b.getAttribute("data-identifier-variant"))).toEqual(["inline", "inline", "inline", "inline"]);
  });

  it("filters by audience, screen, civilization and locale; counts follow the filter", async () => {
    await renderConfig();
    await waitFor(corpusRegion);
    fireEvent.change(screen.getByLabelText("受众"), { target: { value: "officer" } });
    expect(ids()).toEqual(["officer-roles"]);
    expect(screen.getByTestId("aa-corpus-summary")).toHaveTextContent("1 条 · 共 1,000 token");
    fireEvent.change(screen.getByLabelText("受众"), { target: { value: "" } });
    // An entry with no civilizations applies to all of them, so it stays under any civilization.
    fireEvent.change(screen.getByLabelText("文明"), { target: { value: "EGYPTIAN" } });
    expect(ids()).toEqual(["rebirth-apply", "duat-scales", "officer-roles"]);
    fireEvent.change(screen.getByLabelText("语言"), { target: { value: "en" } });
    expect(ids()).toEqual(["duat-scales"]);
    fireEvent.change(screen.getByLabelText("页面"), { target: { value: "life" } });
    expect(within(corpusRegion()).queryByRole("table")).toBeNull();
    expect(screen.getByText("没有符合筛选的条目。")).toBeInTheDocument();
  });
});


describe("向量模型 (canvas 1a 六, 1h/1i)", () => {
  const emb = () => region("向量模型");
  // The block waits for its own GET (embedding/), after the config form is up.
  const renderBlock = async () => {
    await renderConfig();
    await screen.findByRole("region", { name: "向量模型" });
  };
  const embField = (label: string) => within(emb()).getByLabelText(label);
  const UNTESTED = "地址、模型或维度改过，测通后才能保存。";
  const OLD_MODEL = "向量是用旧模型生成的，需要重建";
  const testOk = { ok: true, error_kind: null, latency_ms: 86, dims: 2560, embedding_url: "http://192.168.2.2:11434", embedding_model: "qwen3-embedding:8b", embedding_dims: null };

  it("shows the saved settings, the count from the status API, and the fallback line; no rebuild notice when current", async () => {
    await renderBlock();
    expect(embField("地址")).toHaveValue("http://192.168.2.2:11434");
    expect(embField("模型名")).toHaveValue("qwen3-embedding:4b-q4_K_M");
    expect(embField("截断维度")).toHaveValue("");
    expect(embField("检索条数 k")).toHaveValue(5);
    expect(embField("相似度门槛")).toHaveValue(0.56);
    expect(within(emb()).getByText("最相关的一条低于它时，助手用全部帮助条目回答。")).toBeInTheDocument();
    expect(screen.getByTestId("aa-emb-progress")).toHaveTextContent("60 / 60 条已生成向量");
    expect(screen.getByTestId("aa-emb-fallback")).toHaveTextContent("向量服务连不上时，助手会自动改用全部帮助条目回答，不会答不了。");
    expect(screen.queryByText(OLD_MODEL)).toBeNull();
    expect(screen.queryByTestId("aa-rebuild-notice")).toBeNull();
    expect(screen.queryByText("还没有向量")).toBeNull();
  });

  it("a model change joins the footer draft and cannot be saved until that exact candidate passed", async () => {
    await renderBlock();
    fireEvent.change(embField("模型名"), { target: { value: "qwen3-embedding:8b" } });
    expect(draftCount()).toBe("未保存 1 项");
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText(UNTESTED)).toBeInTheDocument();

    post.mockResolvedValueOnce({ data: testOk });
    fireEvent.click(within(emb()).getByRole("button", { name: "测试连接" }));
    expect(await within(emb()).findByTestId("aa-emb-test")).toHaveTextContent("连通 · 维度与设置一致");
    expect(screen.getByTestId("aa-emb-test")).toHaveTextContent("86 ms · 返回维度 2560");
    expect(post).toHaveBeenCalledWith("/assist-admin/embedding/test/", { embedding_model: "qwen3-embedding:8b" });
    expect(calls(post, "/assist-admin/config/test/")).toHaveLength(0);
    expect(saveButton()).toBeEnabled();
    expect(screen.queryByText(UNTESTED)).toBeNull();

    // Another candidate: the pass no longer counts.
    fireEvent.change(embField("截断维度"), { target: { value: "1024" } });
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText("之后又改了连接配置，此结果作废：请再测一次。")).toBeInTheDocument();
    fireEvent.change(embField("截断维度"), { target: { value: "" } });
    expect(saveButton()).toBeEnabled();

    // Saving answers needs_rebuild; the page says so, top and block — and nothing rebuilt.
    embedding = makeEmbedding(
      { needs_rebuild: true, embedded: 0, model: "qwen3-embedding:8b" },
      { embedding_model: "qwen3-embedding:8b", overridden: ["embedding_model"] }
    );
    patch.mockResolvedValueOnce({ data: embedding });
    fireEvent.click(saveButton());
    await waitFor(() => expect(draftCount()).toBe("没有未保存的改动"));
    expect(patch.mock.calls).toEqual([["/assist-admin/embedding/", { embedding_model: "qwen3-embedding:8b" }]]);
    expect(calls(post, "/assist-admin/embedding/rebuild/")).toHaveLength(0);
    expect(screen.getByTestId("aa-rebuild-notice")).toHaveTextContent(OLD_MODEL);
    expect(screen.getByTestId("aa-embedding-old-model")).toHaveTextContent("qwen3-embedding:4b-q4_K_M → qwen3-embedding:8b");
    expect(screen.getByTestId("aa-emb-progress")).toHaveTextContent("0 / 60 条已生成向量");
  });

  it("the backend's untested_embedding refusal is named, and the embedding keys stay unsaved", async () => {
    await renderBlock();
    fireEvent.change(embField("地址"), { target: { value: "http://192.168.2.9:11434" } });
    post.mockResolvedValueOnce({ data: { ...testOk, embedding_url: "http://192.168.2.9:11434" } });
    fireEvent.click(within(emb()).getByRole("button", { name: "测试连接" }));
    await within(emb()).findByTestId("aa-emb-test");
    patch.mockRejectedValueOnce(refusal(400, { detail: "x", code: "untested_embedding" }));
    fireEvent.click(saveButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(UNTESTED);
    expect(draftCount()).toBe("未保存 1 项");
  });

  it("k and the similarity floor save without a test; out-of-range values block the save", async () => {
    await renderBlock();
    fireEvent.change(embField("检索条数 k"), { target: { value: "6" } });
    fireEvent.change(embField("相似度门槛"), { target: { value: "0.6" } });
    expect(draftCount()).toBe("未保存 2 项");
    expect(saveButton()).toBeEnabled();
    expect(screen.queryByText(UNTESTED)).toBeNull();

    fireEvent.change(embField("检索条数 k"), { target: { value: "0" } });
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText(/有数值填得不对/)).toBeInTheDocument();
    fireEvent.change(embField("检索条数 k"), { target: { value: "6" } });

    patch.mockResolvedValueOnce({ data: makeEmbedding({}, { retrieval_k: 6, retrieval_min_similarity: 0.6 }) });
    fireEvent.click(saveButton());
    await waitFor(() => expect(draftCount()).toBe("没有未保存的改动"));
    expect(patch.mock.calls).toEqual([["/assist-admin/embedding/", { retrieval_k: 6, retrieval_min_similarity: 0.6 }]]);
    expect(post).not.toHaveBeenCalled();
  });

  it("one footer counts and saves both drafts: config first, then the embedding", async () => {
    await renderBlock();
    fireEvent.change(screen.getByLabelText("灵魂端 · 每账号每小时"), { target: { value: "40" } });
    fireEvent.change(embField("检索条数 k"), { target: { value: "6" } });
    expect(draftCount()).toBe("未保存 2 项");
    patch.mockResolvedValueOnce({ data: makeConfig({ soul_per_hour: 40 }) });
    patch.mockResolvedValueOnce({ data: makeEmbedding({}, { retrieval_k: 6 }) });
    fireEvent.click(saveButton());
    await waitFor(() => expect(draftCount()).toBe("没有未保存的改动"));
    expect(patch.mock.calls).toEqual([
      ["/assist-admin/config/", { soul_per_hour: 40 }],
      ["/assist-admin/embedding/", { retrieval_k: 6 }],
    ]);
  });

  it.each([
    ["connection", "连不上"],
    ["timeout", "超时"],
    ["model_not_found", "模型不存在"],
  ])("a %s failure is named, and Save stays disabled", async (kind, copy) => {
    await renderBlock();
    fireEvent.change(embField("模型名"), { target: { value: "nope" } });
    post.mockResolvedValueOnce({ data: { ...testOk, ok: false, error_kind: kind, dims: null, latency_ms: 4 } });
    fireEvent.click(within(emb()).getByRole("button", { name: "测试连接" }));
    const box = await within(emb()).findByTestId("aa-emb-test");
    expect(box).toHaveTextContent("未连通 · 不能保存");
    expect(box).toHaveTextContent(`${copy} ${kind}`);
    expect(box).not.toHaveTextContent("连通 · 维度与设置一致");
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText(UNTESTED)).toBeInTheDocument();
  });

  it("dims_mismatch shows what came back against what was asked; an unnamed kind shows only its code", async () => {
    await renderBlock();
    fireEvent.change(embField("截断维度"), { target: { value: "1024" } });
    post.mockResolvedValueOnce({ data: { ...testOk, ok: false, error_kind: "dims_mismatch", dims: 2560, embedding_dims: 1024, latency_ms: 91 } });
    fireEvent.click(within(emb()).getByRole("button", { name: "测试连接" }));
    const box = await within(emb()).findByTestId("aa-emb-test");
    expect(box).toHaveTextContent("维度和设置不符 dims_mismatch");
    expect(box).toHaveTextContent("91 ms · 返回维度 2560 ≠ 1024");

    post.mockResolvedValueOnce({ data: { ...testOk, ok: false, error_kind: "bad_response", dims: null } });
    fireEvent.click(within(emb()).getByRole("button", { name: "再测一次" }));
    await waitFor(() => expect(screen.getByTestId("aa-emb-test")).toHaveTextContent("bad_response"));
    const after = screen.getByTestId("aa-emb-test");
    for (const named of ["连不上", "超时", "模型不存在", "维度和设置不符", "返回维度"]) expect(after).not.toHaveTextContent(named);
  });

  it("rebuild is a confirmed action: nothing is sent until the confirm, and cancel sends nothing", async () => {
    await renderBlock();
    fireEvent.click(within(emb()).getByRole("button", { name: "重建向量" }));
    let dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("重建全部向量？");
    expect(dialog).toHaveTextContent("全部生成完才替换，中途失败不影响现有向量");
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(post).not.toHaveBeenCalled();

    fireEvent.click(within(emb()).getByRole("button", { name: "重建向量" }));
    dialog = await screen.findByRole("alertdialog");
    post.mockResolvedValueOnce({
      data: { embedded: 60, unchanged: 0, deleted: 0, model: "qwen3-embedding:4b-q4_K_M", dims: null, index: null, dropped: [],
        status: makeEmbedding({ last_rebuild_at: "2026-09-30T06:31:00Z" }).status },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "重建向量" }));
    expect(await within(emb()).findByText("重建完成")).toBeInTheDocument();
    expect(calls(post, "/assist-admin/embedding/rebuild/")).toEqual([["/assist-admin/embedding/rebuild/"]]);
    expect(screen.queryByText("重建失败")).toBeNull();
  });

  it("409 rebuild_running reads as rebuilding; the status API's running flag disables the button", async () => {
    await renderBlock();
    fireEvent.click(within(emb()).getByRole("button", { name: "重建向量" }));
    post.mockRejectedValueOnce(refusal(409, { detail: "x", code: "rebuild_running" }));
    embedding = makeEmbedding({ rebuild_running: true });
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "重建向量" }));
    expect(await within(emb()).findByText("重建中…")).toBeInTheDocument();
    await waitFor(() => expect(within(emb()).getByRole("button", { name: "重建向量" })).toBeDisabled());
    expect(within(emb()).queryByText("重建失败")).toBeNull();
  });

  it("503 embedding_unavailable reads as a failed rebuild with its kind, offering a retry", async () => {
    await renderBlock();
    fireEvent.click(within(emb()).getByRole("button", { name: "重建向量" }));
    post.mockRejectedValueOnce(refusal(503, { detail: "x", code: "embedding_unavailable", error_kind: "timeout" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "重建向量" }));
    const state = await within(emb()).findByTestId("aa-emb-rebuild-state");
    await waitFor(() => expect(state).toHaveTextContent("重建失败"));
    expect(state).toHaveTextContent("超时 timeout");
    expect(state).not.toHaveTextContent("重建完成");
    expect(within(emb()).getByRole("button", { name: "重试重建" })).toBeEnabled();
    // The previous vectors still count.
    expect(screen.getByTestId("aa-emb-progress")).toHaveTextContent("60 / 60 条已生成向量");
  });

  it("never built: says there are no vectors yet, and no last-rebuild line", async () => {
    embedding = makeEmbedding({ embedded: 0, needs_rebuild: true, last_rebuild_at: null, last_rebuild_model: null });
    await renderBlock();
    expect(screen.getByTestId("aa-emb-progress")).toHaveTextContent("还没有向量");
    expect(within(emb()).queryByText(/上次重建/)).toBeNull();
    expect(screen.queryByText(OLD_MODEL)).toBeNull();
  });

  it("stale vectors under the same model: fall-back line, but not the old-model notice", async () => {
    embedding = makeEmbedding({ embedded: 58, needs_rebuild: true });
    await renderBlock();
    expect(screen.getByTestId("aa-emb-progress")).toHaveTextContent("58 / 60 条已生成向量");
    expect(within(emb()).getByText("重建完成前，助手改用全部帮助条目回答。")).toBeInTheDocument();
    expect(screen.queryByText(OLD_MODEL)).toBeNull();
    expect(screen.queryByTestId("aa-rebuild-notice")).toBeNull();
  });
});

describe("eval: retrieval (canvas 1b eval results)", () => {
  const RUN = {
    id: 7, created_at: "2026-09-29T06:30:00Z", status: "done", total: 6, done: 6, finished_at: "2026-09-29T06:35:00Z",
    candidates: [{ provider: "openai_compatible", base_url: "https://llm.example/v1", model: "assist-medium", effort: "", fallbacks: false }],
    summary: [{ candidate: 0, provider: "openai_compatible", model: "assist-medium", cases: 3, passed: 2, errors: 0, tool_accuracy: 0.875,
      phrase_hit_rate: 0.792, retrieval_hit_rate: 0.913, retrieval_fallbacks: 0, mean_latency_ms: 2900, cost: 0.21, input_tokens: 1, output_tokens: 1 }],
  };
  const result = (id: number, c: number, q: string, retrieved: string[], hit: boolean | null) => ({
    id, candidate: 0, case: c, side: "soul", question: q, tools_called: ["rebirth"], answer: "答", passed: true, included: {},
    retrieval: "vector", retrieved, retrieval_hit: hit, latency_ms: 2100, tokens: { input: 2000, output: 100 },
  });
  const CASES = [
    { id: 1, side: "soul", locale: "zh-Hans", question: "被驳回了还能申诉吗？", expected_tools: ["rebirth"], expected_entries: ["rebirth.appeal", "rebirth.cooldown"] },
    { id: 2, side: "soul", locale: "zh-Hans", question: "下一站什么时候开始？", expected_tools: ["sentence_plan"], expected_entries: ["sentence.plan", "sentence.station"] },
    { id: 3, side: "soul", locale: "zh-Hans", question: "朋友圈谁能看到？", expected_tools: [], expected_entries: [] },
  ];
  const DETAIL = {
    ...RUN,
    results: [
      result(1, 1, "被驳回了还能申诉吗？", ["rebirth.appeal", "rebirth.cooldown", "rebirth.apply"], true),
      result(2, 2, "下一站什么时候开始？", ["sentence.plan", "dispatch.flow", "sentence.amend"], false),
      result(3, 3, "朋友圈谁能看到？", ["social.visibility"], null),
    ],
  };

  it("shows the hit rate, a hits/expected cell per question, and expected vs actual when a row opens", async () => {
    get.mockImplementation(async (url: string) => {
      if (url === "/assist-admin/config/") return { data: config };
      if (url === "/assist-admin/embedding/") return { data: embedding };
      if (url === "/assist-admin/corpus/") return { data: CORPUS };
      if (url === "/assist-admin/eval/runs/") return { data: [RUN] };
      if (url === "/assist-admin/eval/runs/7/") return { data: DETAIL };
      if (url === "/assist-admin/eval/cases/") return { data: CASES };
      return { data: [] };
    });
    await renderConfig();
    fireEvent.click(await within(region("评测")).findByRole("button", { name: /assist-medium/ }));
    expect(await screen.findByTestId("aa-retrieval-hit-rate")).toHaveTextContent("91.3%");
    expect(screen.getByRole("columnheader", { name: "检索" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTestId("aa-retrieval-cell").map((c) => c.textContent)).toEqual(["2/2", "1/2", expect.not.stringContaining("/")]));

    expect(screen.queryByTestId("aa-retrieval-detail")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "下一站什么时候开始？" }));
    const detail = await screen.findByTestId("aa-retrieval-detail");
    expect(detail).toHaveTextContent("期望命中的条目");
    expect(detail).toHaveTextContent("sentence.plan 命中 · 1");
    expect(detail).toHaveTextContent("sentence.station 未检索到");
    expect(detail).toHaveTextContent("实际检索到的前 3 条");
    expect(detail).toHaveTextContent("2 dispatch.flow");
    expect(detail).not.toHaveTextContent("sentence.station 命中");
  });
});

describe("usage: 检索降级", () => {
  beforeEach(() => {
    mockPath = "/admin/assistant/usage";
  });

  it("is the service-down fallback share of all questions, not the low-similarity one", async () => {
    renderRoute(UsageRoute);
    // 100 / 16,742 = 0.6%; counting the 400 low-similarity fallbacks too would read 3.0%.
    expect(await screen.findByTestId("aa-rate-fallback")).toHaveTextContent("0.6%");
    expect(screen.getByTestId("aa-rate-fallback")).not.toHaveTextContent("3.0%");
    expect(screen.getByText("检索降级")).toBeInTheDocument();
    expect(screen.getByText("检索降级：向量服务不可用、退回用全部帮助条目回答的提问。")).toBeInTheDocument();
  });
});

describe("供应商 · 平台 / 获取模型 / 单价 / 测试 (canvas provider-platforms)", () => {
  const block = () => region("供应商");
  const platformSelect = () => within(block()).getByLabelText("平台");
  const fetchButton = () => within(block()).getByRole("button", { name: "获取模型" });
  const OK_TEST = { ok: true, error_kind: null, latency_ms: 800, tokens: { input: 5, output: 1 }, provider: "openai_compatible", model: "assist-medium" };

  it("the right-hand 「连通测试」 section is gone; the test button and its result live in the provider block", async () => {
    await renderConfig();
    expect(screen.queryByRole("region", { name: "连通测试" })).toBeNull();
    fireEvent.change(providerModel(), { target: { value: "assist-large" } });
    post.mockResolvedValueOnce({ data: { ...OK_TEST, tools: true, model: "assist-large" } });
    fireEvent.click(providerTest());
    const result = await within(block()).findByTestId("aa-test-result");
    expect(result).toHaveTextContent("连通 · 工具 ✓");
    expect(result).not.toHaveTextContent("不支持工具调用");
  });

  it("connected without tools is a warning that still allows saving", async () => {
    await renderConfig();
    fireEvent.change(providerModel(), { target: { value: "small-model" } });
    post.mockResolvedValueOnce({ data: { ...OK_TEST, tools: false, model: "small-model" } });
    fireEvent.click(providerTest());
    const result = await within(block()).findByTestId("aa-test-result");
    expect(result).toHaveTextContent("连通 · 工具 ✕");
    expect(result).toHaveTextContent("这个模型不支持工具调用：助手只能答通用问题，查不了个人数据。可以保存，但建议换模型。");
    expect(result.className).toContain("color-warning");
    expect(saveButton()).toBeEnabled();
  });

  it("a failed test names its kind with the existing copy and keeps Save disabled", async () => {
    await renderConfig();
    fireEvent.change(providerModel(), { target: { value: "deepseek-chatt" } });
    post.mockResolvedValueOnce({ data: { ...OK_TEST, ok: false, error_kind: "model_not_found", tools: null } });
    fireEvent.click(providerTest());
    const result = await within(block()).findByTestId("aa-test-result");
    expect(result).toHaveTextContent("未连通 · 不能保存");
    expect(result).toHaveTextContent("这个地址下没有这个模型。请核对模型名。");
    expect(result).not.toHaveTextContent("连通 · 工具");
    expect(saveButton()).toBeDisabled();
  });

  it("a preset shows its adapter and address as a collapsed summary, read-only when expanded; custom edits them", async () => {
    config = makeConfig({ platform: "deepseek", base_url: "https://api.deepseek.com" });
    await renderConfig();
    expect(within(block()).getByTestId("aa-preset-summary")).toHaveTextContent("OpenAI 兼容 · https://api.deepseek.com");
    expect(within(block()).queryByLabelText("Base URL")).toBeNull();
    expect(within(block()).queryByLabelText("类型")).toBeNull();
    const toggle = within(block()).getByRole("button", { name: /展开/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(within(block()).getByRole("button", { name: /收起/ })).toHaveAttribute("aria-expanded", "true");
    expect(within(block()).getByText("由平台决定，不能改。要改请选「自定义」。")).toBeInTheDocument();
    expect(within(block()).queryByRole("textbox", { name: "Base URL" })).toBeNull();

    fireEvent.change(platformSelect(), { target: { value: "custom" } });
    expect(within(block()).getByLabelText("Base URL")).toHaveValue("https://api.deepseek.com");
    expect(within(block()).getByLabelText("类型")).toHaveValue("openai_compatible");
    expect(within(block()).queryByTestId("aa-preset")).toBeNull();
  });

  it("tool support is the status tag of the selected platform, not text in the options; the legend stays", async () => {
    await renderConfig();
    const options = within(platformSelect()).getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("DeepSeek");
    expect(options).toContain("自定义");
    // Absence: user 2026-10-01 — 「工具 ✓」 in every option read as if every platform were checked.
    expect(options.filter((o) => o?.includes("工具"))).toEqual([]);
    const tag = () => within(block()).getByTestId("aa-tools");
    expect(tag()).toHaveTextContent("工具 ?");
    expect(tag().className).toContain("--color-warning");
    fireEvent.change(platformSelect(), { target: { value: "deepseek" } });
    expect(tag()).toHaveTextContent("工具 ✓");
    expect(tag().className).toContain("--color-success");
    expect(within(block()).getByText("工具 ✕ ＝ 助手只能答通用问题，查不了个人数据。工具 ? ＝ 看所选模型，「测试连接」时实测。")).toBeInTheDocument();
  });

  it("the time-of-day price hint is always under the prices", async () => {
    await renderConfig();
    expect(within(block()).getByTestId("aa-price")).toHaveTextContent("分时段计价的平台，请按常用时段填写。");
  });

  it("the reason Save is off sits beside Save in the footer", async () => {
    await renderConfig();
    fireEvent.change(providerModel(), { target: { value: "assist-large" } });
    const reason = screen.getByText("连接配置改过，先在「供应商」里「测试连接」测通这份草稿才能保存。");
    expect(reason.parentElement).toBe(saveButton().parentElement);
  });

  it("choosing a preset fills the adapter and address into the draft and needs a key", async () => {
    await renderConfig();
    fireEvent.change(platformSelect(), { target: { value: "anthropic" } });
    expect(draftCount()).toBe("未保存 3 项"); // platform, provider, base_url
    expect(screen.getByText(/换了供应商或地址，要同时填新的 API key/)).toBeInTheDocument();
    // Moved without a key: the saved key cannot be used there, so fetching is off and says why.
    expect(fetchButton()).toBeDisabled();
    expect(within(block()).getByTestId("aa-fetch-msg")).toHaveTextContent("先粘贴 key，才能获取模型。");
    fireEvent.click(screen.getByRole("button", { name: "更换" }));
    fireEvent.change(screen.getByLabelText("粘贴新 key"), { target: { value: SECRET } });
    expect(fetchButton()).toBeEnabled();
    expect(within(block()).queryByTestId("aa-fetch-msg")).toBeNull();
  });

  it("fetch is enabled by a saved key on the same endpoint", async () => {
    await renderConfig();
    expect(fetchButton()).toBeEnabled();
    expect(within(block()).queryByTestId("aa-fetch-msg")).toBeNull();
  });

  it("with no key saved the button is off; Ollama needs none and leaves the saved key behind", async () => {
    config = makeConfig({ api_key: { set: false, last4: null, set_at: null, source: "env" } });
    await renderConfig();
    expect(fetchButton()).toBeDisabled();
    fireEvent.change(platformSelect(), { target: { value: "ollama" } });
    expect(fetchButton()).toBeEnabled();
    post.mockResolvedValueOnce({ data: { status: "ok", error_kind: null, models: [{ name: "qwen3:32b", context: null }] } });
    fireEvent.click(fetchButton());
    await within(block()).findByTestId("aa-model-list");
    expect(post).toHaveBeenCalledWith("/assist-admin/config/models/", {
      platform: "ollama", base_url: "http://localhost:11434/v1", api_key: "",
    });
  });

  it("a fetched list is searchable; choosing fills the model, closes the list and prefills a reference price", async () => {
    await renderConfig();
    post.mockResolvedValueOnce({ data: { status: "ok", error_kind: null, models: [
      { name: "deepseek-ai/DeepSeek-V3.2", context: 131072 }, { name: "Qwen/Qwen3-32B", context: null }] } });
    fireEvent.click(fetchButton());
    const list = await within(block()).findByTestId("aa-model-list");
    expect(post).toHaveBeenCalledWith("/assist-admin/config/models/", {});
    expect(list).toHaveTextContent("共 2 个");
    expect(list).toHaveTextContent("列表里没有要的，就直接在上面手填模型名。");
    fireEvent.change(within(list).getByRole("searchbox", { name: "搜索模型" }), { target: { value: "qwen" } });
    expect(within(list).queryByText("deepseek-ai/DeepSeek-V3.2")).toBeNull();

    get.mockImplementationOnce(async () => ({ data: { found: true, input: 0.28, output: 0.42, cache_read: 0.028, as_of: "2026-09-30" } }));
    fireEvent.click(within(list).getByRole("button", { name: "Qwen/Qwen3-32B" }));
    expect(providerModel()).toHaveValue("Qwen/Qwen3-32B");
    expect(within(block()).queryByTestId("aa-model-list")).toBeNull();
    await waitFor(() => expect(within(block()).getByTestId("aa-price-note")).toHaveTextContent(
      "参考价 · 来源 LiteLLM · 2026-09-30 · 以平台账单为准"));
    expect(get).toHaveBeenCalledWith("/assist-admin/config/price/", { params: { platform: "custom", model: "Qwen/Qwen3-32B" } });
    expect(screen.getByLabelText("每百万 token · 输入")).toHaveValue(0.28);
  });

  it("「no model list」 is an ink note, not an error; a rejected key is", async () => {
    await renderConfig();
    post.mockResolvedValueOnce({ data: { status: "no_list", error_kind: null, models: [] } });
    fireEvent.click(fetchButton());
    const msg = await within(block()).findByTestId("aa-fetch-msg");
    expect(msg).toHaveTextContent("llm.example 不提供模型列表。");
    expect(msg.className).not.toContain("color-danger");

    post.mockResolvedValueOnce({ data: { status: "failed", error_kind: "auth", models: [] } });
    fireEvent.click(fetchButton());
    await waitFor(() => expect(within(block()).getByTestId("aa-fetch-msg")).toHaveTextContent("key 无效。"));
    expect(within(block()).getByTestId("aa-fetch-msg").className).toContain("color-danger");
  });

  it("price note: a saved price without a source reads as manual with a restore; editing marks it manual; none warns", async () => {
    config = makeConfig({ prices: { "assist-medium": { input: 3, output: 15, source: "litellm", as_of: "2026-09-28" } } });
    await renderConfig();
    const note = () => within(block()).getByTestId("aa-price-note");
    expect(note()).toHaveTextContent("参考价 · 来源 LiteLLM · 2026-09-28");
    fireEvent.change(screen.getByLabelText("每百万 token · 输入"), { target: { value: "3.5" } });
    expect(note()).toHaveTextContent("手动填写");
    expect(note()).not.toHaveTextContent("参考价 ·");

    get.mockImplementationOnce(async () => ({ data: { found: true, input: 3, output: 15, cache_read: null, as_of: "2026-09-28" } }));
    fireEvent.click(within(note()).getByRole("button", { name: "恢复参考价" }));
    await waitFor(() => expect(note()).toHaveTextContent("参考价 · 来源 LiteLLM · 2026-09-28"));
    expect(draftCount()).toBe("没有未保存的改动"); // restored = the saved entry again

    fireEvent.change(providerModel(), { target: { value: "unpriced-model" } });
    expect(note()).toHaveTextContent("! 没有参考价，请手动填写。月度上限按这个价格计算。");
  });
});

describe("备用供应商 (frames 6a–6e)", () => {
  const block = () => region("供应商");
  const backupBlock = () => within(block()).getByTestId("aa-backup");
  const OK = { ok: true, error_kind: null, latency_ms: 700, tokens: { input: 5, output: 1 }, tools: true, provider: "openai_compatible", model: "b-model" };

  it("collapsed while there is none: what it is for, 「＋ 添加备用」, no fields, and no part in saving", async () => {
    await renderConfig();
    const b = backupBlock();
    expect(b).toHaveTextContent("备用供应商（可选）");
    expect(b).toHaveTextContent("未设置备用供应商");
    expect(b).toHaveTextContent("主供应商连不上、超时、限流、欠费或服务端出错时，自动改用备用再答一次。");
    expect(within(b).queryByLabelText("平台")).toBeNull();
    expect(within(b).queryByRole("button", { name: "移除备用" })).toBeNull();
    expect(screen.getByTestId("aa-provider-summary")).toHaveTextContent("当前生效 · assist-medium");
    expect(screen.getByTestId("aa-provider-summary")).not.toHaveTextContent("备");
    // An unrelated change saves without any backup test.
    fireEvent.change(screen.getByLabelText("灵魂端 · 每账号每小时"), { target: { value: "40" } });
    expect(saveButton()).toBeEnabled();
  });

  it("added: saves only after its own test passed; a failed test says so; then PATCH config/backup/", async () => {
    await renderConfig();
    fireEvent.click(within(backupBlock()).getByRole("button", { name: /添加备用/ }));
    const b = backupBlock();
    expect(within(b).getByRole("button", { name: "移除备用" })).toBeInTheDocument();
    expect(within(b).getByLabelText("平台")).toHaveValue("deepseek");
    fireEvent.click(within(b).getByRole("button", { name: "更换" }));
    fireEvent.change(within(b).getByLabelText("粘贴新 key"), { target: { value: SECRET } });
    fireEvent.change(within(b).getByLabelText("模型名"), { target: { value: "b-model" } });
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText("备用还没测通。主、备都测通后才能保存。")).toBeInTheDocument();

    post.mockResolvedValueOnce({ data: { ...OK, ok: false, error_kind: "auth", tools: null } });
    fireEvent.click(within(b).getByRole("button", { name: "测试连接" }));
    await screen.findByText("备用测试未通过。修好或移除备用后才能保存。");
    expect(saveButton()).toBeDisabled();

    post.mockResolvedValueOnce({ data: OK });
    fireEvent.click(within(b).getByRole("button", { name: "再测一次" }));
    await waitFor(() => expect(saveButton()).toBeEnabled());
    const candidate = { platform: "deepseek", provider: "openai_compatible", base_url: "https://api.deepseek.com", api_key: SECRET, model: "b-model" };
    expect(post).toHaveBeenLastCalledWith("/assist-admin/config/backup/test/", candidate);
    expect(screen.queryByText(/备用还没测通|备用测试未通过/)).toBeNull();

    patch.mockResolvedValueOnce({ data: { ...GLM_BACKUP, platform: "deepseek", model: "b-model" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(patch).toHaveBeenCalledWith("/assist-admin/config/backup/", candidate));
    // The primary had nothing to save: no PATCH of config/.
    expect(calls(patch, "/assist-admin/config/")).toEqual([]);
  });

  it("removing an unsaved backup collapses it and drops the rule", async () => {
    await renderConfig();
    fireEvent.click(within(backupBlock()).getByRole("button", { name: /添加备用/ }));
    expect(saveButton()).toBeDisabled();
    fireEvent.click(within(backupBlock()).getByRole("button", { name: "移除备用" }));
    expect(backupBlock()).toHaveTextContent("未设置备用供应商");
    expect(draftCount()).toBe("没有未保存的改动");
    fireEvent.change(screen.getByLabelText("灵魂端 · 每账号每小时"), { target: { value: "40" } });
    expect(saveButton()).toBeEnabled();
    expect(screen.queryByText("备用还没测通。主、备都测通后才能保存。")).toBeNull();
  });

  it("same platform as the primary: a note under the backup's platform, not a block", async () => {
    await renderConfig();
    fireEvent.click(within(backupBlock()).getByRole("button", { name: /添加备用/ }));
    expect(within(backupBlock()).queryByTestId("aa-backup-same-platform")).toBeNull();
    fireEvent.change(within(backupBlock()).getByLabelText("平台"), { target: { value: "custom" } });
    fireEvent.change(within(backupBlock()).getByLabelText("Base URL"), { target: { value: "https://LLM.example/v2" } });
    const note = within(backupBlock()).getByTestId("aa-backup-same-platform");
    expect(note.querySelector("strong")).toHaveTextContent("和主供应商同一平台。");
    expect(note).toHaveTextContent("这家平台故障时，主、备会一起不可用。不影响保存。");
    fireEvent.change(within(backupBlock()).getByLabelText("Base URL"), { target: { value: "https://elsewhere.example/v1" } });
    expect(within(backupBlock()).queryByTestId("aa-backup-same-platform")).toBeNull();
  });

  it("a saved backup is open, named in the header, and 「移除备用」 + Save deletes it", async () => {
    backup = GLM_BACKUP;
    await renderConfig();
    expect(screen.getByTestId("aa-provider-summary")).toHaveTextContent("当前生效 · assist-medium · 备 glm-4.6");
    expect(within(backupBlock()).getByLabelText("模型名")).toHaveValue("glm-4.6");
    expect(within(backupBlock()).getByTestId("aa-backup-key-state")).toHaveTextContent("•••• d0b4");
    // Unchanged, it takes no part in saving.
    fireEvent.change(screen.getByLabelText("灵魂端 · 每账号每小时"), { target: { value: "40" } });
    expect(saveButton()).toBeEnabled();
    fireEvent.click(within(backupBlock()).getByRole("button", { name: "移除备用" }));
    expect(draftCount()).toBe("未保存 2 项");
    patch.mockResolvedValueOnce({ data: makeConfig({ soul_per_hour: 40 }) });
    del.mockResolvedValueOnce({ data: NO_BACKUP });
    fireEvent.click(saveButton());
    await waitFor(() => expect(del).toHaveBeenCalledWith("/assist-admin/config/backup/"));
    expect(calls(patch, "/assist-admin/config/backup/")).toEqual([]);
  });
});

describe("usage: 改用备用 and the primary / backup split (frame 7a)", () => {
  it("the quality section counts switches like 检索降级, with the four reasons (and the rare two when present)", async () => {
    get.mockImplementation(async () => ({
      data: { ...USAGE, fallbacks: { count: 12, by_reason: { connection: 5, timeout: 3, rate_limited: 3, server_error: 1, quota: 0, circuit_open: 0 } } },
    }));
    renderRoute(UsageRoute);
    expect(await screen.findByTestId("aa-fallbacks")).toHaveTextContent("12 次 · 0.1%");
    const reasons = screen.getByTestId("aa-fallback-reasons");
    expect(reasons).toHaveTextContent("连不上 5 · 超时 3 · 429 限流 3 · 5xx 出错 1");
    expect(reasons).not.toHaveTextContent("余额不足");
    expect(reasons).not.toHaveTextContent("连续失败");
  });

  it("quota and the circuit breaker are named when they happened", async () => {
    get.mockImplementation(async () => ({
      data: { ...USAGE, fallbacks: { count: 3, by_reason: { connection: 0, timeout: 0, rate_limited: 0, server_error: 0, quota: 1, circuit_open: 2 } } },
    }));
    renderRoute(UsageRoute);
    expect(await screen.findByTestId("aa-fallback-reasons")).toHaveTextContent("· 余额不足 1 · 主供应商连续失败 · 暂用备用 2");
  });

  it("the cost legend gives each role's month total, only once a backup has cost anything", async () => {
    const row = { requests: 1, answered: 1, input_tokens: 1, output_tokens: 1, cache_read_tokens: 0 };
    get.mockImplementation(async () => ({
      data: { ...USAGE, by_provider: [{ ...row, role: "primary", cost: 180 }, { ...row, role: "backup", cost: 4.2 }] },
    }));
    renderRoute(UsageRoute);
    expect(await screen.findByTestId("aa-cost-legend")).toHaveTextContent("主供应商 180.00备用 4.20");
  });

  it("no backup cost, no legend", async () => {
    renderRoute(UsageRoute);
    await screen.findByTestId("aa-fallbacks");
    expect(screen.queryByTestId("aa-cost-legend")).toBeNull();
  });

  const SPLIT_DAYS = [
    { ...USAGE.by_day[0], date: "2026-09-16", cost: 2, primary_cost: 2, backup_cost: 0 },
    { ...USAGE.by_day[0], date: "2026-09-17", cost: 5, primary_cost: 3, backup_cost: 2, fallbacks: 5,
      fallback_reasons: { ...NO_REASONS, connection: 4, timeout: 1 } },
  ];

  it("stacks each day: primary solid, the backup hatched on top — and a day without the backup has no backup segment", async () => {
    get.mockImplementation(async () => ({ data: { ...USAGE, by_day: SPLIT_DAYS } }));
    renderRoute(UsageRoute);
    const [quiet, busy] = await screen.findAllByTestId("aa-day");
    expect(within(quiet).getByTestId("aa-day-primary")).toHaveStyle({ height: "40%" });
    expect(within(quiet).queryByTestId("aa-day-backup")).toBeNull();
    expect(within(busy).getByTestId("aa-day-primary")).toHaveStyle({ height: "60%" });
    const hatch = within(busy).getByTestId("aa-day-backup");
    expect(hatch).toHaveStyle({ height: "40%" });
    expect(hatch.className).toContain("repeating-linear-gradient(135deg");
    // Ink only: no vermilion, no status colour on the bars.
    for (const bar of screen.getAllByTestId(/aa-day-(primary|backup)/))
      expect(bar.className).not.toMatch(/accent|danger|warning|success|status|vermilion/);
    // Each bar is labelled with its whole detail line.
    expect(busy).toHaveAccessibleName("9/17 主 3.00 · 备 2.00 · 改用备用 5 次 · 连不上");
  });

  it("clicking a day shows its detail bar with the day's main reason; a day without switches names none", async () => {
    get.mockImplementation(async () => ({ data: { ...USAGE, by_day: SPLIT_DAYS } }));
    renderRoute(UsageRoute);
    const [quiet, busy] = await screen.findAllByTestId("aa-day");
    const detail = screen.getByTestId("aa-day-detail");
    expect(detail).toBeEmptyDOMElement();
    fireEvent.click(busy);
    expect(busy).toHaveAttribute("aria-pressed", "true");
    expect(detail).toHaveTextContent(/^9\/17 主 3\.00 · 备 2\.00 · 改用备用 5 次 · 连不上$/);
    expect(detail).not.toHaveTextContent("超时");
    fireEvent.click(quiet);
    expect(detail).toHaveTextContent(/^9\/16 主 2\.00 · 备 0\.0000 · 改用备用 0 次$/);
  });

  it("the table splits the cost into 主 and 备 columns", async () => {
    get.mockImplementation(async () => ({ data: { ...USAGE, by_day: SPLIT_DAYS } }));
    renderRoute(UsageRoute);
    fireEvent.click(await screen.findByRole("button", { name: "以表格查看" }));
    const table = within(screen.getByRole("region", { name: "按天 · 花费" })).getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["日期", "问答", "token", "主供应商", "备用"]);
    expect(within(table).getByRole("row", { name: /2026-09-17/ })).toHaveTextContent(/3\.00\s*2\.00$/);
    expect(within(table).queryByRole("columnheader", { name: "花费" })).toBeNull();
  });
});
