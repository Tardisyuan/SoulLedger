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

jest.mock("@soulledger/core/api", () => {
  // The real rule, not a copy of it: a stub that re-implemented the count
  // could agree with a broken one.
  const { DISPATCH_REASON_MIN_CHARS, dispatchReasonLength } = jest.requireActual("@soulledger/core/api");
  return {
  DISPATCH_REASON_MIN_CHARS,
  dispatchReasonLength,
  dispatchApi: {
    propose: jest.fn(),
    get: jest.fn(),
    createDraft: jest.fn(),
    updateDraft: jest.fn(),
    submitDraft: jest.fn(),
    discardDraft: jest.fn(),
    realmOptions: jest.fn(),
  },
  soulsApi: { list: jest.fn(), get: jest.fn() },
  ledgerApi: { statsOverview: jest.fn() },
  };
});

const mockBack = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockSearch = new URLSearchParams();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: mockReplace }),
  useSearchParams: () => mockSearch,
}));

jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { id: 1, tenant: { code: "CN_DIYU" } } }),
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, p?: Record<string, string>) => (p ? `${key}:${p.min ?? ""}/${p.count ?? ""}` : key),
    locale: "en",
    hydrated: true,
  }),
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

function renderPage(extraTenants: object[] = []) {
  (soulsApi.list as jest.Mock).mockResolvedValue({
    data: { results: [{ id: "s1", name: "孟婆", current_state: "ALIVE" }], count: 1 },
  });
  (ledgerApi.statsOverview as jest.Mock).mockResolvedValue({
    data: {
      tenants: [
        { tenant_id: 1, tenant_code: "CN_DIYU", tenant_name: "地府" },
        { tenant_id: 2, tenant_code: "GR_HADES", tenant_name: "冥界" },
        ...extraTenants,
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
  await screen.findByRole("radio", { name: /冥界/ });

  const soulInput = screen.getByLabelText(/dispatch\.target_soul/);
  fireEvent.click(soulInput);
  fireEvent.change(soulInput, { target: { value: "孟" } });
  fireEvent.click(await screen.findByRole("option", { name: /孟婆/ }));

  fireEvent.click(screen.getByRole("radio", { name: /冥界/ }));
  fireEvent.change(screen.getByLabelText(/dispatch\.reason/), {
    target: { value: LONG_REASON },
  });
}

/** At least DISPATCH_REASON_MIN_CHARS (20) characters, as the server requires. */
const LONG_REASON = "跨境审判：此魂须移送冥界，由彼方判官依其律法重审";

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = new URLSearchParams();
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

    // Deliberately a full-length reason (was "x"): since the 20-character
    // minimum, a one-character reason is invalid in its own right.
    fireEvent.change(screen.getByLabelText(/dispatch\.reason/), {
      target: { value: LONG_REASON },
    });

    await waitFor(() =>
      expect(screen.getByLabelText(/dispatch\.reason/)).not.toHaveAttribute("aria-invalid", "true")
    );
  });

  it("says, while typing, how short the reason is — counted in characters, trimmed", async () => {
    renderPage();
    const reason = await screen.findByLabelText(/dispatch\.reason/);
    // Empty is not nagged about before anything was written.
    expect(screen.queryByText(/dispatch\.reason_too_short/)).not.toBeInTheDocument();

    // 19 characters (one astral, which String.length would count as two),
    // padded with spaces the server trims away.
    fireEvent.change(reason, { target: { value: "  𠀀" + "一".repeat(18) + "  " } });
    expect(await screen.findByText("dispatch.reason_too_short:20/19")).toBeInTheDocument();
    expect(reason).toHaveAttribute("aria-invalid", "true");

    fireEvent.change(reason, { target: { value: "一".repeat(20) } });
    await waitFor(() => expect(screen.queryByText(/dispatch\.reason_too_short/)).not.toBeInTheDocument());
    expect(reason).not.toHaveAttribute("aria-invalid", "true");
  });

  it("does not send a reason under 20 characters", async () => {
    renderPage();
    await fillValid();
    fireEvent.change(screen.getByLabelText(/dispatch\.reason/), { target: { value: "跨境审判" } });
    fireEvent.click(screen.getByText("dispatch.submit_proposal"));
    expect(await screen.findByText("dispatch.reason_too_short:20/4")).toBeInTheDocument();
    expect(mockedPropose).not.toHaveBeenCalled();
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

      // A radio group now, not a select: the group points at its own alert,
      // and there is no row at all that could read as "nothing to choose".
      const tenantGroup = await screen.findByRole("group", { name: /dispatch\.target_tenant/ });
      await waitFor(() => expect(tenantGroup).toHaveAttribute("aria-describedby", "target_tenant_code-error"));
      expect(screen.getByRole("alert")).toHaveTextContent("dispatch.tenants_error");
      expect(screen.queryAllByRole("radio")).toHaveLength(0);
    });
  });
});

