/**
 * 书信(殿司收件箱)在客户端要判断的几条规则 —— Web(`frontend/app/soul-inbox/page.tsx`)与官员 App
 * (`mobile-officer/src/screens/letter.tsx`)读同一份。规则本身是服务端的,这里只把服务端下发的事实读成一个答案:
 *
 * - 能不能回(`inboxReplyGate`):`services.officer_reply` 的顺序 —— 已关闭 `closed` → 灵魂已调走
 *   `not_current_hall`(`can_reply` false,即 `inbox.hall_can_reply`)→ 交给了别人 `assigned_to_other`
 *   (`assignee` 已按 `live_assignee` 给出)。权限码(`soul_inbox.reply`)不在这里:它是看信的人的事,
 *   各端用自己的 `hasPermission` / `useCan` 与之相与。
 * - 待回复(`awaitingReply`):`inbox.awaiting_reply` —— 最后一封是灵魂写的,且殿司此刻回得了。
 * - 回复正文(`replyReady`)与草稿(`normalizeDraft` / `draftNeedsSave`):`OfficerReplySerializer.body`
 *   (去掉首尾空白后非空、不超过 `INBOX_REPLY_MAX`)与草稿视图的「只有空白 = 清掉」。
 */
import { INBOX_REPLY_MAX } from "../api/soul-inbox";
import { localDateString } from "./dates";

/** 这封信此刻的回信状态。`open`:能回(没人经办的也能回,回了不改经办人)。 */
export type InboxReplyGate = "closed" | "moved" | "others" | "open";

/** 只用到收件箱会话的这几样(`OfficerInbox`)。 */
export interface InboxReplyFacts {
  closed_at?: string | null;
  /** 服务端的 `hall_can_reply`;旧服务端不发,按能回算。 */
  can_reply?: boolean;
  assignee?: { user_id: number } | null;
  last_from?: string;
}

/**
 * `movedSeen`:这台设备上一次回信刚被答 409 `not_current_hall`,比手上的会话新(列表还没刷新)。
 * `userId`:看信的官员;不知道是谁时,有经办人就算别人的。
 */
export function inboxReplyGate(c: InboxReplyFacts, viewer: { userId: number | undefined; movedSeen?: boolean }): InboxReplyGate {
  if (c.closed_at != null) return "closed";
  if (c.can_reply === false || viewer.movedSeen) return "moved";
  if (c.assignee != null && c.assignee.user_id !== viewer.userId) return "others";
  return "open";
}

/**
 * 「待回复」:最后一封是灵魂写的,且殿司此刻回得了(`inbox.awaiting_reply`)。`lastFrom`:手上有线程时由最后一封信给出
 * (比会话行上的 `last_from` 新:那一列等 Synapse 回调才改)。
 */
export function awaitingReply(c: InboxReplyFacts, lastFrom: string | undefined = c.last_from): boolean {
  return lastFrom === "soul" && c.closed_at == null && c.can_reply !== false;
}

/** 这段字能不能作为回复发出:去掉首尾空白后非空,且不超过服务端收的长度(`OfficerReplySerializer.body`)。 */
export function replyReady(text: string): boolean {
  const body = text.trim();
  return body !== "" && body.length <= INBOX_REPLY_MAX;
}

/** 草稿存进服务端时的样子:只有空白就是清掉(草稿视图同一条规则)。 */
export const normalizeDraft = (text: string): string => (text.trim() ? text : "");

/**
 * 回复框里的字要不要存:与服务端那一份(`null` = 还没取到)不同才存。还没取到就一个字都不存 —— 否则空白的框
 * 会先把服务端的草稿清掉;取不到时要说出来(Web 的「草稿没取到 · 重试」),不能一直不声不响地不存。
 */
export function draftNeedsSave(saved: string | null, text: string): boolean {
  return saved !== null && normalizeDraft(text) !== saved;
}

// ── 第六十四批:往来怎么排(三端同一份) ─────────────────────────────────────────────────────────────────────
//
// 一栏从上往下读。同一人连着写的几封并成一组,组头一行署名;跨天插一行日期;自己这一方的组放面板(画在各端),
// 对方的直接是正文。灵魂端也用这一份:那里「自己」是灵魂,组头写「我 / 殿司」。

/** 信是哪一方写的。`hall`:殿司(官员的回信)。 */
export type LetterSide = "soul" | "hall";

/** 一组里两封相隔超过这么久,后一封上方补一个小时间。 */
export const LETTER_STAMP_GAP_MS = 30 * 60_000;

/** 分组只看这三样:时间(毫秒)、哪一方、谁(同一方换了人就换组;灵魂端的殿司一律算同一人)。 */
export interface LetterFacts {
  ts: number;
  side: LetterSide;
  author: string;
}

