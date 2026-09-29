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
import type { AssistAdminConfig, AssistAdminUsage } from "@soulledger/core/api/assist-admin";
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

function makeConfig(over: Partial<AssistAdminConfig> = {}): AssistAdminConfig {
  return {
    enabled: true, switch: true, env_enabled: true, provider: "openai_compatible", base_url: "https://llm.example/v1",
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
  await screen.findByLabelText("模型名");
  return view;
}

const saveButton = () => screen.getByRole("button", { name: "保存" });
const draftCount = () => screen.getByTestId("aa-draft-count").textContent;
const calls = (spy: jest.SpyInstance, url: string) => spy.mock.calls.filter(([u]) => u === url);

beforeEach(() => {
  mockTenant.user.role = "ADMIN";
  mockPath = "/admin/assistant";
  config = makeConfig();
  get.mockReset().mockImplementation(async (url: string) => {
    if (url === "/assist-admin/config/") return { data: config };
    if (url === "/assist-admin/halls/") return { data: HALLS };
    if (url === "/assist-admin/usage/") return { data: USAGE };
    if (url === "/assist-admin/corpus/") return { data: CORPUS };
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
    fireEvent.change(screen.getByLabelText("模型名"), { target: { value: "assist-large" } });
    expect(draftCount()).toBe("未保存 1 项");
    fireEvent.change(screen.getByLabelText("灵魂端 · 每账号每小时"), { target: { value: "40" } });
    expect(draftCount()).toBe("未保存 2 项");
    fireEvent.change(screen.getByLabelText("灵魂端 · 每账号每小时"), { target: { value: "30" } });
    expect(draftCount()).toBe("未保存 1 项");
    fireEvent.click(screen.getByRole("button", { name: "放弃" }));
    expect(draftCount()).toBe("没有未保存的改动");
    expect(screen.getByLabelText("模型名")).toHaveValue("assist-medium");
    expect(saveButton()).toBeDisabled();
  });

  it("keeps Save disabled, with the reason under it, until this exact draft passed the test", async () => {
    await renderConfig();
    const reason = "连接配置改过，先在「连通测试」测通这份草稿才能保存。";
    fireEvent.change(screen.getByLabelText("模型名"), { target: { value: "assist-large" } });
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText(reason)).toBeInTheDocument();

    post.mockResolvedValueOnce({ data: { ok: true, error_kind: null, latency_ms: 1840, tokens: { input: 2310, output: 186 }, provider: "openai_compatible", model: "assist-large" } });
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
    await screen.findByText("连通 · 可以保存");
    expect(post).toHaveBeenCalledWith("/assist-admin/config/test/", { model: "assist-large" });
    expect(saveButton()).toBeEnabled();
    expect(screen.queryByText(reason)).not.toBeInTheDocument();

    // A different draft is a different connection: the old pass no longer counts.
    fireEvent.change(screen.getByLabelText("模型名"), { target: { value: "assist-xl" } });
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText(reason)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("模型名"), { target: { value: "assist-large" } });
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
    expect(screen.getByText("连接配置改过，先在「连通测试」测通这份草稿才能保存。")).toBeInTheDocument();

    post.mockResolvedValueOnce({ data: { ok: true, error_kind: null, latency_ms: 900, tokens: {}, provider: "openai_compatible", model: "assist-medium" } });
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
    await screen.findByText("连通 · 可以保存");
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
    fireEvent.change(screen.getByLabelText("模型名"), { target: { value: "assist-large" } });
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
    fireEvent.change(screen.getByLabelText("模型名"), { target: { value: "assist-large" } });
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

