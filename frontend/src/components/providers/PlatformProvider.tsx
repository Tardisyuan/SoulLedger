"use client";

import { installWebPlatform } from "@/lib/platform/web";

/**
 * Installs the browser storage/navigation adapter into `@soulledger/core`.
 *
 * AT MODULE SCOPE, NOT IN AN EFFECT. `packages/core/src/api/client.ts`'s Axios interceptors
 * and the two WebSocket clients read the adapter on every request; if the
 * install waited for `useEffect`, the first render's queries would go out
 * unauthenticated and 401 before it ran. Module scope runs when the client
 * chunk is evaluated, which is before any component in it mounts.
 *
 * This also runs during server prerender of the client tree. That is harmless
 * and deliberate: the adapter is written to be server-safe, so on the server it
 * reads and writes nothing, exactly as the package's default null adapter does.
 *
 * The component renders nothing. It exists so that the install is a thing the
 * root layout visibly does — `src/__tests__/platformAdapterIsInstalled.test.tsx`
 * asserts that `app/layout.tsx` mounts it, because an import that only exists
 * for its side effect is the kind of line a tidy-up deletes.
 */
installWebPlatform();

export function PlatformProvider() {
  return null;
}
