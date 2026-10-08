/**
 * The 开启两步验证 wizard (A12, `src/components/profile/MfaSetupWizard.tsx`): the secret is asked for
 * on step 2 (QR + grouped manual key), step 3 verifies a code and hands over the ten recovery codes,
 * 完成 stays disabled until 「我已妥善保存」 is ticked, ONLY 完成 calls `complete`, and leaving at any
 * step calls `cancelSetup` and never `complete`. The footnote 「中途退出不会开启」 is on every step.
 *
 * Written 2026-10-09 and NOT run (user instruction: write, don't run).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { mfaApi } from "@soulledger/core/api";
import { MfaSetupWizard, groupKey } from "@/src/components/profile/MfaSetupWizard";

jest.mock("@soulledger/core/api", () => ({
  mfaApi: { setup: jest.fn(), cancelSetup: jest.fn(), confirm: jest.fn(), complete: jest.fn() },
}));
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => (params ? `${key}(${Object.values(params).join(",")})` : key),
    locale: "zh-Hans",
    hydrated: true,
  }),
}));

const setup = mfaApi.setup as jest.Mock;
const cancelSetup = mfaApi.cancelSetup as jest.Mock;
const confirm = mfaApi.confirm as jest.Mock;
const complete = mfaApi.complete as jest.Mock;

const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const CODES = ["aaaa-bbbb", "cccc-dddd", "eeee-ffff", "gggg-hhhh", "jjjj-kkkk", "mmmm-nnnn", "pppp-qqqq", "rrrr-ssss", "tttt-uuuu", "vvvv-wwww"];

beforeEach(() => {
  jest.clearAllMocks();
  setup.mockResolvedValue({ data: { secret: SECRET, otpauth_url: `otpauth://totp/SoulLedger%3Ayama?secret=${SECRET}&issuer=SoulLedger` } });
  cancelSetup.mockResolvedValue({ data: { detail: "setup discarded" } });
  confirm.mockResolvedValue({ data: { recovery_codes: CODES } });
  complete.mockResolvedValue({ data: { enabled: true } });
});

function renderWizard() {
  const onClose = jest.fn();
  const onEnabled = jest.fn();
  render(<MfaSetupWizard username="yama" onClose={onClose} onEnabled={onEnabled} />);
  return { onClose, onEnabled };
}

const next = () => fireEvent.click(screen.getByRole("button", { name: "mfa.setup.next" }));
const wizard = () => screen.getByTestId("mfa-wizard");

async function goToStep4() {
  next(); // 1 → 2
  await waitFor(() => expect(setup).toHaveBeenCalledTimes(1));
  await screen.findByTestId("mfa-manual-key");
  next(); // 2 → 3
  expect(wizard().getAttribute("data-step")).toBe("3");
  fireEvent.change(screen.getByLabelText(/mfa\.verify\.code_label/), { target: { value: "123456" } });
  await waitFor(() => expect(confirm).toHaveBeenCalledWith("123456"));
  await screen.findByTestId("mfa-recovery-codes");
  expect(wizard().getAttribute("data-step")).toBe("4");
}

describe("groupKey", () => {
  it("groups the base32 key by four for hand entry", () => {
    expect(groupKey("JBSWY3DPEHPK3PXP")).toBe("JBSW Y3DP EHPK 3PXP");
  });
});

describe("MfaSetupWizard", () => {
  it("opens on step 1 with a four-segment step bar and the exit footnote, and asks for no secret yet", () => {
    renderWizard();
    expect(wizard().getAttribute("data-step")).toBe("1");
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText("mfa.setup.exit_note")).toBeTruthy();
    expect(setup).not.toHaveBeenCalled();
  });

  it("step 2 fetches the secret once and shows the QR and the grouped manual key", async () => {
    renderWizard();
    next();
    await screen.findByTestId("mfa-manual-key");
    expect(setup).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("mfa-manual-key").textContent).toBe(groupKey(SECRET));
    expect(screen.getByTestId("mfa-qr").tagName.toLowerCase()).toBe("svg");
    expect((screen.getByRole("link", { name: /mfa\.setup\.step2_open/ }) as HTMLAnchorElement).getAttribute("href")).toMatch(/^otpauth:\/\/totp\//);
    expect(screen.getByText("mfa.setup.exit_note")).toBeTruthy();
    // going back and forward again does not re-issue the secret
    fireEvent.click(screen.getByRole("button", { name: "mfa.setup.back" }));
    next();
    await screen.findByTestId("mfa-manual-key");
    expect(setup).toHaveBeenCalledTimes(1);
  });

  it("step 3: a wrong code shows the clock hint and stays on step 3", async () => {
    confirm.mockRejectedValueOnce({ response: { status: 400, data: { code: "wrong" } } });
    renderWizard();
    next();
    await screen.findByTestId("mfa-manual-key");
    next();
    fireEvent.change(screen.getByLabelText(/mfa\.verify\.code_label/), { target: { value: "000000" } });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("mfa.setup.step3_error");
    expect(wizard().getAttribute("data-step")).toBe("3");
    expect(complete).not.toHaveBeenCalled();
  });

  it("step 4: 完成 is disabled until the saved box is ticked; only 完成 turns it on", async () => {
    const { onEnabled } = renderWizard();
    await goToStep4();
    expect(screen.getAllByRole("listitem").filter((li) => CODES.includes(li.textContent ?? ""))).toHaveLength(10);
    expect(screen.getByText("mfa.setup.exit_note")).toBeTruthy();
    const finish = screen.getByTestId("mfa-finish") as HTMLButtonElement;
    expect(finish.disabled).toBe(true);
    expect(complete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("mfa.setup.saved_check"));
    expect(finish.disabled).toBe(false);
    fireEvent.click(finish);
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    await screen.findByTestId("mfa-done");
    expect(onEnabled).toHaveBeenCalledTimes(1);
    expect(cancelSetup).not.toHaveBeenCalled();
  });

  it("leaving at step 4 — codes already shown — voids the setup: cancelSetup, never complete", async () => {
    const { onClose, onEnabled } = renderWizard();
    await goToStep4();
    fireEvent.click(screen.getByRole("button", { name: "common.close" }));
    expect(cancelSetup).toHaveBeenCalledTimes(1);
    expect(complete).not.toHaveBeenCalled();
    expect(onEnabled).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaving at step 1 also tells the server, so nothing half-made lingers", () => {
    const { onClose } = renderWizard();
    fireEvent.click(screen.getByRole("button", { name: "common.close" }));
    expect(cancelSetup).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closing after 完成 does not cancel what was just turned on", async () => {
    renderWizard();
    await goToStep4();
    fireEvent.click(screen.getByLabelText("mfa.setup.saved_check"));
    fireEvent.click(screen.getByTestId("mfa-finish"));
    await screen.findByTestId("mfa-done");
    // Two closes now: the Esc chip in the header and the footer button; either is fine.
    fireEvent.click(screen.getAllByRole("button", { name: "common.close" })[0]);
    expect(cancelSetup).not.toHaveBeenCalled();
  });
});
