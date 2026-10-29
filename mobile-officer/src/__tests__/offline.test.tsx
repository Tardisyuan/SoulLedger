/**
 * Officer app offline (Design batch 28 O3): the banner, the read cache, decisions held back, and letter
 * replies queued on the phone and sent when the network returns.
 */
import { platform } from "@soulledger/core/platform";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { useEffect, useState } from "react";
import { Image, Pressable, Text } from "react-native";

import { OnlineContext, type Online } from "../../../mobile/src/online";
import { DRAFTS_KEY, clearDrafts, readDraft, saveDraft } from "../drafts";
import { FOLD_MS, OfflineBanner } from "../offlineBanner";
import { OUTBOX_KEY, clearOutbox, discardReply, enqueueReply, flushOutbox, outboxEntries, outboxEntry, retryReply } from "../outbox";
import { CACHE_KEY, DETAIL_KEEP, cacheRead, cacheWrite, clearReadCache } from "../readCache";
import { LetterImage } from "../screens/letterImages";
import { Detail } from "../screens/detail";
import { TodoTab } from "../screens/todo";
import { SessionProvider, USER_KEY, useSession } from "../session";
import { OFFICER, httpError, renderOfficer } from "./harness";

const mockTodo = jest.fn();
const mockItem = jest.fn();
const mockConvo = jest.fn();
const mockMessages = jest.fn();
const mockReply = jest.fn();
jest.mock("@soulledger/core/api/officer-app", () => ({
  ...jest.requireActual("@soulledger/core/api/officer-app"),
  officerAppApi: { todo: (...a: unknown[]) => mockTodo(...a), item: (...a: unknown[]) => mockItem(...a), registerPush: jest.fn(), unregisterPush: jest.fn() },
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

const NINE_FORTY_ONE = new Date(2026, 9, 14, 9, 41).getTime();
const net = { set: (_n: Online) => {} };
function Net({ children, start = { offline: false, back: 0 } }: { children: React.ReactNode; start?: Online }) {
  const [value, set] = useState<Online>(start);
  useEffect(() => {
    net.set = set;
  }, []);
  return <OnlineContext.Provider value={value}>{children}</OnlineContext.Provider>;
}
const goOffline = () => act(() => net.set({ offline: true, back: 0 }));
const comeBack = (back = 1) => act(() => net.set({ offline: false, back }));
const settle = () => act(async () => {});

const row = (kind: string, id: string) => ({ kind, id, title: `t-${id}`, created_at: "2026-10-09T01:00:00Z", target: { kind, id } });
const group = (items: object[]) => ({ count: items.length, items });
const TODO = { approvals: group([row("approval", "wf-1")]), reassignments: group([]), cooldowns: group([]), rebirths: group([]), letters: group([row("letter", "c-1")]) };
const ITEM = { kind: "approval", id: "wf-1", title: "转生配额审批", created_at: "2026-10-09T01:00:00Z", actionable: true, state: "actionable", handled_by: null, handled_at: null, workflow_id: "wf-1", node_id: "node-1" };
const CONVO = { id: "c-1", soul_name: "李白", closed_at: null, last_from: "soul" };
const msg = (id: string, officer: boolean) => ({ event_id: id, from_officer: officer, body: "x", timestamp: 1, sender_name: "n", officer_title: "", image: null });

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  clearDrafts();
  clearOutbox();
  clearReadCache();
  mockTodo.mockResolvedValue({ data: TODO });
  mockItem.mockResolvedValue({ data: ITEM });
  mockConvo.mockResolvedValue({ data: CONVO });
  mockMessages.mockResolvedValue({ data: [msg("m1", false)] });
  mockReply.mockResolvedValue({ data: {} });
});

describe("the banner", () => {
  const mount = (start?: Online) =>
    renderOfficer(
      <Net start={start}>
        <OfflineBanner />
      </Net>
    );

  it("is absent online, dark offline, and not the light one", async () => {
    mount();
    expect(screen.queryByTestId("offline-banner")).toBeNull();
    expect(screen.queryByTestId("restored-banner")).toBeNull();
    await goOffline();
    expect(screen.getByTestId("offline-banner")).toBeTruthy();
    expect(screen.queryByTestId("restored-banner")).toBeNull();
  });

  it("names the time the screen's content was fetched", async () => {
    jest.spyOn(Date, "now").mockReturnValue(NINE_FORTY_ONE);
    mockTodo.mockResolvedValue({ data: TODO });
    renderOfficer(
      <Net>
        <OfflineBanner />
        <TodoTab highlight={null} onOpen={() => {}} />
      </Net>
    );
    await screen.findByTestId("todo-group-approval");
    await goOffline();
    expect(screen.getByTestId("offline-banner")).toBeTruthy();
    expect(screen.getByText("没有网络 · 显示的是 09:41 的内容")).toBeTruthy();
  });

  it("on a screen that got nothing (「没取到」) says only 没有网络, and going back names the list's time again", async () => {
    jest.spyOn(Date, "now").mockReturnValue(NINE_FORTY_ONE);
    mockTodo.mockResolvedValue({ data: TODO });
    function Stack() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <OfflineBanner />
          <TodoTab highlight={null} onOpen={() => {}} />
          <Pressable testID="toggle-detail" onPress={() => setOpen((v) => !v)} />
          {open ? <Detail target={{ type: "todo", kind: "approval", id: "never-opened" }} onBack={() => {}} onSettled={jest.fn()} /> : null}
        </>
      );
    }
    renderOfficer(
      <Net>
        <Stack />
      </Net>
    );
    await screen.findByTestId("todo-group-approval");
    await goOffline();
    expect(screen.getByText("没有网络 · 显示的是 09:41 的内容")).toBeTruthy();
    // A detail never opened online: nothing in the cache, and offline nothing is asked for.
    mockItem.mockRejectedValue(new Error("Network Error"));
    fireEvent.press(screen.getByTestId("toggle-detail"));
    await waitFor(() => expect(screen.getByText("没有网络")).toBeTruthy());
    expect(screen.queryByText(/显示的是/)).toBeNull();
    fireEvent.press(screen.getByTestId("toggle-detail"));
    expect(await screen.findByText("没有网络 · 显示的是 09:41 的内容")).toBeTruthy();
  });

  it("turns light with the count of replies sent, and folds away after 3 s", async () => {
    jest.useFakeTimers();
    try {
      mockMessages.mockResolvedValue({ data: [msg("m1", false)] });
      enqueueReply({ id: "c-1", name: "李白", text: "好", seen: [] });
      enqueueReply({ id: "c-2", name: "杜甫", text: "好", seen: [] });
      mount({ offline: true, back: 0 });
      expect(screen.getByTestId("offline-banner")).toBeTruthy();
      comeBack();
      await settle();
      expect(screen.queryByTestId("offline-banner")).toBeNull();
      expect(screen.getByText("✓ 已恢复网络 · 发出了 2 封回信")).toBeTruthy();
      expect(mockReply).toHaveBeenCalledTimes(2);
      act(() => jest.advanceTimersByTime(FOLD_MS - 1));
      expect(screen.getByTestId("restored-banner")).toBeTruthy();
      act(() => jest.advanceTimersByTime(1));
      expect(screen.queryByTestId("restored-banner")).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it("stays while a queued reply failed, and folds once the failure is dealt with", async () => {
    jest.useFakeTimers();
    try {
      mockReply.mockRejectedValue(httpError(403));
      enqueueReply({ id: "c-1", name: "李白", text: "好", seen: [] });
      mount({ offline: true, back: 0 });
      comeBack();
      await settle();
      act(() => jest.advanceTimersByTime(FOLD_MS * 3));
      expect(screen.getByTestId("restored-banner")).toBeTruthy();
      expect(screen.getByText("✓ 已恢复网络")).toBeTruthy(); // nothing went out: no count
      act(() => discardReply("c-1"));
      act(() => jest.advanceTimersByTime(FOLD_MS));
      expect(screen.queryByTestId("restored-banner")).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("the read cache", () => {
  it("shows the to-do list offline without asking the server, and the live list online", async () => {
    cacheWrite("list:todo", { ...TODO, approvals: group([row("approval", "old")]) });
    renderOfficer(
      <Net start={{ offline: true, back: 0 }}>
        <TodoTab highlight={null} onOpen={() => {}} />
      </Net>
    );
    expect(await screen.findByTestId("todo-row-approval-old")).toBeTruthy();
    expect(mockTodo).not.toHaveBeenCalled();
    await comeBack();
    expect(await screen.findByTestId("todo-row-approval-wf-1")).toBeTruthy();
    expect(screen.queryByTestId("todo-row-approval-old")).toBeNull();
    expect((cacheRead<typeof TODO>("list:todo")!.data.approvals.items[0] as { id: string }).id).toBe("wf-1");
  });

  it("falls back to the cache when the request gets no answer, but never when the server answered", async () => {
    cacheWrite("list:todo", TODO);
    mockTodo.mockRejectedValue(new Error("Network Error"));
    const first = renderOfficer(<TodoTab highlight={null} onOpen={() => {}} />);
    expect(await first.findByTestId("todo-row-approval-wf-1")).toBeTruthy();
    first.unmount();
    mockTodo.mockRejectedValue(httpError(500));
    renderOfficer(<TodoTab highlight={null} onOpen={() => {}} />);
    await screen.findByTestId("state-error");
    expect(screen.queryByTestId("todo-row-approval-wf-1")).toBeNull();
  });

  it("shows an opened detail from the cache offline", async () => {
    const view = renderOfficer(<Detail target={{ type: "todo", kind: "approval", id: "wf-1" }} onBack={() => {}} onSettled={jest.fn()} />);
    await screen.findByText("转生配额审批");
    view.unmount();
    mockItem.mockClear();
    renderOfficer(
      <Net start={{ offline: true, back: 0 }}>
        <Detail target={{ type: "todo", kind: "approval", id: "wf-1" }} onBack={() => {}} onSettled={jest.fn()} />
      </Net>
    );
    expect(await screen.findByText("转生配额审批")).toBeTruthy();
    expect(mockItem).not.toHaveBeenCalled();
  });

  it("keeps the DETAIL_KEEP newest details and the lists apart from them", () => {
    cacheWrite("list:todo", TODO);
    for (let i = 0; i < DETAIL_KEEP + 3; i++) cacheWrite(`detail:approval:${i}`, { i });
    expect(cacheRead("detail:approval:0")).toBeNull();
    expect(cacheRead("detail:approval:2")).toBeNull();
    expect(cacheRead("detail:approval:3")).not.toBeNull();
    expect(cacheRead(`detail:approval:${DETAIL_KEEP + 2}`)).not.toBeNull();
    expect(cacheRead("list:todo")).not.toBeNull();
    expect((JSON.parse(platform().persistent.get(CACHE_KEY)!) as { details: unknown[] }).details).toHaveLength(DETAIL_KEEP);
  });

  it("an opened-again detail moves to the front instead of taking a second slot", () => {
    for (let i = 0; i < DETAIL_KEEP; i++) cacheWrite(`detail:approval:${i}`, { i });
    cacheWrite("detail:approval:0", { i: "again" });
    cacheWrite("detail:approval:new", {});
    expect(cacheRead("detail:approval:0")).not.toBeNull();
    expect(cacheRead("detail:approval:1")).toBeNull();
  });

  it("a picture that cannot load offline is a grey block, online it is the retry as before", () => {
    const image = { id: "i1", url: "/m/1", width: 100, height: 50 };
    const offline = renderOfficer(
      <Net start={{ offline: true, back: 0 }}>
        <LetterImage image={image} onOpen={() => {}} onReload={() => {}} />
      </Net>
    );
    fireEvent(offline.UNSAFE_getByType(Image), "error");
    expect(screen.getByTestId("letter-image-later")).toBeTruthy();
    expect(screen.getByText("有网后显示")).toBeTruthy();
    expect(screen.queryByTestId("letter-image-broken")).toBeNull();
    offline.unmount();
    const online = renderOfficer(<LetterImage image={image} onOpen={() => {}} onReload={() => {}} />);
    fireEvent(online.UNSAFE_getByType(Image), "error");
    expect(screen.getByTestId("letter-image-broken")).toBeTruthy();
    expect(screen.queryByTestId("letter-image-later")).toBeNull();
  });
});

describe("decisions offline", () => {
  const open = async (offline: boolean) => {
    renderOfficer(
      <Net start={{ offline, back: 0 }}>
        <Detail target={{ type: "todo", kind: "approval", id: "wf-1" }} onBack={() => {}} onSettled={jest.fn()} />
      </Net>
    );
    await screen.findByTestId("action-bar");
  };

  it("greys approve and reject out and says why above them", async () => {
    cacheWrite("detail:approval:wf-1", { item: ITEM, cooldown: null });
    await open(true);
    expect(screen.getByTestId("action-approve").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId("action-reject").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId("detail-offline-reason").props.children).toBe("◇ 没有网络时不能批准或驳回：这期间案卷可能已经变了。");
    fireEvent.press(screen.getByTestId("action-approve"));
    expect(screen.queryByText("批准这一签？")).toBeNull();
  });

  it("online they are live and the reason is absent", async () => {
    await open(false);
    expect(screen.getByTestId("action-approve").props.accessibilityState.disabled).toBe(false);
    expect(screen.getByTestId("action-reject").props.accessibilityState.disabled).toBe(false);
    expect(screen.queryByTestId("detail-offline-reason")).toBeNull();
  });
});

describe("a reply written offline", () => {
  const back = jest.fn();
  beforeEach(() => back.mockClear());
  const openThread = async (offline: boolean) => {
    renderOfficer(
      <Net start={{ offline, back: 0 }}>
        <Detail target={{ type: "todo", kind: "letter", id: "c-1" }} onBack={back} onSettled={jest.fn()} />
        <TodoTab highlight={null} onOpen={() => {}} />
      </Net>
    );
    await screen.findByTestId("letter-thread");
  };

  it("is queued, tagged 待发出 on the list, kept in the draft, and not sent", async () => {
    // Opened online once, so the thread is in the cache; then the network goes.
    await openThread(false);
    await goOffline();
    fireEvent.changeText(screen.getByTestId("letter-input"), "先答应下来");
    fireEvent.press(screen.getByTestId("letter-send"));
    expect(mockReply).not.toHaveBeenCalled();
    expect(outboxEntry("c-1")).toMatchObject({ name: "李白", text: "先答应下来", state: "queued", seen: [] });
    expect(readDraft("c-1")).toBe("先答应下来");
    expect(screen.getByTestId("letter-queued")).toBeTruthy();
    expect(screen.getByTestId("letter-send").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId("letter-input").props.editable).toBe(false);
    expect(screen.getByTestId("outbox-pending-c-1")).toBeTruthy();
    expect(screen.getByText("回信 · 李白")).toBeTruthy();
    expect(screen.getByText("有网后自动发出")).toBeTruthy();
    expect(platform().persistent.get(OUTBOX_KEY)).toContain("先答应下来"); // survives a restart
    expect(back).toHaveBeenCalledTimes(1); // queued is done as far as this screen goes: back to the list
  });

  it("sent on reconnect while the letter is open, the box empties instead of offering the same words again", async () => {
    await openThread(false);
    await goOffline();
    fireEvent.changeText(screen.getByTestId("letter-input"), "先答应下来");
    fireEvent.press(screen.getByTestId("letter-send"));
    expect(screen.getByTestId("letter-queued")).toBeTruthy();
    await act(async () => {
      await flushOutbox();
    });
    expect(mockReply).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("letter-input").props.value).toBe("");
    expect(screen.queryByTestId("letter-queued")).toBeNull();
  });

  it("goes out on reconnect: the entry and the draft are gone", async () => {
    saveDraft("c-1", "先答应下来");
    enqueueReply({ id: "c-1", name: "李白", text: "先答应下来", seen: [] });
    expect(await flushOutbox()).toBe(1);
    expect(mockReply).toHaveBeenCalledWith("c-1", "先答应下来", expect.any(String));
    expect(outboxEntries()).toEqual([]);
    expect(readDraft("c-1")).toBe("");
    expect(platform().persistent.get(OUTBOX_KEY)).toBeNull();
  });

  it("online, a reply is sent at once and nothing is queued", async () => {
    await openThread(false);
    fireEvent.changeText(screen.getByTestId("letter-input"), "直接发");
    fireEvent.press(screen.getByTestId("letter-send"));
    await waitFor(() => expect(mockReply).toHaveBeenCalledWith("c-1", "直接发", expect.any(String)));
    expect(outboxEntries()).toEqual([]);
    await waitFor(() => expect(back).toHaveBeenCalledTimes(1));
  });

  it("a request with no answer leaves it queued for the next return", async () => {
    mockReply.mockRejectedValue(new Error("Network Error"));
    enqueueReply({ id: "c-1", name: "李白", text: "好", seen: [] });
    expect(await flushOutbox()).toBe(0);
    expect(outboxEntry("c-1")?.state).toBe("queued");
  });

  const reasons: [string, () => void, string, string[]][] = [
    ["answered by another officer (the thread has an officer message it did not have)", () => mockMessages.mockResolvedValue({ data: [msg("m1", false), msg("o9", true)] }), "这封书信已经由别的官员回过了。你写的内容还留着。", ["view", "discard"]],
    ["closed (409 closed)", () => mockReply.mockRejectedValue(httpError(409, { code: "closed" })), "这封书信已经归档。", ["view", "discard"]],
    ["no longer this hall's (403)", () => mockReply.mockRejectedValue(httpError(403)), "你已不在这一殿。", ["discard"]],
    ["no longer visible (404)", () => mockMessages.mockRejectedValue(httpError(404)), "你已不在这一殿。", ["discard"]],
    ["anything else (500)", () => mockReply.mockRejectedValue(httpError(500)), "没有发出，稍后再试", ["retry", "discard"]],
  ];
  it.each(reasons)("%s", async (_name, arrange, words, actions) => {
    arrange();
    saveDraft("c-1", "我的话");
    enqueueReply({ id: "c-1", name: "李白", text: "我的话", seen: [] });
    renderOfficer(<TodoTab highlight={null} onOpen={() => {}} />);
    await act(async () => {
      await flushOutbox();
    });
    expect(screen.getByText("回信 · 李白 没有发出")).toBeTruthy();
    expect(screen.getByTestId("outbox-reason-c-1").props.children).toBe(words);
    for (const a of ["view", "retry", "discard"]) expect(!!screen.queryByTestId(`outbox-${a}-c-1`)).toBe(actions.includes(a));
    expect(screen.queryByTestId("outbox-pending-c-1")).toBeNull();
    expect(readDraft("c-1")).toBe("我的话"); // a failure never costs the words
    if (words.startsWith("这封书信已经由")) expect(mockReply).not.toHaveBeenCalled();
  });

  it("重试 sends it again; 删除我的草稿 removes the entry and the draft", async () => {
    mockReply.mockRejectedValueOnce(httpError(500));
    saveDraft("c-1", "我的话");
    enqueueReply({ id: "c-1", name: "李白", text: "我的话", seen: [] });
    renderOfficer(<TodoTab highlight={null} onOpen={() => {}} />);
    await act(async () => {
      await flushOutbox();
    });
    await act(async () => {
      await retryReply("c-1");
    });
    expect(mockReply).toHaveBeenCalledTimes(2);
    expect(outboxEntries()).toEqual([]);

    mockReply.mockRejectedValue(httpError(403));
    saveDraft("c-1", "再来");
    act(() => enqueueReply({ id: "c-1", name: "李白", text: "再来", seen: [] }));
    await act(async () => {
      await flushOutbox();
    });
    fireEvent.press(screen.getByTestId("outbox-discard-c-1"));
    expect(outboxEntries()).toEqual([]);
    expect(readDraft("c-1")).toBe("");
    expect(screen.queryByTestId("outbox-failed-c-1")).toBeNull();
  });
});

describe("whose these are", () => {
  function Out() {
    const { signOut } = useSession();
    return (
      <Pressable testID="out" onPress={signOut}>
        <Text>out</Text>
      </Pressable>
    );
  }
  const seed = () => {
    cacheWrite("list:todo", TODO);
    cacheWrite("detail:letter:c-1", {});
    enqueueReply({ id: "c-1", name: "李白", text: "好", seen: [] });
    saveDraft("c-1", "好");
  };
  const gone = () => {
    expect(platform().persistent.get(CACHE_KEY)).toBeNull();
    expect(platform().persistent.get(OUTBOX_KEY)).toBeNull();
    expect(platform().persistent.get(DRAFTS_KEY)).toBeNull();
    expect(outboxEntries()).toEqual([]);
    expect(cacheRead("list:todo")).toBeNull();
  };

  it("signing out clears the cache and the queue", () => {
    seed();
    renderOfficer(
      <SessionProvider>
        <Out />
      </SessionProvider>
    );
    fireEvent.press(screen.getByTestId("out"));
    gone();
  });

  it("a session the server ended clears them too", () => {
    seed();
    renderOfficer(<SessionProvider>{null}</SessionProvider>);
    act(() => platform().onUnauthorized());
    gone();
  });

  it("a start with no refresh token to resume clears what the last officer left (A7)", () => {
    platform().persistent.set(USER_KEY, JSON.stringify({ ...OFFICER, id: 41 }));
    seed();
    expect(cacheRead("list:todo")).not.toBeNull(); // there was something to clear
    renderOfficer(<SessionProvider>{null}</SessionProvider>);
    gone();
    expect(platform().persistent.get(USER_KEY)).toBeNull();
  });

  describe("left behind by another officer (A7)", () => {
    const as = (id: number) => platform().persistent.set(USER_KEY, JSON.stringify({ ...OFFICER, id }));
    afterEach(() => platform().persistent.remove(USER_KEY));

    it("the next officer reads none of it, and the queue is not sent under the next one's name", async () => {
      as(41);
      seed();
      expect(outboxEntries()).toHaveLength(1);
      as(42); // nothing cleared in between
      expect(outboxEntries()).toEqual([]);
      expect(readDraft("c-1")).toBe("");
      expect(cacheRead("list:todo")).toBeNull();
      expect(cacheRead("detail:letter:c-1")).toBeNull();
      mockMessages.mockResolvedValue({ data: [] });
      await act(async () => {
        expect(await flushOutbox()).toBe(0);
      });
      expect(mockReply).not.toHaveBeenCalled();
      // It is still the first officer's: back under that name it is all there.
      as(41);
      expect(outboxEntries().map((e) => e.id)).toEqual(["c-1"]);
      expect(readDraft("c-1")).toBe("好");
      expect(cacheRead("list:todo")).not.toBeNull();
    });

    it("a store written before owners existed (a bare list) is read as nobody's", () => {
      platform().persistent.set(OUTBOX_KEY, JSON.stringify([{ id: "c-1", name: "李白", text: "好", seen: [], state: "queued" }]));
      platform().persistent.set(DRAFTS_KEY, JSON.stringify([{ id: "c-1", text: "好" }]));
      as(43); // a different owner from the snapshot's: the outbox is read again
      expect(outboxEntries()).toEqual([]);
      expect(readDraft("c-1")).toBe("");
    });
  });
});
