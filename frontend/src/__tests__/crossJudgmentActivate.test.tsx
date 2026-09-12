/**
 * The cross-judgment detail page offers "activate" to exactly the tenant that
 * can use it (BD-06, 2026-09-12).
 *
 * Activation used to happen server-side as a side effect of the first
 * `participate`, which capped a "joint" judgment at one participant. It is now
 * an explicit `POST .../activate/` that the backend accepts only from the
 * initiating tenant, only while PROPOSED, only with a seated participant. This
 * file pins that the page shows the button under those three conditions and
 * hides it otherwise — a button the server would 403 or 400 is worse than no
 * button.
 *
 * The real `I18nProvider` on the default locale, so the button's name is the
 * bundle's text and a deleted key would surface as the raw key. Tenant, toast
 * and API are doubles; `mockTenant` is a module constant for the reason the
 * fetch-budget test next door records (a fresh object per call re-fetches).
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/src/contexts/I18nContext";

jest.mock("next/navigation", () => ({
  useParams: () => ({ id: "cj-1" }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));

const mockTenant: { user: { id: number; username: string; tenant: { code: string } | null } } = {
  user: { id: 1, username: "u", tenant: { code: "CN_DIYU" } },
};
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => mockTenant,
}));

const showToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast }),
}));

jest.mock("@soulledger/core/api", () => ({
  crossTenantJudgmentsApi: {
    get: jest.fn(),
    activate: jest.fn(),
  },
}));

import Page from "@/app/cross-judgments/[id]/page";

const { crossTenantJudgmentsApi } = jest.requireMock("@soulledger/core/api") as {
  crossTenantJudgmentsApi: { get: jest.Mock; activate: jest.Mock };
};

const participant = {
  id: "p1",
  judgment: "cj-1",
  participant_tenant: 2,
  participant_tenant_code: "EU_HEAVEN_HELL",
  participant_actor: null,
  participant_actor_name: null,
  role: "CO_JUDGE",
  joined_at: "2026-09-12T00:00:00Z",
};

function judgment(overrides: Record<string, unknown> = {}) {
  return {
    id: "cj-1",
    title: "Joint",
    description: "d",
    initiating_tenant: 1,
    initiating_tenant_code: "CN_DIYU",
    status: "PROPOSED",
    concluded_at: null,
    conclusion_type: null,
    participants: [participant],
    create_time: "2026-09-12T00:00:00Z",
    update_time: "2026-09-12T00:00:00Z",
    ...overrides,
  };
}

function renderPage(data: ReturnType<typeof judgment>) {
  crossTenantJudgmentsApi.get.mockResolvedValue({ data });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider initialLocale="zh-Hans">
        <Page />
      </I18nProvider>
    </QueryClientProvider>
  );
}

const ACTIVATE = "激活联审";

describe("cross-judgment detail — activate", () => {
  beforeEach(() => {
    crossTenantJudgmentsApi.get.mockReset();
    crossTenantJudgmentsApi.activate.mockReset();
    showToast.mockReset();
    mockTenant.user = { id: 1, username: "u", tenant: { code: "CN_DIYU" } };
  });

  it("the initiator sees it on a PROPOSED case with a seated participant, and it posts", async () => {
    crossTenantJudgmentsApi.activate.mockResolvedValue({ data: judgment({ status: "ACTIVE" }) });
    renderPage(judgment());

    const button = await screen.findByRole("button", { name: ACTIVATE });
    fireEvent.click(button);

    await waitFor(() => expect(crossTenantJudgmentsApi.activate).toHaveBeenCalledWith("cj-1"));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("联审已激活", "success"));
  });

  it("a failed activation is reported, not swallowed", async () => {
    crossTenantJudgmentsApi.activate.mockRejectedValue(new Error("400"));
    renderPage(judgment());

    fireEvent.click(await screen.findByRole("button", { name: ACTIVATE }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith("激活失败", "error"));
  });

  it("a participant tenant does not see it", async () => {
    mockTenant.user = { id: 2, username: "eu", tenant: { code: "EU_HEAVEN_HELL" } };
    renderPage(judgment());

    await screen.findByText("Joint");
    expect(screen.queryByRole("button", { name: ACTIVATE })).toBeNull();
  });

  it("an empty bench cannot be convened", async () => {
    renderPage(judgment({ participants: [] }));

    await screen.findByText("Joint");
    expect(screen.queryByRole("button", { name: ACTIVATE })).toBeNull();
  });

  it("an ACTIVE case has nothing left to activate", async () => {
    renderPage(judgment({ status: "ACTIVE" }));

    await screen.findByText("Joint");
    expect(screen.queryByRole("button", { name: ACTIVATE })).toBeNull();
  });
});
