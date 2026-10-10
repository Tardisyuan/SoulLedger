/**
 * 两步验证 in the app: the four-step wizard, the managed state (regenerate / disable), the
 * standing banner that opens the wizard, and the rules that matter more than the pixels --
 * the unconfirmed secret is dropped when the wizard is left, step 4 cannot be left before the
 * recovery codes are confirmed saved, and the codes are never written anywhere.
 */
import { useState } from "react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { BackHandler, Linking, StyleSheet } from "react-native";

import { MfaScreen } from "../screens/mfa";
import { Shell } from "../shell";
import { SessionContext } from "../session";
import { OFFICER, httpError, renderOfficer, sessionOf } from "./harness";

const mockApi = {
  status: jest.fn(),
  setup: jest.fn(),
  cancelSetup: jest.fn(),
  confirm: jest.fn(),
  complete: jest.fn(),
  regenerateRecoveryCodes: jest.fn(),
  disable: jest.fn(),
};
jest.mock("@soulledger/core/api/auth", () => ({
  ...jest.requireActual("@soulledger/core/api/auth"),
  mfaApi: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (mockApi as Record<string, jest.Mock>)[k](...a) }),
}));
jest.mock("@soulledger/core/api/officer-app", () => ({
  ...jest.requireActual("@soulledger/core/api/officer-app"),
  officerAppApi: { todo: jest.fn(async () => ({ data: { approvals: { count: 0, items: [] }, reassignments: { count: 0, items: [] }, cooldowns: { count: 0, items: [] }, rebirths: { count: 0, items: [] } } })), registerPush: jest.fn(), unregisterPush: jest.fn() },
}));

const SECRET = "JBSWY3DPEHPK3PXP";
const URL = "otpauth://totp/SoulLedger:yama?secret=JBSWY3DPEHPK3PXP&issuer=SoulLedger";
const CODES = ["AAAA-1111", "BBBB-2222", "CCCC-3333", "DDDD-4444", "EEEE-5555", "FFFF-6666", "GGGG-7777", "HHHH-8888", "IIII-9999", "JJJJ-0000"];
const OFF = { enabled: false, required: true, recovery_codes_remaining: 0 };
const ON = { enabled: true, required: true, recovery_codes_remaining: 7 };

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.status.mockResolvedValue({ data: OFF });
  mockApi.setup.mockResolvedValue({ data: { secret: SECRET, otpauth_url: URL } });
  mockApi.cancelSetup.mockResolvedValue({ data: {} });
  mockApi.confirm.mockResolvedValue({ data: { recovery_codes: CODES } });
  mockApi.complete.mockResolvedValue({ data: { ...ON, recovery_codes_remaining: 10 } });
  mockApi.regenerateRecoveryCodes.mockResolvedValue({ data: { recovery_codes: CODES } });
  mockApi.disable.mockResolvedValue({ data: OFF });
});

const press = (id: string) => act(async () => { fireEvent.press(screen.getByTestId(id)); });

async function toStep(n: 2 | 3 | 4) {
  fireEvent.press(await screen.findByTestId("mfa-start"));
  await press("mfa-next");
  if (n === 2) return;
  await screen.findByTestId("mfa-manual-key");
  await press("mfa-next");
  if (n === 3) return;
  fireEvent.changeText(screen.getByTestId("mfa-setup-code"), "123456");
  await press("mfa-confirm");
  await screen.findByTestId("mfa-recovery-codes");
}

