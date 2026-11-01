/**
 * The reply box keeps its words on this phone: restored on open, saved while typing, gone once the reply
 * went out, kept when sending failed, and wiped when the officer signs out or the server ends the session.
 */
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";

import { REFRESH_TOKEN_KEY, platform } from "@soulledger/core/platform";
import { DRAFTS_KEY, DRAFT_KEEP, clearDraft, clearDrafts, draftIds, flushDraft, mergeServerDraft, pushDrafts, readDraft, saveDraft, scheduleDraft, settleDraft } from "../drafts";
import { OnlineContext } from "../../../mobile/src/online";
import { clearOutbox, discardReply, enqueueReply, flushOutbox } from "../outbox";
import { Detail } from "../screens/detail";
import { SessionProvider, USER_KEY, useSession } from "../session";
import { OFFICER, httpError, renderOfficer } from "./harness";

const mockConvo = jest.fn();
const mockMessages = jest.fn();
const mockReply = jest.fn();
const mockServerDraft = jest.fn();
const mockPutDraft = jest.fn();
const mockDeleteDraft = jest.fn();
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
    draft: (...a: unknown[]) => mockServerDraft(...a),
    saveDraft: (...a: unknown[]) => mockPutDraft(...a),
    clearDraft: (...a: unknown[]) => mockDeleteDraft(...a),
  },
  inboxTemplatesApi: { list: jest.fn(async () => ({ data: [] })) },
}));
jest.mock("@soulledger/core/api/auth", () => ({
  ...jest.requireActual("@soulledger/core/api/auth"),
  authApi: { profile: jest.fn(async () => ({ data: {} })), logout: jest.fn(async () => ({})) },
}));

const stored = () => platform().persistent.get(DRAFTS_KEY);
const serverDraft = (draft: string, at: string | null = null) => ({ draft, draft_saved_at: at, archived_at: null, last_read_at: null });
const signedInAs = (id: number) => platform().persistent.set(USER_KEY, JSON.stringify({ ...OFFICER, id }));
const iso = (ms: number) => new Date(ms).toISOString();
const settle = () => act(async () => {});

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
  mockServerDraft.mockResolvedValue({ data: serverDraft("") });
  mockPutDraft.mockResolvedValue({ data: {} });
  mockDeleteDraft.mockResolvedValue({ data: {} });
});
afterEach(() => {
  clearDrafts();
  clearOutbox();
  platform().persistent.remove(USER_KEY);
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
      <Pressable testID="out" onPress={() => signOut()}>
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

  // User, 2026-11-01: the server ending the session keeps the words for the same officer (signInKeepsUnsent.test.tsx);
  // with nobody signed in they are nobody's, and the box's last keystrokes are written under the officer they belong to.
  it("a session the server ended keeps them, unread, even with the box open", async () => {
    platform().persistent.set(USER_KEY, JSON.stringify({ ...OFFICER, id: 41 }));
    platform().secure.set(REFRESH_TOKEN_KEY, "r-41"); // signed in, so the box is open under officer 41
    saveDraft("c-9", "旧官员的话");
    const { unmount } = renderOfficer(
      <SessionProvider>
        <Detail target={{ type: "todo", kind: "letter", id: "c-1" }} onBack={() => {}} onSettled={jest.fn()} />
      </SessionProvider>
    );
    await screen.findByTestId("letter-thread");
    fireEvent.changeText(screen.getByTestId("letter-input"), "正打到一半");
    act(() => platform().onUnauthorized());
    unmount();
    platform().secure.remove(REFRESH_TOKEN_KEY);
    expect(readDraft("c-1")).toBe(""); // nobody is signed in now
    const kept = JSON.parse(stored()!) as { owner: string; drafts: { id: string; text: string }[] };
    expect(kept.owner).toBe("id:41");
    expect(kept.drafts.map((d) => d.id).sort()).toEqual(["c-1", "c-9"]);
    expect(kept.drafts.find((d) => d.id === "c-1")?.text).toBe("正打到一半");
  });
});

