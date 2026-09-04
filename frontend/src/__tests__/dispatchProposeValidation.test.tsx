/**
 * Rejections land on the control the server refused, not in a generic toast.
 *
 * This form has three `required` controls and used to pass `error` to none of
 * them. `Field` builds the whole apparatus — `aria-invalid`, `role="alert"`,
 * `aria-describedby` chaining — and its own header records that only 2 of 92
 * legacy controls ever showed an error. So every failure here, whatever its
 * cause, arrived as the same sentence ("发起调度失败") and the operator's only
 * move was to guess which of the three fields the server disliked.
 *
 * `required` was also decorative: `Field` renders it as `aria-required` and
 * nothing else, with no native or client-side gate, so an untouched select
 * submitted and round-tripped to the server to be told what the form already
 * knew. Measured app-wide at the same time: **2 `onBlur` handlers in the whole
 * frontend** — inline validation was, in practice, never.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import ProposeDispatchPage from "@/app/dispatch/propose/page";
import { dispatchApi, soulsApi, ledgerApi } from "@soulledger/core/api";

jest.mock("@soulledger/core/api", () => ({
  dispatchApi: { propose: jest.fn() },
  soulsApi: { list: jest.fn() },
  ledgerApi: { statsOverview: jest.fn() },
}));

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));

jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { id: 1, tenant: { code: "CN_DIYU" } } }),
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "en", hydrated: true }),
}));

const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

// The real gate, fed a real permission list — `suiteShape` forbids stubbing
// the gate component itself, and rightly: a passthrough stub would let the
// gate be deleted with nothing going red.
jest.mock("@/src/hooks/usePermissions", () => {
  const held = new Set(["dispatch.manage"]);
  const has = (p: string) => held.has(p);
  return {
    usePermissions: () => ({
      hasPermission: has,
      hasAnyPermission: (l: string[]) => l.some(has),
      hasAllPermissions: (l: string[]) => l.every(has),
    }),
  };
});

const mockedPropose = dispatchApi.propose as jest.Mock;

function renderPage() {
  (soulsApi.list as jest.Mock).mockResolvedValue({
    data: { results: [{ id: "s1", name: "孟婆", current_state: "ALIVE" }], count: 1 },
  });
  (ledgerApi.statsOverview as jest.Mock).mockResolvedValue({
    data: {
      tenants: [
        { tenant_id: 1, tenant_code: "CN_DIYU", tenant_name: "地府" },
        { tenant_id: 2, tenant_code: "GR_HADES", tenant_name: "冥界" },
      ],
    },
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ProposeDispatchPage />
    </QueryClientProvider>
  );
}

/**
 * Fill every control so a test can then break exactly one thing.
 *
 * THE TENANT SELECT WAITS FOR ITS OPTIONS, not just for the control: it is fed
 * by a query, and setting a `<select>` to a value it has no option for leaves
 * it at "" — which the submit-time required check then blocks, so the test
 * would never reach the server at all. (It did, the first time.)
 *
 * THE SOUL FIELD IS NO LONGER A SELECT. It is a search-driven combobox, because
 * the old `<select>` was built from page 1 of a 20-per-page endpoint and could
 * not reach a tenant's twenty-first soul. So the soul is chosen the way a user
 * chooses one: type, wait for the server's answer, click the row. `findByRole`
 * is what waits out the 300ms debounce — no fake timers, because the thing
 * being tested is that the value survives the round trip, and a mocked clock
 * would let a broken debounce pass.
 */
