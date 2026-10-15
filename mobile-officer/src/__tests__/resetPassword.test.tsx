/**
 * Finishing a password reset inside the app: `soulledger-officer://reset?uid=..&token=..` (the desk page's
 * "open in the officer app"). The parser, the fact that this one link -- unlike every other -- lands while
 * SIGNED OUT, the form and its refusals (by code), the sign-in page that follows, and what must NOT happen:
 * the credential reaching a log, a store, or the screen.
 */
import type { LoginUser } from "@soulledger/core/api/auth";
import { platform } from "@soulledger/core/platform";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { useMemo, useState } from "react";

import { Gate } from "../gate";
import { isRetiredResetLink, officerLinks, parseOfficerLink, parseResetLink, resetLinks } from "../links";
import { ResetPasswordScreen } from "../screens/reset";
import { SessionContext } from "../session";
import { OFFICER, httpError, renderOfficer, sessionOf } from "./harness";

const mockConfirm = jest.fn();
const mockTodo = jest.fn();
jest.mock("@soulledger/core/api/auth", () => ({
  ...jest.requireActual("@soulledger/core/api/auth"),
  authApi: { confirmOfficerReset: (...a: unknown[]) => mockConfirm(...a), requestOfficerReset: jest.fn(), profile: jest.fn(async () => ({ data: {} })) },
  mfaApi: { status: jest.fn(async () => ({ data: { enabled: true, required: true } })) },
}));
jest.mock("@soulledger/core/api/officer-app", () => ({
  ...jest.requireActual("@soulledger/core/api/officer-app"),
  officerAppApi: { todo: (...a: unknown[]) => mockTodo(...a), item: jest.fn(), registerPush: jest.fn(), unregisterPush: jest.fn() },
}));
jest.mock("@soulledger/core/api/judgment", () => ({ judgmentApi: { list: jest.fn(async () => ({ data: { results: [] } })), claim: jest.fn(), queueCounts: jest.fn(async () => ({ data: { mine: 0, unclaimed: 0, others: 0, deferred: 0 } })) } }));
jest.mock("@soulledger/core/api/notifications", () => ({
  notificationsApi: { list: jest.fn(async () => ({ data: { results: [] } })), markRead: jest.fn(), markAllRead: jest.fn() },
}));

// A fresh credential per test: a used-up one is remembered for the life of the process (links.ts retireResetLink).
let counter = 0;
let UID = "";
let TOKEN = "";
let LINK = "";
const PASSWORD = "N0t-Guessable!2026";
const group = (items: object[]) => ({ count: items.length, items });

/** Drops whatever an earlier test left waiting in the inboxes. */
function drain() {
  resetLinks.subscribe(() => {})();
  officerLinks.subscribe(() => {})();
}

beforeEach(() => {
  jest.clearAllMocks();
  counter += 1;
  UID = `uidMARK${counter}`;
  TOKEN = `tokMARK${counter}-0123456789abcdef0123456789abcdef`;
  LINK = `soulledger-officer://reset?uid=${UID}&token=${TOKEN}`;
  drain();
  mockTodo.mockResolvedValue({ data: { approvals: group([]), reassignments: group([]), cooldowns: group([]), rebirths: group([]) } });
});
afterEach(drain);

describe("parseResetLink", () => {
  it("reads uid and token, percent-decoded", () => {
    expect(parseResetLink(LINK)).toEqual({ uid: UID, token: TOKEN });
    expect(parseResetLink(`SoulLedger-Officer://RESET/?token=${encodeURIComponent(TOKEN)}&uid=${UID}#frag`)).toEqual({ uid: UID, token: TOKEN });
  });

  it.each([
    ["no query", "soulledger-officer://reset"],
    ["no token", `soulledger-officer://reset?uid=${UID}`],
    ["no uid", `soulledger-officer://reset?token=${TOKEN}`],
    ["an empty token", `soulledger-officer://reset?uid=${UID}&token=`],
    ["a token too short to be one", `soulledger-officer://reset?uid=${UID}&token=abc`],
    ["a token with a character a real one never has", `soulledger-officer://reset?uid=${UID}&token=${encodeURIComponent("abcdefgh/../x")}`],
    ["a uid with a space", `soulledger-officer://reset?uid=${encodeURIComponent("a b")}&token=${TOKEN}`],
    ["an over-long token", `soulledger-officer://reset?uid=${UID}&token=${"a".repeat(129)}`],
    ["a further path segment", `soulledger-officer://reset/extra?uid=${UID}&token=${TOKEN}`],
    ["the soul app's scheme", `soulledger://reset?uid=${UID}&token=${TOKEN}`],
    ["https", `https://example.com/reset?uid=${UID}&token=${TOKEN}`],
    ["a malformed escape", `soulledger-officer://reset?uid=${UID}&token=%E0%A4%A`],
  ])("drops %s", (_why, url) => expect(parseResetLink(url)).toBeNull());

  it.each([null, undefined, 7, {}])("drops %p", (url) => expect(parseResetLink(url)).toBeNull());

  it("is not one of the tab links, and the tab parser does not take it", () => {
    expect(parseOfficerLink(LINK)).toBeNull();
    officerLinks.push(LINK);
    const seen = jest.fn();
    officerLinks.subscribe(seen)();
    expect(seen).not.toHaveBeenCalled();
  });
});