describe("the same draft at the desk (soulInboxApi.draft)", () => {
  const box = () => screen.getByTestId("letter-input").props.value;

  beforeEach(() => signedInAs(41));

  it("opens with the server's words when this phone has none", async () => {
    mockServerDraft.mockResolvedValue({ data: serverDraft("在网页上写的", iso(Date.now())) });
    await openThread();
    await waitFor(() => expect(box()).toBe("在网页上写的"));
    expect(readDraft("c-1")).toBe("在网页上写的");
    expect(mockPutDraft).not.toHaveBeenCalled(); // taken from the server, nothing to carry back
  });

  it("two different drafts: the phone's newer words win, stay in the box and go up", async () => {
    saveDraft("c-1", "手机上刚写的");
    mockServerDraft.mockResolvedValue({ data: serverDraft("网页上的旧话", iso(Date.now() - 60_000)) });
    await openThread();
    await waitFor(() => expect(mockPutDraft).toHaveBeenCalledWith("c-1", "手机上刚写的"));
    expect(box()).toBe("手机上刚写的");
    expect(box()).not.toBe("网页上的旧话");
  });

  it("two different drafts: the server's newer words win, and the phone's are not pushed over them", async () => {
    saveDraft("c-1", "手机上的旧话");
    mockServerDraft.mockResolvedValue({ data: serverDraft("网页上刚写的", iso(Date.now() + 60_000)) });
    await openThread();
    await waitFor(() => expect(box()).toBe("网页上刚写的"));
    expect(readDraft("c-1")).toBe("网页上刚写的");
    expect(mockPutDraft).not.toHaveBeenCalled();
    pushDrafts([]);
    expect(mockPutDraft).not.toHaveBeenCalled();
  });

  it("words already on the server yield to it, even when it now has nothing (sent or cleared at the desk)", async () => {
    saveDraft("c-1", "已经推上去的");
    pushDrafts([]);
    await settle();
    expect(mergeServerDraft("c-1", serverDraft(""))).toBe("");
    expect(readDraft("c-1")).toBe("");
    expect(stored()).toBeNull();
  });

  it("unpushed words survive a server with nothing", async () => {
    saveDraft("c-1", "还没推");
    await openThread();
    await waitFor(() => expect(mockPutDraft).toHaveBeenCalledWith("c-1", "还没推"));
    expect(box()).toBe("还没推");
  });

  it("an answer that arrives after the officer started typing does not replace the box", async () => {
    let answer: (value: unknown) => void = () => {};
    mockServerDraft.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await openThread();
    fireEvent.changeText(screen.getByTestId("letter-input"), "抢先打的字");
    await act(async () => answer({ data: serverDraft("网页上的", iso(Date.now() + 60_000)) }));
    expect(box()).toBe("抢先打的字");
    settleDraft();
  });

  it("offline: kept here and not asked; when the network returns the draft goes up once", async () => {
    const value = { offline: true, back: 0 };
    renderOfficer(
      <OnlineContext.Provider value={value}>
        <Detail target={{ type: "todo", kind: "letter", id: "c-1" }} onBack={() => {}} onSettled={jest.fn()} />
      </OnlineContext.Provider>
    );
    await screen.findByTestId("letter-thread");
    expect(mockServerDraft).not.toHaveBeenCalled();
    saveDraft("c-1", "离线写的");
    mockPutDraft.mockRejectedValueOnce(new Error("Network Error")); // still no network the first time
    await act(async () => void (await flushOutbox()));
    expect(readDraft("c-1")).toBe("离线写的");
    mockPutDraft.mockClear();
    await act(async () => void (await flushOutbox())); // back: it was still waiting
    expect(mockPutDraft).toHaveBeenCalledTimes(1);
    expect(mockPutDraft).toHaveBeenCalledWith("c-1", "离线写的");
    mockPutDraft.mockClear();
    await act(async () => void (await flushOutbox())); // landed: nothing left to send
    expect(mockPutDraft).not.toHaveBeenCalled();
  });

  it("a push that fails says nothing, costs nothing, and goes again", async () => {
    mockPutDraft.mockRejectedValue(httpError(500));
    await openThread();
    fireEvent.changeText(screen.getByTestId("letter-input"), "推不上去");
    act(() => settleDraft());
    await settle();
    expect(mockPutDraft).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("letter-failed")).toBeNull();
    expect(screen.getByTestId("letter-input").props.value).toBe("推不上去");
    expect(readDraft("c-1")).toBe("推不上去");
    pushDrafts([]);
    expect(mockPutDraft).toHaveBeenCalledTimes(2);
  });

  it("a closed thread answers 409: the words stay here, and it is not asked again", async () => {
    mockPutDraft.mockRejectedValue(httpError(409));
    saveDraft("c-1", "已关闭");
    pushDrafts([]);
    await settle();
    expect(readDraft("c-1")).toBe("已关闭");
    pushDrafts([]);
    expect(mockPutDraft).toHaveBeenCalledTimes(1);
  });

  it("a reply that went out clears both sides, and nothing puts it back", async () => {
    await openThread();
    await settle();
    fireEvent.changeText(screen.getByTestId("letter-input"), "发出去了");
    fireEvent.press(screen.getByTestId("letter-send"));
    await waitFor(() => expect(mockDeleteDraft).toHaveBeenCalledWith("c-1"));
    expect(stored()).toBeNull();
    act(() => settleDraft());
    pushDrafts([]);
    expect(mockPutDraft).not.toHaveBeenCalled();
  });

  it("a queued reply's words are not pushed alongside it", async () => {
    saveDraft("c-1", "排队的回信");
    saveDraft("c-2", "另一份草稿");
    enqueueReply({ id: "c-1", name: "李白", text: "排队的回信", seen: [] });
    mockReply.mockRejectedValueOnce(httpError(500));
    mockMessages.mockResolvedValue({ data: [] });
    await act(async () => void (await flushOutbox()));
    expect(mockPutDraft).toHaveBeenCalledTimes(1);
    expect(mockPutDraft).toHaveBeenCalledWith("c-2", "另一份草稿");
    expect(mockPutDraft).not.toHaveBeenCalledWith("c-1", expect.anything());
  });

  it("an emptied box the server has a copy of is told to the server, and offline it waits", async () => {
    saveDraft("c-1", "写了又删");
    pushDrafts([]);
    await settle();
    mockPutDraft.mockClear();
    mockPutDraft.mockRejectedValueOnce(new Error("Network Error"));
    saveDraft("c-1", "");
    pushDrafts([]);
    await settle();
    expect(mockPutDraft).toHaveBeenCalledWith("c-1", "");
    expect(draftIds()).toEqual([]); // not a draft to count at sign-out
    expect(mergeServerDraft("c-1", serverDraft("写了又删", iso(Date.now() - 60_000)))).toBe(""); // does not come back
    mockPutDraft.mockClear();
    pushDrafts([]);
    await settle();
    expect(mockPutDraft).toHaveBeenCalledWith("c-1", "");
    expect(stored()).toBeNull();
  });

  it("「删除我的草稿」 reaches the server too", async () => {
    saveDraft("c-1", "不要了");
    pushDrafts([]);
    await settle();
    mockPutDraft.mockClear();
    enqueueReply({ id: "c-1", name: "李白", text: "不要了", seen: [] });
    discardReply("c-1");
    await settle();
    expect(mockPutDraft).toHaveBeenCalledWith("c-1", "");
    expect(readDraft("c-1")).toBe("");
    expect(stored()).toBeNull();
  });
});

