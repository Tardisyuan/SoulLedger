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
 * post twice.
 *
 * THE OUTBOX OUTLIVES THE PROCESS. Letters not yet confirmed (queued, or in
 * flight when the app died) are kept in `platform().persistent` under
 * `OUTBOX_KEY`, stamped with the account they belong to, and sent again on the
 * next start with their original txn id. Another account signing in finds
 * nothing (and overwrites the record); signing out, or the session ending on
 * its own (401 / 403 in `session.tsx`), removes it (`clearOutbox`).
 * The same txn id only de-duplicates if Synapse sees it from the same device,
 * for 30–60 minutes (its transaction cache, keyed by user + device, MSC3970) —
 * so the record also keeps the Matrix device id, and the next login asks for
 * that device again. Past the cache's lifetime, the guard is the echo: a letter
 * whose txn id already came back in /sync was delivered, and is not sent again.
 * The backend path (throttled rooms, the hall) gets the txn id too and keeps it
 * for 7 days: sent again, it answers with the first event id and posts nothing
 * — which also keeps a throttled room's resend from being refused as a second
 * request.
 *
 * IMAGES (2026-10-10) ride the same outbox. An image item holds the compressed
 * file's local uri (the thing that survives a restart), and goes in two steps
 * through the backend: upload (its id is written back onto the item the moment
 * it is known), then send. The send is idempotent per uploaded image on the
 * server, so a restart anywhere between the two steps cannot post twice: after
 * the upload it sends the saved image id, before it uploads again (an orphan the
 * server sweeps). Images are delivered one at a time, in the order picked —
 * four concurrent uploads would land in whatever order they finished.
 */
