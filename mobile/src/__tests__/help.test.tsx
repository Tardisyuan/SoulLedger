/**
 * 帮助 (Design 第二十八批 S5), through the real navigator: the three groups and Design's first-version answers,
 * 「没找到答案？ / 写给本殿」 at the bottom, and the sign-in page's 「登录遇到问题」, which shows only 登录与账号 and
 * works signed out.
 */
import { REFRESH_TOKEN_KEY } from "@soulledger/core/platform";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "../i18n";
import { RootNavigator } from "../navigation";
import { installMobilePlatform, sessionStore } from "../platform";
import { SessionProvider } from "../session";
import { PROFILE, life, resetLoginMemory, stubApi } from "./stubApi";

const secure = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const SETTINGS = { rebirth: true, judgment: true, residence: true, chat: true, locale: "zh-Hans" };

/** The answers as Design wrote them (Batch28Content.dc.html, 「常见问题 · 第一版答案」), punctuation included. */
const ANSWERS = {
  login: "先检查编号有没有输错。密码连续输错 5 次会锁 15 分钟，等一会儿再试。还是不行，点「忘记密码」。",
  forgot: "在登录页点「忘记密码」,验证码会发到你登记的联系邮箱。没有登记邮箱的，请到本殿窗口办理，带上交付单。",
  phone: "用另一部手机登录，到「账号安全 › 登录设备与记录」让丢的那部退出，再改密码。开了两步验证的，用恢复码登录。恢复码也没有了，请到本殿窗口办理。",
  slip: "你到殿时领的那张纸，上面有你的编号和第一次登录用的密码。第一次登录后，这个密码就不能再用了。交付单请收好，到窗口办事时要用。",
  contact: "在这页底部点「写给本殿」,回复会出现在书信里。急事请到本殿窗口。",
};
const QUESTIONS = { login: "登录不了", forgot: "忘记密码", phone: "手机丢了", slip: "交付单是什么", contact: "怎么联系本殿" };

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
  resetLoginMemory();
  secure.clear();
  sessionStore.remove("soulledger_access");
  await AsyncStorage.clear();
});

describe("from the sign-in page, signed out", () => {
  async function openFromLogin() {
    stubApi({});
    renderApp();
    await act(async () => {});
    fireEvent.press(await screen.findByTestId("login-trouble"));
    await screen.findByTestId("help");
  }

  it("has 「登录遇到问题」 at the bottom of the page, under the form and above the languages", async () => {
    stubApi({});
    renderApp();
    await act(async () => {});
    const link = await screen.findByTestId("login-trouble");
    expect(within(link).getByText("登录遇到问题")).toBeTruthy();
    const tree = JSON.stringify(screen.toJSON());
    expect(tree.indexOf('"testID":"login-submit"')).toBeLessThan(tree.indexOf('"testID":"login-trouble"'));
  });

  it("opens the help page with ONLY 登录与账号: its three questions, and neither the other groups nor a way to write", async () => {
    await openFromLogin();
    expect(within(screen.getByTestId("help-group-login")).getByText("登录与账号")).toBeTruthy();
    for (const id of ["login", "forgot", "phone"] as const) expect(screen.getByTestId(`help-q-${id}`)).toHaveTextContent(QUESTIONS[id]);
    // the absences: nothing from the other groups, and no write button (a letter needs a signed-in soul)
    expect(screen.queryByTestId("help-group-visit")).toBeNull();
    expect(screen.queryByTestId("help-group-contact")).toBeNull();
    expect(screen.queryByTestId("help-q-slip")).toBeNull();
    expect(screen.queryByTestId("help-q-contact")).toBeNull();
    expect(screen.queryByTestId("help-write")).toBeNull();
    expect(screen.queryByText("没找到答案？")).toBeNull();
  });

  it("each question opens its answer, Design's words, and closes again", async () => {
    await openFromLogin();
    for (const id of ["login", "forgot", "phone"] as const) {
      expect(screen.queryByTestId(`help-a-${id}`)).toBeNull();
      fireEvent.press(screen.getByTestId(`help-q-${id}`));
      expect(screen.getByTestId(`help-a-${id}`)).toHaveTextContent(ANSWERS[id]);
    }
    fireEvent.press(screen.getByTestId("help-q-forgot"));
    expect(screen.queryByTestId("help-a-forgot")).toBeNull();
    expect(screen.getByTestId("help-a-login")).toBeTruthy();
  });
});

