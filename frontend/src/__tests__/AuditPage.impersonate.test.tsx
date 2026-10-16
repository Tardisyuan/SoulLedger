/**
 * 审计页按名字显示「开始代看 / 结束代看」两种动作(W6),描述从 `changes` 按界面语言现拼,
 * 而不是原样露出库里存的 zh 固定句式或词条键。用真实的 zh-Hans 词包,断言操作员读到的字。
 */
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AuditPage from "@/app/audit/page";
import { auditApi } from "@soulledger/core/api";
import { tZh, zh } from "./support/zhBundle";

jest.mock("@soulledger/core/api", () => ({
  auditApi: {
    list: jest.fn(),
    exportCsv: jest.fn(),
    actions: jest.fn().mockResolvedValue({ data: [] }),
    resources: jest.fn().mockResolvedValue({ data: [] }),
  },
  tenantsApi: { list: jest.fn().mockResolvedValue({ data: { results: [] } }) },
  PAGE_SIZE: 20,
  menusApi: {
    all: jest.fn().mockResolvedValue({ data: [] }),
    list: jest.fn().mockResolvedValue({ data: { results: [] } }),
  },
}));
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ isAdmin: true, tenantCode: null, user: { role: "ADMIN", permissions: ["audit.read"] } }),
}));
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    // Enum lookups probe a member's key and expect the key back on a miss (that is how an unknown member reads
    // as 未识别); every other key must exist.
    t: (key: string, params?: Record<string, string>) => (key.startsWith("audit.actions.") || key.startsWith("audit.resources.") ? tZh(key, params) : zh(key, params)),
    formatDateTime: (v: string) => v,
    formatDate: (v: string) => v,
    locale: "zh-Hans",
    hydrated: true,
  }),
}));

const entry = (over: Record<string, unknown>) => ({
  id: 1, resource: "user", resource_id: "3", user: "cui", user_display: "崔判官",
  ip_address: "10.0.0.1", timestamp: "2026-10-12T14:20:00Z", ...over,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<AuditPage />, { wrapper: Wrapper });
}

it("两种代看动作有名字,描述按 changes 现拼", async () => {
  (auditApi.list as jest.Mock).mockResolvedValue({
    data: {
      count: 2,
      results: [
        entry({
          id: 2, action: "IMPERSONATE_END", timestamp: "2026-10-12T14:34:00Z", description: "以 孟婆 的身份查看 · 14 分钟 · 看过 6 个页面",
          changes: { target_name: "孟婆", minutes: 14, pages: 6 },
        }),
        entry({
          id: 1, action: "IMPERSONATE_START", description: "以 孟婆 的身份查看 · 理由：她说看不到「移交」菜单",
          changes: { target_name: "孟婆", reason: "她说看不到「移交」菜单" },
        }),
      ],
    },
  });
  const { container } = renderPage();

  expect((await screen.findAllByText("开始代看")).length).toBeGreaterThan(0);
  expect(screen.getAllByText("结束代看").length).toBeGreaterThan(0);
  expect(await screen.findByText("以 孟婆 的身份查看 · 理由：她说看不到「移交」菜单")).toBeInTheDocument();
  expect(screen.getByText("以 孟婆 的身份查看 · 14 分钟 · 看过 6 个页面")).toBeInTheDocument();
  // 没有露出词条键,也没有落进「无法识别」。
  expect(container.textContent).not.toMatch(/audit\.(actions|descriptions)\./);
  expect(container.querySelectorAll('[data-enum-state="unrecognized"]')).toHaveLength(0);
});

it("筛选项来自后端：动作走 audit.actions 词条(不显示后端 label),认不得的动作显示「未识别」;资源有词条的翻译，没有的原样", async () => {
  (auditApi.list as jest.Mock).mockResolvedValue({ data: { count: 0, results: [] } });
  (auditApi.actions as jest.Mock).mockResolvedValue({
    data: [
      { value: "BATCH_DELETE", label: "后端中文" },
      { value: "SOME_FUTURE_ACTION", label: "后端中文" },
    ],
  });
  (auditApi.resources as jest.Mock).mockResolvedValue({ data: ["soul", "tenant", "rebirth_application"] });
  renderPage();

  const action = await screen.findByRole("combobox", { name: zh("audit.filter_action") });
  const byValue = (select: HTMLElement, value: string) => select.querySelector(`option[value="${value}"]`)?.textContent;
  await waitFor(() => expect(byValue(action, "BATCH_DELETE")).toBe("批量删除"));
  expect(byValue(action, "SOME_FUTURE_ACTION")).toBe(zh("common.value.unrecognized"));
  expect(action.textContent).not.toContain("后端中文");
  expect(action.textContent).not.toContain("SOME_FUTURE_ACTION");

  const resource = screen.getByRole("combobox", { name: zh("audit.filter_resource") });
  await waitFor(() => expect(byValue(resource, "soul")).toBe("灵魂"));
  expect(byValue(resource, "tenant")).toBe("殿设置");
  expect(byValue(resource, "rebirth_application")).toBe("rebirth_application");
});
