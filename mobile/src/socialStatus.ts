/**
 * The circle status (`/me/social/status/`), asked once for every reader on screen at that moment
 * (cq-apps 2026-10-30 #7). The readers want different fields: the compose page and a post's page
 * `can_write` / `muted_until`, the circle bar's 「互动」 `unread_interactions`, my page `user_id`.
 *
 * Nothing is cached between visits: each reader still fetches when it mounts (and the bar on every
 * refocus), so a page opened later sees a new mute or unread count. What is shared is the request in
 * flight: readers asking at the same moment get one response. A write that changes the status
 * (`invalidateSocialStatus`) drops that request and makes every mounted reader ask again; sign-out
 * (`clearSocialStatus`) drops it so the next account never receives the last one's answer.
 */
import { useEffect } from "react";
import { soulSocialApi, type SoulSocialStatus } from "@soulledger/core/api/soul-social";

import { useRemote } from "./ui";

let inflight: Promise<SoulSocialStatus> | null = null;
const readers = new Set<() => unknown>();

/** The status, sharing the request already on its way if there is one. */
export function fetchSocialStatus(): Promise<SoulSocialStatus> {
  if (inflight) return inflight;
  const mine = soulSocialApi.status().finally(() => {
    if (inflight === mine) inflight = null;
  });
  inflight = mine;
  return mine;
}

/** After posting, commenting, reporting, reading the inbox: every mounted reader asks again. */
export function invalidateSocialStatus(): void {
  inflight = null;
  readers.forEach((reload) => void reload());
}

/** Sign-out / expired session: a request still on its way belongs to the account that left. */
export function clearSocialStatus(): void {
  inflight = null;
}

/** `useRemote` over the shared request, re-asked when a write invalidates it. */
export function useSocialStatus() {
  const status = useRemote(fetchSocialStatus);
  const { reload } = status;
  useEffect(() => {
    readers.add(reload);
    return () => {
      readers.delete(reload);
    };
  }, [reload]);
  return status;
}