describe("from settings, signed in", () => {
  async function openFromSettings() {
    secure.set(REFRESH_TOKEN_KEY, "R");
    stubApi({
      "/me/": { status: 200, data: PROFILE },
      "/me/life/": { status: 200, data: life(1) },
      "GET /me/notification-settings/": { status: 200, data: SETTINGS },
      "GET /me/mfa/": { status: 200, data: { enabled: false } },
      "GET /me/sessions/": { status: 200, data: [] },
    });
    renderApp();
    await screen.findByTestId("profile-card");
    fireEvent.press(screen.getByTestId("header-account"));
    await screen.findByTestId("settings");
    await screen.findByTestId("push-toggles");
    await waitFor(() => expect(screen.getByTestId("open-mfa-state")).toBeTruthy());
    fireEvent.press(screen.getByTestId("open-help"));
    await screen.findByTestId("help");
  }

  it("shows all three groups with Design's five questions and answers", async () => {
    await openFromSettings();
    expect(within(screen.getByTestId("help-group-login")).getByText("登录与账号")).toBeTruthy();
    expect(within(screen.getByTestId("help-group-visit")).getByText("到殿须知")).toBeTruthy();
    expect(within(screen.getByTestId("help-group-contact")).getByText("联系")).toBeTruthy();
    for (const id of Object.keys(QUESTIONS) as (keyof typeof QUESTIONS)[]) {
      expect(screen.getByTestId(`help-q-${id}`)).toHaveTextContent(QUESTIONS[id]);
      fireEvent.press(screen.getByTestId(`help-q-${id}`));
      expect(screen.getByTestId(`help-a-${id}`)).toHaveTextContent(ANSWERS[id]);
    }
  });

  it("ends with 「没找到答案？」 and a bordered 「写给本殿」 that opens the form", async () => {
    await openFromSettings();
    const block = screen.getByTestId("help-write-block");
    expect(within(block).getByText("没找到答案？")).toBeTruthy();
    const button = within(block).getByTestId("help-write");
    expect(within(button).getByText("写给本殿")).toBeTruthy();
    fireEvent.press(button);
    await screen.findByTestId("feedback");
    expect(screen.getByTestId("feedback-send")).toBeTruthy();
  });
});

describe("第四十批 S-d: no letters here", () => {
  it("says which hall to go to (the hall the soul is in now), with no write button", async () => {
    secure.set(REFRESH_TOKEN_KEY, "R");
    const hall_names = { "zh-Hans": "酆都第十殿", en: "The Tenth Court", egy: "Yanluo Wesekhet" };
    stubApi({
      "/me/": { status: 200, data: { ...PROFILE, tenant: { ...PROFILE.tenant, hall_names } } },
      "/me/life/": { status: 200, data: life(1) },
      "/me/chat/session/": { status: 503, data: { code: "chat_not_configured" } },
      "GET /me/notification-settings/": { status: 200, data: SETTINGS },
      "GET /me/mfa/": { status: 200, data: { enabled: false } },
      "GET /me/sessions/": { status: 200, data: [] },
    });
    renderApp();
    await screen.findByTestId("profile-card");
    fireEvent.press(screen.getByTestId("header-account"));
    await screen.findByTestId("settings");
    fireEvent.press(await screen.findByTestId("open-help"));
    const block = await screen.findByTestId("help-in-person-block");
    expect(within(block).getByText("还是没解决")).toBeTruthy();
    expect(within(block).getByText("请到酆都第十殿,带上交付单")).toBeTruthy();
    expect(within(block).getByText("本殿还没开通书信，问题要到殿里当面办。")).toBeTruthy();
    expect(screen.queryByTestId("help-write")).toBeNull();
  });
});
