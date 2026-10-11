/**
 * app/soul-credentials/page.tsx — the pending-delivery list and the
 * one-time password reveal.
 *
 * `RequirePermission` / `usePermissions` run for real against a stubbed
 * `useTenant` (see SchedulerPage.test.tsx for why). Copy is the real zh-Hans
 * bundle, so a key the page asks for that the bundle lacks shows up as a miss.
 *
 * The reveal tests assert ABSENCE as much as presence: the plaintext must not
 * be in the query cache, the mutation cache, local/session storage, or the
 * document once the dialog is closed.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SoulCredentialsPage from "@/app/soul-credentials/page";
import { tZh } from "./support/zhBundle";

jest.mock("@soulledger/core/api", () => ({
  PAGE_SIZE: 20,
  soulAccountsApi: {
    credentials: jest.fn(),
    revealCredential: jest.fn(),
    markDelivered: jest.fn(),
    retry: jest.fn(),
    printSlip: jest.fn(),
  },
}));
const { soulAccountsApi } = jest.requireMock("@soulledger/core/api") as {
  soulAccountsApi: Record<"credentials" | "revealCredential" | "markDelivered" | "retry" | "printSlip", jest.Mock>;
};

let mockUser: { id: number; username: string; role: string; permissions: string[] } | null = null;
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: mockUser }) }));

const mockI18n = {
  t: tZh,
  formatDateTime: (v: string) => `dt(${v})`,
  locale: "zh-Hans",
  hydrated: true,
};
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => mockI18n,
}));

const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));

const SECRET = "Zq7-one-time-SECRET";
const FUTURE = "2999-01-01T00:00:00Z";
const PAST = "2000-01-01T00:00:00Z";

function credential(over: Record<string, unknown> = {}) {
  return {
    id: "c1",
    account: "a1",
    soul: "s1",
    soul_code: "ABCDEFGH23",
    soul_name: "张三",
    cycle: 0,
    channel: "",
    status: "PENDING",
    expires_at: FUTURE,
    attempts: 0,
    last_error: "",
    created_at: "2026-09-17T00:00:00Z",
    sent_at: null,
    revealed_at: null,
    revealed_by: null,
    delivered_at: null,
    delivered_by: null,
    email_not_synced: null,
    ...over,
  };
}

const page = (results: unknown[]) => ({ data: { count: results.length, next: null, previous: null, results } });
const http = (status: number, data?: unknown) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });

let client: QueryClient;
function renderPage() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<SoulCredentialsPage />, { wrapper: Wrapper });
}

const asRole = (...permissions: string[]) => (mockUser = { id: 2, username: "op", role: "GUARDIAN", permissions });
const asManager = () => asRole("soul_account.read", "soul_account.manage");

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  soulAccountsApi.credentials.mockResolvedValue(page([credential()]));
});

describe("access", () => {
  it("refuses the page without soul_account.read and asks the API nothing", () => {
    asRole("soul.read");
    renderPage();
    expect(screen.getByText(tZh("permission.denied_title"))).toBeInTheDocument();
    expect(soulAccountsApi.credentials).not.toHaveBeenCalled();
  });

  it("read-only: the rows, but no reveal, retry, deliver or reset control", async () => {
    asRole("soul_account.read");
    soulAccountsApi.credentials.mockResolvedValue(
      page([credential(), credential({ id: "c2", status: "REVEALED" }), credential({ id: "c3", status: "VOID", expires_at: PAST })])
    );
    renderPage();
    await screen.findAllByText("张三");
    expect(screen.queryByRole("button", { name: tZh("soul_accounts.credentials.actions.reveal") })).toBeNull();
    expect(screen.queryByRole("button", { name: tZh("soul_accounts.credentials.actions.retry") })).toBeNull();
    expect(screen.queryByRole("button", { name: tZh("soul_accounts.credentials.actions.mark_delivered") })).toBeNull();
    expect(screen.queryByRole("link", { name: tZh("soul_accounts.credentials.actions.go_reset") })).toBeNull();
    expect(screen.getByText(new RegExp(tZh("soul_accounts.credentials.manage_hint").replace(/\./g, "\\.")))).toBeInTheDocument();
  });

  it("manage: each control on the row whose status allows it, and only there", async () => {
    asManager();
    soulAccountsApi.credentials.mockResolvedValue(
      page([credential(), credential({ id: "c2", status: "REVEALED" }), credential({ id: "c3", status: "VOID", expires_at: PAST })])
    );
    const { container } = renderPage();
    await screen.findAllByText("张三");
    const row = (id: string) => within(container.querySelector(`[data-credential-id="${id}"]`) as HTMLElement);
    expect(row("c1").getByRole("button", { name: tZh("soul_accounts.credentials.actions.reveal") })).toBeInTheDocument();
    expect(row("c1").getByRole("button", { name: tZh("soul_accounts.credentials.actions.retry") })).toBeInTheDocument();
    expect(row("c1").queryByRole("button", { name: tZh("soul_accounts.credentials.actions.mark_delivered") })).toBeNull();
    expect(row("c2").getByRole("button", { name: tZh("soul_accounts.credentials.actions.mark_delivered") })).toBeInTheDocument();
    expect(row("c2").queryByRole("button", { name: tZh("soul_accounts.credentials.actions.reveal") })).toBeNull();
    // The expired row: a status, the reason, and the way out — never a reveal.
    expect(row("c3").getByText(tZh("soul_accounts.credentials.reason.expired"))).toBeInTheDocument();
    expect(row("c3").getByRole("link", { name: tZh("soul_accounts.credentials.actions.go_reset") })).toHaveAttribute(
      "href",
      "/souls/s1#soul-account"
    );
    expect(row("c3").queryByRole("button", { name: tZh("soul_accounts.credentials.actions.reveal") })).toBeNull();
  });
});

describe("email_not_synced", () => {
  it("warns on the flagged row and in the reveal confirm, and nowhere else", async () => {
    asManager();
    soulAccountsApi.credentials.mockResolvedValue(page([credential({ email_not_synced: "taken" }), credential({ id: "c2" })]));
    const { container } = renderPage();
    await screen.findAllByText("张三");
    const row = (id: string) => within(container.querySelector(`[data-credential-id="${id}"]`) as HTMLElement);
    const copy = tZh("soul_accounts.account.email_not_synced");
    expect(copy).toBe("邮箱已被其他账号占用，未同步为登录邮箱：这个灵魂只能找殿司重设密码");
    expect(row("c1").getByRole("note")).toHaveTextContent(copy);
    expect(row("c2").queryByRole("note")).toBeNull();
    fireEvent.click(row("c1").getByRole("button", { name: tZh("soul_accounts.credentials.actions.reveal") }));
    expect(within(await screen.findByRole("dialog")).getByRole("note")).toHaveTextContent(copy);
  });
});

describe("reveal: once, and gone when the dialog closes", () => {
  async function openConfirm() {
    fireEvent.click(await screen.findByRole("button", { name: tZh("soul_accounts.credentials.actions.reveal") }));
    return screen.findByRole("dialog");
  }

  it("confirms first and says it is one time only; nothing is requested before the confirm", async () => {
    asManager();
    renderPage();
    const dialog = await openConfirm();
    expect(within(dialog).getByText(/只能查看一次/)).toBeInTheDocument();
    expect(soulAccountsApi.revealCredential).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("common.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(soulAccountsApi.revealCredential).not.toHaveBeenCalled();
  });

  it("shows the plaintext once, keeps it out of every cache and store, and cannot show it again after closing", async () => {
    asManager();
    soulAccountsApi.revealCredential.mockResolvedValue({ data: { soul_code: "ABCDEFGH23", password: SECRET, expires_at: FUTURE } });
    renderPage();
    const dialog = await openConfirm();
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("soul_accounts.reveal.confirm") }));
    expect(await screen.findByTestId("revealed-password")).toHaveTextContent(SECRET);
    expect(soulAccountsApi.revealCredential).toHaveBeenCalledTimes(1);
    expect(soulAccountsApi.revealCredential).toHaveBeenCalledWith("c1");

    // Not in any cache or store while it is on screen.
    const cached = JSON.stringify([
      client.getQueryCache().getAll().map((q) => q.state.data),
      client.getMutationCache().getAll().map((m) => m.state.data),
    ]);
    expect(cached).not.toContain(SECRET);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(SECRET);
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(SECRET);

    fireEvent.click(screen.getByRole("button", { name: tZh("soul_accounts.reveal.close") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByText(SECRET)).toBeNull();

    // Opening the same row again starts from the confirmation, not from the plaintext.
    await openConfirm();
    expect(screen.queryByText(SECRET)).toBeNull();
    expect(screen.queryByTestId("revealed-password")).toBeNull();
    expect(soulAccountsApi.revealCredential).toHaveBeenCalledTimes(1);
  });

  it("a second reveal (409) says it was already viewed and shows no password", async () => {
    asManager();
    soulAccountsApi.revealCredential.mockRejectedValue(
      http(409, { detail: "明文已被查看过或已发送", code: "credential_not_revealable" })
    );
    renderPage();
    const dialog = await openConfirm();
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("soul_accounts.reveal.confirm") }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("soul_accounts.reveal.already_revealed"), "error"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByTestId("revealed-password")).toBeNull();
    // The list is asked again so the row shows its new status.
    await waitFor(() => expect(soulAccountsApi.credentials).toHaveBeenCalledTimes(2));
  });

  it("an expired credential (410) points at reset", async () => {
    asManager();
    soulAccountsApi.revealCredential.mockRejectedValue(http(410, { detail: "过期", code: "credential_expired" }));
    renderPage();
    const dialog = await openConfirm();
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("soul_accounts.reveal.confirm") }));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(tZh("soul_accounts.credentials.expired_go_reset"), "error")
    );
  });

  it("marks delivered straight from the shown password, then closes", async () => {
    asManager();
    soulAccountsApi.revealCredential.mockResolvedValue({ data: { soul_code: "ABCDEFGH23", password: SECRET, expires_at: FUTURE } });
    soulAccountsApi.markDelivered.mockResolvedValue({ data: credential({ status: "DELIVERED" }) });
    renderPage();
    const dialog = await openConfirm();
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("soul_accounts.reveal.confirm") }));
    fireEvent.click(await screen.findByRole("button", { name: tZh("soul_accounts.reveal.deliver_and_close") }));
    await waitFor(() => expect(soulAccountsApi.markDelivered).toHaveBeenCalledWith("c1"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByText(SECRET)).toBeNull();
  });
});

describe("retry and deliver", () => {
  it("retry that went out says sent; one that did not says why", async () => {
    asManager();
    soulAccountsApi.retry.mockResolvedValueOnce({ data: credential({ status: "SENT", channel: "EMAIL" }) });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: tZh("soul_accounts.credentials.actions.retry") }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("soul_accounts.credentials.retry_sent"), "success"));

    soulAccountsApi.retry.mockResolvedValueOnce({ data: credential({ status: "PENDING", last_error: "SMTPException", attempts: 2 }) });
    fireEvent.click(await screen.findByRole("button", { name: tZh("soul_accounts.credentials.actions.retry") }));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        tZh("soul_accounts.credentials.reason.send_failed", { error: "SMTPException", attempts: "2" }),
        "info"
      )
    );
  });

  it("deliver refused (409) is reported by its code", async () => {
    asManager();
    soulAccountsApi.credentials.mockResolvedValue(page([credential({ status: "REVEALED" })]));
    soulAccountsApi.markDelivered.mockRejectedValue(http(409, { detail: "x", code: "credential_not_revealed" }));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: tZh("soul_accounts.credentials.actions.mark_delivered") }));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(tZh("soul_accounts.credentials.deliver_not_revealed"), "error")
    );
  });
});

describe("loading, error, empty and filtered are different screens", () => {
  it("a failed request shows the error with a retry, not the empty state", async () => {
    asManager();
    soulAccountsApi.credentials.mockRejectedValue(http(500));
    renderPage();
    expect(await screen.findByRole("button", { name: tZh("error.retry") })).toBeInTheDocument();
    expect(screen.queryByText(tZh("soul_accounts.credentials.empty.pending"))).toBeNull();
  });

  it("nothing pending says so, and a filter with nothing says something else", async () => {
    asManager();
    soulAccountsApi.credentials.mockResolvedValue(page([]));
    renderPage();
    expect(await screen.findByText(tZh("soul_accounts.credentials.empty.pending"))).toBeInTheDocument();
    expect(soulAccountsApi.credentials).toHaveBeenLastCalledWith({ status: "PENDING", page: 1 });
    fireEvent.click(screen.getByRole("button", { name: tZh("soul_accounts.credentials.filters.DELIVERED") }));
    expect(await screen.findByText(tZh("soul_accounts.credentials.empty.filtered"))).toBeInTheDocument();
    expect(screen.queryByText(tZh("soul_accounts.credentials.empty.pending"))).toBeNull();
    expect(soulAccountsApi.credentials).toHaveBeenLastCalledWith({ status: "DELIVERED", page: 1 });
  });
});

it("an unknown status renders as unrecognized with the raw member in title", async () => {
  asManager();
  soulAccountsApi.credentials.mockResolvedValue(page([credential({ status: "LOST_IN_DUAT" })]));
  renderPage();
  const badge = await screen.findByTitle("LOST_IN_DUAT");
  expect(badge).toHaveTextContent(tZh("common.value.unrecognized"));
  expect(screen.queryByText("LOST_IN_DUAT")).toBeNull();
  // An unknown status offers no action at all.
  expect(screen.queryByRole("button", { name: tZh("soul_accounts.credentials.actions.reveal") })).toBeNull();
});

describe("print the delivery slip", () => {
  const PRINT = () => tZh("soul_accounts.credentials.print_slip");
  const REPRINT = () => tZh("soul_accounts.credentials.reprint_slip");
  const SLIP = {
    soul_name: "张三",
    soul_code: "ABCDEFGH23",
    home_tenant: { code: "cn", display_name: "Chinese Afterlife", hall_names: { "zh-Hans": "酆都 · 第二殿" }, seal_glyphs: [] },
    expires_at: FUTURE,
    officer_name: "书吏阿尼",
    printed_at: "2026-10-11T01:00:00Z",
  };
  let printSpy: jest.SpyInstance;
  beforeEach(() => {
    printSpy = jest.spyOn(window, "print").mockImplementation(() => undefined);
  });
  afterEach(() => printSpy.mockRestore());

  const rows = async (...list: unknown[]) => {
    soulAccountsApi.credentials.mockResolvedValue(page(list));
    const { container } = renderPage();
    await screen.findAllByText("张三");
    return (id: string) => within(container.querySelector(`[data-credential-id="${id}"]`) as HTMLElement);
  };
  const labels = (row: ReturnType<typeof within>) =>
    row.queryAllByRole("button").map((b: HTMLElement) => b.textContent);

  it("the entry shows per status: print on PENDING and REVEALED, reprint on DELIVERED, nothing on VOID or expired", async () => {
    asManager();
    const row = await rows(
      credential({ id: "p" }),
      credential({ id: "r", status: "REVEALED" }),
      credential({ id: "d", status: "DELIVERED" }),
      credential({ id: "d-old", status: "DELIVERED", expires_at: PAST }),
      credential({ id: "v", status: "VOID", expires_at: PAST }),
      credential({ id: "p-old", expires_at: PAST }),
    );
    expect(labels(row("p"))).toEqual([tZh("soul_accounts.credentials.actions.reveal"), tZh("soul_accounts.credentials.actions.retry"), PRINT()]);
    // Between view-password / retry and mark-delivered.
    expect(labels(row("r"))).toEqual([PRINT(), tZh("soul_accounts.credentials.actions.mark_delivered")]);
    expect(labels(row("d"))).toEqual([REPRINT()]);
    for (const id of ["d-old", "v", "p-old"]) expect(labels(row(id))).toEqual([]);
  });

  it("without soul_account.manage there is no print entry", async () => {
    asRole("soul_account.read");
    await rows(credential({ id: "p" }), credential({ id: "d", status: "DELIVERED" }));
    expect(screen.queryByRole("button", { name: PRINT() })).toBeNull();
    expect(screen.queryByRole("button", { name: REPRINT() })).toBeNull();
  });

  it("asks the server first, then prints the returned slip with no password anywhere, and unmounts it", async () => {
    asManager();
    soulAccountsApi.printSlip.mockResolvedValue({ data: SLIP });
    let slipDuringPrint = "";
    printSpy.mockImplementation(() => {
      slipDuringPrint = document.querySelector('[data-testid="delivery-slip"]')?.textContent ?? "";
    });
    const row = await rows(credential({ id: "p" }));
    fireEvent.click(row("p").getByRole("button", { name: PRINT() }));
    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));
    expect(soulAccountsApi.printSlip).toHaveBeenCalledWith("p");
    expect(slipDuringPrint).toContain("ABC DEFG H23");
    expect(slipDuringPrint).toContain("书吏阿尼");
    expect(slipDuringPrint).toContain("酆都 · 第二殿");
    expect(slipDuringPrint).not.toContain(SECRET);
    // Printing changes nothing on the row: the list is not asked again.
    expect(soulAccountsApi.credentials).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.querySelector('[data-testid="delivery-slip"]')).toBeNull());
  });

  describe("colour accent switch", () => {
    // TODO(design): the label has no language-pack entry yet, so the switch only renders once a bundle supplies it;
    // the tests supply it themselves, under the key the page looks up.
    const KEY = "soul_accounts.credentials.slip_color";
    const realT = mockI18n.t;
    beforeEach(() => {
      mockI18n.t = ((key: string, params?: Record<string, string>) => (key === KEY ? "彩色点缀" : realT(key, params))) as typeof realT;
    });
    afterEach(() => {
      mockI18n.t = realT;
    });

    it("is off by default, remembers a tick on this computer, and the slip is printed in colour only after that", async () => {
      asManager();
      soulAccountsApi.printSlip.mockResolvedValue({ data: SLIP });
      let colour: string | null = "unset";
      printSpy.mockImplementation(() => {
        colour = document.querySelector('[data-testid="delivery-slip"]')?.getAttribute("data-slip-color") ?? null;
      });
      const row = await rows(credential({ id: "p" }));
      const box = screen.getByRole("checkbox", { name: "彩色点缀" });
      expect(box).not.toBeChecked();

      fireEvent.click(row("p").getByRole("button", { name: PRINT() }));
      await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));
      expect(colour).toBeNull();

      fireEvent.click(box);
      expect(box).toBeChecked();
      expect(window.localStorage.getItem("soulledger.slip.color")).toBe("1");
      fireEvent.click(row("p").getByRole("button", { name: PRINT() }));
      await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(2));
      expect(colour).toBe("");
    });

    it("reads the remembered choice back on the next visit, and a storage that throws counts as off", async () => {
      asManager();
      window.localStorage.setItem("soulledger.slip.color", "1");
      await rows(credential({ id: "p" }));
      await waitFor(() => expect(screen.getByRole("checkbox", { name: "彩色点缀" })).toBeChecked());

      const get = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      try {
        document.body.innerHTML = "";
        await rows(credential({ id: "q" }));
        expect(screen.getByRole("checkbox", { name: "彩色点缀" })).not.toBeChecked();
      } finally {
        get.mockRestore();
      }
    });

    it("is not offered without soul_account.manage", async () => {
      asRole("soul_account.read");
      await rows(credential({ id: "p" }));
      expect(screen.queryByRole("checkbox", { name: "彩色点缀" })).toBeNull();
    });
  });

  it("without a language-pack entry for the switch there is no switch (no raw key on screen)", async () => {
    asManager();
    await rows(credential({ id: "p" }));
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("a failed request prints nothing and says so", async () => {
    asManager();
    soulAccountsApi.printSlip.mockRejectedValue(http(500));
    const row = await rows(credential({ id: "p" }));
    fireEvent.click(row("p").getByRole("button", { name: PRINT() }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("soul_accounts.credentials.print_failed"), "error"));
    expect(printSpy).not.toHaveBeenCalled();
  });

  it("a 409 shows the backend's own reason, and prints nothing", async () => {
    asManager();
    soulAccountsApi.printSlip.mockRejectedValue(http(409, { detail: "这份初始密码已作废。", code: "credential_void" }));
    const row = await rows(credential({ id: "p" }));
    fireEvent.click(row("p").getByRole("button", { name: PRINT() }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("这份初始密码已作废。", "error"));
    expect(printSpy).not.toHaveBeenCalled();
  });

  it("shows the soul code in 3-4-3 groups with a spelled-out label, never the raw ten", async () => {
    asManager();
    const row = await rows(credential({ id: "p" }));
    const shown = row("p").getByText("ABC DEFG H23");
    expect(shown).toHaveAttribute("aria-label", tZh("soul_app.login.id_aria", { spelled: "A B C，D E F G，H 2 3" }));
    expect(screen.queryByText("ABCDEFGH23")).toBeNull();
  });
});
