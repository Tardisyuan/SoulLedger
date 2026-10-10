/**
 * The forced-upgrade screen appears only when the backend names a minimum above this build, and
 * never because the check failed. The screen sits above the session, so signed-out users see it too.
 */
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Linking, Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "../i18n";
import { VersionGate } from "../versionGate";

// jest.setup pins the app version to 0.1.0.
const reply = (body: unknown, ok = true) =>
  (global.fetch = jest.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch);
const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

async function mount() {
  const view = render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <I18nProvider>
        <VersionGate app="soul">
          <Text testID="app-body">the app</Text>
        </VersionGate>
      </I18nProvider>
    </SafeAreaProvider>
  );
  await act(async () => {});
  return view;
}

const policy = (min: string, url = "https://store.test/app") => ({ min_supported: min, latest: min, store_url: url });

test("below the minimum: the update screen replaces the app and opens the store", async () => {
  reply(policy("0.2.0"));
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  await mount();
  expect(screen.getByTestId("update-required")).toBeTruthy();
  expect(screen.queryByTestId("app-body")).toBeNull();
  fireEvent.press(screen.getByTestId("update-open-store"));
  expect(open).toHaveBeenCalledWith("https://store.test/app");
});

test("the screen: mark, title, the soul's own body, one button, the running version; nothing to close", async () => {
  reply(policy("0.2.0"));
  await mount();
  expect(screen.getByTestId("update-mark", { includeHiddenElements: true })).toBeTruthy();
  expect(screen.getByText("需要更新")).toBeTruthy();
  expect(screen.getByText("这一版已经不能用了。更新后，你的书信和档案都还在。")).toBeTruthy();
  expect(screen.getByText("去更新")).toBeTruthy();
  expect(screen.getByTestId("update-version").props.children).toBe("版本 0.1.0");
  // Absence: the officer wording, a second button, a close control.
  expect(screen.queryByText(/低于本殿要求/)).toBeNull();
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(screen.queryByText("取消")).toBeNull();
});

test("no store link from the backend: no button, the rest of the screen stays", async () => {
  reply(policy("0.2.0", ""));
  await mount();
  expect(screen.getByTestId("update-required")).toBeTruthy();
  expect(screen.queryByTestId("update-open-store")).toBeNull();
  expect(screen.getByTestId("update-version")).toBeTruthy();
});

test.each([
  ["version is enough", () => reply(policy("0.1.0"))],
  ["above the current version only as latest, minimum empty", () => reply({ min_supported: "", latest: "9.9.9", store_url: "" })],
  ["not configured", () => reply({ min_supported: "", latest: "", store_url: "" })],
  ["minimum is not a version", () => reply(policy("soon"))],
  ["the endpoint answers 500", () => reply({}, false)],
  [
    "the network is down",
    () => {
      global.fetch = jest.fn(async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch;
    },
  ],
])("%s: the app is shown, the update screen is not", async (_name, arrange) => {
  arrange();
  await mount();
  expect(screen.getByTestId("app-body")).toBeTruthy();
  expect(screen.queryByTestId("update-required")).toBeNull();
});
