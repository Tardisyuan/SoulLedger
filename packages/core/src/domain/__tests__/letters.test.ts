import { describe, expect, it } from "vitest";

import { INBOX_REPLY_MAX } from "../../api/soul-inbox";
import {
  awaitingReply,
  draftNeedsSave,
  groupLetters,
  inboxReplyGate,
  isReadOnlyLetterState,
  lastSoulLetterAt,
  letterImageBox,
  letterState,
  letterWait,
  normalizeDraft,
  replyReady,
  type LetterFacts,
} from "../letters";

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

// 本机日历上的时刻:换时区跑也落在同一天。
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).getTime();
const soul = (ts: number, author = "QA·收信人"): LetterFacts => ({ ts, side: "soul", author });
const hall = (ts: number, author = "qa.officer.cn"): LetterFacts => ({ ts, side: "hall", author });
const same = (f: LetterFacts) => f;
const shape = (rows: ReturnType<typeof groupLetters<LetterFacts>>) =>
  rows.map((r) => (r.kind === "day" ? `day ${r.day}` : `${r.side}${r.open ? "*" : ""} ${r.letters.map((l) => (l.stamp ? "+" : ".")).join("")}`));

describe("groupLetters —— 第六十四批:连写并组、跨天分隔、没回的那组", () => {
  it("同一方同一人连着写的并成一组;换方、换人就换组", () => {
    const rows = groupLetters(
      [soul(at(1, 18, 42)), hall(at(1, 18, 49)), soul(at(1, 20, 10)), soul(at(1, 20, 12)), hall(at(1, 20, 15)), hall(at(1, 20, 16), "测试官员(QA)")],
      same
    );
    expect(shape(rows)).toEqual(["day 2026-11-01", "soul .", "hall .", "soul ..", "hall .", "hall ."]);
    // 组头的时间是组里第一封的。
    expect(rows[3]).toMatchObject({ kind: "group", ts: at(1, 20, 10), author: "QA·收信人" });
  });

  it("跨天插一行日期,并且新起一组(哪怕还是同一个人)", () => {
    const rows = groupLetters([soul(at(1, 23, 50)), soul(at(2, 0, 5))], same);
    expect(shape(rows)).toEqual(["day 2026-11-01", "soul .", "day 2026-11-02", "soul ."]);
  });

  it("组里相隔超过 30 分钟的那一封才补小时间;正好 30 分钟不补", () => {
    const rows = groupLetters([soul(at(2, 4, 11)), soul(at(2, 4, 41)), soul(at(2, 6, 40))], same);
    expect(shape(rows)).toEqual(["day 2026-11-02", "soul ..+"]);
  });

  it("open:只标最后一组,且只在它是来信时;回了就没有墨线", () => {
    const waiting = groupLetters([soul(at(1, 9)), hall(at(1, 10)), soul(at(2, 4))], same, { open: true });
    expect(shape(waiting)).toEqual(["day 2026-11-01", "soul .", "hall .", "day 2026-11-02", "soul* ."]);
    const answered = groupLetters([soul(at(1, 9)), hall(at(1, 10))], same, { open: true });
    expect(shape(answered).some((s) => s.includes("*"))).toBe(false);
    // 调用处说「不在等殿司」(已关闭、调走、归档)时,来信也不画墨线。
    expect(shape(groupLetters([soul(at(1, 9))], same, { open: false }))).toEqual(["day 2026-11-01", "soul ."]);
  });

  it("没有信:没有行", () => {
    expect(groupLetters([], same)).toEqual([]);
  });
});

describe("letterState —— 底部状态行", () => {
  it("关闭 → 调走 → 轮到谁;关闭与调走只读", () => {
    expect(letterState("closed", "soul")).toBe("closed");
    expect(letterState("moved", "soul")).toBe("moved");
    expect(letterState("open", "soul")).toBe("awaiting_hall");
    // 交给了别人:还是轮到殿司回(下面是「由谁经办」那一行,不是回复框)。
    expect(letterState("others", "soul")).toBe("awaiting_hall");
    expect(letterState("open", "hall")).toBe("awaiting_soul");
    expect(letterState("open", undefined)).toBeNull();
    expect(letterState("closed", undefined)).toBe("closed");
    expect((["closed", "moved"] as const).map(isReadOnlyLetterState)).toEqual([true, true]);
    expect([isReadOnlyLetterState("awaiting_hall"), isReadOnlyLetterState("awaiting_soul"), isReadOnlyLetterState(null)]).toEqual([false, false, false]);
  });
});

describe("letterWait —— 「来信已等 {{wait}}」", () => {
  const now = at(21, 12);
  it("一小时内按分钟(至少 1),两天内按小时,再久按天;往下取整", () => {
    expect(letterWait(now, now)).toEqual({ unit: "minutes", n: 1 });
    expect(letterWait(now - 59 * 60_000, now)).toEqual({ unit: "minutes", n: 59 });
    expect(letterWait(now - 60 * 60_000, now)).toEqual({ unit: "hours", n: 1 });
    expect(letterWait(now - (47 * 60 + 59) * 60_000, now)).toEqual({ unit: "hours", n: 47 });
    expect(letterWait(now - 48 * 3_600_000, now)).toEqual({ unit: "days", n: 2 });
    expect(letterWait(at(2, 4, 11), now)).toEqual({ unit: "days", n: 19 });
  });
  it("从最后一封来信算起,不是最后一封信", () => {
    const items = [soul(at(1, 9)), soul(at(2, 4)), hall(at(3, 8))];
    expect(lastSoulLetterAt(items, same)).toBe(at(2, 4));
    expect(lastSoulLetterAt([hall(at(1, 9))], same)).toBeUndefined();
  });
});

describe("letterImageBox —— 图片信放进 160×120", () => {
  it("按原比例缩进框里;读不出比例就满框", () => {
    expect(letterImageBox(1600, 1200)).toEqual({ width: 160, height: 120 });
    expect(letterImageBox(1200, 1600)).toEqual({ width: 90, height: 120 });
    expect(letterImageBox(2000, 500)).toEqual({ width: 160, height: 40 });
    expect(letterImageBox(undefined, 0)).toEqual({ width: 160, height: 120 });
  });
});