describe("the reset inbox", () => {
  it("holds a link that arrives before anyone is listening and hands it over once", () => {
    resetLinks.push(LINK);
    const first = jest.fn();
    const off = resetLinks.subscribe(first);
    expect(first).toHaveBeenCalledWith({ uid: UID, token: TOKEN });
    off();
    const second = jest.fn();
    resetLinks.subscribe(second)();
    expect(second).not.toHaveBeenCalled();
  });
});

describe("ResetPasswordScreen", () => {
  const cred = () => ({ uid: UID, token: TOKEN });
  const fill = (a = PASSWORD, b = a) => {
    fireEvent.changeText(screen.getByTestId("reset-new"), a);
    fireEvent.changeText(screen.getByTestId("reset-confirm"), b);
  };
  const submit = () => act(async () => { fireEvent.press(screen.getByTestId("reset-submit")); });
  const mount = (over: Partial<Parameters<typeof ResetPasswordScreen>[0]> = {}) => {
    const props = { credential: cred(), onClose: jest.fn(), onDone: jest.fn(), ...over };
    renderOfficer(<ResetPasswordScreen {...props} />, { user: null });
    return props;
  };

  it("asks password managers for a new-password field", () => {
    mount();
    for (const id of ["reset-new", "reset-confirm"]) {
      expect(screen.getByTestId(id).props.secureTextEntry).toBe(true);
      expect(screen.getByTestId(id).props.textContentType).toBe("newPassword");
    }
  });

  it("sends uid, token and the new password, then reports done and retires the link", async () => {
    mockConfirm.mockResolvedValue({ data: { detail: "ok" } });
    const { onDone } = mount();
    fill();
    await submit();
    expect(mockConfirm).toHaveBeenCalledWith({ uid: UID, token: TOKEN, new_password: PASSWORD });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(isRetiredResetLink(cred())).toBe(true);
  });

  const mark = (id: string) => screen.getByTestId(`pw-rules-${id}-mark`, { includeHiddenElements: true }).props.children as string;
  const matchMark = () => screen.getByTestId("pw-match-mark", { includeHiddenElements: true }).props.children as string;

  it("lists two rows (no 当前密码 box here), all ○, plus the ◇ note", () => {
    mount();
    expect([mark("min_length"), mark("not_digits"), matchMark()]).toEqual(["○", "○", "○"]);
    expect(screen.queryByTestId("pw-rules-not_current")).toBeNull();
    expect(screen.getByTestId("pw-rules-note")).toBeTruthy();
  });

  it("ticks while typing without !, shows ! on leaving the box, ticks again at once", () => {
    mount();
    fireEvent.changeText(screen.getByTestId("reset-new"), "1234");
    expect([mark("min_length"), mark("not_digits")]).toEqual(["○", "○"]);
    fireEvent(screen.getByTestId("reset-new"), "blur");
    expect([mark("min_length"), mark("not_digits")]).toEqual(["!", "!"]);
    fireEvent.changeText(screen.getByTestId("reset-new"), PASSWORD);
    expect([mark("min_length"), mark("not_digits")]).toEqual(["✓", "✓"]);
  });

  it("a mismatch or a short password never reaches the server, and is told by the list, not by a sentence", async () => {
    mount();
    fill(PASSWORD, "something-else-1");
    await submit();
    expect(matchMark()).toBe("!");
    expect(screen.queryByTestId("reset-local-error")).toBeNull();
    fill("short", "short");
    await submit();
    expect(mark("min_length")).toBe("!");
    expect(screen.queryByTestId("reset-local-error")).toBeNull();
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("a refusal as too common is the block above the list; the ticks stay and the words stay", async () => {
    mockConfirm.mockRejectedValue(
      httpError(400, { code: "weak_password", new_password: [{ code: "password_too_common", message: "m" }] })
    );
    const { onDone } = mount();
    fill();
    await submit();
    expect(screen.getByText("! 这个密码太容易被猜到")).toBeTruthy();
    expect([mark("min_length"), mark("not_digits"), matchMark()]).toEqual(["✓", "✓", "✓"]);
    expect(screen.queryByTestId("reset-new-error")).toBeNull();
    expect(screen.getByTestId("reset-new").props.value).toBe(PASSWORD);
    expect(screen.getByTestId("reset-confirm").props.value).toBe(PASSWORD);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("a weak password stays on the form: the common reason in the list's block, each other reason as a line, by code, under the field", async () => {
    mockConfirm.mockRejectedValue(
      httpError(400, {
        code: "weak_password",
        error: "This password is too common.",
        new_password: [
          { code: "password_too_common", message: "This password is too common." },
          { code: "password_entirely_numeric", message: "This password is entirely numeric." },
        ],
      })
    );
    const { onDone } = mount();
    fill();
    await submit();
    expect(screen.getAllByTestId("reset-new-error").map((n) => n.props.children)).toEqual(["密码不能全是数字"]);
    expect(screen.getByText("! 这个密码太容易被猜到")).toBeTruthy();
    expect(screen.queryByText(/This password/)).toBeNull();
    expect(onDone).not.toHaveBeenCalled();
    expect(isRetiredResetLink(cred())).toBe(false); // it can still be used
    expect(screen.getByTestId("reset-submit")).toBeTruthy();
  });

  it("a weak refusal without reasons still says so", async () => {
    mockConfirm.mockRejectedValue(httpError(400, { code: "weak_password", error: "x" }));
    mount();
    fill();
    await submit();
    expect(screen.getByTestId("reset-new-error").props.children).toBe("新密码不符合要求");
  });

  it("an expired, used or unknown link is its own state; 'request again' only when the caller can", async () => {
    mockConfirm.mockRejectedValue(httpError(400, { code: "reset_link_invalid", error: "x" }));
    const { onRequestAgain } = mount({ onRequestAgain: jest.fn() });
    fill();
    await submit();
    expect(screen.getByTestId("reset-invalid")).toBeTruthy();
    expect(screen.getByText("链接无效或已过期")).toBeTruthy();
    expect(screen.queryByTestId("reset-submit")).toBeNull();
    expect(isRetiredResetLink(cred())).toBe(true);
    fireEvent.press(screen.getByTestId("reset-request-again"));
    expect(onRequestAgain).toHaveBeenCalledTimes(1);
  });

  it("without a way to request again (signed in) the dead-link state offers only the back row", async () => {
    mockConfirm.mockRejectedValue(httpError(400, { code: "reset_link_invalid" }));
    mount();
    fill();
    await submit();
    expect(screen.getByTestId("reset-invalid")).toBeTruthy();
    expect(screen.queryByTestId("reset-request-again")).toBeNull();
    expect(screen.getByTestId("reset-screen-back")).toBeTruthy();
  });

  it.each([
    ["no answer at all", () => new Error("Network Error"), "网络错误"],
    ["a 429", () => httpError(429, { code: "rate_limited" }), "请求过于频繁，请稍后再试"],
    ["a 500", () => httpError(500, {}), "未能发送，请稍后再试"],
  ])("%s keeps the form and the link, and says so", async (_why, make, line) => {
    mockConfirm.mockRejectedValue(make());
    const { onDone } = mount();
    fill();
    await submit();
    expect(screen.getByTestId("reset-failure").props.children).toBe(line);
    expect(screen.getByTestId("reset-submit")).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
    expect(isRetiredResetLink(cred())).toBe(false);
  });

  it("the credential reaches no log, no store, and is not drawn -- through success, weak, dead link and network failure", async () => {
    const consoles = (["log", "info", "warn", "error", "debug"] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
    const stores = [platform().persistent, platform().session, platform().secure].map((s) => jest.spyOn(s, "set"));
    const leaked = () => {
      const seen = JSON.stringify([...consoles, ...stores].map((s) => s.mock.calls)) + JSON.stringify(screen.toJSON());
      return [UID, TOKEN].filter((secret) => seen.includes(secret));
    };
    const failures = [
      httpError(400, { code: "weak_password", new_password: [{ code: "password_too_common", message: "m" }] }),
      new Error("Network Error"),
      httpError(400, { code: "reset_link_invalid" }),
    ];
    mount();
    for (const failure of failures) {
      mockConfirm.mockRejectedValueOnce(failure);
      if (screen.queryByTestId("reset-submit")) {
        fill();
        await submit();
      }
      expect(leaked()).toEqual([]);
    }
    consoles.forEach((c) => c.mockRestore());
    stores.forEach((s) => s.mockRestore());
  });
});

describe("Gate: signed out", () => {
  const signedOut = () => renderOfficer(<Gate />, { user: null });
  const fillAndSubmit = async () => {
    fireEvent.changeText(screen.getByTestId("reset-new"), PASSWORD);
    fireEvent.changeText(screen.getByTestId("reset-confirm"), PASSWORD);
    await act(async () => { fireEvent.press(screen.getByTestId("reset-submit")); });
  };

  it("a reset link lands at once, signed out, instead of waiting for a sign-in", async () => {
    signedOut();
    expect(screen.getByTestId("login")).toBeTruthy();
    await act(async () => resetLinks.push(LINK));
    expect(screen.getByTestId("reset-screen")).toBeTruthy();
    expect(screen.queryByTestId("login")).toBeNull();
  });

  it("one that arrived before the gate mounted (cold start from the link) is shown too", () => {
    resetLinks.push(LINK);
    signedOut();
    expect(screen.getByTestId("reset-screen")).toBeTruthy();
  });

  it("every other link still waits: signed out nothing opens, and it is there for after the sign-in", async () => {
    signedOut();
    await act(async () => officerLinks.push("soulledger-officer://queue"));
    expect(screen.getByTestId("login")).toBeTruthy();
    expect(screen.queryByTestId("reset-screen")).toBeNull();
    const held = jest.fn();
    officerLinks.subscribe(held)();
    expect(held).toHaveBeenCalledWith({ tab: "queue" });
  });

  it("success: back to the sign-in page with the line to use the new password", async () => {
    mockConfirm.mockResolvedValue({ data: { detail: "ok" } });
    signedOut();
    await act(async () => resetLinks.push(LINK));
    await fillAndSubmit();
    expect(mockConfirm).toHaveBeenCalledWith({ uid: UID, token: TOKEN, new_password: PASSWORD });
    expect(await screen.findByTestId("login-reset-done")).toBeTruthy();
    expect(screen.getByText(/密码已重置/)).toBeTruthy();
    expect(screen.queryByTestId("reset-screen")).toBeNull();
  });

  it("the same link delivered again after success does not reopen the form (an Android activity recreation)", async () => {
    mockConfirm.mockResolvedValue({ data: { detail: "ok" } });
    signedOut();
    await act(async () => resetLinks.push(LINK));
    await fillAndSubmit();
    await screen.findByTestId("login-reset-done");
    await act(async () => resetLinks.push(LINK));
    expect(screen.queryByTestId("reset-screen")).toBeNull();
  });

  it("a dead link leads on to 忘记密码", async () => {
    mockConfirm.mockRejectedValue(httpError(400, { code: "reset_link_invalid" }));
    signedOut();
    await act(async () => resetLinks.push(LINK));
    await fillAndSubmit();
    await act(async () => { fireEvent.press(screen.getByTestId("reset-request-again")); });
    expect(screen.getByTestId("forgot-form")).toBeTruthy();
    expect(screen.queryByTestId("reset-screen")).toBeNull();
  });

  it("closing the form goes back to the sign-in page and sends nothing", async () => {
    signedOut();
    await act(async () => resetLinks.push(LINK));
    await act(async () => { fireEvent.press(screen.getByTestId("reset-screen-back")); });
    expect(screen.getByTestId("login")).toBeTruthy();
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(screen.queryByTestId("login-reset-done")).toBeNull();
  });

  it("a malformed link changes nothing", async () => {
    signedOut();
    await act(async () => resetLinks.push("soulledger-officer://reset?uid=x&token=y"));
    expect(screen.getByTestId("login")).toBeTruthy();
  });
});

describe("Gate: signed in", () => {
  /** A session that really ends: signOut flips it to signed out, as the provider does. */
  const signOutSpy = jest.fn();
  function Live({ user }: { user: LoginUser }) {
    const [current, setCurrent] = useState<LoginUser | null>(user);
    const session = useMemo(
      () =>
        sessionOf(current, {
          signOut: () => {
            signOutSpy();
            setCurrent(null);
          },
        }),
      [current]
    );
    return (
      <SessionContext.Provider value={session}>
        <Gate />
      </SessionContext.Provider>
    );
  }

  it("shows the form over the shell, and closing it leaves the shell as it was", async () => {
    renderOfficer(<Live user={OFFICER} />);
    await screen.findByTestId("tab-bar");
    await act(async () => resetLinks.push(LINK));
    expect(screen.getByTestId("reset-overlay")).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId("reset-screen-back")); });
    expect(screen.queryByTestId("reset-overlay")).toBeNull();
    expect(screen.getByTestId("tab-bar")).toBeTruthy();
    expect(signOutSpy).not.toHaveBeenCalled();
  });

  it("success ends this session too and lands on the sign-in page with the line", async () => {
    mockConfirm.mockResolvedValue({ data: { detail: "ok" } });
    renderOfficer(<Live user={OFFICER} />);
    await screen.findByTestId("tab-bar");
    await act(async () => resetLinks.push(LINK));
    fireEvent.changeText(screen.getByTestId("reset-new"), PASSWORD);
    fireEvent.changeText(screen.getByTestId("reset-confirm"), PASSWORD);
    await act(async () => { fireEvent.press(screen.getByTestId("reset-submit")); });
    expect(signOutSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId("login-reset-done")).toBeTruthy());
    expect(screen.queryByTestId("tab-bar")).toBeNull();
  });
});