import { soulErrorStatus } from "@soulledger/core/api/soul";
import {
  soulChatApi,
  soulChatErrorCode,
  soulChatImageErrorCode,
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
import { platform } from "@soulledger/core/platform";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { sendsThroughBackend } from "./chatRules";

export type Availability = "probing" | "ready" | "unavailable" | "not_configured";
export type Refused = { code: string; retryAt: string | null };

/** A letter image waiting to go: the compressed local file, and once uploaded the server's id for it. */
export interface OutgoingImage {
  uri: string;
  name: string;
  type: string;
  /** Pixel size of the file (known from compression, replaced by the server's once uploaded). */
  width?: number;
  height?: number;
  imageId?: string;
}

export interface Outgoing {
  txnId: string;
  conversationId: string;
  roomId: string;
  /** Empty for an image: an image is its own message, never mixed with text. */
  body: string;
  ts: number;
  state: "sending" | "sent" | "queued" | "failed";
  eventId?: string;
  refused?: Refused;
  image?: OutgoingImage;
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
  /** One message per image, in order; each uploads then sends, one at a time. */
  sendImages: (c: SoulConversation, images: OutgoingImage[]) => void;
  /** 0..1 while an image's file is going up, by txn id. Not persisted. */
  progress: Record<string, number>;
  resend: (txnId: string) => void;
  loadOlder: (roomId: string) => Promise<void>;
  markRead: (roomId: string, eventId: string) => void;
  openInbox: () => Promise<SoulConversation>;
  openDirect: (userId: number) => Promise<SoulConversation>;
}

/** Codes that mean "the service did not answer", not "the service said no". */
const UNAVAILABLE = new Set(["chat_unavailable"]);
/** Retry waits after a failure: 5 → 10 → 20 → 30 → 30 … s, back to 5 s after a success or a retry press. */
const RETRY_MS = 5_000;
const RETRY_MAX_MS = 30_000;
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
  sendImages: noop,
  progress: {},
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

/** In `platform().persistent`: `{ owner, device, items }` — one account's unconfirmed letters. */
export const OUTBOX_KEY = "soulledger_chat_outbox";
interface StoredOutbox {
  owner: string;
  device: string | null;
  items: Outgoing[];
}

const isStoredItem = (o: unknown): o is Outgoing => {
  const x = o as Record<string, unknown> | null;
  const image = x?.image as Record<string, unknown> | undefined;
  const imageOk = image === undefined || (!!image && ["uri", "name", "type"].every((k) => typeof image[k] === "string"));
  return !!x && ["txnId", "conversationId", "roomId", "body"].every((k) => typeof x[k] === "string") && typeof x.ts === "number" && imageOk;
};

/** This account's record, or an empty one. Anything else on disk (another account, an old build, garbage) reads as empty. */
export function readOutbox(owner: string): StoredOutbox {
  try {
    const raw = JSON.parse(platform().persistent.get(OUTBOX_KEY) ?? "null");
    if (raw?.owner === owner && Array.isArray(raw.items)) {
      return {
        owner,
        device: typeof raw.device === "string" ? raw.device : null,
        // Whatever it was doing when the app stopped, it is waiting now.
        items: raw.items.filter(isStoredItem).map((o: Outgoing) => ({ ...o, state: "queued" as const, refused: undefined })),
      };
    }
  } catch {
    // Unreadable: nothing to resend.
  }
  return { owner, device: null, items: [] };
}

/** How many sign-outs have cleared the outbox (see `save` in ChatProvider). */
let signOuts = 0;

/** Sign-out: this device keeps no letters of a soul who has left it. */
export const clearOutbox = () => {
  signOuts += 1;
  platform().persistent.remove(OUTBOX_KEY);
};

/** What is worth keeping: not yet confirmed, and not refused (a refusal is final). */
const unconfirmed = (o: Outgoing) => o.state === "queued" || o.state === "sending";

export function ChatProvider({ account, children }: { account: string | null; children: ReactNode }) {
  const enabled = account !== null;
  const [availability, setAvailability] = useState<Availability>("probing");
  const [conversations, setConversations] = useState<SoulConversation[] | null>(null);
  const [timeline, setTimeline] = useState<TimelineState>(EMPTY_TIMELINE);
  const [me, setMe] = useState<string | null>(null);
  const [outbox, setOutbox] = useState<Outgoing[]>(() => (account ? readOutbox(account).items : []));
  const [refused, setRefused] = useState<Record<string, Refused>>({});
  const [progress, setProgress] = useState<Record<string, number>>({});
  const client = useRef<MatrixClient | null>(null);
  const since = useRef<string | null>(null);
  const known = useRef<Set<string>>(new Set());
  const wake = useRef<() => void>(noop);
  const convs = useRef<SoulConversation[]>([]);
  const outboxRef = useRef<Outgoing[]>([]);
  const availabilityRef = useRef<Availability>(availability);
  /** The Matrix device to log in as (persisted with the outbox). */
  const device = useRef<string | null>(null);
  /** txn id → event id, for every echo of my own sends /sync has brought. */
  const echoed = useRef(new Map<string, string>());
  /** The conversation list has loaded at least once: an unknown conversation id then really is unknown. */
  const listed = useRef(false);
  /** The sign-outs already counted when this account's session began. */
  const signOutsSeen = useRef(signOuts);
  // Each account starts from its own record, and a signed-out provider holds nobody's letters.
  // Swapped during render (React's "adjusting state when a prop changes"), so no commit, and so
  // no save below, ever pairs one account's name with another account's letters.
  const [outboxOwner, setOutboxOwner] = useState(account);
  if (outboxOwner !== account) {
    setOutboxOwner(account);
    setOutbox(account ? readOutbox(account).items : []);
  }
  // Declared before the save below: on an account's first commit its device goes to disk with its letters.
  useEffect(() => {
    device.current = account ? readOutbox(account).device : null;
    signOutsSeen.current = signOuts;
    echoed.current = new Map();
    listed.current = false;
  }, [account]);

  const save = useCallback(
    (items: Outgoing[]) => {
      // A sign-out since this session began has already taken these letters off the device, so it is not
      // this save's to undo. The save that tried is a passive effect from a commit before the sign-out.
      // `clearOutbox` runs before the sign-out's setState, and React flushes a pending effect before it
      // renders the next update, so without this the letters went back to disk under the old account.
      // It happened whenever such an effect was still pending: 5 of 5 runs of session.test's
      // "a session that expires on its own (401)" once its 401 was answered inside act (2026-09-24).
      if (!account || signOutsSeen.current !== signOuts) return;
      const record: StoredOutbox = { owner: account, device: device.current, items: items.filter(unconfirmed) };
      // Nothing waiting: nothing on disk (the device id only matters to a letter that is waiting).
      if (record.items.length) platform().persistent.set(OUTBOX_KEY, JSON.stringify(record));
      else platform().persistent.remove(OUTBOX_KEY);
    },
    [account]
  );

  useEffect(() => {
    outboxRef.current = outbox;
    availabilityRef.current = availability;
    save(outbox);
  }, [outbox, availability, save]);
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
      listed.current = true;
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

  /** Images go one at a time, in order; `inflight` keeps a flush from queueing one that is already on its way. */
  const imageChain = useRef<Promise<void>>(Promise.resolve());
  const inflight = useRef(new Set<string>());

  const deliverImage = useCallback(
    (o: Outgoing): Promise<void> => {
      if (inflight.current.has(o.txnId)) return Promise.resolve();
      inflight.current.add(o.txnId);
      patch(o.txnId, { state: "sending", refused: undefined });
      const run = async () => {
        try {
          const c = convs.current.find((row) => row.id === o.conversationId);
          // Before the list has loaded, unknown is not gone: keep waiting (as for text).
          if (!c) return patch(o.txnId, { state: listed.current ? "failed" : "queued" });
          const image = outboxRef.current.find((x) => x.txnId === o.txnId)?.image ?? o.image!;
          try {
            let imageId = image.imageId;
            if (!imageId) {
              const body = new FormData();
              body.append("file", { uri: image.uri, name: image.name, type: image.type } as unknown as Blob);
              const up = await soulChatApi.uploadImage(c.id, body, (fraction) => setProgress((p) => ({ ...p, [o.txnId]: fraction })));
              imageId = up.id;
              // Written back at once: from here a restart sends this image instead of uploading another.
              setOutbox((all) => all.map((x) => (x.txnId === o.txnId ? { ...x, image: { ...image, imageId: up.id, width: up.width, height: up.height } } : x)));
            }
            const eventId = await soulChatApi.sendImage(imageId);
            patch(o.txnId, { state: "sent", eventId });
          } catch (error) {
            if (isOffline(error)) {
              patch(o.txnId, { state: "queued" });
              setAvailability("unavailable");
              return;
            }
            const code = soulChatErrorCode(error);
            const imageCode = soulChatImageErrorCode(error);
            // `not_found`: the server no longer has the uploaded file (swept after a day) — send again from the local file.
            const stale = code === "not_found";
            // Final for this image: a fact about the conversation (muted, closed, …) or about the file itself.
            // Not final: a full upload queue, a throttle, a server fault — the retry may well work.
            const refusal =
              code && !stale
                ? { code, retryAt: soulChatRetryAt(error) }
                : imageCode && imageCode !== "too_many_pending"
                  ? { code: imageCode, retryAt: null }
                  : undefined;
            setOutbox((all) =>
              all.map((x) =>
                x.txnId === o.txnId ? { ...x, state: "failed" as const, refused: refusal, image: stale && x.image ? { ...x.image, imageId: undefined } : x.image } : x
              )
            );
            if (code && !stale) {
              setRefused((r) => ({ ...r, [c.id]: { code, retryAt: soulChatRetryAt(error) } }));
              void reload().then(() => setRefused((r) => ({ ...r, [c.id]: { code, retryAt: soulChatRetryAt(error) } })));
            }
          }
        } finally {
          inflight.current.delete(o.txnId);
          setProgress(({ [o.txnId]: _done, ...rest }) => rest);
        }
      };
      imageChain.current = imageChain.current.then(run, run);
      return imageChain.current;
    },
    [patch, reload]
  );

  const deliver = useCallback(
    async (o: Outgoing) => {
      if (o.image) return deliverImage(o);
      // Its echo already came back (a restart after the response was lost): delivered, do not post again.
      const seen = echoed.current.get(o.txnId);
      if (seen) return patch(o.txnId, { state: "sent", eventId: seen });
      const c = convs.current.find((row) => row.id === o.conversationId);
      // Before the list has loaded (a restored letter, the list unreachable), unknown is not gone: keep waiting.
      if (!c) return patch(o.txnId, { state: listed.current ? "failed" : "queued" });
      patch(o.txnId, { state: "sending" });
      try {
        const matrix = client.current;
        if (!sendsThroughBackend(c) && !matrix) throw new MatrixRequestError("not signed in to Synapse", "", null);
        const eventId = sendsThroughBackend(c) ? await soulChatApi.send(c.id, o.body, o.txnId) : await matrix!.send(c.room_id, o.txnId, o.body);
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
    [patch, reload, deliverImage]
  );

  const flush = useCallback(() => {
    for (const o of outboxRef.current) if (o.state === "queued") void deliver(o);
  }, [deliver]);

  // Sign in to Synapse, then long-poll /sync until signed out.
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let retryMs = RETRY_MS;
    // Waits out the current backoff and doubles it. `wake` (the retry button) ends the wait now and
    // starts the backoff over: the soul asked, so the next failure waits 5 s again, not 30.
    const backoff = () =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
          resolve();
        }, retryMs);
        wake.current = () => {
          clearTimeout(timer);
          retryMs = RETRY_MS;
          resolve();
        };
      });

    // "stop" = the backend says chat is not configured here (503 chat_not_configured).
    // That is a deployment fact, not a transient fault: asking again every RETRY_MS
    // only produced a 503 every 5 s for as long as the app was open. The loop ends;
    // a remount (sign-in, `enabled` flipping) starts it again.
    async function connect(): Promise<boolean | "stop"> {
      try {
        const grant = await soulChatApi.session();
        const creds = await matrixLogin(grant, device.current);
        if (!alive) return false;
        if (creds.deviceId && creds.deviceId !== device.current) {
          device.current = creds.deviceId;
          save(outboxRef.current);
        }
        client.current = matrixClient(creds);
        if (alive) setMe(creds.userId);
        return true;
      } catch (error) {
        const notConfigured = soulChatErrorCode(error) === "chat_not_configured";
        if (alive) setAvailability(notConfigured ? "not_configured" : "unavailable");
        return notConfigured ? "stop" : false;
      }
    }

    async function run() {
      await reload();
      while (alive) {
        if (!client.current) {
          const connected = await connect();
          if (!alive || connected === "stop") return;
          if (!connected) {
            await backoff();
            continue;
          }
        }
        try {
          const response = await client.current!.sync(since.current, since.current ? POLL_MS : 0);
          if (!alive) return;
          since.current = response.next_batch;
          retryMs = RETRY_MS; // connected and synced: the next failure waits 5 s again
          for (const room of Object.values(response.rooms?.join ?? {})) {
            for (const e of room.timeline?.events ?? []) {
              if (e.unsigned?.transaction_id) echoed.current.set(e.unsigned.transaction_id, e.event_id);
            }
          }
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
          await backoff();
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
  }, [enabled, reload, flush, save]);

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
      progress,
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
      sendImages: (c, images) => {
        const at = Date.now();
        const items: Outgoing[] = images.map((image, i) => ({
          txnId: newTxn(),
          conversationId: c.id,
          roomId: c.room_id,
          body: "",
          ts: at + i,
          state: "sending",
          image,
        }));
        setOutbox((all) => [...all, ...items]);
        for (const o of items) void deliverImage(o);
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
    [availability, conversations, listError, gone, timeline, me, outbox, refused, progress, reload, flush, deliver, deliverImage]
  );

  return <ChatContext.Provider value={enabled ? value : INERT}>{children}</ChatContext.Provider>;
}
