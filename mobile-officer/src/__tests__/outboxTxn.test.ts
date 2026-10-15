/**
 * A reply that may already have reached the server (A10): every attempt carries the same transaction id
 * (the server answers a repeat with the first reply), and our own words in the thread afterwards are not
 * "another officer answered".
 */
import { installMobilePlatform } from "../shared";
import { clearDrafts } from "../drafts";
import { clearOutbox, enqueueReply, flushOutbox, outboxEntry } from "../outbox";

installMobilePlatform();

const mockMessages = jest.fn();
const mockReply = jest.fn();
jest.mock("@soulledger/core/api/soul-inbox", () => ({
  ...jest.requireActual("@soulledger/core/api/soul-inbox"),
  soulInboxApi: { messages: (...a: unknown[]) => mockMessages(...a), reply: (...a: unknown[]) => mockReply(...a) },
}));

const msg = (id: string, officer: boolean, body = "x", txn_id: string | null = null) => ({ event_id: id, from_officer: officer, body, timestamp: 1, sender_name: "n", officer_title: "", image: null, txn_id });
const noAnswer = () => Object.assign(new Error("Network Error"), {});

beforeEach(() => {
  jest.clearAllMocks();
  clearDrafts();
  clearOutbox();
  mockMessages.mockResolvedValue({ data: [msg("m1", false)] });
  mockReply.mockResolvedValue({ data: { event_id: "e1" } });
});

describe("the outbox's transaction id", () => {
  it("sends one id and sends the same id again after a request that got no answer", async () => {
    mockReply.mockRejectedValueOnce(noAnswer());
    enqueueReply({ id: "c-1", name: "李白", text: "好", seen: ["m1"] });
    expect(await flushOutbox()).toBe(0);
    expect(await flushOutbox()).toBe(1);
    const [first, second] = mockReply.mock.calls.map((c) => c[2]);
    expect(typeof first).toBe("string");
    expect(second).toBe(first);
  });

  it("keeps the id a reply was queued with (the screen already tried it online)", async () => {
    enqueueReply({ id: "c-1", name: "李白", text: "好", seen: [], txn: "or-from-screen", tried: true });
    await flushOutbox();
    expect(mockReply).toHaveBeenCalledWith("c-1", "好", "or-from-screen");
  });

  it("after a try, the officer message carrying our txn id is not 'answered by someone else'", async () => {
    // The first attempt reached the server, the answer was lost; the thread now holds our reply.
    mockReply.mockRejectedValueOnce(noAnswer());
    enqueueReply({ id: "c-1", name: "李白", text: "好", seen: ["m1"] });
    await flushOutbox();
    const txn = mockReply.mock.calls[0][2];
    mockMessages.mockResolvedValue({ data: [msg("o1", true, "好", txn), msg("m1", false)] });
    expect(await flushOutbox()).toBe(1);
    expect(outboxEntry("c-1")).toBeUndefined();
  });

  it("another officer's identical words (other txn, or none) are 'answered' even after a try", async () => {
    mockReply.mockRejectedValueOnce(noAnswer());
    enqueueReply({ id: "c-1", name: "李白", text: "好", seen: ["m1"] });
    await flushOutbox();
    mockMessages.mockResolvedValue({ data: [msg("o9", true, "好", "someone-elses"), msg("m1", false)] });
    expect(await flushOutbox()).toBe(0);
    expect(outboxEntry("c-1")).toMatchObject({ state: "failed", reason: "answered" });
    clearOutbox();
    mockMessages.mockResolvedValue({ data: [msg("o9", true, "好"), msg("m1", false)] });
    enqueueReply({ id: "c-1", name: "李白", text: "好", seen: ["m1"], txn: "t", tried: true });
    expect(await flushOutbox()).toBe(0);
    expect(outboxEntry("c-1")).toMatchObject({ state: "failed", reason: "answered" });
  });

  it("a different officer's words are still 'answered', before and after a try", async () => {
    mockMessages.mockResolvedValue({ data: [msg("o9", true, "别人写的"), msg("m1", false)] });
    enqueueReply({ id: "c-1", name: "李白", text: "好", seen: ["m1"], tried: true });
    expect(await flushOutbox()).toBe(0);
    expect(outboxEntry("c-1")).toMatchObject({ state: "failed", reason: "answered" });
    expect(mockReply).not.toHaveBeenCalled();
  });

  it("an officer message with the same words is 'answered' when this reply was never tried", async () => {
    mockMessages.mockResolvedValue({ data: [msg("o9", true, "好"), msg("m1", false)] });
    enqueueReply({ id: "c-1", name: "李白", text: "好", seen: ["m1"] });
    expect(await flushOutbox()).toBe(0);
    expect(outboxEntry("c-1")).toMatchObject({ state: "failed", reason: "answered" });
  });
});
