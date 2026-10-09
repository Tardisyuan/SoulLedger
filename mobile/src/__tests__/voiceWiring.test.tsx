/**
 * Where the spoken number comes from and goes (src/voiceCache.ts): the rebirth tab publishes the
 * days of cooldown each time it fetches them, and every way out of a session clears the cache.
 * The native writer itself is voiceCache.test.ts; here it is a double.
 */
import { REFRESH_TOKEN_KEY } from "@soulledger/core/platform";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { Pressable, Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "../i18n";
import { soulLinks } from "../links";
import { RootNavigator, navigationRef } from "../navigation";
import { installMobilePlatform } from "../platform";
import { SessionProvider, useSession } from "../session";
import { PROFILE, life, stubApi } from "./stubApi";

const mockPublish = jest.fn();
const mockClear = jest.fn();
jest.mock("../voiceCache", () => ({
  ...jest.requireActual("../voiceCache"),
  publishVoiceNumber: (...a: unknown[]) => mockPublish(...a),
  clearVoiceNumbers: (...a: unknown[]) => mockClear(...a),
}));

const secure = (SecureStore as unknown as { __store: Map<string, string> }).__store;

beforeEach(async () => {
  jest.clearAllMocks();
  installMobilePlatform();
  secure.clear();
  await AsyncStorage.clear();
});

describe("the cooldown number", () => {
  it("is published, in whole days rounded up, when the rebirth tab has fetched it", async () => {
    secure.set(REFRESH_TOKEN_KEY, "R");
    const until = new Date(Date.now() + 3.5 * 86_400_000).toISOString();
    stubApi({
      "/me/": { status: 200, data: PROFILE },
      "/me/life/": { status: 200, data: life(1) },
      "/me/rebirth-applications/": { status: 200, data: { can_apply: false, reason: "cooldown", cooldown_until: until, results: [] } },
      "GET /me/notification-settings/": { status: 200, data: { rebirth: true, judgment: true, residence: true, chat: true, locale: "zh-Hans" } },
      "/me/assist/conversations/": { status: 200, data: [] },
    });
    render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <I18nProvider>
          <SessionProvider>
            <RootNavigator />
          </SessionProvider>
        </I18nProvider>
      </SafeAreaProvider>
    );
    await screen.findByTestId("profile-card");
    await act(async () => soulLinks.push("soulledger://cooldown"));
    await waitFor(() => expect(navigationRef.getCurrentRoute()?.name).toBe("Applications"));
    await waitFor(() => expect(mockPublish).toHaveBeenCalledWith("cooldown", 4));
  });
});

describe("signing out", () => {
  function Probe() {
    const { signOut } = useSession();
    return (
      <Pressable testID="out" onPress={signOut}>
        <Text>out</Text>
      </Pressable>
    );
  }

  it("clears the spoken numbers", () => {
    render(
      <I18nProvider>
        <SessionProvider>
          <Probe />
        </SessionProvider>
      </I18nProvider>
    );
    expect(mockClear).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("out"));
    expect(mockClear).toHaveBeenCalledTimes(1);
  });
});
