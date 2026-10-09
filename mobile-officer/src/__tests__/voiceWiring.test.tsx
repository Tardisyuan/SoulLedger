/**
 * The officer's spoken number: the to-do tab publishes the total of its four group counts each
 * time it fetches them (a number, never an item), and signing out clears the cache.
 * The native writer is mobile/src/__tests__/voiceCache.test.ts; here it is a double.
 */
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";

import { SessionProvider, useSession } from "../session";
import { TodoTab } from "../screens/todo";
import { renderOfficer } from "./harness";

const mockTodo = jest.fn();
jest.mock("@soulledger/core/api/officer-app", () => ({
  ...jest.requireActual("@soulledger/core/api/officer-app"),
  officerAppApi: { todo: (...a: unknown[]) => mockTodo(...a) },
}));
const mockPublish = jest.fn();
const mockClear = jest.fn();
jest.mock("../../../mobile/src/voiceCache", () => ({
  ...jest.requireActual("../../../mobile/src/voiceCache"),
  publishVoiceNumber: (...a: unknown[]) => mockPublish(...a),
  clearVoiceNumbers: (...a: unknown[]) => mockClear(...a),
}));

const group = (n: number) => ({ count: n, items: [] });

beforeEach(() => jest.clearAllMocks());

describe("the to-do total", () => {
  it("is the sum of the four groups' counts", async () => {
    mockTodo.mockResolvedValue({ data: { approvals: group(2), reassignments: group(1), cooldowns: group(0), rebirths: group(3) } });
    renderOfficer(<TodoTab onOpen={jest.fn()} highlight={null} />);
    await waitFor(() => expect(mockPublish).toHaveBeenCalledWith("todo", 6));
  });

  it("is 0, not absent, when nothing is waiting", async () => {
    mockTodo.mockResolvedValue({ data: { approvals: group(0), reassignments: group(0), cooldowns: group(0), rebirths: group(0) } });
    renderOfficer(<TodoTab onOpen={jest.fn()} highlight={null} />);
    await waitFor(() => expect(mockPublish).toHaveBeenCalledWith("todo", 0));
  });

  it("is not published when the fetch failed", async () => {
    mockTodo.mockRejectedValue(new Error("offline"));
    renderOfficer(<TodoTab onOpen={jest.fn()} highlight={null} />);
    await screen.findByTestId("tab-todo-screen");
    expect(mockPublish).not.toHaveBeenCalled();
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
    renderOfficer(
      <SessionProvider>
        <Probe />
      </SessionProvider>
    );
    fireEvent.press(screen.getByTestId("out"));
    expect(mockClear).toHaveBeenCalledTimes(1);
  });
});