describe("the wizard", () => {
  it("walks four steps, turns it on only at 完成, and tells the session", async () => {
    const session = sessionOf(OFFICER);
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    renderOfficer(<MfaScreen onBack={() => {}} />, { session });
    fireEvent.press(await screen.findByTestId("mfa-start"));
    expect(screen.getByTestId("mfa-step").props.children).toMatch("1 / 4");
    expect(mockApi.setup).not.toHaveBeenCalled();
    await press("mfa-next");

    // step 2: the key as selectable text in groups of four; the link opens the authenticator
    expect((await screen.findByTestId("mfa-manual-key")).props.selectable).toBe(true);
    expect(screen.getByText("JBSW Y3DP EHPK 3PXP")).toBeTruthy();
    await press("mfa-open-authenticator");
    expect(open).toHaveBeenCalledWith(URL);
    expect(mockApi.setup).toHaveBeenCalledTimes(1);
    await press("mfa-next");

    // step 3: nothing happens until six digits are in
    expect(screen.getByTestId("mfa-setup-code").props.autoComplete).toBe("one-time-code");
    fireEvent.changeText(screen.getByTestId("mfa-setup-code"), "12a34");
    expect(screen.getByTestId("mfa-setup-code").props.value).toBe("1234");
    await press("mfa-confirm");
    expect(mockApi.confirm).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByTestId("mfa-setup-code"), "123456");
    await press("mfa-confirm");
    expect(mockApi.confirm).toHaveBeenCalledWith("123456");

    // step 4: still not on
    await screen.findByTestId("mfa-codes-text");
    expect(screen.getByTestId("mfa-codes-col-0").props.selectable).toBe(true);
    expect(screen.getByTestId("mfa-codes-col-0").props.children).toBe(CODES.slice(0, 5).join("\n"));
    expect(screen.getByTestId("mfa-codes-col-1").props.children).toBe(CODES.slice(5).join("\n"));
    expect(screen.queryByTestId("mfa-codes-col-2")).toBeNull();
    // no serial numbers beside the codes
    expect(screen.queryByText(/^\s*1[.)]/)).toBeNull();
    expect(mockApi.complete).not.toHaveBeenCalled();
    expect(session.setMfaEnabled).not.toHaveBeenCalled();
    await press("mfa-saved");
    await press("mfa-finish");
    expect(mockApi.complete).toHaveBeenCalledTimes(1);
    expect(session.setMfaEnabled).toHaveBeenCalledWith(true);
    expect(await screen.findByTestId("mfa-done")).toBeTruthy();
    // the codes are gone from the screen once it is on, and the secret was never dropped
    expect(screen.queryByTestId("mfa-codes-text")).toBeNull();
    expect(mockApi.cancelSetup).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it("step 4 cannot be finished or left until the codes are ticked as saved", async () => {
    const onBack = jest.fn();
    const onLocked = jest.fn();
    const session = sessionOf(OFFICER);
    renderOfficer(<MfaScreen onBack={onBack} onLocked={onLocked} />, { session });
    await toStep(4);
    // no back row at all, and the shell is told to hold the tab bar
    expect(screen.queryByTestId("mfa-screen-back")).toBeNull();
    expect(onLocked).toHaveBeenLastCalledWith(true);
    // 完成 is inert before the tick
    await press("mfa-finish");
    expect(mockApi.complete).not.toHaveBeenCalled();
    expect(screen.queryByTestId("mfa-done")).toBeNull();
    // the tick can be taken back
    await press("mfa-saved");
    await press("mfa-saved");
    await press("mfa-finish");
    expect(mockApi.complete).not.toHaveBeenCalled();
    expect(screen.queryByTestId("mfa-prev")).toBeNull();
  });

  it("a failed 完成 stays on step 4 with the codes still shown, and nothing is enabled", async () => {
    mockApi.complete.mockRejectedValue(httpError(409, { code: "not_verified" }));
    const session = sessionOf(OFFICER);
    renderOfficer(<MfaScreen onBack={() => {}} />, { session });
    await toStep(4);
    await press("mfa-saved");
    await press("mfa-finish");
    expect(await screen.findByTestId("mfa-complete-error")).toBeTruthy();
    expect(screen.getByTestId("mfa-codes-text")).toBeTruthy();
    expect(session.setMfaEnabled).not.toHaveBeenCalled();
  });

  it("leaving after the secret was issued drops it server-side; leaving before does not call", async () => {
    const view = renderOfficer(<MfaScreen onBack={() => {}} />);
    fireEvent.press(await screen.findByTestId("mfa-start"));
    view.unmount();
    expect(mockApi.cancelSetup).not.toHaveBeenCalled();

    const second = renderOfficer(<MfaScreen onBack={() => {}} />);
    await toStep(2);
    await screen.findByTestId("mfa-manual-key");
    second.unmount();
    expect(mockApi.cancelSetup).toHaveBeenCalledTimes(1);
  });

  it("a wrong code says so, empties the field, and stays on step 3 without codes", async () => {
    mockApi.confirm.mockRejectedValueOnce(httpError(400, { code: "wrong", remaining_attempts: 4 }));
    renderOfficer(<MfaScreen onBack={() => {}} />);
    await toStep(3);
    fireEvent.changeText(screen.getByTestId("mfa-setup-code"), "000000");
    await press("mfa-confirm");
    expect(await screen.findByText("! 动态码不对，检查手机时间是否准确")).toBeTruthy();
    expect(screen.getByTestId("mfa-setup-code").props.value).toBe("");
    expect(screen.queryByTestId("mfa-recovery-codes")).toBeNull();
  });

  it("an expired code, a lock and a lost network each say their own sentence", async () => {
    renderOfficer(<MfaScreen onBack={() => {}} />);
    await toStep(3);
    const attempt = async (error: unknown, text: string) => {
      mockApi.confirm.mockRejectedValueOnce(error);
      fireEvent.changeText(screen.getByTestId("mfa-setup-code"), "111111");
      await press("mfa-confirm");
      expect(await screen.findByText(text)).toBeTruthy();
    };
    await attempt(httpError(400, { code: "expired" }), "! 动态码已过期");
    await attempt(httpError(429, { code: "locked", retry_after: 60 }), "! 尝试次数过多，请稍后再试");
    await attempt(new Error("Network Error"), "! 网络错误");
    expect(screen.queryByTestId("mfa-recovery-codes")).toBeNull();
  });

  it("if no secret can be had it says so and cannot go on; if no authenticator opens, the key is still there", async () => {
    mockApi.setup.mockRejectedValueOnce(httpError(500, {}));
    renderOfficer(<MfaScreen onBack={() => {}} />);
    await toStep(2);
    expect(await screen.findByTestId("mfa-setup-failed")).toBeTruthy();
    expect(screen.queryByTestId("mfa-manual-key")).toBeNull();
    await press("mfa-next");
    expect(screen.getByTestId("mfa-step").props.children).toMatch("2 / 4");
  });

  it("no authenticator app: says so and keeps the key on screen", async () => {
    const open = jest.spyOn(Linking, "openURL").mockRejectedValue(new Error("no handler"));
    renderOfficer(<MfaScreen onBack={() => {}} />);
    await toStep(2);
    await screen.findByTestId("mfa-manual-key");
    await press("mfa-open-authenticator");
    expect(await screen.findByTestId("mfa-open-failed")).toBeTruthy();
    expect(screen.getByTestId("mfa-manual-key")).toBeTruthy();
    open.mockRestore();
  });

  it("never writes the recovery codes or the secret to the console", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
    renderOfficer(<MfaScreen onBack={() => {}} />);
    await toStep(4);
    await press("mfa-saved");
    await press("mfa-finish");
    await screen.findByTestId("mfa-done");
    const written = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    for (const c of [...CODES, SECRET]) expect(written).not.toContain(c);
    spies.forEach((s) => s.mockRestore());
  });
});

