/**
 * Design v4 第六十一批 E6 on the 本世 page: a pull that fails says so once. When the page's own refresh failed, the
 * stale line says it, and the profile refresh failing in the same pull adds no 「无法连接服务器」 toast (simulator
 * 2026-11-21: both showed, and the toast stayed up). When only the profile failed there is no line, so the toast
 * is the one message.
 */
import { REFRESH_TOKEN_KEY } from "@soulledger/core/platform";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, screen } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";

import { RootNavigator } from "../navigation";
import { installMobilePlatform } from "@soulledger/mobile-ui/src/platform";
import { SessionProvider } from "../session";
import { Screen } from "@soulledger/mobile-ui/src/ui";
import { renderSoul } from "./harness";
import { PROFILE, life, resetLoginMemory, stubApi } from "./stubApi";

const secure = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const NETWORK = "无法连接服务器，请检查网络后重试";

beforeEach(async () => {
  installMobilePlatform();
  resetLoginMemory();
  secure.clear();
  secure.set(REFRESH_TOKEN_KEY, "R");
  await AsyncStorage.clear();
});

async function pull() {
  await screen.findByTestId("profile-card");
  const page = screen.UNSAFE_getAllByType(Screen).find((s) => s.props.testID === "profile-card")!;
  await act(async () => void page.props.onRefresh());
  await act(async () => {});
}

const ME = { ...PROFILE, welcomed_civilizations: ["CHINESE"] };

it("the page and the profile both fail: the stale line, and no toast", async () => {
  stubApi({ "/me/": [{ status: 200, data: ME }, "offline"], "/me/life/": [{ status: 200, data: life(1) }, "offline"] });
  renderSoul(
    <SessionProvider>
      <RootNavigator />
    </SessionProvider>
  );
  await pull();
  expect(await screen.findByTestId("stale-line")).toBeTruthy();
  expect(screen.queryByText(NETWORK)).toBeNull();
});

it("only the profile fails: no stale line, so the toast says it", async () => {
  stubApi({ "/me/": [{ status: 200, data: ME }, "offline"], "/me/life/": { status: 200, data: life(1) } });
  renderSoul(
    <SessionProvider>
      <RootNavigator />
    </SessionProvider>
  );
  await pull();
  expect(await screen.findByText(NETWORK)).toBeTruthy();
  expect(screen.queryByTestId("stale-line")).toBeNull();
});
