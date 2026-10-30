/**
 * A scripted transport for core's REAL soul client (`soulHttp`): its
 * interceptors — refresh, 401 → onUnauthorized, 403 → password change — run
 * exactly as on a device; only the network is replaced.
 */
import { soulHttp } from "@soulledger/core/api/soul";
import { act, fireEvent, screen } from "@testing-library/react-native";
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

import { ACCOUNT_KEY, APP_LOCK_KEY, ASKED_PREFIX, BIO_KEY, resetColdStart } from "../deviceLogin";
import { persistentStore } from "../platform";
import { REFOCUS_FRESH_MS } from "../ui";

/**
 * Wait out a bottom-tab switch. After the (zero-length) transition, BottomTabView
 * clears its `animating` flag in a 32 ms setTimeout (@react-navigation/bottom-tabs
 * BottomTabView.tsx:190). A test that ends right after a switch leaves that update
 * to land after it — the act() warning jest.setup.js fails on, and a flaky one:
 * whether the timer beats RNTL's cleanup is a race (2026-09-19: one run in four).
 *
 * That 32 ms timer is the second link of a chain: it is armed only when the tab
 * animation ends, and under jest the animation's end is itself a 16 ms timer
 * (@react-native/jest-preset NativeModules.js, `startAnimatingNode`). One 100 ms
 * wait did not cover it under load: with the event loop blocked past 100 ms, the
 * 16 ms and 100 ms timers come due in the same pass, the 16 ms one arms the 32 ms
 * one, and the 100 ms one ends the wait first. So wait once per link, with the
 * link's own delay: Node keeps timers of one duration in one list and fires that
 * list in insertion order, so a timer armed after the link, with the same delay,
 * fires after it however late the loop runs. (Different delays give no such order.)
 */
const tick = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
export async function settleTabs() {
  await tick(16); // after the animation's end, which arms…
  await tick(32); // …and after `animating: false`
}

/** Press a bottom tab and let the switch finish (see settleTabs). */
export async function pressTab(testID: string) {
  fireEvent.press(screen.getByTestId(testID));
  await settleTabs();
}

/**
 * Moves the clock the refocus throttle reads (ui.tsx `REFOCUS_FRESH_MS`) past it, so the answers already on
 * screen count as old and a return to the page asks again. Returns the spy; `mockRestore()` it at the end.
 */
export function ageAnswers(ms = REFOCUS_FRESH_MS + 1000) {
  const real = Date.now.bind(Date);
  return jest.spyOn(Date, "now").mockImplementation(() => real() + ms);
}

export type Reply = { status: number; data?: unknown } | "offline";

/**
 * A reply the test hands over when it chooses — inside act(), so that every update
 * that follows it (and the navigator's own bookkeeping after those) is flushed
 * before act returns, rather than raced by a waitFor.
 */
export function heldReply() {
  let answer!: (reply: Reply) => void;
  const reply = new Promise<Reply>((resolve) => (answer = resolve));
  return { reply, answer };
}

export function stubApi(routes: Record<string, Reply | Promise<Reply> | (Reply | Promise<Reply>)[]>) {
  const calls: { method: string; url: string; body: unknown; params?: Record<string, unknown> }[] = [];
  soulHttp.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const url = config.url ?? "";
    const method = (config.method ?? "get").toUpperCase();
    // A multipart upload's body is the FormData itself (not JSON); it is recorded as is.
    const body = typeof config.data === "string" ? JSON.parse(config.data) : config.data;
    calls.push({ method, url, body, params: config.params });
    // An upload with a progress listener hears 30% before its reply, so the in-flight state is observable.
    config.onUploadProgress?.({ loaded: 30, total: 100, bytes: 30, lengthComputable: true });
    // A cold start with a stored refresh token rotates it before `/me/` (session.tsx `boot`); unless a test scripts
    // that answer, the server accepts it.
    const route =
      routes[`${method} ${url}`] ?? routes[url] ?? (url === "/soul-auth/refresh/" ? { status: 200, data: { access: "A", refresh: body?.refresh ?? "R" } } : undefined);
    // A held reply may also sit inside a sequence (one per call), so every pick is awaited.
    const reply = await (Array.isArray(route) ? (route.length > 1 ? route.shift() : route[0]) : route);
    if (!reply) throw new Error(`unscripted request: ${method} ${url}`);
    if (reply === "offline") throw new AxiosError("Network Error", "ERR_NETWORK", config);
    const response = { status: reply.status, data: reply.data, headers: {}, config, statusText: "" } as AxiosResponse;
    if (reply.status >= 400) throw new AxiosError("fail", "ERR_BAD_RESPONSE", config, null, response);
    return response;
  };
  return calls;
}

export const PROFILE = {
  soul_code: "QU33Q9FW5F",
  name: "张三",
  birth_name: "张三",
  civilization: "CHINESE",
  tenant: { code: "CN_DIYU", display_name: "中国地府", hall_names: { "zh-Hans": "第五殿", en: "The Fifth Court", egy: "Yanluo Wesekhet" }, seal_glyphs: [] },
  home_tenant: { code: "CN_DIYU", display_name: "中国地府", hall_names: { "zh-Hans": "第五殿", en: "The Fifth Court", egy: "Yanluo Wesekhet" }, seal_glyphs: [] },
  home_civilization: "CHINESE",
  is_residing: false,
  current_state: "JUDGING",
  birth_date: { year: 1901, month: 3, day: null },
  death_date: { year: 1980, month: null, day: null },
  origin_location: "成都",
  merit_score: 12,
  demerit_score: 3,
  account: { cycle: 1, must_change_password: false, initial_password_expires_at: null, created_at: "2026-09-01T00:00:00Z" },
  // Already welcomed here (文明气质 1b), so the welcome overlay stays out of tests about something else.
  welcomed_civilizations: ["CHINESE"],
};

export function application(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
    cycle: 1,
    desired_form: "HUMAN",
    statement: "",
    appeal_statement: "",
    status: "UNDER_REVIEW",
    cross_civilization: null,
    rejection_reason: "",
    decided_at: null,
    first_rejection_reason: "",
    first_decided_at: null,
    current_step: { node_type: "EVALUATION", approver_role: "JUDGE", is_appeal: false },
    can_appeal: false,
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
    ...overrides,
  };
}

export function life(cycle: number, overrides: Record<string, unknown> = {}) {
  return { cycle, records: [], judgments: [], dispositions: [], rebirth_applications: [], reincarnation: null, ...overrides };
}

/**
 * What the sign-in page remembers (the last account, 面容 / 指纹 on, the question asked) lives in the platform's
 * in-memory persistent cache, which `AsyncStorage.clear()` does not reach: a test that signed in leaves the next
 * one looking at 「换一个账号」 instead of the empty form. Also a fresh process (cold start) and an un-enrolled phone.
 */
export function resetLoginMemory() {
  for (const key of [ACCOUNT_KEY, BIO_KEY, APP_LOCK_KEY, `${ASKED_PREFIX}${PROFILE.soul_code}`]) persistentStore.remove(key);
  resetColdStart();
  const secure = SecureStore as unknown as { __guarded: Map<string, string>; __auth: { error: unknown; prompts: string[] } };
  secure.__guarded.clear();
  secure.__auth.error = null;
  secure.__auth.prompts.length = 0;
  Object.assign((LocalAuthentication as unknown as { __state: object }).__state, { hardware: true, enrolled: false, types: [2], recognised: true, gate: null, prompts: [] });
}
