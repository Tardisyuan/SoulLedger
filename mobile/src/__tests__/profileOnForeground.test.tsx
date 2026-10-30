/**
 * Back in the foreground the soul app asks `/me/` again (phone QA 10-29b; the officer app does since 192ad39d), so
 * 本世 shows what changed while it slept. Only a background → active turn asks; a session that is no longer signed
 * in keeps its state; a failed read keeps the profile shown.
 */
import { REFRESH_TOKEN_KEY } from "@soulledger/core/platform";
import { act, render, screen } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { AppState, Text } from "react-native";

import { I18nProvider } from "../i18n";
import { installMobilePlatform } from "../platform";
import { SessionProvider, useSession, withProfile } from "../session";
import { PROFILE, resetLoginMemory, stubApi } from "./stubApi";

const secure = (SecureStore as unknown as { __store: Map<string, string> }).__store;
type Listener = (state: string) => void;
let listeners: Set<Listener>;
const turn = (next: string) => act(async () => void listeners.forEach((l) => l(next)));

function Name() {
  const { state } = useSession();
  return <Text testID="name">{state.status === "signedIn" ? state.profile.name : state.status}</Text>;
}

async function boot(me: unknown) {
  secure.set(REFRESH_TOKEN_KEY, "R");
  const calls = stubApi({
    "/me/": me as never,
    "GET /me/notification-settings/": { status: 200, data: { locale: "zh-Hans" } },
  });
  render(
    <I18nProvider>
      <SessionProvider>
        <Name />
      </SessionProvider>
    </I18nProvider>
  );
  await act(async () => {});
  return () => calls.filter((c) => c.url === "/me/").length;
}

beforeEach(() => {
  installMobilePlatform();
  resetLoginMemory();
  secure.clear();
  listeners = new Set();
  jest.spyOn(AppState, "addEventListener").mockImplementation(((_type: string, handler: Listener) => {
    listeners.add(handler);
    return { remove: () => void listeners.delete(handler) };
  }) as unknown as typeof AppState.addEventListener);
});

afterEach(() => jest.restoreAllMocks());

it("background → active asks /me/ again and the new profile replaces the old", async () => {
  const meCalls = await boot([
    { status: 200, data: PROFILE },
    { status: 200, data: { ...PROFILE, name: "张三丰" } },
  ]);
  expect(screen.getByTestId("name").props.children).toBe("张三");
  expect(meCalls()).toBe(1);

  await turn("background");
  expect(meCalls()).toBe(1); // going away asks nothing
  await turn("active");
  expect(meCalls()).toBe(2);
  expect(screen.getByTestId("name").props.children).toBe("张三丰");
  expect(screen.queryByText("张三")).toBeNull();

  await turn("active"); // already active: no second ask
  expect(meCalls()).toBe(2);
});

it("a failed read on return keeps the profile shown", async () => {
  const meCalls = await boot([{ status: 200, data: PROFILE }, "offline"]);
  await turn("background");
  await turn("active");
  expect(meCalls()).toBe(2);
  expect(screen.getByTestId("name").props.children).toBe("张三");
});

it("signed out: no listener asks anything", async () => {
  const meCalls = await boot({ status: 403, data: { code: "initial_password_expired" } });
  await turn("background");
  await turn("active");
  expect(meCalls()).toBe(1);
  expect(screen.getByTestId("name").props.children).toBe("signedOut");
});

// opt-apps2 N2: iOS reports inactive → active after the face / finger sheet, an alert or Control Center.
it("inactive → active (a face check, a system alert) asks nothing", async () => {
  const meCalls = await boot({ status: 200, data: PROFILE });
  await turn("inactive");
  await turn("active");
  expect(meCalls()).toBe(1);
  await turn("background");
  await turn("active");
  expect(meCalls()).toBe(2);
});

// opt-apps2 R1: an equal answer used to replace the state object and redraw everything under the session.
it("an unchanged profile on return keeps the session state: nothing under it redraws", async () => {
  const rendered = jest.fn();
  function Count() {
    useSession();
    rendered();
    return null;
  }
  secure.set(REFRESH_TOKEN_KEY, "R");
  const calls = stubApi({ "/me/": { status: 200, data: PROFILE }, "GET /me/notification-settings/": { status: 200, data: { locale: "zh-Hans" } } });
  render(
    <I18nProvider>
      <SessionProvider>
        <Count />
      </SessionProvider>
    </I18nProvider>
  );
  await act(async () => {});
  const before = rendered.mock.calls.length;
  await turn("background");
  await turn("active");
  expect(calls.filter((c) => c.url === "/me/")).toHaveLength(2); // it was asked
  expect(rendered.mock.calls.length).toBe(before); // and nothing redrew
});

it("withProfile: the same object for an equal profile, a new one for a changed one", () => {
  const prev = { status: "signedIn" as const, profile: PROFILE as never };
  expect(withProfile(prev, JSON.parse(JSON.stringify(PROFILE)))).toBe(prev);
  const next = withProfile(prev, { ...PROFILE, name: "张三丰" } as never);
  expect(next).not.toBe(prev);
  expect(next).toEqual({ status: "signedIn", profile: { ...PROFILE, name: "张三丰" } });
});
