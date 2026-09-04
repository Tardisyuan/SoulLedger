import type { NotifyParams } from "@soulledger/core/platform";

/**
 * The web host's translator, reachable from outside React.
 *
 * WHY THIS EXISTS. `notify` takes a message **key** and the host resolves it
 * (see `NotifyMessage` in `@soulledger/core/platform`). The thing that resolves
 * keys in this app is `useI18n().t`, and the platform adapter in
 * `../platform/web.ts` cannot call it: `t` is a React callback closed over
 * provider state, while the adapter is a module-level object that no component
 * renders. So the adapter needs a way to reach `t` that is not a hook.
 *
 * WHY IT HOLDS `t` ITSELF AND NOT A SECOND LOOKUP. The obvious alternative was
 * to give this module the default bundle and its own `key.split(".")` walk. It
 * would have agreed with `t` for exactly as long as nobody changed either one —
 * the drift this repository has already been bitten by twice (`getAccessToken`
 * in three files; `CIVILIZATION_ICONS` in two, whose values matched while their
 * comments had diverged). There is one lookup in this app and it is
 * `I18nContext`'s. This module holds a reference to it and nothing else.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WITH NO PROVIDER MOUNTED, `translate` RETURNS THE KEY. Stated, not hidden.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * That is the same thing `t` itself does for a key it cannot find, so it is not
 * a new failure shape. It is reachable in exactly two places:
 *
 *  - Next's server render, where nothing calls `notify` because every caller is
 *    a mutation callback in a client component;
 *  - a jest suite that installs the web adapter (`jest.setup.js` does, for
 *    every suite) and renders no `I18nProvider`.
 *
 * `I18nProvider` wraps the root layout, so in the running app it has published
 * before any hook can fire. A default bundle imported here would paper over the
 * second case with Chinese copy and buy nothing in the first, at the cost of a
 * second copy of the lookup — hence the key.
 *
 * ONE APP, ONE PROVIDER. A second `I18nProvider` on a different locale would
 * overwrite the first. There is no such thing here.
 */
export type Translator = (key: string, params?: NotifyParams) => string;

let current: Translator | null = null;

/** Called by `I18nProvider` with its own `t`, and with `null` on unmount. */
export function publishTranslator(translator: Translator | null): void {
  current = translator;
}

/** The non-React reader. See the header for what it answers before a mount. */
export function translate(key: string, params?: NotifyParams): string {
  return current ? current(key, params) : key;
}
