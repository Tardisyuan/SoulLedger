/**
 * Deep links (soulledger://life|letters|assist|cooldown): the parser, the inbox that holds a link
 * until someone can act on it, and the real navigator landing on the page. A link only opens a page.
 */
import { REFRESH_TOKEN_KEY } from "@soulledger/core/platform";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { Linking } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { createLinkInbox, pathOf, queryOf } from "../deepLink";
import { I18nProvider } from "../i18n";
import { ASK_MAX_LENGTH, parseSoulLink, soulLinks } from "../links";
import { RootNavigator, navigationRef } from "../navigation";
import { installMobilePlatform } from "../platform";
import { SessionProvider } from "../session";
import { PROFILE, life, stubApi } from "./stubApi";

const secure = (SecureStore as unknown as { __store: Map<string, string> }).__store;

describe("parseSoulLink", () => {
  it.each([
    ["soulledger://life", "life"],
    ["soulledger://letters", "letters"],
    ["soulledger://assist/", "assist"],
    ["SoulLedger://Cooldown?from=siri", "cooldown"],
  ])("%s -> %s", (url, link) => expect(parseSoulLink(url)).toEqual({ page: link }));

  it.each([
    "soulledger://",
    "soulledger://unknown",
    "soulledger://life/extra",
    "soulledger-officer://life",
    "https://example.com/life",
    "soulledger://%E0%A4%A",
    "",
    null,
    42,
  ])("ignores %p", (url) => expect(parseSoulLink(url)).toBeNull());
});

describe("the ask link", () => {
  const question = (url: string) => parseSoulLink(url);

  it("carries the question, decoded", () => {
    expect(question("soulledger://ask?q=%E6%80%8E%E4%B9%88%E7%94%B3%E8%AF%B7%EF%BC%9F")).toEqual({ page: "ask", question: "怎么申请？" });
    expect(question("soulledger://ask?q=a+b%20c&x=1")).toEqual({ page: "ask", question: "a b c" });
    expect(question("soulledger://ask?x=1&q=C%2B%2B%20%26%20go#frag")).toEqual({ page: "ask", question: "C++ & go" });
  });

  it("opens the box empty when there is no usable question", () => {
    for (const url of ["soulledger://ask", "soulledger://ask?q=", "soulledger://ask?q=%20%0A%20", "soulledger://ask?q=%E0%A4%A", "soulledger://ask?other=1"]) {
      expect(question(url)).toEqual({ page: "ask" });
    }
  });

  it("strips control characters and trims", () => {
    expect(question("soulledger://ask?q=%20%20hi%00there%07%20")).toEqual({ page: "ask", question: "hi there" });
  });

  it("is cut at the drawer's limit, by characters", () => {
    const long = "问".repeat(ASK_MAX_LENGTH + 50);
    const got = question(`soulledger://ask?q=${encodeURIComponent(long)}`);
    expect(Array.from(got?.question ?? "")).toHaveLength(ASK_MAX_LENGTH);
  });

  it("is only recognised on the soul scheme, as one segment", () => {
    expect(question("soulledger-officer://ask?q=x")).toBeNull();
    expect(question("soulledger://ask/more?q=x")).toBeNull();
  });
});

describe("queryOf", () => {
  it("reads one parameter, first match, and never throws", () => {
    expect(queryOf("x://a?p=1&p=2", "p")).toBe("1");
    expect(queryOf("x://a?p", "p")).toBe("");
    expect(queryOf("x://a", "p")).toBeNull();
    expect(queryOf("x://a?p=%E0%A4%A", "p")).toBeNull();
    expect(queryOf(42, "p")).toBeNull();
  });
});

describe("pathOf", () => {
  it("decodes segments and drops query and fragment", () => {
    expect(pathOf("x://a/b%20c/?q=1#f", "x")).toEqual(["a", "b c"]);
  });
});

describe("the link inbox", () => {
  const parse = (url: string) => (url === "ok" ? "OK" : null);

  it("holds a link until somebody subscribes, once", () => {
    const inbox = createLinkInbox(parse);
    inbox.push("ok");
    inbox.push("nonsense");
    const seen: string[] = [];
    const off = inbox.subscribe((l) => seen.push(l));
    expect(seen).toEqual(["OK"]);
    off();
    const again: string[] = [];
    inbox.subscribe((l) => again.push(l));
    expect(again).toEqual([]);
  });

  it("delivers live links to a subscriber and keeps them once it has left", () => {
    const inbox = createLinkInbox(parse);
    const seen: string[] = [];
    const off = inbox.subscribe((l) => seen.push(l));
    inbox.push("ok");
    off();
    inbox.push("ok");
    expect(seen).toEqual(["OK"]);
    inbox.subscribe((l) => seen.push(l));
    expect(seen).toEqual(["OK", "OK"]);
  });

  it("install() reads the opening URL and listens for later ones, once", async () => {
    const inbox = createLinkInbox(parse);
    const initial = jest.spyOn(Linking, "getInitialURL").mockResolvedValue("ok");
    const listen = jest.spyOn(Linking, "addEventListener").mockReturnValue({ remove: jest.fn() } as never);
    inbox.install();
    inbox.install();
    expect(initial).toHaveBeenCalledTimes(1);
    expect(listen).toHaveBeenCalledTimes(1);
    const seen: string[] = [];
    await act(async () => {});
    inbox.subscribe((l) => seen.push(l));
    expect(seen).toEqual(["OK"]);
    listen.mock.calls[0][1]({ url: "ok" });
    expect(seen).toEqual(["OK", "OK"]);
    jest.restoreAllMocks();
  });
});

