import { describe, expect, it } from "vitest";

import type { SoulConversation } from "../../api/soul-chat";
import { chatMode, chatSections, sendsThroughBackend } from "../soulChat";

// Moved from mobile/src/__tests__/chat.test.tsx with the rules (2026-11-21).
const NOW = Date.parse("2026-09-15T10:45:00+08:00");

function conv(overrides: Partial<SoulConversation> = {}): SoulConversation {
  return {
    id: "c-direct",
    kind: "DIRECT",
    room_id: "!direct:hs.test",
    peer_user: 7,
    peer_name: "吴长明",
    hall: "",
    throttled: false,
    last_request_at: null,
    responded_at: null,
    last_message_at: null,
    created_at: "2026-09-10T00:00:00Z",
    mutual: true,
    initiated_by_me: false,
    next_request_at: null,
    refusal: null,
    ...overrides,
  } as SoulConversation;
}

const hall = (overrides: Partial<SoulConversation> = {}) =>
  conv({ id: "c-hall", kind: "OFFICER_INBOX", room_id: "!hall:hs.test", peer_user: null, peer_name: "", hall: "第五殿", mutual: false, ...overrides });

const facts = (overrides = {}) => ({ now: NOW, peerHasSpoken: false, iHaveSpoken: false, refused: null, ...overrides });

describe("chatMode — the design's eight states from the server's facts", () => {
  it("① free: mutual", () => {
    expect(chatMode(conv(), facts()).kind).toBe("free");
  });

  it("② my request, a letter may go / locked until next_request_at", () => {
    const mine = conv({ throttled: true, initiated_by_me: true, mutual: false });
    expect(chatMode(mine, facts()).kind).toBe("outgoing_open");
    const next = new Date(NOW + 3_600_000).toISOString();
    expect(chatMode({ ...mine, next_request_at: next }, facts())).toEqual({ kind: "outgoing_locked", nextAt: next, rejected: false });
    // The time has come: open again, not locked forever.
    expect(chatMode({ ...mine, next_request_at: new Date(NOW - 1).toISOString() }, facts()).kind).toBe("outgoing_open");
    // They answered: free, before the backend lifts the throttle on the next send.
    expect(chatMode({ ...mine, next_request_at: next }, facts({ peerHasSpoken: true })).kind).toBe("free");
  });

  it("③ their request: incoming until I answer", () => {
    const theirs = conv({ throttled: true, initiated_by_me: false, mutual: false });
    expect(chatMode(theirs, facts()).kind).toBe("incoming");
    expect(chatMode(theirs, facts({ iHaveSpoken: true })).kind).toBe("free");
  });

  it("④ request_throttled: a refused send locks with the server's retry_at, marked as rejected", () => {
    const mine = conv({ throttled: true, initiated_by_me: true, mutual: false });
    const retry = "2026-09-16T19:30:00+08:00";
    expect(chatMode(mine, facts({ refused: { code: "request_throttled", retryAt: retry } }))).toEqual({
      kind: "outgoing_locked",
      nextAt: retry,
      rejected: true,
    });
  });

  it("④ once retry_at has passed the refusal locks nothing: the list decides again", () => {
    const mine = conv({ throttled: true, initiated_by_me: true, mutual: false });
    const over = { code: "request_throttled", retryAt: new Date(NOW).toISOString() };
    expect(chatMode(mine, facts({ refused: over })).kind).toBe("outgoing_open");
    const next = new Date(NOW + 3_600_000).toISOString();
    expect(chatMode({ ...mine, next_request_at: next }, facts({ refused: over }))).toEqual({ kind: "outgoing_locked", nextAt: next, rejected: false });
  });

  it("⑤ muted, ⑥ closed / peer_retired — the server's refusal wins over everything else", () => {
    expect(chatMode(conv({ refusal: "muted" }), facts()).kind).toBe("muted");
    expect(chatMode(conv({ refusal: "closed", throttled: true, initiated_by_me: true }), facts())).toEqual({ kind: "closed", reason: "closed" });
    expect(chatMode(conv({ refusal: "peer_retired" }), facts())).toEqual({ kind: "closed", reason: "peer_retired" });
    // A refusal met on send is newer than the list.
    expect(chatMode(conv(), facts({ refused: { code: "muted", retryAt: null } })).kind).toBe("muted");
  });

  it("the hall: writable when current, sealed when left — and never 'muted' (a mute does not cut the hall)", () => {
    expect(chatMode(hall(), facts()).kind).toBe("hall");
    expect(chatMode(hall({ refusal: "not_current_hall" }), facts()).kind).toBe("hall_sealed");
    expect(chatMode(hall({ refusal: "muted" }), facts()).kind).toBe("hall");
  });
});

describe("sendsThroughBackend — the path each send takes", () => {
  it("my request and the hall go through the backend; the answer to THEIR request goes to Synapse", () => {
    expect(sendsThroughBackend(conv({ throttled: true, initiated_by_me: true }))).toBe(true);
    expect(sendsThroughBackend(hall())).toBe(true);
    // The backend refuses the receiver on its path (409 not_initiator); in Synapse the receiver speaks at 50.
    expect(sendsThroughBackend(conv({ throttled: true, initiated_by_me: false }))).toBe(false);
    expect(sendsThroughBackend(conv())).toBe(false);
  });
});

describe("chatSections — halls and souls are never interleaved", () => {
  it("current hall on top, halls left behind under it, souls newest first", () => {
    const old = hall({ id: "old", refusal: "not_current_hall", last_message_at: "2026-09-15T00:00:00Z" });
    const a = conv({ id: "a", room_id: "!a", last_message_at: "2026-09-12T00:00:00Z" });
    const b = conv({ id: "b", room_id: "!b", last_message_at: "2026-09-14T00:00:00Z" });
    const cur = hall({ last_message_at: "2026-09-01T00:00:00Z" });
    const sections = chatSections([a, old, b, cur], (room) => (room === "!a" ? Date.parse("2026-09-15T01:00:00Z") : 0));
    expect(sections.hall?.id).toBe("c-hall");
    expect(sections.sealedHalls.map((c) => c.id)).toEqual(["old"]);
    // The newest hall letter does not pull the hall down among the souls, and a newer timeline beats the list.
    expect(sections.souls.map((c) => c.id)).toEqual(["a", "b"]);
  });
});
