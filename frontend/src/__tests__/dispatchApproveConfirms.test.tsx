/**
 * The cross-tenant handover does not fire on one click.
 *
 * `app/dispatch/[id]/page.tsx` had three actions in one card. Reject opened a
 * confirmation. Execute opened a confirmation. **Approve called
 * `approveMutation.mutate()` straight out of `onClick`** — and approve is the
 * one whose consequence leaves this tenant: it hands disposition rights over a
 * soul to another tenant's ledger and writes an audit row. The two reversible
 * verbs were guarded and the irreversible one was not.
 *
 * NN/g's position, from the research pass, is that confirmations belong to
 * infrequent destructive actions and everything else is better served by
 * instant-commit plus undo. A cross-tenant approval is exactly the infrequent,
 * consequential case that keeps the dialog.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * A shim for `React.use`, and an honest note about what it costs.
 *
 * `package.json` declares `react@^18.3.1`, where `React.use` does not exist —
 * `typeof require("react").use` is `undefined`. The page calls it anyway, and
 * works in the app, because **Next substitutes its own bundled React**
 * (19.3.0-canary at the time of writing) for the application build. Jest
 * resolves the plain dependency, so the test environment and the running
 * application are on different major versions of React.
 *
 * Mapping jest's `^react$` at Next's compiled copy was tried and abandoned:
 * 76 of 104 suites went red, because @testing-library also needs
 * `react-dom/client`, the jsx runtimes and `react-dom/test-utils` remapped in
 * step. Aligning the declared dependency to React 19 is the real fix and is
 * foundation-scale work, not something to smuggle into a defect commit.
 *
 * So: this replaces exactly one function, unwrapping the params promise the
 * way React 19's `use` does for an already-resolved promise. WHAT IT
 * THEREFORE CANNOT PROVE: anything about suspense, about an unresolved
 * promise, or about the page's behaviour under the React the app actually
 * ships. It proves what the assertions below say and nothing wider.
 */
jest.mock("react", () => {
  const actual = jest.requireActual("react");
  return {
    ...actual,
    use: <T,>(value: Promise<T> | T): T => {
      if (value && typeof (value as { then?: unknown }).then === "function") {
        // Only ever handed `Promise.resolve({ id })` by these tests.
        return { id: "d1" } as unknown as T;
      }
      return value as T;
    },
  };
});

import DispatchDetailPage from "@/app/dispatch/[id]/page";
import { dispatchApi } from "@soulledger/core/api";

jest.mock("@soulledger/core/api", () => ({
  dispatchApi: {
    get: jest.fn(),
    approve: jest.fn().mockResolvedValue({ data: {} }),
    reject: jest.fn().mockResolvedValue({ data: {} }),
    execute: jest.fn().mockResolvedValue({ data: {} }),
  },
}));

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));

jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { id: 1, username: "yama", role: "ADMIN" }, isAdmin: true }),
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    formatDateTime: (v: string) => v ?? "",
    locale: "en",
    hydrated: true,
  }),
}));

jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

/**
 * The real `RequirePermission`, fed a real permission list.
 *
 * Stubbing that component is forbidden by `suiteShape.test.ts` and the
 * prohibition is well earned: a passthrough stub ignores the `permissions`
 * prop, so inside the stubbing file a gate can be deleted outright — or
 * pointed at a codename that does not exist — with nothing going red. Mocking
 * `usePermissions` instead leaves the gate itself under test: it still reads
 * the prop, still calls `hasAnyPermission`, and this mock still answers "no"
 * for a codename the operator does not hold.
 */
jest.mock("@/src/hooks/usePermissions", () => {
  const held = new Set(["dispatch.approve", "dispatch.reject", "dispatch.execute"]);
  const has = (p: string) => held.has(p);
  return {
    usePermissions: () => ({
      hasPermission: has,
      hasAnyPermission: (list: string[]) => list.some(has),
      hasAllPermissions: (list: string[]) => list.every(has),
    }),
  };
});

const mockedGet = dispatchApi.get as jest.Mock;
const mockedApprove = dispatchApi.approve as jest.Mock;

function renderPage() {
  mockedGet.mockResolvedValue({
    data: {
      id: "d1",
      status: "PROPOSED",
      soul_name: "孟婆",
      reason: "跨境",
      source_tenant_name: "CN_DIYU",
      target_tenant_name: "GR_HADES",
    },
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DispatchDetailPage params={Promise.resolve({ id: "d1" })} />
    </QueryClientProvider>
  );
}

beforeEach(() => jest.clearAllMocks());

describe("approving a cross-tenant dispatch", () => {
  it("does not call the API on the first click", async () => {
    renderPage();

    const approve = await screen.findByRole("button", { name: "dispatch.approve" });
    fireEvent.click(approve);

    // The click opens the dialog and nothing else. This is the whole defect:
    // before, this assertion would have found the call already made.
    expect(mockedApprove).not.toHaveBeenCalled();
    expect(await screen.findByText("dispatch.approve_warning")).toBeInTheDocument();
  });

  it("calls it once the operator confirms", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "dispatch.approve" }));
    // Two buttons now read "dispatch.approve" — the card's and the dialog's.
    // The dialog's is the last one rendered.
    const buttons = await screen.findAllByRole("button", { name: "dispatch.approve" });
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => expect(mockedApprove).toHaveBeenCalledTimes(1));
  });

  it("does not call it when the operator backs out", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "dispatch.approve" }));
    fireEvent.click(await screen.findByRole("button", { name: "common.cancel" }));

    await waitFor(() =>
      expect(screen.queryByText("dispatch.approve_warning")).not.toBeInTheDocument()
    );
    expect(mockedApprove).not.toHaveBeenCalled();
  });
});
