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
