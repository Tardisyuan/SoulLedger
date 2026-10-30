/**
 * The circle status asked once for every reader on screen at that moment (cq-apps 2026-10-30 #7):
 * one request for readers mounted together, a fresh one for a page opened later, one more after a
 * write, and nothing from the account that signed out.
 */
import { soulSocialApi, type SoulSocialStatus } from "@soulledger/core/api/soul-social";
import { NavigationContainer } from "@react-navigation/native";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ToastProvider } from "../feedback";
import { I18nProvider } from "../i18n";
import { installMobilePlatform } from "../platform";
import { CircleInboxScreen, useUnreadInteractions } from "../screens/circleInbox";
import { clearSocialStatus, invalidateSocialStatus, useSocialStatus } from "../socialStatus";
import { stubApi } from "./stubApi";

jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: () => {},
}));

const status = (over: Partial<SoulSocialStatus> = {}): SoulSocialStatus =>
  ({ user_id: 1, can_write: true, muted_until: null, reports_remaining: 5, unread_interactions: 0, ...over }) as SoulSocialStatus;

/** `status()` answered by hand, one deferred per call. */
function held() {
  const answers: ((s: SoulSocialStatus) => void)[] = [];
  const spy = jest.spyOn(soulSocialApi, "status").mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
  return { spy, answer: (i: number, s: SoulSocialStatus) => act(async () => answers[i](s)) };
}

function readers(n: number) {
  return renderHook(() => Array.from({ length: n }, () => useSocialStatus()));
}

beforeEach(() => {
  installMobilePlatform();
  clearSocialStatus();
});
afterEach(() => jest.restoreAllMocks());

describe("circle status", () => {
  it("readers mounted together share one request, and each gets the answer", async () => {
    const { spy, answer } = held();
    const { result } = readers(3);
    expect(spy).toHaveBeenCalledTimes(1);
    await answer(0, status({ unread_interactions: 4 }));
    expect(result.current.map((r) => r.data?.unread_interactions)).toEqual([4, 4, 4]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("a page opened after the answer asks again, and sees the new mute", async () => {
    const { spy, answer } = held();
    readers(1);
    await answer(0, status());
    const later = readers(1);
    expect(spy).toHaveBeenCalledTimes(2);
    await answer(1, status({ can_write: false, muted_until: "2026-11-01T00:00:00Z" }));
    expect(later.result.current[0].data?.can_write).toBe(false);
  });

  it("a write makes every mounted reader ask again, in one request, and drops the answer then on its way", async () => {
    const { spy, answer } = held();
    const { result } = readers(2);
    act(() => invalidateSocialStatus());
    expect(spy).toHaveBeenCalledTimes(2);
    await answer(1, status({ unread_interactions: 0 }));
    // The answer asked for before the write arrives last and is not painted over the new one.
    await answer(0, status({ unread_interactions: 9 }));
    expect(result.current.map((r) => r.data?.unread_interactions)).toEqual([0, 0]);
  });

  it("after sign-out the next account never receives the last one's answer", async () => {
    const { spy, answer } = held();
    const before = readers(1);
    before.unmount();
    clearSocialStatus();
    const after = readers(1);
    expect(spy).toHaveBeenCalledTimes(2);
    await answer(0, status({ user_id: 1, unread_interactions: 7 }));
    expect(after.result.current[0].data).toBeNull();
    await answer(1, status({ user_id: 2 }));
    expect(after.result.current[0].data?.user_id).toBe(2);
  });
});

describe("circle status · 互动消息 wiring", () => {
  function Bar() {
    const unread = useUnreadInteractions();
    return <>{unread ? <ShowBadge n={unread} /> : null}</>;
  }
  function ShowBadge({ n }: { n: string }) {
    return <Text testID="badge">{n}</Text>;
  }

  it("opening 互动消息 marks all read and the bar's badge asks again and clears, without leaving the page", async () => {
    let unread = 3;
    const calls = stubApi({
      "/me/social/interactions/": { status: 200, data: { count: 0, next: null, previous: null, results: [] } },
      "POST /me/social/interactions/read/": { status: 204 },
    });
    const statusSpy = jest.spyOn(soulSocialApi, "status").mockImplementation(async () => status({ unread_interactions: unread }));
    let markRead!: () => void;
    const readSpy = jest.spyOn(soulSocialApi, "readInteractions").mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          markRead = () => {
            unread = 0;
            resolve(undefined);
          };
        })
    );
    render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <I18nProvider>
          <ToastProvider>
            <NavigationContainer>
              <Bar />
              <CircleInboxScreen />
            </NavigationContainer>
          </ToastProvider>
        </I18nProvider>
      </SafeAreaProvider>
    );
    await waitFor(() => expect(readSpy).toHaveBeenCalledTimes(1));
    expect((await screen.findByTestId("badge")).props.children).toBe("3");
    expect(statusSpy).toHaveBeenCalledTimes(1);
    await act(async () => markRead());
    await waitFor(() => expect(screen.queryByTestId("badge")).toBeNull());
    expect(statusSpy).toHaveBeenCalledTimes(2);
    expect(calls.some((c) => c.url.includes("/interactions/"))).toBe(true);
  });
});