/** 规范 v1「发起移交」, restyled onto what the dispatch API actually has. */
describe("the dispatch form, 规范 v1", () => {
  it("lists every civilization with its numbering sample; the source row is disabled and says so", async () => {
    renderPage();
    const source = await screen.findByRole("radio", { name: /地府/ });
    expect(source).toBeDisabled();
    expect(source.closest("label")).toHaveTextContent("dispatch.source_label");
    const target = screen.getByRole("radio", { name: /冥界/ });
    expect(target).toBeEnabled();
    // GREEK's sample, verbatim — and never on the source row.
    expect(target.closest("label")).toHaveTextContent("523a");
    expect(source.closest("label")).not.toHaveTextContent("救濟門");
  });

  it("the approval-flow panel follows the real state machine: submit, target approves, target executes", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("radio", { name: /冥界/ }));
    const flow = screen.getByRole("complementary", { name: "dispatch.flow.title" });
    expect(flow.querySelectorAll("li")).toHaveLength(3);
    // A draft is not a step of the approval flow: saving one starts nothing.
    expect(flow).not.toHaveTextContent(/草稿|draft/i);
  });

  it("a soul carried from the detail page is shown read-only and is what gets proposed", async () => {
    mockSearch = new URLSearchParams("soul=38fb6bc2-9e41-4c07-b0a3-5d1e7f2a8c94");
    (soulsApi.get as jest.Mock).mockResolvedValue({
      data: { id: "38fb6bc2-9e41-4c07-b0a3-5d1e7f2a8c94", name: "沈青梧" },
    });
    renderPage();
    expect(await screen.findByText("沈青梧")).toBeInTheDocument();
    expect(screen.getByText("dispatch.soul_from_detail")).toBeInTheDocument();
    // Read-only means there is no search box to change it with.
    expect(screen.queryByLabelText(/dispatch\.target_soul/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /冥界/ }));
    fireEvent.change(screen.getByLabelText(/dispatch\.reason/), { target: { value: LONG_REASON } });
    fireEvent.click(screen.getByText("dispatch.submit_proposal"));
    await waitFor(() =>
      expect(mockedPropose).toHaveBeenCalledWith(
        expect.objectContaining({ soul: "38fb6bc2-9e41-4c07-b0a3-5d1e7f2a8c94", target_tenant: 2 })
      )
    );
  });

  it("a carried soul that fails to load falls back to the search field with an error", async () => {
    mockSearch = new URLSearchParams("soul=gone");
    (soulsApi.get as jest.Mock).mockRejectedValue(new Error("404"));
    renderPage();
    await waitFor(() => expect(screen.getByText("dispatch.soul_from_detail_error")).toBeInTheDocument());
    expect(screen.getByLabelText(/dispatch\.target_soul/)).toBeInTheDocument();
  });

  it("放弃… asks first once something is filled in, and leaves at once when nothing is", async () => {
    renderPage();
    await screen.findByRole("radio", { name: /冥界/ });
    fireEvent.click(screen.getByText("dispatch.discard"));
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("dispatch.discard_title")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/dispatch\.reason/), { target: { value: "写了一半" } });
    fireEvent.click(screen.getByText("dispatch.discard"));
    expect(await screen.findByText("dispatch.discard_title")).toBeInTheDocument();
    fireEvent.click(screen.getByText("dispatch.discard_keep"));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

