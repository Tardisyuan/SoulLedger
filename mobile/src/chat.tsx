/**
 * The chat's live state for the signed-in soul: whether chat exists here at
 * all, the conversation list (backend), the timelines (Synapse, one long-poll
 * `/sync`), and the outbox this device has not had confirmed yet.
 *
 * WHERE EACH SEND GOES. A throttled room and the hall inbox go through the
 * backend (`sendsThroughBackend`); a free room goes to Synapse with a
 * transaction id. Both answers are final: a refusal carries the server's code
 * and the conversation list is reloaded, because the refusal means the facts
 * changed (a mute, a closed room, the 24-hour window) and the list is where
 * the server states them.
 *
 * QUEUEING (handoff 1c ⑦). Only "no answer at all" queues: Synapse or the
 * backend unreachable (`chat_unavailable`). A queued Matrix send is retried
 * with the SAME txn id, which Synapse de-duplicates, so a lost response cannot
 * post twice. ponytail: the outbox lives in memory — an app killed while
 * offline loses its queue; persist it (platform().persistent) if that matters.
 */
import { soulErrorStatus } from "@soulledger/core/api/soul";
import {
  soulChatApi,
  soulChatErrorCode,
  soulChatRetryAt,
  type SoulConversation,
} from "@soulledger/core/api/soul-chat";
import {
  EMPTY_TIMELINE,
  MatrixRequestError,
  applyHistory,
  applySync,
  isUnreachable,
  matrixClient,
  matrixLogin,
  type MatrixClient,
  type TimelineState,
} from "@soulledger/core/api/matrix";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { sendsThroughBackend } from "./chatRules";

export type Availability = "probing" | "ready" | "unavailable" | "not_configured";
export type Refused = { code: string; retryAt: string | null };

export interface Outgoing {
  txnId: string;
  conversationId: string;
  roomId: string;
  body: string;
  ts: number;
  state: "sending" | "sent" | "queued" | "failed";
  eventId?: string;
  refused?: Refused;
}

export interface Chat {
  availability: Availability;
  conversations: SoulConversation[] | null;
  /** The list could not be loaded (and none was loaded before). */
  listError: boolean;
  /** Conversations that left the list while this session watched: closed by the server, shown read-only. */
  gone: Record<string, SoulConversation>;
  timeline: TimelineState;
  /** This soul's Matrix user id, once signed in to Synapse. */
  me: string | null;
  outbox: Outgoing[];
  /** The last refusal a send met, per conversation — newer than the list until the list reloads. */
  refused: Record<string, Refused>;
  reload: () => Promise<void>;
  /** Try Synapse again now (the retry button; also flushes the queue). */
  reconnect: () => void;
  send: (c: SoulConversation, body: string) => void;
  resend: (txnId: string) => void;
  loadOlder: (roomId: string) => Promise<void>;
  markRead: (roomId: string, eventId: string) => void;
  openInbox: () => Promise<SoulConversation>;
  openDirect: (userId: number) => Promise<SoulConversation>;
}

/** Codes that mean "the service did not answer", not "the service said no". */
const UNAVAILABLE = new Set(["chat_unavailable"]);
const RETRY_MS = 5_000;
const POLL_MS = 30_000;

const noop = () => {};
const INERT: Chat = {
  availability: "not_configured",
  conversations: null,
  listError: false,
  gone: {},
  timeline: EMPTY_TIMELINE,
  me: null,
  outbox: [],
  refused: {},
  reload: async () => {},
  reconnect: noop,
  send: noop,
  resend: noop,
  loadOlder: async () => {},
  markRead: noop,
  openInbox: () => soulChatApi.openInbox(),
  openDirect: (userId) => soulChatApi.openDirect(userId),
};

/** Exported for screen tests, which hand a screen a fixed chat state. */
export const ChatContext = createContext<Chat>(INERT);
export const useChat = () => useContext(ChatContext);

/** No response, or the service said it could not reach Synapse: queue, do not refuse. */
function isOffline(error: unknown): boolean {
  if (error instanceof MatrixRequestError) return isUnreachable(error);
  const code = soulChatErrorCode(error);
  return code !== null ? UNAVAILABLE.has(code) : soulErrorStatus(error) === null;
}

let counter = 0;
const newTxn = () => `sl${Date.now().toString(36)}.${(counter++).toString(36)}`;

