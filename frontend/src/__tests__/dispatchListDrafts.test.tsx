/**
 * A draft in the dispatch list (设计稿「发起移交」 存草稿). The server sends a
 * DRAFT row only to its author (`hide_others_drafts`, backend/apps/dispatch/
 * views.py); here the row has to say 草稿 and reopen in the form, pre-filled,
 * rather than on the detail page — which has no action for a draft.
 */
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DispatchPage from "@/app/dispatch/page";
import { dispatchApi } from "@soulledger/core/api";

jest.mock("@soulledger/core/api", () => ({
  dispatchApi: { proposed: jest.fn(), history: jest.fn() },
  PAGE_SIZE: 20,
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    // The two state labels this test reads; any other key echoes, which
    // `DomainEnum` treats as a missing translation.
    t: (key: string) => ({ "dispatch.states.DRAFT": "草稿", "dispatch.states.PROPOSED": "待审批" })[key] ?? key,
    formatDateTime: (v: string) => v,
    locale: "zh-Hans",
    hydrated: true,
  }),
}));

jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { id: 1, tenant: { code: "CN_DIYU" } } }),
}));

jest.mock("@/src/components/layout/MenuGloss", () => ({ MenuGloss: () => null }));

jest.mock("@/src/hooks/usePermissions", () => {
  const has = (p: string) => p === "dispatch.read";
  return {
    usePermissions: () => ({
      hasPermission: has,
      hasAnyPermission: (l: string[]) => l.some(has),
      hasAllPermissions: (l: string[]) => l.every(has),
    }),
  };
});

const base = {
  source_tenant: 1, source_tenant_code: "CN_DIYU", target_tenant: 2, target_tenant_code: "EU_HEAVEN_HELL",
  target_realm: null, proposed_at: "2026-09-25T10:00:00Z", executed_at: null, returned_at: null, reason: "",
};

it("marks a draft 草稿 and links it back into the form; a proposal still opens its record", async () => {
  (dispatchApi.proposed as jest.Mock).mockResolvedValue({ data: { results: [], count: 0 } });
  (dispatchApi.history as jest.Mock).mockResolvedValue({
    data: {
      results: [
        { ...base, id: "d1", status: "DRAFT", soul: null, soul_name: null, target_tenant: null, target_tenant_code: null },
        { ...base, id: "p1", status: "PROPOSED", soul: "s1", soul_name: "沈青梧" },
      ],
      count: 2,
    },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DispatchPage />
    </QueryClientProvider>
  );

  const proposal = await screen.findByRole("link", { name: /沈青梧/ });
  expect(proposal).toHaveAttribute("href", "/dispatch/p1");

  const draftRow = screen.getAllByRole("row").find((r) => r.querySelector('a[href="/dispatch/propose?draft=d1"]'));
  expect(draftRow).toBeDefined();
  expect(within(draftRow!).getByText("草稿")).toBeInTheDocument();
  // And only the draft is so marked.
  expect(screen.getAllByText("草稿")).toHaveLength(1);
  expect(screen.queryByRole("link", { name: /沈青梧/ })?.getAttribute("href")).not.toContain("draft=");
});
