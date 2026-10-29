/**
 * 第五十四批(殿管理员):/accept-invite 落地页、移交在途案件对话框、停用前的移交提示。
 * 邀请只能由管理员重发,所以失效页不给「再要一个链接」;预览一变就重取,按钮写总件数。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import AcceptInvitePage from "@/app/(auth)/accept-invite/page";
import { OfficerHandoverDialog } from "@/src/components/users/OfficerHandoverDialog";
import { authApi, handoverApi, usersApi, type User } from "@soulledger/core/api";

jest.mock("@soulledger/core/api", () => ({
  authApi: { acceptOfficerInvite: jest.fn() },
  handoverApi: { officers: jest.fn(), preview: jest.fn(), commit: jest.fn() },
  usersApi: { list: jest.fn(), deactivate: jest.fn() },
  officerRefusalOf: (error: { response?: { data?: { code?: string } } }) =>
    error?.response?.data?.code ? { code: error.response.data.code } : null,
  handoverProblemsOf: (error: { response?: { status?: number; data?: { problems?: string[] } } }) =>
    error?.response?.status === 409 ? (error.response.data?.problems ?? null) : null,
}));
jest.mock("@soulledger/core/api/auth", () => ({
  passwordReasonKeys: (body: { new_password?: { code: string }[] }) => (body.new_password ?? []).map((r) => `reason.${r.code}`),
  splitCommonReasons: jest.fn(),
}));
jest.mock("@/src/contexts/I18nContext", () => ({
  LOCALE_LABELS: {},
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => (params ? `${key}(${Object.values(params).join(",")})` : key),
    formatDate: () => "",
    locale: "zh-Hans",
    hydrated: true,
    setLocale: jest.fn(),
  }),
}));
jest.mock("@/src/components/ui/Toast", () => ({ showToast: jest.fn() }));

const accept = authApi.acceptOfficerInvite as jest.Mock;
const preview = handoverApi.preview as jest.Mock;
const commit = handoverApi.commit as jest.Mock;
const list = usersApi.list as jest.Mock;
const officers = handoverApi.officers as jest.Mock;
const row = (id: number, name: string) => ({ id, display_name: name, role_display: "判官" });
const HALL = { data: [row(1, "alice"), row(2, "bob")] };
const deactivate = usersApi.deactivate as jest.Mock;

const officer = (id: number, username: string): User => ({ id, username, email: `${username}@x.test`, role: "JUDGE", is_active: true, tenant: { id: 1, code: "h", display_name: "H" } });

beforeEach(() => {
  jest.clearAllMocks();
  window.history.pushState({}, "", "/");
});

describe("/accept-invite", () => {
  it("without a link shows the dead-end page, with no way to ask for another", () => {
    render(<AcceptInvitePage />);
    expect(screen.getByTestId("accept-invite-invalid")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /again|request/i })).toBeNull();
    expect(screen.getByText("acceptInvite.link_note")).toBeInTheDocument();
  });

  it("lists every reason a weak password is refused for", async () => {
    window.history.pushState({}, "", "/accept-invite?uid=abc&token=tok-12345678");
    accept.mockRejectedValue({ response: { status: 400, data: { code: "weak_password", new_password: [{ code: "too_short" }, { code: "numeric" }] } } });
    render(<AcceptInvitePage />);
    const pw = screen.getByLabelText(/acceptInvite\.new_password/);
    fireEvent.change(pw, { target: { value: "Str0ng-enough-pass!" } });
    fireEvent.change(screen.getByLabelText(/acceptInvite\.confirm_password/), { target: { value: "Str0ng-enough-pass!" } });
    fireEvent.click(screen.getByRole("button", { name: "acceptInvite.submit" }));
    const box = await screen.findByTestId("accept-invite-weak");
    expect(box).toHaveTextContent("reason.too_short");
    expect(box).toHaveTextContent("reason.numeric");
    expect(accept).toHaveBeenCalledWith({ uid: "abc", token: "tok-12345678", new_password: "Str0ng-enough-pass!" });
  });

  it("disables the button and counts down on 429", async () => {
    window.history.pushState({}, "", "/accept-invite?uid=abc&token=tok-12345678");
    accept.mockRejectedValue({ response: { status: 429, data: { code: "rate_limited", retry_after: 30 } } });
    render(<AcceptInvitePage />);
    fireEvent.change(screen.getByLabelText(/acceptInvite\.new_password/), { target: { value: "Str0ng-enough-pass!" } });
    fireEvent.change(screen.getByLabelText(/acceptInvite\.confirm_password/), { target: { value: "Str0ng-enough-pass!" } });
    fireEvent.click(screen.getByRole("button", { name: "acceptInvite.submit" }));
    expect(await screen.findByText("acceptInvite.rate_limited(30)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "acceptInvite.submit" })).toBeDisabled();
  });
});

describe("OfficerHandoverDialog", () => {
  const renderDialog = () =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <OfficerHandoverDialog from={officer(1, "alice")} onClose={jest.fn()} />
      </QueryClientProvider>,
    );
  const pickTarget = async () => {
    const select = (await screen.findAllByRole("combobox"))[1];
    await within(select).findByRole("option", { name: "bob" });
    fireEvent.change(select, { target: { value: "2" } });
  };

  beforeEach(() => officers.mockResolvedValue(HALL));

  it("previews on its own once both people are picked, notes pooled appeals, and writes the total on the button", async () => {
    preview.mockResolvedValue({ data: { judgments: 3, appeals: 2, appeals_returned_to_pool: 1, city_gods: ["城隍甲"], letters: 4, problems: [] } });
    renderDialog();
    await pickTarget();
    expect(await screen.findByTestId("handover-preview")).toBeInTheDocument();
    expect(preview).toHaveBeenCalledWith(1, 2);
    expect(screen.getByTestId("handover-pool")).toHaveTextContent("officerHandover.returned_to_pool(1)");
    expect(screen.getByTestId("handover-submit")).toHaveTextContent("officerHandover.submit_n(11)");
    expect(screen.getByTestId("handover-submit")).toBeEnabled();
  });

  it("blocks submit and names the problem when the target cannot take the work", async () => {
    preview.mockResolvedValue({ data: { judgments: 1, appeals: 0, appeals_returned_to_pool: 0, city_gods: [], letters: 0, problems: ["target_cannot_judge"] } });
    renderDialog();
    await pickTarget();
    expect(await screen.findByTestId("handover-blocked")).toHaveTextContent("officerHandover.problem.target_cannot_judge(bob)");
    expect(screen.getByTestId("handover-submit")).toBeDisabled();
  });

  it("shows the empty sentence, not a table of zeros, when nothing is open", async () => {
    preview.mockResolvedValue({ data: { judgments: 0, appeals: 0, appeals_returned_to_pool: 0, city_gods: [], letters: 0, problems: [] } });
    renderDialog();
    await pickTarget();
    expect(await screen.findByTestId("handover-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("handover-preview")).toBeNull();
    expect(screen.getByTestId("handover-submit")).toBeDisabled();
  });

  it("reports fewer-than-previewed moves and the pool count after submit", async () => {
    preview.mockResolvedValue({ data: { judgments: 3, appeals: 0, appeals_returned_to_pool: 0, city_gods: [], letters: 0, problems: [] } });
    commit.mockResolvedValue({ data: { judgments: 2, appeals: 0, appeals_returned_to_pool: 1, city_gods: 0, letters: 0 } });
    renderDialog();
    await pickTarget();
    // The button stays disabled until the preview is in.
    await waitFor(() => expect(screen.getByTestId("handover-submit")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("handover-submit"));
    await waitFor(() => expect(screen.getByTestId("handover-result")).toBeInTheDocument());
    expect(screen.getByText("officerHandover.result_pool(1)")).toBeInTheDocument();
    // 3 previewed, 3 moved (2 + 1 to the pool): nothing fewer.
    expect(screen.queryByText("officerHandover.result_fewer")).toBeNull();
  });

  // 第 22 条:操作人不持 soul_inbox.reply,书信不移交 —— 预览与结果都说留下了几封;0 封时一句都不说。
  it("says how many letters stay with the giver when the operator cannot reply", async () => {
    preview.mockResolvedValue({ data: { judgments: 2, appeals: 0, appeals_returned_to_pool: 0, city_gods: [], letters: 0, letters_kept: 3, problems: [] } });
    commit.mockResolvedValue({ data: { judgments: 2, appeals: 0, appeals_returned_to_pool: 0, city_gods: 0, letters: 0, letters_kept: 3 } });
    renderDialog();
    await pickTarget();
    expect(await screen.findByTestId("handover-letters-kept")).toHaveTextContent("officerHandover.letters_kept(3,alice)");
    // Kept letters are not counted on the button.
    expect(screen.getByTestId("handover-submit")).toHaveTextContent("officerHandover.submit_n(2)");
    fireEvent.click(screen.getByTestId("handover-submit"));
    expect(await screen.findByTestId("handover-result-letters-kept")).toHaveTextContent("officerHandover.result_letters_kept(3)");
  });

  it("says nothing about kept letters when none were kept", async () => {
    preview.mockResolvedValue({ data: { judgments: 1, appeals: 0, appeals_returned_to_pool: 0, city_gods: [], letters: 2, letters_kept: 0, problems: [] } });
    commit.mockResolvedValue({ data: { judgments: 1, appeals: 0, appeals_returned_to_pool: 0, city_gods: 0, letters: 2, letters_kept: 0 } });
    renderDialog();
    await pickTarget();
    expect(await screen.findByTestId("handover-preview")).toBeInTheDocument();
    expect(screen.queryByTestId("handover-letters-kept")).toBeNull();
    fireEvent.click(screen.getByTestId("handover-submit"));
    await screen.findByTestId("handover-result");
    expect(screen.queryByTestId("handover-result-letters-kept")).toBeNull();
  });

  // rbac-web M-7:人选走 judgment.assign 的接口,按交出人的殿问;不再读 users/(ADMIN + user.manage)。
  it("asks the handover officer list for the giver's hall, not the admin-only user list", async () => {
    renderDialog();
    await pickTarget();
    expect(officers).toHaveBeenCalledWith(1);
    expect(list).not.toHaveBeenCalled();
  });

  it("without a giver (opened from the queue by a hall lead) both people are picked, then it previews", async () => {
    preview.mockResolvedValue({ data: { judgments: 1, appeals: 0, appeals_returned_to_pool: 0, city_gods: [], letters: 0, problems: [] } });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <OfficerHandoverDialog onClose={jest.fn()} />
      </QueryClientProvider>,
    );
    const [giver, taker] = await screen.findAllByRole("combobox");
    await within(giver).findByRole("option", { name: "alice" });
    expect(officers).toHaveBeenCalledWith(undefined);
    expect(preview).not.toHaveBeenCalled();
    fireEvent.change(giver, { target: { value: "1" } });
    fireEvent.change(taker, { target: { value: "2" } });
    expect(await screen.findByTestId("handover-preview")).toBeInTheDocument();
    expect(preview).toHaveBeenCalledWith(1, 2);
  });
});

describe("OfficerHandoverDialog, opened from deactivation", () => {
  beforeEach(() => officers.mockResolvedValue(HALL));

  it("locks the source and deactivates with the receiver in one call, never the bare handover", async () => {
    preview.mockResolvedValue({ data: { judgments: 1, appeals: 0, appeals_returned_to_pool: 0, city_gods: [], letters: 0, problems: [] } });
    deactivate.mockResolvedValue({ data: officer(1, "alice") });
    const onClose = jest.fn();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <OfficerHandoverDialog from={officer(1, "alice")} deactivate onClose={onClose} />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("handover-deactivate-prompt")).toHaveTextContent("officerHandover.deactivate_prompt(alice)");
    const [source, target] = await screen.findAllByRole("combobox");
    expect(source).toBeDisabled();
    await within(target).findByRole("option", { name: "bob" });
    fireEvent.change(target, { target: { value: "2" } });
    await waitFor(() => expect(screen.getByTestId("handover-submit")).toHaveTextContent("officerHandover.submit_and_deactivate_n(1)"));
    fireEvent.click(screen.getByTestId("handover-submit"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(deactivate).toHaveBeenCalledWith("1", 2);
    expect(commit).not.toHaveBeenCalled();
  });
});