export function ChatProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [availability, setAvailability] = useState<Availability>("probing");
  const [conversations, setConversations] = useState<SoulConversation[] | null>(null);
  const [timeline, setTimeline] = useState<TimelineState>(EMPTY_TIMELINE);
  const [me, setMe] = useState<string | null>(null);
  const [outbox, setOutbox] = useState<Outgoing[]>([]);
  const [refused, setRefused] = useState<Record<string, Refused>>({});
  const client = useRef<MatrixClient | null>(null);
  const since = useRef<string | null>(null);
  const known = useRef<Set<string>>(new Set());
  const wake = useRef<() => void>(noop);
  const convs = useRef<SoulConversation[]>([]);
  const outboxRef = useRef<Outgoing[]>([]);
  const availabilityRef = useRef<Availability>(availability);
  useEffect(() => {
    outboxRef.current = outbox;
    availabilityRef.current = availability;
  }, [outbox, availability]);
  const [listError, setListError] = useState(false);
  const [gone, setGone] = useState<Record<string, SoulConversation>>({});

  const reload = useCallback(async () => {
    try {
      const rows = await soulChatApi.conversations();
      // The list keeps closed rooms of this life (read-only, with `closed_at`), so a row dropping out
      // is rare — a backfill gap, say. Kept for this session, read-only, so an open screen does not go blank (1c ⑥).
      const vanished = convs.current.filter((p) => !rows.some((r) => r.id === p.id));
      if (vanished.length) setGone((g) => ({ ...g, ...Object.fromEntries(vanished.map((v) => [v.id, { ...v, refusal: "closed" }])) }));
      convs.current = rows;
      known.current = new Set(rows.map((c) => c.room_id));
      setConversations(rows);
      setRefused({});
      setListError(false);
    } catch (error) {
      if (soulChatErrorCode(error) === "chat_not_configured") setAvailability("not_configured");
      else setListError(true);
    }
  }, []);

  const patch = useCallback((txnId: string, change: Partial<Outgoing>) => {
    setOutbox((all) => all.map((o) => (o.txnId === txnId ? { ...o, ...change } : o)));
  }, []);

  const deliver = useCallback(
    async (o: Outgoing) => {
      const c = convs.current.find((row) => row.id === o.conversationId);
      if (!c) return patch(o.txnId, { state: "failed" });
      patch(o.txnId, { state: "sending" });
      try {
        const matrix = client.current;
        if (!sendsThroughBackend(c) && !matrix) throw new MatrixRequestError("not signed in to Synapse", "", null);
        const eventId = sendsThroughBackend(c) ? await soulChatApi.send(c.id, o.body) : await matrix!.send(c.room_id, o.txnId, o.body);
        patch(o.txnId, { state: "sent", eventId });
        // The backend may have lifted the throttle, or moved the next request time.
        if (c.throttled) void reload();
      } catch (error) {
        if (isOffline(error)) {
          patch(o.txnId, { state: "queued" });
          setAvailability("unavailable");
          return;
        }
        const code = soulChatErrorCode(error);
        const refusal = code ? { code, retryAt: soulChatRetryAt(error) } : undefined;
        patch(o.txnId, { state: "failed", refused: refusal });
        if (refusal) setRefused((r) => ({ ...r, [c.id]: refusal }));
        // A Synapse 403 (power level, policy module) or a backend refusal: the facts moved; ask again.
        void reload().then(() => refusal && setRefused((r) => ({ ...r, [c.id]: refusal })));
      }
    },
    [patch, reload]
  );

  const flush = useCallback(() => {
    for (const o of outboxRef.current) if (o.state === "queued") void deliver(o);
  }, [deliver]);

  // Sign in to Synapse, then long-poll /sync until signed out.
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const pause = (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        wake.current = () => {
          clearTimeout(timer);
          resolve();
        };
      });

    async function connect(): Promise<boolean> {
      try {
        const grant = await soulChatApi.session();
        const creds = await matrixLogin(grant);
        client.current = matrixClient(creds);
        if (alive) setMe(creds.userId);
        return true;
      } catch (error) {
        if (alive) setAvailability(soulChatErrorCode(error) === "chat_not_configured" ? "not_configured" : "unavailable");
        return false;
      }
    }

    async function run() {
      await reload();
      while (alive) {
        if (!client.current && !(await connect())) {
          if (!alive) return;
          await pause(RETRY_MS);
          continue;
        }
        try {
          const response = await client.current!.sync(since.current, since.current ? POLL_MS : 0);
          if (!alive) return;
          since.current = response.next_batch;
          setTimeline((state) => applySync(state, response));
          if (availabilityRef.current !== "ready") {
            setAvailability("ready");
            availabilityRef.current = "ready";
            flush();
          }
          const rooms = Object.keys(response.rooms?.join ?? {});
          if (rooms.some((r) => !known.current.has(r))) void reload();
        } catch (error) {
          if (!alive) return;
          if (error instanceof MatrixRequestError && error.status === 401) {
            client.current = null; // the access token is gone: log in again with a fresh grant
            continue;
          }
          setAvailability("unavailable");
          await pause(RETRY_MS);
        }
      }
    }
    void run();
    return () => {
      alive = false;
      wake.current();
      client.current = null;
      since.current = null;
    };
  }, [enabled, reload, flush]);

  const value = useMemo<Chat>(
    () => ({
      availability,
      conversations,
      listError,
      gone,
      timeline,
      me,
      outbox,
      refused,
      reload,
      reconnect: () => {
        wake.current();
        flush();
      },
      send: (c, body) => {
        const o: Outgoing = {
          txnId: newTxn(),
          conversationId: c.id,
          roomId: c.room_id,
          body,
          ts: Date.now(),
          state: availability === "ready" || sendsThroughBackend(c) ? "sending" : "queued",
        };
        setOutbox((all) => [...all, o]);
        if (o.state === "sending") void deliver(o);
      },
      resend: (txnId) => {
        const o = outboxRef.current.find((x) => x.txnId === txnId);
        if (o) void deliver(o);
      },
      loadOlder: async (roomId) => {
        const from = timeline.rooms[roomId]?.prevBatch;
        if (!client.current || !from) return;
        try {
          const page = await client.current.messages(roomId, from);
          setTimeline((state) => applyHistory(state, roomId, page.chunk, page.end));
        } catch {
          // History is best-effort; what sync brought stays on screen.
        }
      },
      markRead: (roomId, eventId) => {
        setTimeline((state) =>
          state.rooms[roomId] ? { ...state, rooms: { ...state.rooms, [roomId]: { ...state.rooms[roomId], unread: 0 } } } : state
        );
        void client.current?.readReceipt(roomId, eventId).catch(noop);
      },
      openInbox: async () => {
        const c = await soulChatApi.openInbox();
        await reload();
        return c;
      },
      openDirect: async (userId) => {
        const c = await soulChatApi.openDirect(userId);
        await reload();
        return c;
      },
    }),
    [availability, conversations, listError, gone, timeline, me, outbox, refused, reload, flush, deliver]
  );

  return <ChatContext.Provider value={enabled ? value : INERT}>{children}</ChatContext.Provider>;
}
