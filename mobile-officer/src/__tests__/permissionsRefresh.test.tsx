/**
 * RBAC review M1: a grant changed after sign-in reaches the button gates without signing in again.
 * The real SessionProvider re-reads `/auth/profile/` (which carries `permissions`) at start and every
 * time the app comes back to the foreground; `useCan` reads the refreshed list.
 */
import { act, render, screen } from "@testing-library/react-native";
import { AppState, Text } from "react-native";

import { REFRESH_TOKEN_KEY, platform } from "@soulledger/core/platform";
import { SessionProvider, USER_KEY, useCan } from "../session";
import { OFFICER } from "./harness";

const mockProfile = jest.fn();
jest.mock("@soulledger/core/api/auth", () => ({
  ...jest.requireActual("@soulledger/core/api/auth"),
  authApi: { profile: (...a: unknown[]) => mockProfile(...a), logout: jest.fn(async () => ({})) },
}));

function Gate() {
  const canExecute = useCan("judgment.execute");
  const canAssign = useCan("judgment.assign");
  return <Text testID="gate">{`${canExecute ? "execute" : "-"} ${canAssign ? "assign" : "-"}`}</Text>;
}

let foreground: ((next: string) => void) | null = null;

beforeEach(() => {
  jest.clearAllMocks();
  foreground = null;
  jest.spyOn(AppState, "addEventListener").mockImplementation(((_type: string, fn: (next: string) => void) => {
    foreground = fn;
    return { remove: () => void (foreground = null) };
  }) as unknown as typeof AppState.addEventListener);
  platform().persistent.set(USER_KEY, JSON.stringify(OFFICER)); // holds judgment.execute, not judgment.assign
  platform().secure.set(REFRESH_TOKEN_KEY, "R");
});

afterEach(() => {
  platform().persistent.remove(USER_KEY);
  platform().secure.remove(REFRESH_TOKEN_KEY);
  jest.restoreAllMocks();
});

const profileWith = (permissions?: string[]) => ({ data: { ...OFFICER, permissions } });

async function boot() {
  render(
    <SessionProvider>
      <Gate />
    </SessionProvider>
  );
  await act(async () => {});
}

async function comeBack() {
  await act(async () => {
    foreground?.("background");
    foreground?.("active");
  });
}

it("the start-up profile replaces the cached permission list", async () => {
  mockProfile.mockResolvedValue(profileWith(["judgment.assign"]));
  await boot();
  expect(screen.getByTestId("gate").props.children).toBe("- assign");
  expect(JSON.parse(platform().persistent.get(USER_KEY)!).permissions).toEqual(["judgment.assign"]);
});

it("a grant given while the app slept shows on returning to the foreground; a revoke hides it again", async () => {
  mockProfile.mockResolvedValue(profileWith(OFFICER.permissions));
  await boot();
  expect(screen.getByTestId("gate").props.children).toBe("execute -");

  mockProfile.mockResolvedValue(profileWith([...OFFICER.permissions, "judgment.assign"]));
  await comeBack();
  expect(mockProfile).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId("gate").props.children).toBe("execute assign");

  mockProfile.mockResolvedValue(profileWith(["workflow.approve"]));
  await comeBack();
  expect(screen.getByTestId("gate").props.children).toBe("- -");
});

it("a profile without the list (an older server) keeps the cached one", async () => {
  mockProfile.mockResolvedValue(profileWith());
  await boot();
  expect(screen.getByTestId("gate").props.children).toBe("execute -");
});

it("a failed refresh keeps the cached list", async () => {
  mockProfile.mockRejectedValue(new Error("offline"));
  await boot();
  await comeBack();
  expect(screen.getByTestId("gate").props.children).toBe("execute -");
});

// opt-apps2 N2: iOS reports inactive → active after the face sheet or a system alert -- not a return.
it("inactive → active asks nothing; background → active does", async () => {
  mockProfile.mockResolvedValue(profileWith(OFFICER.permissions));
  await boot();
  expect(mockProfile).toHaveBeenCalledTimes(1);
  await act(async () => {
    foreground?.("inactive");
    foreground?.("active");
  });
  expect(mockProfile).toHaveBeenCalledTimes(1);
  await comeBack();
  expect(mockProfile).toHaveBeenCalledTimes(2);
});

// opt-apps2 R1: an equal answer replaced the state (and rewrote the stored profile), redrawing the whole shell.
it("an unchanged profile keeps the session state and the stored copy as they were", async () => {
  const rendered = jest.fn();
  function Count() {
    useCan("judgment.execute");
    rendered();
    return null;
  }
  mockProfile.mockResolvedValue(profileWith(OFFICER.permissions));
  render(
    <SessionProvider>
      <Count />
    </SessionProvider>
  );
  await act(async () => {});
  const before = rendered.mock.calls.length;
  const write = jest.spyOn(platform().persistent, "set");
  await comeBack();
  expect(mockProfile).toHaveBeenCalledTimes(2);
  expect(rendered.mock.calls.length).toBe(before);
  expect(write.mock.calls.filter(([key]) => key === USER_KEY)).toEqual([]);
});
