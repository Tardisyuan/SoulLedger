/**
 * The reply box keeps its words on this phone: restored on open, saved while typing, gone once the reply
 * went out, kept when sending failed, and wiped when the officer signs out or the server ends the session.
 */
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";

import { platform } from "@soulledger/core/platform";
import { DRAFTS_KEY, DRAFT_KEEP, clearDrafts, flushDraft, readDraft, saveDraft, scheduleDraft } from "../drafts";
import { Detail } from "../screens/detail";
import { SessionProvider, useSession } from "../session";
import { httpError, renderOfficer } from "./harness";

const mockConvo = jest.fn();
const mockMessages = jest.fn();
const mockReply = jest.fn();
jest.mock("@soulledger/core/api/officer-app", () => ({
  ...jest.requireActual("@soulledger/core/api/officer-app"),
  officerAppApi: { todo: jest.fn(), registerPush: jest.fn(), unregisterPush: jest.fn() },
}));
jest.mock("@soulledger/core/api/soul-inbox", () => ({
  ...jest.requireActual("@soulledger/core/api/soul-inbox"),
  soulInboxApi: {
    get: (...a: unknown[]) => mockConvo(...a),
    messages: (...a: unknown[]) => mockMessages(...a),
    reply: (...a: unknown[]) => mockReply(...a),
    markRead: async () => ({ data: {} }),
  },
  inboxTemplatesApi: { list: jest.fn(async () => ({ data: [] })) },
}));
jest.mock("@soulledger/core/api/auth", () => ({
  ...jest.requireActual("@soulledger/core/api/auth"),
  authApi: { profile: jest.fn(async () => ({ data: {} })), logout: jest.fn(async () => ({})) },
}));

const stored = () => platform().persistent.get(DRAFTS_KEY);

async function openThread(id = "c-1") {
  const view = renderOfficer(<Detail target={{ type: "todo", kind: "letter", id }} onBack={() => {}} onSettled={jest.fn()} />);
  await screen.findByTestId("letter-thread");
  return view;
}

beforeEach(() => {
  jest.clearAllMocks();
  clearDrafts();
  mockConvo.mockResolvedValue({ data: { id: "c-1", soul_name: "李白", closed_at: null, last_from: "soul" } });
  mockMessages.mockResolvedValue({ data: [] });
  mockReply.mockResolvedValue({ data: {} });
});

describe("the reply box", () => {
  it("opens with the draft kept for THIS conversation, and empty for another", async () => {
    saveDraft("c-1", "先写了一半");
    saveDraft("c-2", "别人的信");
    const { unmount } = await openThread("c-1");
    expect(screen.getByTestId("letter-input").props.value).toBe("先写了一半");
    unmount();
    await openThread("c-3");
    expect(screen.getByTestId("letter-input").props.value).toBe("");
  });

  it("saves while typing, under its own conversation only", async () => {
    await openThread();
    fireEvent.changeText(screen.getByTestId("letter-input"), "正在写");
    await waitFor(() => expect(readDraft("c-1")).toBe("正在写"));
    expect(readDraft("c-2")).toBe("");
  });

  it("leaving the screen straight after typing does not lose the last words", async () => {
    const { unmount } = await openThread();
    fireEvent.changeText(screen.getByTestId("letter-input"), "刚打完就走");
    expect(readDraft("c-1")).toBe(""); // still waiting on the debounce
    unmount();
    expect(readDraft("c-1")).toBe("刚打完就走");
  });

  it("a reply that went out clears the draft, and nothing writes it back afterwards", async () => {
    await openThread();
    fireEvent.changeText(screen.getByTestId("letter-input"), "已发出");
    fireEvent.press(screen.getByTestId("letter-send"));
    await waitFor(() => expect(mockReply).toHaveBeenCalledWith("c-1", "已发出", expect.any(String)));
    await waitFor(() => expect(screen.getByTestId("letter-input").props.value).toBe(""));
    expect(stored()).toBeNull();
    // Run the debounced write now if one is still waiting (what its timer would do), instead of sleeping past
    // SAVE_DELAY_MS on real time — under load the sleep can end before the timer fires and prove nothing.
    act(() => flushDraft());
    expect(stored()).toBeNull();
  });

  it("a failed send keeps the words and the draft", async () => {
    mockReply.mockRejectedValue(httpError(500));
    await openThread();
    fireEvent.changeText(screen.getByTestId("letter-input"), "没发出去");
    fireEvent.press(screen.getByTestId("letter-send"));
    await screen.findByTestId("letter-failed");
    expect(screen.getByTestId("letter-input").props.value).toBe("没发出去");
    flushDraft();
    expect(readDraft("c-1")).toBe("没发出去");
  });
});

describe("the store", () => {
  it("keeps the most recent DRAFT_KEEP, newest first; editing an old one brings it forward", () => {
    for (let i = 0; i < DRAFT_KEEP + 5; i++) saveDraft(`c-${i}`, `t${i}`);
    const ids = (JSON.parse(stored()!) as { drafts: { id: string }[] }).drafts.map((d) => d.id);
    expect(ids).toHaveLength(DRAFT_KEEP);
    expect(ids[0]).toBe(`c-${DRAFT_KEEP + 4}`);
    expect(readDraft("c-0")).toBe(""); // the oldest went
    expect(readDraft("c-4")).toBe(""); // five went in all
    expect(readDraft("c-5")).toBe("t5");
    saveDraft("c-5", "改过");
    expect((JSON.parse(stored()!) as { drafts: { id: string }[] }).drafts[0].id).toBe("c-5");
  });

  it("an emptied box removes the draft (and the key, with the last one)", () => {
    saveDraft("c-1", "x");
    saveDraft("c-1", "  ");
    expect(readDraft("c-1")).toBe("");
    expect(stored()).toBeNull();
  });

  it("garbage in the key reads as no drafts", () => {
    platform().persistent.set(DRAFTS_KEY, "{not json");
    expect(readDraft("c-1")).toBe("");
    saveDraft("c-1", "好");
    expect(readDraft("c-1")).toBe("好");
  });
});

describe("whose drafts these are", () => {
  function Probe() {
    const { signOut } = useSession();
    return (
      <Pressable testID="out" onPress={signOut}>
        <Text>out</Text>
      </Pressable>
    );
  }

  it("signing out removes every draft, and a write still waiting cannot bring one back", () => {
    saveDraft("c-1", "旧官员的话");
    scheduleDraft("c-2", "还没落盘的");
    renderOfficer(
      <SessionProvider>
        <Probe />
      </SessionProvider>
    );
    fireEvent.press(screen.getByTestId("out"));
    expect(stored()).toBeNull();
    flushDraft();
    expect(stored()).toBeNull();
  });

  it("a session the server ended removes them too, even with the box open", async () => {
    saveDraft("c-9", "旧官员的话");
    const { unmount } = renderOfficer(
      <SessionProvider>
        <Detail target={{ type: "todo", kind: "letter", id: "c-1" }} onBack={() => {}} onSettled={jest.fn()} />
      </SessionProvider>
    );
    await screen.findByTestId("letter-thread");
    fireEvent.changeText(screen.getByTestId("letter-input"), "正打到一半");
    act(() => platform().onUnauthorized());
    expect(stored()).toBeNull();
    unmount(); // the unmount flush must not restore what was just wiped
    expect(stored()).toBeNull();
    expect(readDraft("c-1")).toBe("");
  });
});
