/**
 * Unsent replies and reply drafts across the end of a session (user, 2026-11-01):
 *   - the server ends it (401): kept; the SAME officer signing in again gets them back, another officer finds them
 *     gone from the phone (A7 「换人不留痕」 holds, checked at sign-in against the owner stored with them);
 *   - the officer signs out: told how many first, can try sending or stay; only 「仍然退出」 clears them;
 *   - a password reset on this phone signs out with `keepUnsent`: kept, as after a 401.
 */
import { REFRESH_TOKEN_KEY, platform } from "@soulledger/core/platform";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";

import { DRAFTS_KEY, clearDrafts, readDraft, saveDraft } from "../drafts";
import { OUTBOX_KEY, clearOutbox, enqueueReply, outboxEntries } from "../outbox";
import { MeTab } from "../screens/me";
import { SignOutButton } from "../screens/signOut";
import { SessionProvider, USER_KEY, useSession } from "../session";
import { translate } from "../shared";
import { OFFICER, renderOfficer, sessionOf } from "./harness";

const mockLogin = jest.fn();
const mockMessages = jest.fn();
const mockReply = jest.fn();
jest.mock("@soulledger/core/api/auth", () => ({
  ...jest.requireActual("@soulledger/core/api/auth"),
  authApi: {
    officerLogin: (...a: unknown[]) => mockLogin(...a),
    profile: jest.fn(async () => ({ data: {} })),
    preferences: jest.fn(async () => ({ data: {} })),
    logout: jest.fn(async () => ({})),
  },
  mfaApi: { status: jest.fn(async () => ({ data: { enabled: true, required: true } })) },
}));
jest.mock("@soulledger/core/api/officer-app", () => ({
  ...jest.requireActual("@soulledger/core/api/officer-app"),
  officerAppApi: { todo: jest.fn(), stats: jest.fn(async () => ({ data: {} })), registerPush: jest.fn(), unregisterPush: jest.fn() },
}));
jest.mock("@soulledger/core/api/soul-inbox", () => ({
  ...jest.requireActual("@soulledger/core/api/soul-inbox"),
  soulInboxApi: {
    messages: (...a: unknown[]) => mockMessages(...a),
    reply: (...a: unknown[]) => mockReply(...a),
  },
}));

const as = (id: number) => platform().persistent.set(USER_KEY, JSON.stringify({ ...OFFICER, id }));
const seed = () => {
  enqueueReply({ id: "c-1", name: "李白", text: "回信", seen: [] });
  saveDraft("c-1", "回信");
  saveDraft("c-2", "写了一半");
};
const settle = () => act(async () => {});

function SignIn({ id }: { id: number }) {
  const { signIn, state } = useSession();
  return (
    <Pressable testID="sign-in" onPress={() => void signIn("yama", "pw")}>
      <Text testID="status">{`${state.status}:${id}`}</Text>
    </Pressable>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  clearDrafts();
  clearOutbox();
  platform().persistent.remove(USER_KEY);
  mockMessages.mockResolvedValue({ data: [] });
  mockReply.mockResolvedValue({ data: {} });
});
afterEach(() => {
  platform().secure.remove(REFRESH_TOKEN_KEY);
  platform().persistent.remove(USER_KEY);
});

describe("the server ended the session", () => {
  async function endThenSignInAs(next: number) {
    as(41);
    platform().secure.set(REFRESH_TOKEN_KEY, "r-41");
    seed();
    renderOfficer(
      <SessionProvider>
        <SignIn id={next} />
      </SessionProvider>
    );
    await settle();
    act(() => platform().onUnauthorized());
    expect(screen.getByTestId("status").props.children).toBe(`signedOut:${next}`);
    mockLogin.mockResolvedValue({ data: { access: "a", refresh: "r", user: { ...OFFICER, id: next } } });
    fireEvent.press(screen.getByTestId("sign-in"));
    await waitFor(() => expect(screen.getByTestId("status").props.children).toBe(`signedIn:${next}`));
  }

  it("the same officer signing in again gets the unsent reply and the drafts back", async () => {
    await endThenSignInAs(41);
    expect(outboxEntries().map((e) => e.id)).toEqual(["c-1"]);
    expect(readDraft("c-1")).toBe("回信");
    expect(readDraft("c-2")).toBe("写了一半");
  });

  it("another officer signing in: they are removed from the phone, not merely hidden", async () => {
    await endThenSignInAs(42);
    expect(platform().persistent.get(OUTBOX_KEY)).toBeNull();
    expect(platform().persistent.get(DRAFTS_KEY)).toBeNull();
    expect(outboxEntries()).toEqual([]);
    // Gone for good: back under the first officer there is nothing either.
    as(41);
    expect(outboxEntries()).toEqual([]);
    expect(readDraft("c-2")).toBe("");
  });
});