describe("the sync and whose drafts these are (A7)", () => {
  it("the next officer on the phone neither pushes nor is shown the last one's words", async () => {
    signedInAs(41);
    saveDraft("c-1", "四十一号的话");
    signedInAs(42);
    pushDrafts([]);
    expect(mockPutDraft).not.toHaveBeenCalled();
    mockServerDraft.mockResolvedValue({ data: serverDraft("四十二号在网页上写的", iso(Date.now())) });
    await openThread();
    await waitFor(() => expect(screen.getByTestId("letter-input").props.value).toBe("四十二号在网页上写的"));
    expect(screen.getByTestId("letter-input").props.value).not.toContain("四十一号");
    // ...and taking his own copy did not write over what is kept for 41 until the sign-in decides (owner.ts).
    signedInAs(41);
    expect(readDraft("c-1")).toBe("四十一号的话");
  });

  it("a push answered after the officer changed does not touch the next one's store", async () => {
    signedInAs(41);
    let answer: (value: unknown) => void = () => {};
    mockPutDraft.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    saveDraft("c-1", "四十一号的话");
    pushDrafts([]);
    signedInAs(42);
    await act(async () => answer({ data: {} }));
    signedInAs(41);
    pushDrafts([]);
    expect(mockPutDraft).toHaveBeenCalledTimes(2); // still dirty: 42's session did not mark it landed
  });

  it("nobody signed in: nothing goes to the server", () => {
    signedInAs(41);
    scheduleDraft("c-1", "正打到一半");
    platform().persistent.remove(USER_KEY);
    settleDraft();
    clearDraft("c-1");
    pushDrafts([]);
    expect(mockPutDraft).not.toHaveBeenCalled();
    expect(mockDeleteDraft).not.toHaveBeenCalled();
  });

  it("sign-out's count is the conversations with words: a server copy taken counts, a blank one does not", async () => {
    signedInAs(41);
    saveDraft("c-1", "手机上的");
    mergeServerDraft("c-2", serverDraft("网页上的", iso(Date.now())));
    saveDraft("c-3", "写了又删");
    pushDrafts([]);
    await settle();
    saveDraft("c-3", "");
    expect(draftIds().sort()).toEqual(["c-1", "c-2"]);
  });
});
