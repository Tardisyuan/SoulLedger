/**
 * Factories for the module doubles most suites declare by hand
 * (docs/test-suite-review-2026-11-10.md §3.1: I18nContext ×188,
 * TenantContext ×126, ToastContext ×93).
 *
 * `jest.mock` is hoisted and scoped to the test file, so a helper cannot call
 * it for you. The factory is what is shared:
 *
 *     jest.mock("@/src/contexts/TenantContext", () => require("./support/mocks").tenantMock());
 *     import { setMockUser, mockShowToast } from "./support/mocks";
 *
 * Each test file has its own module registry, so the state below (the user,
 * the toast spy) is per file, and the instance the factory closes over is the
 * one the test imports.
 *
 * Each double returns what the hand-written copies returned and nothing more:
 * a double that answers more than the original did would quietly change what
 * the migrated tests measure. A test that needs another field writes its own.
 */
type Params = Record<string, string>;

/**
 * How a key-echo `t` shows its params — the three spellings the suites use:
 * `"drop"` → `key`, `"paren"` → `key(a,b)`, `"colon"` → `key:a,b`.
 */
export type ParamStyle = "drop" | "paren" | "colon";

export function echoT(style: ParamStyle = "drop") {
  return (key: string, params?: Params): string => {
    if (!params || style === "drop") return key;
    const values = Object.values(params).join(",");
    return style === "paren" ? `${key}(${values})` : `${key}:${values}`;
  };
}

/**
 * `useI18n` answering a key-echo `t` plus exactly the `fields` given
 * (`locale`, `hydrated`, `formatDateTime`, …) — no defaults, so a suite that
 * never said `hydrated` still gets `undefined` there, as it did by hand.
 * `actual: true` spreads the real module first, for code that also imports
 * `makeTranslateWithFallback` / `LOCALE_LABELS` / `I18nProvider` from it.
 *
 * Identity matches the inline copies, whose arrows were rebuilt on every
 * `useI18n()` call: `t` is a fresh echo per call, and every function field
 * (all of them inline arrows at the call sites) is re-wrapped per call, so a
 * component that memoizes on `formatDateTime` sees it change as it did.
 *
 * `useI18n` instead of fields: the suite's own hook, used as is — for a `t`
 * that closes over `tZh` / a `mock*` variable, a custom mapping, or a stable
 * `() => mockI18n`. Only the module spread around it is shared.
 */
export function i18nMock({
  params = "drop",
  actual = false,
  useI18n,
  ...fields
}: { params?: ParamStyle; actual?: boolean; useI18n?: () => unknown } & Record<string, unknown> = {}) {
  const fresh = (v: unknown) => (typeof v === "function" ? (...a: unknown[]) => v(...a) : v);
  return {
    ...(actual ? jest.requireActual("@/src/contexts/I18nContext") : {}),
    useI18n:
      useI18n ??
      (() => ({ t: echoT(params), ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, fresh(v)])) })),
  };
}

let tenantUser: unknown = null;

/** The user `useTenant()` reports. Reset it in `beforeEach`: nothing here resets it for you. */
export function setMockUser(user: unknown): void {
  tenantUser = user;
}

/** `useTenant: () => ({ user })` — the user only, exactly like the `{ user: mockUser }` copies. */
export function tenantMock() {
  return { useTenant: () => ({ user: tenantUser }) };
}

/** One spy per test file. `jest.clearAllMocks()` clears it like any other `jest.fn()`. */
export const mockShowToast = jest.fn();

/** `useToast: () => ({ showToast: mockShowToast })`. */
export function toastMock() {
  return { useToast: () => ({ showToast: mockShowToast }) };
}

/** A DRF list response as axios resolves it — 14 suites had this exact line. */
export const page = (results: unknown[]) => ({ data: { count: results.length, next: null, previous: null, results } });

/** An axios-shaped HTTP failure — 9 suites had this exact line. */
export const http = (status: number, data?: unknown) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });
