/**
 * Civilization rules as the soul sees them, through the real navigator:
 *
 *   skin      follows where the soul IS (its current tenant)
 *   words     follow where the soul BELONGS (home tenant; user decision 2026-09-17)
 *   rebirth   is the server's to decide (`can_apply` / `reason`); a terminal
 *             civilization gets the permanent disabled entry and its own empty state
 */
import { REFRESH_TOKEN_KEY } from "@soulledger/core/platform";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen, within } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "../i18n";
import { RootNavigator } from "../navigation";
import { installMobilePlatform } from "../platform";
import { SessionProvider } from "../session";
import { themeFor } from "../theme";
import { PROFILE, application, life, stubApi } from "./stubApi";

const secure = (SecureStore as unknown as { __store: Map<string, string> }).__store;

const EG_TENANT = { code: "EG_DUAT", display_name: "杜阿特" };
const CN_TENANT = { code: "CN_DIYU", display_name: "中国地府" };

/** A Chinese soul dispatched to the Duat. */
const RESIDING = { ...PROFILE, civilization: "EGYPTIAN", tenant: EG_TENANT, home_tenant: CN_TENANT };
/** A soul of the Duat, at home. */
const NATIVE_EG = { ...PROFILE, civilization: "EGYPTIAN", tenant: EG_TENANT };

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

beforeEach(async () => {
  installMobilePlatform();
  secure.clear();
  secure.set(REFRESH_TOKEN_KEY, "R");
  await AsyncStorage.clear();
});

const background = (el: { props: { style?: unknown } }) =>
  (StyleSheet.flatten(el.props.style as never) as { backgroundColor?: string }).backgroundColor;

describe("a soul residing in another civilization", () => {
  it("wears the Duat's colours, keeps the words of its home, and says where it is from", async () => {
    stubApi({ "/me/": { status: 200, data: RESIDING }, "/me/life/": { status: 200, data: life(1) } });
    renderApp();
    const card = await screen.findByTestId("profile-card");
    expect(background(card)).toBe(themeFor("EGYPTIAN", "light").s0); // jest reports a light scheme
    expect(background(card)).not.toBe(themeFor("CHINESE", "light").s0);
    // Home lexicon: 功 / 过 and 审判中 — none of the Duat's words.
    expect(screen.getByText("功")).toBeTruthy();
    expect(screen.getByText("过")).toBeTruthy();
    expect(screen.queryByText("羽侧")).toBeNull();
    expect(screen.queryByText("心侧")).toBeNull();
    expect(within(screen.getByTestId("soul-state")).getByText("审判中")).toBeTruthy();
    expect(screen.queryByText("称心中")).toBeNull();
    expect(screen.getByTestId("residence").props.children).toBe("暂居 埃及 · 原属 中国");
  });

  it("may apply when the server says so — the Duat having no rebirth does not disable it", async () => {
    stubApi({
      "/me/": { status: 200, data: RESIDING },
      "/me/life/": { status: 200, data: life(1) },
      "/me/rebirth-applications/": { status: 200, data: { can_apply: true, reason: null, cooldown_until: null, results: [] } },
    });
    renderApp();
    await screen.findByTestId("profile-card");
    fireEvent.press(screen.getByTestId("tab-Applications"));
    const apply = await screen.findByTestId("apply");
    expect(apply.props.accessibilityState.disabled).toBe(false);
    expect(screen.queryByTestId("terminal-empty")).toBeNull();
    expect(screen.getByText("还没有转生申请")).toBeTruthy();
  });

  it("an application from before the dispatch is appealable whenever the server says can_appeal", async () => {
    stubApi({
      "/me/": { status: 200, data: RESIDING },
      "/me/life/": { status: 200, data: life(1, { rebirth_applications: [application({ status: "REJECTED", can_appeal: true, current_step: null })] }) },
      "/me/rebirth-applications/a1/": { status: 200, data: application({ status: "REJECTED", can_appeal: true, current_step: null, rejection_reason: "x" }) },
    });
    renderApp();
    fireEvent.press(await screen.findByTestId("section-applications-toggle"));
    fireEvent.press(await screen.findByTestId("life-open-a1"));
    expect(await screen.findByTestId("appeal")).toBeTruthy();
    expect(screen.queryByText(/往簿/)).toBeNull();
  });
});

describe("a native soul of the Duat", () => {
  it("reads feather side / heart side over the same two integers, and 称心中", async () => {
    stubApi({ "/me/": { status: 200, data: NATIVE_EG }, "/me/life/": { status: 200, data: life(1) } });
    renderApp();
    await screen.findByTestId("profile-card");
    expect(within(screen.getByTestId("score-merit")).getByText("羽侧")).toBeTruthy();
    expect(within(screen.getByTestId("score-merit")).getByText(String(PROFILE.merit_score))).toBeTruthy();
    expect(within(screen.getByTestId("score-demerit")).getByText("心侧")).toBeTruthy();
    expect(within(screen.getByTestId("score-demerit")).getByText(String(PROFILE.demerit_score))).toBeTruthy();
    expect(within(screen.getByTestId("soul-state")).getByText("称心中")).toBeTruthy();
    expect(screen.queryByText("功")).toBeNull();
    expect(screen.queryByTestId("residence")).toBeNull();
  });

  it("terminal cosmology: the entry stays, permanently disabled with the fixed reason, over the Duat's own empty state", async () => {
    stubApi({
      "/me/": { status: 200, data: NATIVE_EG },
      "/me/life/": { status: 200, data: life(1) },
      "/me/rebirth-applications/": {
        status: 200,
        data: { can_apply: false, reason: "terminal_cosmology", cooldown_until: null, results: [] },
      },
    });
    renderApp();
    await screen.findByTestId("profile-card");
    fireEvent.press(screen.getByTestId("tab-Applications"));
    const apply = await screen.findByTestId("apply");
    expect(apply.props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId("eligibility-reason").props.children).toBe("你所属的文明没有转生。此处的去向是终局。");
    const empty = screen.getByTestId("terminal-empty");
    expect(within(empty).getByText("杜阿特没有转生")).toBeTruthy();
    expect(screen.queryByText("还没有转生申请")).toBeNull();
  });

  it("no past lives is said as the Duat says it, not as 'no records'", async () => {
    stubApi({
      "/me/": { status: 200, data: NATIVE_EG },
      "/me/life/": { status: 200, data: life(1) },
      "/me/past-lives/": { status: 200, data: [] },
    });
    renderApp();
    await screen.findByTestId("profile-card");
    fireEvent.press(screen.getByTestId("tab-PastLives"));
    expect((await screen.findByTestId("past-lives-empty")).props.children).toBe("杜阿特没有前世。你只有这一世，此后不再入簿。");
  });

  it("…while a residing Chinese soul with no past lives gets the ordinary sentence", async () => {
    stubApi({
      "/me/": { status: 200, data: RESIDING },
      "/me/life/": { status: 200, data: life(1) },
      "/me/past-lives/": { status: 200, data: [] },
    });
    renderApp();
    await screen.findByTestId("profile-card");
    fireEvent.press(screen.getByTestId("tab-PastLives"));
    expect((await screen.findByTestId("past-lives-empty")).props.children).toBe("没有前世记录");
  });
});