describe("signing out after a password reset keeps them, like a 401", () => {
  function ResetThenSignIn({ id }: { id: number }) {
    const { signIn, signOut, state } = useSession();
    return (
      <>
        <Pressable testID="reset-done" onPress={() => signOut({ keepUnsent: true })} />
        <Pressable testID="sign-in" onPress={() => void signIn("yama", "pw")}>
          <Text testID="status">{`${state.status}:${id}`}</Text>
        </Pressable>
      </>
    );
  }

  it.each([
    [41, true],
    [42, false],
  ])("officer %s signing in next gets them back: %s", async (next, kept) => {
    as(41);
    platform().secure.set(REFRESH_TOKEN_KEY, "r-41");
    seed();
    renderOfficer(
      <SessionProvider>
        <ResetThenSignIn id={next} />
      </SessionProvider>
    );
    await settle();
    fireEvent.press(screen.getByTestId("reset-done"));
    expect(screen.getByTestId("status").props.children).toBe(`signedOut:${next}`);
    expect(platform().persistent.get(OUTBOX_KEY)).not.toBeNull();
    mockLogin.mockResolvedValue({ data: { access: "a", refresh: "r", user: { ...OFFICER, id: next } } });
    fireEvent.press(screen.getByTestId("sign-in"));
    await waitFor(() => expect(screen.getByTestId("status").props.children).toBe(`signedIn:${next}`));
    expect(outboxEntries().map((e) => e.id)).toEqual(kept ? ["c-1"] : []);
    expect(readDraft("c-2")).toBe(kept ? "写了一半" : "");
  });
});

describe("signing out says what would be lost", () => {
  const PENDING = translate("zh-Hans", "officer_app.me.logout_pending", { unsent: "1", drafts: "1" });

  it("counts the unsent reply once and the other draft; 取消 clears nothing and does not sign out", async () => {
    seed();
    const session = sessionOf(OFFICER);
    renderOfficer(<MeTab onOpen={() => {}} />, { session });
    fireEvent.press(await screen.findByTestId("me-logout"));
    expect(screen.getByText(PENDING)).toBeTruthy();
    expect(screen.queryByText(translate("zh-Hans", "officer_app.me.logout_title"))).toBeNull();
    expect(screen.getByTestId("me-logout-confirm")).toBeTruthy();
    fireEvent.press(screen.getByTestId("me-logout-cancel"));
    expect(session.signOut).not.toHaveBeenCalled();
    expect(outboxEntries()).toHaveLength(1);
    expect(readDraft("c-2")).toBe("写了一半");
    expect(screen.queryByText(PENDING)).toBeNull();
    await settle();
  });

  it("「先重试发送」 sends the queued reply and the count follows; 「仍然退出」 signs out", async () => {
    seed();
    const session = sessionOf(OFFICER);
    renderOfficer(<MeTab onOpen={() => {}} />, { session });
    fireEvent.press(await screen.findByTestId("me-logout"));
    fireEvent.press(screen.getByTestId("me-logout-retry"));
    await waitFor(() => expect(mockReply).toHaveBeenCalledWith("c-1", "回信", expect.any(String)));
    await waitFor(() => expect(outboxEntries()).toEqual([]));
    expect(await screen.findByText(translate("zh-Hans", "officer_app.me.logout_pending", { unsent: "0", drafts: "1" }))).toBeTruthy();
    expect(screen.queryByTestId("me-logout-retry")).toBeNull(); // nothing left to send
    fireEvent.press(screen.getByTestId("me-logout-confirm"));
    expect(session.signOut).toHaveBeenCalledTimes(1);
  });

  it("with nothing pending, the plain question (我的), and the other places sign out at once", async () => {
    const session = sessionOf(OFFICER);
    renderOfficer(<MeTab onOpen={() => {}} />, { session });
    fireEvent.press(await screen.findByTestId("me-logout"));
    expect(screen.getByText(translate("zh-Hans", "officer_app.me.logout_title"))).toBeTruthy();
    expect(screen.queryByTestId("me-logout-pending")).toBeNull();
    await settle();
  });

  it("the two-step hold's button asks only when something would be lost", () => {
    const session = sessionOf(OFFICER);
    const { unmount } = renderOfficer(<SignOutButton testID="hold" kind="outline" />, { session });
    fireEvent.press(screen.getByTestId("hold"));
    expect(session.signOut).toHaveBeenCalledTimes(1);
    unmount();
    saveDraft("c-2", "写了一半");
    const asked = sessionOf(OFFICER);
    renderOfficer(<SignOutButton testID="hold" kind="outline" />, { session: asked });
    fireEvent.press(screen.getByTestId("hold"));
    expect(asked.signOut).not.toHaveBeenCalled();
    expect(screen.getByTestId("hold-pending")).toBeTruthy();
  });
});
