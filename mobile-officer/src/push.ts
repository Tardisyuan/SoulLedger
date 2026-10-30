/**
 * Push, the officer app's half (the server's is `backend/apps/officer_app/push.py`).
 *
 * The lock screen carries a count and nothing else -- 「有 N 件待你处理」 -- written by the server
 * from a fixed table; `data` is `{category: "officer_todo"}`. This app never puts a name, a case
 * or a soul on the lock screen, and neither does the server. Nothing here throws to a caller.
 */
import { officerAppApi } from "@soulledger/core/api/officer-app";
import * as Notifications from "expo-notifications";

import { landingOf, type Landing } from "./rules";
import { pushCore } from "./shared";

export { easProjectId, installNotificationHandler, permission, type Permission, type Registration } from "./shared";

/** The Expo token this device last registered -- what sign-out must unregister. */
export const PUSH_TOKEN_KEY = "officer_push_token";

/**
 * Permission (the system dialog only from the settings switch, never at launch), registration, and sign-out's
 * unregistration: the soul app's core (`mobile/src/pushCore.ts`) with this app's key, channel and endpoints.
 * The channel is PRIVATE: the lock screen shows the generic count only, whatever the title / body say. Unregister
 * asks the server first and clears the local copy after (A16); a failed request is not retried -- what stops the
 * pushes is the logout that follows: since 2026-10-23 it ends this device's sign-in session on the server, and
 * that ends its registration.
 */
export const { requestPermission, registerDevice, hasRegisteredDevice, registeredToken, unregisterDevice } = pushCore({
  tokenKey: PUSH_TOKEN_KEY,
  channel: { id: "default", name: "SoulLedger Officers" },
  register: (token, device) => officerAppApi.registerPush({ token, platform: device }),
  unregister: (token) => officerAppApi.unregisterPush(token),
});

/** Calls `onArrive` for every notification that arrives while the app is in the foreground (not tapped yet). */
export function listenForArrivals(onArrive: () => void): () => void {
  const sub = Notifications.addNotificationReceivedListener(() => onArrive());
  return () => sub.remove();
}

/**
 * Calls `onLand` for a tapped notification: one that opened the app (the last response) and every
 * later one. A response whose payload names nowhere is ignored.
 */
export function listenForLandings(onLand: (landing: Landing) => void): () => void {
  let alive = true;
  const handle = (data: unknown) => {
    const landing = landingOf(data);
    if (alive && landing) onLand(landing);
  };
  void Notifications.getLastNotificationResponseAsync()
    .then((last) => {
      if (last) {
        handle(last.notification.request.content.data);
        Notifications.clearLastNotificationResponse?.();
      }
    })
    .catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener((response) => handle(response.notification.request.content.data));
  return () => {
    alive = false;
    sub.remove();
  };
}
