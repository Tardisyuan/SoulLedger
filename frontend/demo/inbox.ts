/**
 * The officers' letter inbox. The real one reads a Matrix server, which a recording has none of, so these few threads are
 * written here. They hang off real souls in the recording, so links to the soul open a real page.
 */
import { type Answer, type Recording, addRow, patchRow, read, rowsNow } from "./store";

type Row = Record<string, unknown>;

const THREADS = [
  {
    hoursAgo: 3,
    letters: { zh: ["判官大人:我母亲尚在阳间,年迈无依。此案若能早结,可否容我托梦一言?"], en: ["Your honour: my mother is still among the living, old and alone. If this case could end soon, might I speak to her in a dream?"] },
  },
  {
    hoursAgo: 19,
    letters: { zh: ["卷宗里写我贪财,可那笔银子是替同乡还的债,借据还在老宅的梁上。", "烦请查证。"], en: ["The file says I was greedy, but that silver paid a neighbour's debt. The note is still in the rafters of the old house.", "Please look into it."] },
  },
  {
    hoursAgo: 52,
    letters: { zh: ["听闻隔壁殿的案子都结了,我的还要等多久?"], en: ["I hear the cases next door are all closed. How much longer for mine?"] },
    replied: { zh: "已在排期,前面还有两件,结案会即刻告知。", en: "It is scheduled, with two ahead of it. You will hear as soon as it closes." },
  },
  {
    hoursAgo: 120,
    letters: { zh: ["谢谢您上回回信。我想再问一句:转世之后,这些事还记得吗?"], en: ["Thank you for your last letter. One more question: after rebirth, will I remember any of this?"] },
    replied: { zh: "饮过孟婆汤便不记得了。", en: "Not after the soup." },
  },
];
const HALLS: Record<string, Record<string, string>> = {
  zh: { CN_DIYU: "中国地府", EU_HEAVEN_HELL: "欧洲天堂与地狱", EG_DUAT: "埃及冥界", GR_HADES: "希腊冥界" },
  en: { CN_DIYU: "Diyu", EU_HEAVEN_HELL: "Heaven and Hell", EG_DUAT: "The Duat", GR_HADES: "Hades" },
};
const INBOX = "/chat/inbox/";
const idFor = (soulId: unknown) => `c0ffee00${String(soulId).slice(8)}`;
const ago = (hours: number) => Date.now() - hours * 3600000;

function seedRows(rec: Recording): Row[] {
  // The letters speak of Meng Po's soup: Diyu's souls only.
  const souls = rowsNow(rec, "/souls/").filter((s) => s.tenant_code === "CN_DIYU" && s.current_state !== "ALIVE" && typeof s.id === "string").slice(0, THREADS.length);
  return souls.map((soul, i) => {
    const thread = THREADS[i];
    const at = new Date(ago(thread.hoursAgo)).toISOString();
    return {
      id: idFor(soul.id),
      soul: soul.id,
      soul_name: soul.name,
      soul_code: `DEMO${String(soul.id).slice(0, 6).toUpperCase()}`,
      tenant: 1,
      tenant_name: HALLS[rec.lang][String(soul.tenant_code)] ?? soul.tenant_code,
      hall_names: {},
      last_message_at: at,
      last_soul_message_at: new Date(ago(thread.hoursAgo + 1)).toISOString(),
      last_from: thread.replied ? "hall" : "soul",
      unread: !thread.replied,
      has_draft: false,
      archived: false,
      assignee: null,
      assigned_at: null,
      feedback_tag: "",
      created_at: new Date(ago(thread.hoursAgo + 40)).toISOString(),
      can_reply: true,
    };
  });
}

const collectionNow = (rec: Recording): Row[] =>
  // A patch reads through `rowsNow` only for rows it knows, so these go through the same door as recorded ones.
  (read({ ...rec, lists: { ...rec.lists, [INBOX]: { rows: seedRows(rec), extra: {} } } }, INBOX, new URLSearchParams("page_size=100")).data as { results: Row[] }).results;

function messagesOf(rec: Recording, id: string): Row[] {
  const index = seedRows(rec).findIndex((row) => row.id === id);
  const thread = THREADS[index];
  const soul = seedRows(rec)[index];
  if (!thread) return [];
  const message = (body: string, fromOfficer: boolean, hours: number, n: number) => ({
    event_id: `$demo-${id}-${n}`,
    from_officer: fromOfficer,
    sender_name: fromOfficer ? meOf(rec).display_name || meOf(rec).username : soul.soul_name,
    officer_title: fromOfficer ? (rec.lang === "zh" ? "判官" : "Judge") : "",
    txn_id: null,
    body,
    image: null,
    timestamp: ago(hours),
  });
  const base = thread.letters[rec.lang].map((body, n) => message(body, false, thread.hoursAgo + 1 - n * 0.1, n));
  if (thread.replied) base.push(message(thread.replied[rec.lang], true, thread.hoursAgo, 9));
  return base;
}

