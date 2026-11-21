import { describe, expect, it } from "vitest";

import { INBOX_REPLY_MAX } from "../../api/soul-inbox";
import { awaitingReply, draftNeedsSave, inboxReplyGate, normalizeDraft, replyReady } from "../letters";

const open = { closed_at: null, can_reply: true, assignee: null, last_from: "soul" };
const me = { userId: 7 };

describe("inboxReplyGate —— services.officer_reply 的顺序", () => {
  it("没关、灵魂在殿、没人经办或经办人是我:能回", () => {
    expect(inboxReplyGate(open, me)).toBe("open");
    expect(inboxReplyGate({ ...open, assignee: { user_id: 7 } }, me)).toBe("open");
    // 旧服务端不发 can_reply:按能回算。
    expect(inboxReplyGate({ closed_at: null, assignee: null }, me)).toBe("open");
  });

  it("交给了别人:others;不知道我是谁时有经办人就算别人的", () => {
    expect(inboxReplyGate({ ...open, assignee: { user_id: 8 } }, me)).toBe("others");
    expect(inboxReplyGate({ ...open, assignee: { user_id: 8 } }, { userId: undefined })).toBe("others");
  });

  it("灵魂调走:can_reply false,或刚被答 not_current_hall;先于经办人", () => {
    expect(inboxReplyGate({ ...open, can_reply: false, assignee: { user_id: 8 } }, me)).toBe("moved");
    expect(inboxReplyGate(open, { ...me, movedSeen: true })).toBe("moved");
  });

  it("已关闭先于一切", () => {
    expect(inboxReplyGate({ ...open, closed_at: "2026-11-01T00:00:00Z", can_reply: false, assignee: { user_id: 8 } }, { ...me, movedSeen: true })).toBe("closed");
  });
});

describe("awaitingReply —— inbox.awaiting_reply", () => {
  it("最后一封是灵魂写的、没关、灵魂在殿", () => {
    expect(awaitingReply(open)).toBe(true);
    expect(awaitingReply({ ...open, can_reply: undefined })).toBe(true);
  });

  it("殿司写的、已关闭、灵魂已调走、还没有信:都不算", () => {
    expect(awaitingReply({ ...open, last_from: "hall" })).toBe(false);
    expect(awaitingReply({ ...open, last_from: "" })).toBe(false);
    expect(awaitingReply({ ...open, closed_at: "2026-11-01T00:00:00Z" })).toBe(false);
    expect(awaitingReply({ ...open, can_reply: false })).toBe(false);
  });

  it("手上的线程比会话行新:按最后一封信算", () => {
    expect(awaitingReply({ ...open, last_from: "hall" }, "soul")).toBe(true);
    expect(awaitingReply(open, "hall")).toBe(false);
    expect(awaitingReply({ ...open, can_reply: false }, "soul")).toBe(false);
  });
});

describe("replyReady —— OfficerReplySerializer.body", () => {
  it("去掉首尾空白后非空、不超过上限", () => {
    expect(replyReady("")).toBe(false);
    expect(replyReady(" \n\t ")).toBe(false);
    expect(replyReady("好")).toBe(true);
    // 服务端先去空白再量长度:首尾的空白不算进上限。
    expect(replyReady(`  ${"好".repeat(INBOX_REPLY_MAX)}  `)).toBe(true);
    expect(replyReady("好".repeat(INBOX_REPLY_MAX + 1))).toBe(false);
  });
});

describe("草稿 —— 草稿视图的「只有空白 = 清掉」", () => {
  it("normalizeDraft:只有空白是空串,其余原样", () => {
    expect(normalizeDraft(" \n ")).toBe("");
    expect(normalizeDraft(" 写到一半 ")).toBe(" 写到一半 ");
  });

  it("draftNeedsSave:服务端那份还没取到,一个字都不存", () => {
    expect(draftNeedsSave(null, "写到一半")).toBe(false);
    expect(draftNeedsSave(null, "")).toBe(false);
  });

  it("draftNeedsSave:与服务端那份不同才存;空白对空白不存,空白对有字要清", () => {
    expect(draftNeedsSave("写到一半", "写到一半")).toBe(false);
    expect(draftNeedsSave("", "  ")).toBe(false);
    expect(draftNeedsSave("", "新写的")).toBe(true);
    expect(draftNeedsSave("写到一半", "  ")).toBe(true);
  });
});
