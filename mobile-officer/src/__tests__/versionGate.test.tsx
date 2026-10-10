/** The officer app wires the shared gate in with its own app id; same rule: fail open, block only below the minimum. */
import { act, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { VersionGate } from "../shared";
import { renderOfficer } from "./harness";

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

async function mount() {
  renderOfficer(
    <VersionGate app="officer">
      <Text testID="app-body">desk</Text>
    </VersionGate>,
    { user: null }
  );
  await act(async () => {});
}

test("below the minimum: the update screen, for a signed-out officer too, asking for the officer policy", async () => {
  const f = jest.fn(async (_url: string) => ({ ok: true, json: async () => ({ min_supported: "9.0.0", latest: "9.0.0", store_url: "https://s.test" }) }));
  global.fetch = f as unknown as typeof fetch;
  await mount();
  expect(screen.getByTestId("update-required")).toBeTruthy();
  expect(screen.queryByTestId("app-body")).toBeNull();
  expect(String(f.mock.calls[0][0])).toContain("app=officer");
});

test("the officer's body names the running and the required version; the soul's wording is absent", async () => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ min_supported: "9.0.0", latest: "9.0.0", store_url: "https://s.test" }) })) as unknown as typeof fetch;
  await mount();
  expect(screen.getByText("当前版本 0.1.0 低于本殿要求的最低版本 9.0.0。")).toBeTruthy();
  expect(screen.queryByText(/书信和档案/)).toBeNull();
  expect(screen.getByTestId("update-version").props.children).toBe("版本 0.1.0");
  expect(screen.getByText("去更新")).toBeTruthy();
});

test("a failed check lets the officer in", async () => {
  global.fetch = jest.fn(async () => {
    throw new Error("offline");
  }) as unknown as typeof fetch;
  await mount();
  expect(screen.getByTestId("app-body")).toBeTruthy();
  expect(screen.queryByTestId("update-required")).toBeNull();
});
