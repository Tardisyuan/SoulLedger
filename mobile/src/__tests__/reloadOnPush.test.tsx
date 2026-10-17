/**
 * Audit 2026-10-17 #9: a push arriving while the app is in front refreshes the page in front —
 * through `useReloadOnRefocus`, which every data page already calls. `useFocusEffect` runs as
 * `useEffect` here (no navigator): mounted = focused, unmounted = blurred.
 */
import { act, render } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";

import { useReloadOnRefocus } from "../ui";

jest.mock("@react-navigation/native", () => {
  const actual = jest.requireActual("@react-navigation/native");
  const { useEffect } = jest.requireActual("react");
  return { ...actual, useFocusEffect: (effect: () => void) => useEffect(effect, [effect]) };
});

const received = (Notifications as unknown as { __state: { receivedListeners: Set<(n: unknown) => void> } }).__state.receivedListeners;

function Page({ reload }: { reload: () => void }) {
  useReloadOnRefocus(reload);
  return null;
}

it("reloads when a notification arrives while the page is in front, and stops listening when it leaves", async () => {
  const reload = jest.fn();
  const page = render(<Page reload={reload} />);
  expect(reload).not.toHaveBeenCalled();
  await act(async () => received.forEach((fn) => fn({ request: { content: { data: { screen: "Applications" } } } })));
  expect(reload).toHaveBeenCalledTimes(1);
  page.unmount();
  expect(received.size).toBe(0);
});