const DRAFT = {
  id: "d1",
  status: "DRAFT",
  soul: "38fb6bc2-9e41-4c07-b0a3-5d1e7f2a8c94",
  soul_name: "沈青梧",
  target_tenant: 2,
  target_tenant_code: "GR_HADES",
  target_realm: "r-meadow",
  reason: "口业",
};
const REALMS = [
  { id: "r-meadow", display_name: "审判草地" },
  { id: "r-tartarus", display_name: "塔尔塔罗斯" },
];

/** 存草稿 / 目标界域 / 放弃… (设计稿「发起移交」). */
describe("dispatch drafts and the target realm", () => {
  beforeEach(() => {
    mockSearch = new URLSearchParams();
    (dispatchApi.realmOptions as jest.Mock).mockResolvedValue({ data: REALMS });
    (soulsApi.get as jest.Mock).mockResolvedValue({ data: { id: DRAFT.soul, name: "沈青梧" } });
  });

  it("the realm select waits for a target civilization, then lists only that civilization's realms", async () => {
    renderPage();
    const realm = screen.getByLabelText(/dispatch\.target_realm/);
    expect(realm).toBeDisabled();
    expect(dispatchApi.realmOptions).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole("radio", { name: /冥界/ }));
    await screen.findByRole("option", { name: "塔尔塔罗斯" });
    expect(dispatchApi.realmOptions).toHaveBeenCalledWith("GR_HADES");
    expect(dispatchApi.realmOptions).not.toHaveBeenCalledWith("CN_DIYU");
    expect(realm).toBeEnabled();
  });

  it("存草稿 saves an incomplete form without a reason check and switches to editing that draft", async () => {
    (dispatchApi.createDraft as jest.Mock).mockResolvedValue({ data: { ...DRAFT, id: "new1" } });
    renderPage();
    fireEvent.click(await screen.findByRole("radio", { name: /冥界/ }));
    fireEvent.change(screen.getByLabelText(/dispatch\.reason/), { target: { value: "口业" } });
    fireEvent.click(screen.getByText("dispatch.save_draft"));
    await waitFor(() =>
      expect(dispatchApi.createDraft).toHaveBeenCalledWith({
        soul: null, target_tenant: 2, target_realm: null, reason: "口业",
      })
    );
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/dispatch/propose?draft=new1"));
    expect(mockedPropose).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith("dispatch.draft_saved", "success");
  });

  it("reopening a draft pre-fills it, and 提交审批 submits that draft rather than proposing anew", async () => {
    mockSearch = new URLSearchParams("draft=d1");
    (dispatchApi.get as jest.Mock).mockResolvedValue({ data: DRAFT });
    (dispatchApi.submitDraft as jest.Mock).mockResolvedValue({ data: { ...DRAFT, status: "PROPOSED" } });
    renderPage();
    expect(await screen.findByText("沈青梧")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("radio", { name: /冥界/ })).toBeChecked());
    expect(screen.getByLabelText(/dispatch\.reason/)).toHaveValue("口业");
    await waitFor(() => expect(screen.getByLabelText(/dispatch\.target_realm/)).toHaveValue("r-meadow"));

    fireEvent.change(screen.getByLabelText(/dispatch\.reason/), { target: { value: LONG_REASON } });
    fireEvent.click(screen.getByText("dispatch.submit_proposal"));
    await waitFor(() =>
      expect(dispatchApi.submitDraft).toHaveBeenCalledWith("d1", {
        soul: DRAFT.soul, target_tenant: 2, target_realm: "r-meadow", reason: LONG_REASON,
      })
    );
    expect(mockedPropose).not.toHaveBeenCalled();
  });

  it("changing the target civilization clears a realm of the old one", async () => {
    mockSearch = new URLSearchParams("draft=d1");
    (dispatchApi.get as jest.Mock).mockResolvedValue({ data: DRAFT });
    renderPage([{ tenant_id: 3, tenant_code: "EG_DUAT", tenant_name: "杜阿特" }]);
    const realm = () => screen.getByLabelText(/dispatch\.target_realm/);
    await waitFor(() => expect(realm()).toHaveValue("r-meadow"));
    (dispatchApi.updateDraft as jest.Mock).mockResolvedValue({ data: DRAFT });
    fireEvent.click(screen.getByRole("radio", { name: /杜阿特/ }));
    await waitFor(() => expect(dispatchApi.realmOptions).toHaveBeenCalledWith("EG_DUAT"));
    // What is sent, not what the <select> shows: a select cannot display a value
    // it has no option for, so its DOM value would read "" even if the form kept
    // the old realm and sent it.
    fireEvent.click(screen.getByText("dispatch.save_draft"));
    await waitFor(() =>
      expect(dispatchApi.updateDraft).toHaveBeenCalledWith("d1", expect.objectContaining({ target_tenant: 3, target_realm: null }))
    );
    expect(realm()).toHaveValue("");
  });

  it("放弃… on a draft says it goes to the recycle bin, and discarding moves it there", async () => {
    mockSearch = new URLSearchParams("draft=d1");
    (dispatchApi.get as jest.Mock).mockResolvedValue({ data: DRAFT });
    (dispatchApi.discardDraft as jest.Mock).mockResolvedValue({ status: 204 });
    renderPage();
    await screen.findByText("沈青梧");
    fireEvent.click(screen.getByText("dispatch.discard"));
    expect(await screen.findByText("dispatch.discard_message")).toBeInTheDocument();
    fireEvent.click(screen.getByText("dispatch.discard_confirm"));
    await waitFor(() => expect(dispatchApi.discardDraft).toHaveBeenCalledWith("d1"));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dispatch"));
    // Kept, not dropped: nothing went back without the bin.
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("放弃… on an unsaved form keeps what was written: saved as a draft, then binned", async () => {
    (dispatchApi.createDraft as jest.Mock).mockResolvedValue({ data: { ...DRAFT, id: "new2" } });
    (dispatchApi.discardDraft as jest.Mock).mockResolvedValue({ status: 204 });
    renderPage();
    await screen.findByRole("radio", { name: /冥界/ });
    fireEvent.change(screen.getByLabelText(/dispatch\.reason/), { target: { value: "写了一半" } });
    fireEvent.click(screen.getByText("dispatch.discard"));
    fireEvent.click(await screen.findByText("dispatch.discard_confirm"));
    await waitFor(() => expect(dispatchApi.discardDraft).toHaveBeenCalledWith("new2"));
    expect(dispatchApi.createDraft).toHaveBeenCalledWith(expect.objectContaining({ reason: "写了一半" }));
  });

  it("a realm the server refuses is shown under the realm select", async () => {
    (dispatchApi.createDraft as jest.Mock).mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { target_realm: ["Realm X is not a realm of GR_HADES"] } },
    });
    renderPage();
    fireEvent.click(await screen.findByRole("radio", { name: /冥界/ }));
    fireEvent.click(screen.getByText("dispatch.save_draft"));
    expect(await screen.findByText("Realm X is not a realm of GR_HADES")).toBeInTheDocument();
    expect(screen.getByLabelText(/dispatch\.target_realm/)).toHaveAttribute("aria-invalid", "true");
  });
});