function folderOf(row: Row, folder: string | null, me: number): boolean {
  switch (folder) {
    case "awaiting_reply":
      return row.last_from === "soul" && !row.archived;
    case "replied":
      return row.last_from === "hall" && !row.archived;
    case "drafts":
      return row.has_draft === true;
    case "archived":
      return row.archived === true;
    case "assigned_to_me":
      return (row.assignee as Row | null)?.user_id === me;
    default:
      return !row.archived;
  }
}

const meOf = (rec: Recording) => rec.login.user as Row & { id: number; display_name?: string; username: string };

export function letterCounts(rec: Recording) {
  const rows = collectionNow(rec);
  const count = (n: number) => ({ count: n, items: [] });
  return {
    letters: count(rows.filter((row) => row.last_from === "soul" && !row.archived).length),
    unassigned_letters: count(rows.filter((row) => !row.assignee && !row.archived).length),
  };
}

export function inboxRead(rec: Recording, path: string, query: URLSearchParams): Answer | null {
  if (!path.startsWith(INBOX)) return null;
  const me = meOf(rec);
  const rows = collectionNow(rec);
  if (path === INBOX) {
    const results = rows.filter((row) => folderOf(row, query.get("folder"), me.id));
    return { status: 200, data: { count: results.length, next: null, previous: null, results } };
  }
  if (path === `${INBOX}folders/`) {
    const n = (folder: string) => rows.filter((row) => folderOf(row, folder, me.id)).length;
    return {
      status: 200,
      data: {
        all: n("all"),
        awaiting_reply: n("awaiting_reply"),
        replied: n("replied"),
        drafts: n("drafts"),
        archived: n("archived"),
        assigned_to_me: n("assigned_to_me"),
        unread: rows.filter((row) => row.unread).length,
        open: n("all"),
        closed: 0,
        halls: [],
      },
    };
  }
  const m = /^\/chat\/inbox\/([^/]+)\/(?:(messages|draft|assignable)\/)?$/.exec(path);
  if (!m) return null;
  const [, id, part] = m;
  if (part === "messages") {
    if (query.has("before")) return { status: 200, data: [] };
    return { status: 200, data: [...messagesOf(rec, id), ...((rowsNow(rec, `${INBOX}${id}/messages/`) as Row[]).slice().reverse())] };
  }
  if (part === "assignable") return { status: 200, data: [{ user_id: me.id, display_name: me.display_name || me.username }] };
  if (part === "draft") {
    return { status: 200, data: { last_read_at: null, archived_at: null, draft: String(rows.find((row) => row.id === id)?.draft ?? ""), draft_saved_at: null } };
  }
  return { status: 200, data: rows.find((row) => row.id === id) ?? { id } };
}

export function inboxWrite(rec: Recording, path: string, body: Row): Answer | null {
  const m = /^\/chat\/inbox\/([^/]+)\/(reply|read|archive|unarchive|assign|unassign)\/$/.exec(path);
  if (!m) return null;
  const [, id, action] = m;
  const me = meOf(rec);
  const state = { last_read_at: new Date().toISOString(), archived_at: null, draft: "", draft_saved_at: null };
  switch (action) {
    case "reply": {
      const event_id = `$demo-reply-${Date.now()}`;
      addRow(`${INBOX}${id}/messages/`, {
        id: event_id,
        event_id,
        from_officer: true,
        sender_name: me.display_name || me.username,
        officer_title: "",
        txn_id: body.txn_id ?? null,
        body: String(body.body ?? ""),
        image: null,
        timestamp: Date.now(),
      });
      patchRow(INBOX, id, { last_from: "hall", last_message_at: new Date().toISOString(), unread: false, has_draft: false, draft: "" });
      return { status: 200, data: { event_id } };
    }
    case "read":
      patchRow(INBOX, id, { unread: false });
      return { status: 200, data: state };
    case "archive":
    case "unarchive":
      patchRow(INBOX, id, { archived: action === "archive" });
      return { status: 200, data: state };
    case "assign":
      patchRow(INBOX, id, { assignee: { user_id: body.user_id, display_name: me.display_name || me.username }, assigned_at: new Date().toISOString() });
      return { status: 200, data: inboxRead(rec, `${INBOX}${id}/`, new URLSearchParams())?.data };
    default:
      patchRow(INBOX, id, { assignee: null, assigned_at: null });
      return { status: 200, data: inboxRead(rec, `${INBOX}${id}/`, new URLSearchParams())?.data };
  }
}