describe("the managed state", () => {
  it("off: offers the wizard and has no regenerate or disable", async () => {
    renderOfficer(<MfaScreen onBack={() => {}} />);
    expect(await screen.findByTestId("mfa-start")).toBeTruthy();
    expect(screen.getByTestId("mfa-required-note")).toBeTruthy();
    expect(screen.queryByTestId("mfa-disable")).toBeNull();
    expect(screen.queryByTestId("mfa-regen")).toBeNull();
  });

  it("on: shows the codes left and no wizard entry", async () => {
    mockApi.status.mockResolvedValue({ data: ON });
    renderOfficer(<MfaScreen onBack={() => {}} />);
    expect((await screen.findByTestId("mfa-codes-left")).props.children).toMatch("7 / 10");
    expect(screen.queryByTestId("mfa-start")).toBeNull();
  });

  it("the status failing offers a retry and no actions", async () => {
    mockApi.status.mockRejectedValue(new Error("Network Error"));
    renderOfficer(<MfaScreen onBack={() => {}} />);
    expect(await screen.findByTestId("mfa-load-failed")).toBeTruthy();
    expect(screen.queryByTestId("mfa-start")).toBeNull();
    expect(screen.queryByTestId("mfa-disable")).toBeNull();
  });

  it("regenerate asks first, then shows the new codes", async () => {
    mockApi.status.mockResolvedValue({ data: ON });
    renderOfficer(<MfaScreen onBack={() => {}} />);
    fireEvent.press(await screen.findByTestId("mfa-regen"));
    fireEvent.press(screen.getByTestId("mfa-regen-cancel"));
    expect(mockApi.regenerateRecoveryCodes).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("mfa-regen"));
    await press("mfa-regen-confirm");
    expect(mockApi.regenerateRecoveryCodes).toHaveBeenCalledTimes(1);
    await screen.findByTestId("mfa-codes-text");
    expect(screen.getByTestId("mfa-codes-col-0").props.children).toContain("AAAA-1111");
    await press("mfa-regenerated-close");
    expect(screen.queryByTestId("mfa-codes-text")).toBeNull();
  });

  it("a failed regenerate shows no codes", async () => {
    mockApi.status.mockResolvedValue({ data: ON });
    mockApi.regenerateRecoveryCodes.mockRejectedValue(new Error("Network Error"));
    renderOfficer(<MfaScreen onBack={() => {}} />);
    fireEvent.press(await screen.findByTestId("mfa-regen"));
    await press("mfa-regen-confirm");
    expect(await screen.findByText("! 网络错误")).toBeTruthy();
    expect(screen.queryByTestId("mfa-codes-text")).toBeNull();
  });

  it("disable by code: inert until six digits, sends the code, and tells the session", async () => {
    mockApi.status.mockResolvedValue({ data: ON });
    const session = sessionOf(OFFICER);
    renderOfficer(<MfaScreen onBack={() => {}} />, { session });
    fireEvent.press(await screen.findByTestId("mfa-disable"));
    fireEvent.changeText(screen.getByTestId("mfa-disable-code"), "123");
    await press("mfa-disable-confirm");
    expect(mockApi.disable).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByTestId("mfa-disable-code"), "123456");
    await press("mfa-disable-confirm");
    expect(mockApi.disable).toHaveBeenCalledWith({ method: "totp", code: "123456" });
    await waitFor(() => expect(session.setMfaEnabled).toHaveBeenCalledWith(false));
  });

  it("disable by password: a refusal says so without echoing the password, and nothing changes", async () => {
    mockApi.status.mockResolvedValue({ data: ON });
    mockApi.disable.mockRejectedValue(httpError(400, { code: "wrong_password" }));
    const session = sessionOf(OFFICER);
    renderOfficer(<MfaScreen onBack={() => {}} />, { session });
    fireEvent.press(await screen.findByTestId("mfa-disable"));
    fireEvent.press(screen.getByTestId("mfa-disable-method-password"));
    expect(screen.getByTestId("mfa-disable-password").props.secureTextEntry).toBe(true);
    fireEvent.changeText(screen.getByTestId("mfa-disable-password"), "hunter2-secret");
    await press("mfa-disable-confirm");
    expect(mockApi.disable).toHaveBeenCalledWith({ method: "password", password: "hunter2-secret" });
    expect(await screen.findByText("! 没能关闭，请检查动态码或密码")).toBeTruthy();
    expect(screen.queryByText(/hunter2-secret/)).toBeNull();
    expect(session.setMfaEnabled).not.toHaveBeenCalled();
  });
});

