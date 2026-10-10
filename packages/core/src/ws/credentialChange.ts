/**
 * "This device is changing its credentials right now" -- a module-level registry, platform-independent.
 *
 * WHY. Changing the password ends every login, this device's included: the server closes the open
 * sockets (4002) the moment the transaction commits, and this device only gets its NEW tokens when the
 * HTTP response arrives and is stored. A reconnect that fired in between would present the old token,
 * be refused (4001), and the probe that follows would refresh with the already-revoked refresh token --
 * signing this device out too. So the realtime client waits for the request to settle before it
 * reconnects (`WSClient`, on 4002). A device that sent no such request (every OTHER device) has nothing
 * registered and reconnects at once, is refused, and goes to the login page, as before.
 */
const pending = new Set<Promise<unknown>>();

/** Register `work` (settled = tokens stored on success, untouched on failure); returns it unchanged. */
export function trackCredentialChange<T>(work: Promise<T>): Promise<T> {
  pending.add(work);
  const done = () => void pending.delete(work);
  work.then(done, done);
  return work;
}

/** Resolves when every registered change has settled (either way) or after `limitMs`; at once if none. */
export function waitForCredentialChange(limitMs: number): Promise<void> {
  if (pending.size === 0) return Promise.resolve();
  const settled = Promise.allSettled([...pending]).then(() => undefined);
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, limitMs);
    void settled.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export function hasCredentialChangeInFlight(): boolean {
  return pending.size > 0;
}