export interface LetterInGroup<T> {
  item: T;
  ts: number;
  /** 与组里上一封相隔超过 `LETTER_STAMP_GAP_MS`:这一封上方写它自己的时:分。组里第一封的时间在组头,不在这里。 */
  stamp: boolean;
}

export interface LetterGroup<T> {
  kind: "group";
  key: string;
  side: LetterSide;
  author: string;
  /** 组里第一封的时间(组头右边那个)。 */
  ts: number;
  letters: LetterInGroup<T>[];
  /** 没回的那组来信:左边一道 2px 墨线。 */
  open: boolean;
}

export type LetterRow<T> = { kind: "day"; key: string; day: string } | LetterGroup<T>;

/**
 * 从旧到新的信 → 日期行与组。新的一天总是新起一组(日期行在两组之间)。
 * `open`:还没回 —— 最后一组若是灵魂的来信,标成 `open`;回了(最后一组是殿司的)就没有。
 * `day` 是本机日历的 `YYYY-MM-DD`,怎么写给人看由各端定。
 */
export function groupLetters<T>(items: readonly T[], facts: (item: T) => LetterFacts, { open = false }: { open?: boolean } = {}): LetterRow<T>[] {
  const rows: LetterRow<T>[] = [];
  let day = "";
  let group: LetterGroup<T> | null = null;
  for (const item of items) {
    const f = facts(item);
    const d = localDateString(new Date(f.ts));
    if (d !== day) {
      rows.push({ kind: "day", key: `d${d}`, day: d });
      day = d;
      group = null;
    }
    const prev = group?.letters[group.letters.length - 1];
    if (group && prev && group.side === f.side && group.author === f.author) {
      group.letters.push({ item, ts: f.ts, stamp: f.ts - prev.ts > LETTER_STAMP_GAP_MS });
    } else {
      group = { kind: "group", key: `g${rows.length}:${f.ts}`, side: f.side, author: f.author, ts: f.ts, letters: [{ item, ts: f.ts, stamp: false }], open: false };
      rows.push(group);
    }
  }
  if (open && group?.side === "soul") group.open = true;
  return rows;
}

/**
 * 底部状态行说的那件事(第六十四批第三节)。`closed` / `moved` 只读:只有一行灰字,不放按钮、不放回复框。
 *
 * 设计稿还有一种「已归档 · 只能看」;这里不做:用户 2026-11-02 定过,归档的信照样能回(回信在服务端把它移出归档),
 * 页头的「已归档」横幅与「取消归档」已经说了它归档了。所以归档的信按「轮到谁」说。
 */
export type LetterState = "awaiting_hall" | "awaiting_soul" | "moved" | "closed";

/** `lastSide`:最后一封是谁写的(没有信时 undefined:那就不说轮到谁)。 */
export function letterState(gate: InboxReplyGate, lastSide: LetterSide | undefined): LetterState | null {
  if (gate === "closed") return "closed";
  if (gate === "moved") return "moved";
  if (!lastSide) return null;
  return lastSide === "soul" ? "awaiting_hall" : "awaiting_soul";
}

export const isReadOnlyLetterState = (s: LetterState | null): boolean => s === "closed" || s === "moved";

const HOUR = 3_600_000;

/**
 * 「来信已等 {{wait}}」的那段时长:`common.duration.<unit>` 填 `n`。从最后一封来信算起,往下取整,规则与审批的
 * 「还有 …」(`deadlineDistance`)同一套:一小时内按分钟(至少 1),两天内按小时,再久按天。
 */
export function letterWait(since: number, now: number): { unit: "minutes" | "hours" | "days"; n: number } {
  const ms = Math.max(0, now - since);
  if (ms < HOUR) return { unit: "minutes", n: Math.max(1, Math.floor(ms / 60_000)) };
  if (ms < 48 * HOUR) return { unit: "hours", n: Math.floor(ms / HOUR) };
  return { unit: "days", n: Math.floor(ms / (24 * HOUR)) };
}

/** 最后一封来信(灵魂写的)的时间;没有就 undefined。`items` 从旧到新。 */
export function lastSoulLetterAt<T>(items: readonly T[], facts: (item: T) => Pick<LetterFacts, "ts" | "side">): number | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const f = facts(items[i]);
    if (f.side === "soul") return f.ts;
  }
  return undefined;
}

/** 图片信在组里的框:按原比例放进 160×120 之内。读不出比例就按满框。 */
export function letterImageBox(width?: number, height?: number): { width: number; height: number } {
  const MAX_W = 160;
  const MAX_H = 120;
  if (!width || !height || width <= 0 || height <= 0) return { width: MAX_W, height: MAX_H };
  const scale = Math.min(MAX_W / width, MAX_H / height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