function renderApp() {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <I18nProvider>
        <SessionProvider>
          <RootNavigator />
        </SessionProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

const APPLICATIONS = { can_apply: false, reason: "application_open", cooldown_until: null, results: [] };

function signedIn() {
  secure.set(REFRESH_TOKEN_KEY, "R");
  stubApi({
    "/me/": { status: 200, data: PROFILE },
    "/me/life/": { status: 200, data: life(1) },
    "/me/rebirth-applications/": { status: 200, data: APPLICATIONS },
    "GET /me/notification-settings/": { status: 200, data: { rebirth: true, judgment: true, residence: true, chat: true, locale: "zh-Hans" } },
    "/me/assist/conversations/": { status: 200, data: [] },
  });
}

/** The drawer's one-time 「它只看不做」 notice shows once per account per device; a later test may not meet it. */
async function passNotice() {
  await screen.findByTestId("assist-panel");
  const ack = screen.queryByTestId("assist-ack");
  if (ack) fireEvent.press(ack);
}

beforeEach(async () => {
  installMobilePlatform();
  secure.clear();
  await AsyncStorage.clear();
});

describe("landing", () => {
  it("cooldown opens the rebirth tab; life opens the life tab", async () => {
    signedIn();
    renderApp();
    await screen.findByTestId("profile-card");
    await act(async () => soulLinks.push("soulledger://cooldown"));
    await waitFor(() => expect(navigationRef.getCurrentRoute()?.name).toBe("Applications"));
    await act(async () => soulLinks.push("soulledger://life"));
    await waitFor(() => expect(navigationRef.getCurrentRoute()?.name).toBe("Life"));
  });

  it("assist opens the drawer over the life tab", async () => {
    signedIn();
    renderApp();
    await screen.findByTestId("profile-card");
    await act(async () => soulLinks.push("soulledger://assist"));
    expect(await screen.findByTestId("assist-panel")).toBeTruthy();
  });

  it("ask opens the drawer with the question typed in and sends nothing", async () => {
    signedIn();
    renderApp();
    await screen.findByTestId("profile-card");
    await act(async () => soulLinks.push("soulledger://ask?q=%E6%80%8E%E4%B9%88%E7%94%B3%E8%AF%B7"));
    // First use: the 「它只看不做」 notice comes first; the question waits behind it.
    await passNotice();
    const input = await screen.findByTestId("assist-input");
    await waitFor(() => expect(input.props.value).toBe("怎么申请"));
    // A sent question empties the box and starts an answer; neither has happened.
    await act(async () => {});
    expect(screen.getByTestId("assist-input").props.value).toBe("怎么申请");
  });

  it("assist without a question leaves the box empty", async () => {
    signedIn();
    renderApp();
    await screen.findByTestId("profile-card");
    await act(async () => soulLinks.push("soulledger://assist"));
    await passNotice();
    expect((await screen.findByTestId("assist-input")).props.value).toBe("");
  });

  it("a link opened while signed out is kept and applied after login", async () => {
    stubApi({
      "/soul-auth/login/": { status: 200, data: { access: "A", refresh: "R", soul_code: PROFILE.soul_code, account: PROFILE.account } },
      "/me/": { status: 200, data: PROFILE },
      "/me/life/": { status: 200, data: life(1) },
      "/me/rebirth-applications/": { status: 200, data: APPLICATIONS },
      "GET /me/notification-settings/": { status: 200, data: { rebirth: true, judgment: true, residence: true, chat: true, locale: "zh-Hans" } },
    });
    renderApp();
    fireEvent.changeText(await screen.findByTestId("login-soul-code"), "SL-CN-000042");
    await act(async () => soulLinks.push("soulledger://cooldown"));
    expect(navigationRef.getCurrentRoute()?.name).toBe("Login");
    fireEvent.changeText(screen.getByTestId("login-password"), "initial-pass");
    fireEvent.press(screen.getByTestId("login-submit"));
    await waitFor(() => expect(navigationRef.getCurrentRoute()?.name).toBe("Applications"));
    await screen.findByTestId("tab-Applications");
    await act(async () => {});
  });

  it("an unknown link changes nothing", async () => {
    signedIn();
    renderApp();
    await screen.findByTestId("profile-card");
    await act(async () => soulLinks.push("soulledger://nowhere"));
    expect(navigationRef.getCurrentRoute()?.name).toBe("Life");
  });
});
