/**
 * 助手管理 (canvas 「灵魂簿 官员端 · 助手管理」 1a–1f), rendered through the real
 * route files with the real zh-Hans bundle. The transport is core's real `api`
 * instance with its verbs spied on, so `assistAdminErrorCode` reads real
 * axios-shaped errors and the request bodies asserted here are the ones sent.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { AxiosError, AxiosHeaders } from "axios";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "@soulledger/core/api/client";
import type { AssistAdminConfig, AssistAdminEmbedding, AssistAdminUsage } from "@soulledger/core/api/assist-admin";
import { I18nProvider } from "@/src/contexts/I18nContext";

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

jest.mock("@/src/components/charts/LazyDashboardCharts", () => ({
  LazyBarChart: ({ data }: { data: unknown[] }) => <div data-testid="bar-chart">{data.length}</div>,
}));

import ConfigRoute from "@/app/admin/assistant/page";
import UsageRoute from "@/app/admin/assistant/usage/page";

const get = jest.spyOn(api, "get");
const post = jest.spyOn(api, "post");
const patch = jest.spyOn(api, "patch");

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
    eval_soul_account: "11111111-1111-1111-1111-111111111111", eval_officer: 9,
    month_rolls_over_at: "每月 1 日 08:00(北京时间)", overridden: [],
    read_only: { max_concurrent: 8, timeout_seconds: 22, history_turns: 20, retention_days: 30 },
    ...over,
  };
}

const HALLS = [
  { id: 3, code: "CN_DIYU", display_name: "第五殿", souls_homed: 1204, assistant_enabled: true },
  { id: 4, code: "EG_DUAT", display_name: "真理大厅", souls_homed: 88, assistant_enabled: false },
];

const USAGE: AssistAdminUsage = {
  month: "2026-09", spent: 184.2, cap: 300, unpriced_models: ["mystery-model"], requests: 16742,
  by_status: { ok: 15000, empty: 1500, unavailable: 100, busy: 42, rate_limited: 100, not_configured: 0 },
  failure_rates: { unavailable: 0.006, rate_limited: 0.0085, empty: 0.118 },
  by_retrieval: { vector: 14000, fallback: 100, fallback_low_similarity: 400 },
  by_day: [{ date: "2026-09-01", requests: 500, answered: 480, input_tokens: 1000, output_tokens: 200, cache_read_tokens: 0, cost: 6.1 }],
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
    return { data: [] };
  });
  post.mockReset();
  patch.mockReset();
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

  it("moving the provider without a new key is refused with the reason", async () => {
    await renderConfig();
    fireEvent.change(screen.getByLabelText("类型"), { target: { value: "anthropic" } });
    expect(saveButton()).toBeDisabled();
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
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "以表格查看" }));
    expect(screen.getByText("2026-09-01")).toBeInTheDocument();
    expect(screen.queryByTestId("bar-chart")).toBeNull();
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

describe("试问 (plan §3.3)", () => {
  const tryRegion = () => screen.getByRole("region", { name: "试问" });
  const ANSWER = {
    side: "soul", answer: "你已有一份转生申请正在审批。", tools_called: ["me", "rebirth"], latency_ms: 2410,
    tokens: { input: 2700, output: 205 }, provider: "openai_compatible", model: "assist-medium",
  };

  it("asks as the eval soul with the saved config and shows the answer and tool names", async () => {
    await renderConfig();
    post.mockResolvedValueOnce({ data: ANSWER });
    const region = tryRegion();
    expect(within(region).getByText("以 问一问评测灵魂 身份提问")).toBeInTheDocument();
    fireEvent.change(within(region).getByLabelText("问题"), { target: { value: "  我为什么不能申请？ " } });
    fireEvent.click(within(region).getByRole("button", { name: "问" }));
    const result = await within(region).findByTestId("aa-try-result");
    expect(calls(post, "/assist-admin/try/")).toEqual([["/assist-admin/try/", { side: "soul", question: "我为什么不能申请？" }]]);
    expect(result).toHaveTextContent("你已有一份转生申请正在审批。");
    expect(result).toHaveTextContent("工具调用 · 2");
    expect(within(result).getByText("me()")).toBeInTheDocument();
    expect(within(result).getByText("rebirth()")).toBeInTheDocument();
    expect(result).toHaveTextContent("2,410 ms · 2,905 tok");
    expect(result.textContent).not.toContain("8f3c");
    // Absence: no draft, so no candidate and no draft note.
    expect(within(region).queryByText(/用未保存的连接草稿提问/)).toBeNull();
  });

  it("sends the unsaved connection draft as the candidate, and the officer side when chosen", async () => {
    await renderConfig();
    fireEvent.change(providerModel(), { target: { value: "assist-large" } });
    post.mockResolvedValueOnce({ data: { ...ANSWER, side: "officer", tools_called: [], model: "assist-large" } });
    const region = tryRegion();
    fireEvent.click(within(region).getByRole("button", { name: "官员端" }));
    expect(within(region).getByText("以 assist-eval-officer 身份提问")).toBeInTheDocument();
    expect(within(region).getByText(/用未保存的连接草稿提问/)).toBeInTheDocument();
    fireEvent.change(within(region).getByLabelText("问题"), { target: { value: "队列里有几件？" } });
    fireEvent.click(within(region).getByRole("button", { name: "问" }));
    const result = await within(region).findByTestId("aa-try-result");
    expect(calls(post, "/assist-admin/try/")[0][1]).toEqual({ side: "officer", question: "队列里有几件？", candidate: { model: "assist-large" } });
    expect(result).toHaveTextContent("没有调用工具");
  });

  it("is disabled with the reason when that side's eval identity is missing, and sends nothing", async () => {
    config = makeConfig({ eval_officer: null });
    await renderConfig();
    const region = tryRegion();
    expect(within(region).getByLabelText("问题")).not.toBeDisabled();
    fireEvent.click(within(region).getByRole("button", { name: "官员端" }));
    expect(within(region).getByLabelText("问题")).toBeDisabled();
    const ask = within(region).getByRole("button", { name: "问" });
    expect(ask).toBeDisabled();
    expect(ask).toHaveAttribute("aria-describedby", "aa-try-missing");
    expect(within(region).getByText("缺少评测官员，先创建评测身份。")).toBeInTheDocument();
    expect(calls(post, "/assist-admin/try/")).toEqual([]);
  });

  it("names a refusal by its code", async () => {
    await renderConfig();
    post.mockRejectedValueOnce(refusal(429, { detail: "x", code: "rate_limited" }));
    const region = tryRegion();
    fireEvent.change(within(region).getByLabelText("问题"), { target: { value: "Q" } });
    fireEvent.click(within(region).getByRole("button", { name: "问" }));
    expect(await within(region).findByRole("alert")).toHaveTextContent("试问太频繁，请稍后再试。");
    expect(within(region).queryByTestId("aa-try-result")).toBeNull();
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

  it("each option carries its tools marker, and the legend explains ✕ and ?", async () => {
    await renderConfig();
    const options = within(platformSelect()).getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("DeepSeek　工具 ✓");
    expect(options).toContain("硅基流动　工具 ?");
    expect(options).toContain("自定义　工具 ?");
    expect(within(block()).getByText("工具 ✕ ＝ 助手只能答通用问题，查不了个人数据。工具 ? ＝ 看所选模型，「测试连接」时实测。")).toBeInTheDocument();
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