async function fillValid() {
  await screen.findByRole("option", { name: /GR_HADES/ });

  const soulInput = screen.getByLabelText(/dispatch\.target_soul/);
  fireEvent.click(soulInput);
  fireEvent.change(soulInput, { target: { value: "孟" } });
  fireEvent.click(await screen.findByRole("option", { name: /孟婆/ }));

  fireEvent.change(screen.getByLabelText(/dispatch\.target_tenant/), {
    target: { value: "GR_HADES" },
  });
  fireEvent.change(screen.getByLabelText(/dispatch\.reason/), {
    target: { value: "跨境审判" },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedPropose.mockResolvedValue({ data: {} });
});

describe("proposing a dispatch", () => {
  it("does not reach the server with an empty required field", async () => {
    renderPage();
    await screen.findByLabelText(/dispatch\.target_soul/);

    fireEvent.click(screen.getByText("dispatch.submit_proposal"));

    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
    // The round trip that used to happen just to be told what the form knew.
    expect(mockedPropose).not.toHaveBeenCalled();
  });

  it("puts a per-field server rejection under that field, not in a toast", async () => {
    renderPage();
    await fillValid();
    mockedPropose.mockRejectedValue({
      isAxiosError: true,
      response: { data: { reason: ["理由不得为空白。"] } },
    });

    fireEvent.click(screen.getByText("dispatch.submit_proposal"));

    await waitFor(() => expect(mockedPropose).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("理由不得为空白。")).toBeInTheDocument());
    // This is the whole change: it used to be a toast saying nothing about
    // which of the three controls was refused.
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("keeps an object-level rejection in the toast, where it belongs", async () => {
    renderPage();
    await fillValid();
    mockedPropose.mockRejectedValue({
      isAxiosError: true,
      response: { data: { non_field_errors: ["不能调度到本租户。"] } },
    });

    fireEvent.click(screen.getByText("dispatch.submit_proposal"));

    // The server named no control, so pinning it under one would be a guess.
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith("不能调度到本租户。", "error")
    );
  });

  it("clears a field's error as soon as it is edited", async () => {
    renderPage();
    await screen.findByLabelText(/dispatch\.target_soul/);
    fireEvent.click(screen.getByText("dispatch.submit_proposal"));
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));

    fireEvent.change(screen.getByLabelText(/dispatch\.reason/), {
      target: { value: "x" },
    });

    await waitFor(() =>
      expect(screen.getByLabelText(/dispatch\.reason/)).not.toHaveAttribute("aria-invalid", "true")
    );
  });

  /**
   * 两个喂数据的查询失败时,不能说成「没有可选的」。
   *
   * 这两个查询原本都只解构了 `data` 和 `isLoading`。检索灵魂失败会渲染
   * `SearchSelectField` 的 `emptyText`(「没有匹配」),租户列表失败则只剩一个
   * 占位 `<option>`。两句都在把「请求失败」说成「没有东西可选」,而这一页的
   * 后果是调度发不出去、且没有任何东西说明为什么。
   *
   * `errorIsNotAnEmptyState` 那道守卫也看不到这一页:它不渲染 `<EmptyState>`
   * 也不渲染 `<DataTable>`,两条规则的主体清单都不含它。
   */
  describe("喂数据的查询失败 ≠ 没有可选项", () => {
    it("灵魂检索失败时,字段自己报错,而不是说「没有匹配」", async () => {
      (soulsApi.list as jest.Mock).mockRejectedValue(new Error("500"));
      (ledgerApi.statsOverview as jest.Mock).mockResolvedValue({ data: { tenants: [] } });
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      render(
        <QueryClientProvider client={client}>
          <ProposeDispatchPage />
        </QueryClientProvider>
      );

      // `Field` 把它接成 aria-invalid + role="alert" + aria-describedby,
      // 所以这条同时验了「说了」和「读屏读得到」。
      const soulField = await screen.findByLabelText(/dispatch\.target_soul/);
      await waitFor(() => expect(soulField).toHaveAttribute("aria-invalid", "true"));
      expect(screen.getByText("dispatch.soul_search_error")).toBeInTheDocument();
      // 缺席断言:「没有匹配」一次都不许出现 —— 它才是缺陷的长相。
      expect(screen.queryByText("dispatch.soul_search_empty")).not.toBeInTheDocument();
    });

    it("租户列表失败时,下拉里不再只剩一个占位项", async () => {
      (soulsApi.list as jest.Mock).mockResolvedValue({ data: { results: [], count: 0 } });
      (ledgerApi.statsOverview as jest.Mock).mockRejectedValue(new Error("500"));
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      render(
        <QueryClientProvider client={client}>
          <ProposeDispatchPage />
        </QueryClientProvider>
      );

      const tenantField = await screen.findByLabelText(/dispatch\.target_tenant/);
      await waitFor(() => expect(tenantField).toHaveAttribute("aria-invalid", "true"));
      expect(screen.getAllByText("dispatch.tenants_error").length).toBeGreaterThan(0);
      expect(screen.queryByText("dispatch.select_tenant")).not.toBeInTheDocument();
    });
  });
});