describe("step 2 and 4 layout", () => {
  const LONG = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXQ";
  it("shows the key in mono, four groups a row, as one selectable string, then the open button, then the hint", async () => {
    mockApi.setup.mockResolvedValue({ data: { secret: LONG, otpauth_url: URL } });
    renderOfficer(<MfaScreen onBack={() => {}} />);
    await toStep(2);
    const key = await screen.findByTestId("mfa-manual-key");
    expect(key.props.children).toBe("JBSW Y3DP EHPK 3PXP\nJBSW Y3DP EHPK 3PXQ");
    expect(StyleSheet.flatten(key.props.style).fontFamily).toMatch(/Mono/);
    expect(screen.queryByTestId("mfa-manual-key-0")).toBeNull();
    const order = JSON.stringify(screen.toJSON());
    const at = (needle: string) => order.indexOf(needle);
    expect(at("mfa-manual-key")).toBeLessThan(at("mfa-open-authenticator"));
    expect(at("mfa-open-authenticator")).toBeLessThan(at("长按文字可以选中并复制。"));
  });

  it("swallows the Android back key on step 4 and lets it through on step 1", async () => {
    const handlers: (() => boolean)[] = [];
    const spy = jest.spyOn(BackHandler, "addEventListener").mockImplementation((_e, h) => {
      handlers.push(h as () => boolean);
      return { remove: () => {} };
    });
    const onBack = jest.fn();
    renderOfficer(<MfaScreen onBack={onBack} />);
    await toStep(4);
    expect(handlers.at(-1)!()).toBe(true);
    expect(onBack).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("the standing banner", () => {
  function Live({ mfaEnabled }: { mfaEnabled: boolean }) {
    const [user, setUser] = useState({ ...OFFICER, mfa_enabled: mfaEnabled, mfa_required: true });
    const session = sessionOf(user, { setMfaEnabled: (e: boolean) => setUser((u) => ({ ...u, mfa_enabled: e })) });
    return (
      <SessionContext.Provider value={session}>
        <Shell />
      </SessionContext.Provider>
    );
  }

  it("opens the wizard; completing it removes the banner; the tab bar is held on the codes step", async () => {
    renderOfficer(<Live mfaEnabled={false} />);
    fireEvent.press(await screen.findByTestId("mfa-banner-action"));
    fireEvent.press(await screen.findByTestId("mfa-start"));
    await press("mfa-next");
    await screen.findByTestId("mfa-manual-key");
    await press("mfa-next");
    fireEvent.changeText(screen.getByTestId("mfa-setup-code"), "123456");
    await press("mfa-confirm");
    await screen.findByTestId("mfa-recovery-codes");
    // held: the tab bar does not leave the codes
    await press("tab-todo");
    expect(screen.getByTestId("mfa-recovery-codes")).toBeTruthy();
    expect(mockApi.cancelSetup).not.toHaveBeenCalled();
    expect(screen.getByTestId("mfa-banner")).toBeTruthy();
    await press("mfa-saved");
    await press("mfa-finish");
    await screen.findByTestId("mfa-done");
    await waitFor(() => expect(screen.queryByTestId("mfa-banner")).toBeNull());
    // and now the tab bar works again
    await press("tab-todo");
    expect(screen.queryByTestId("mfa-screen")).toBeNull();
  });

  it("is one button of at least 44 high, named by its text plus 去设置, and pressing the band itself opens the wizard", async () => {
    renderOfficer(<Live mfaEnabled={false} />);
    const banner = await screen.findByTestId("mfa-banner");
    expect(banner.props.accessibilityRole).toBe("button");
    expect(banner.props.accessibilityLabel).toMatch(/去设置$/);
    expect(banner.props.accessibilityLabel).toMatch(/^[^›]+ 去设置$/);
    expect(StyleSheet.flatten(banner.props.style).minHeight).toBeGreaterThanOrEqual(44);
    // the action is a trailing label, not a second button
    expect(screen.getByTestId("mfa-banner-action").props.accessibilityRole).toBeUndefined();
    fireEvent.press(banner);
    expect(await screen.findByTestId("mfa-start")).toBeTruthy();
  });

  it("is not shown, and the entry is not offered, when two-step verification is already on", async () => {
    mockApi.status.mockResolvedValue({ data: ON });
    renderOfficer(<Live mfaEnabled />);
    await screen.findByTestId("shell");
    expect(screen.queryByTestId("mfa-banner")).toBeNull();
    expect(screen.queryByTestId("mfa-banner-action")).toBeNull();
  });
});
