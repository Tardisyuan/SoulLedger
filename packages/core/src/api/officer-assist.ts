/**
 * 「问一问」 on the officer console: `/api/v1/assist/*`, officer token, the
 * shared `api` client. backend/apps/soul_assist/views.py (the `Officer*`
 * views) is the contract; docs/ARCHITECTURE-officer-assist.md is the design.
 *
 * Same shape as the soul side (./soul-assist). `stream` is how the panel asks
 * (§13, ./assist-stream): stopping closes the connection and the server stores
 * the partial answer. `ask` is the one-shot JSON form (server gives up at 22 s).
 */
import type { GenericAbortSignal } from "axios";
import {
  refusalBody,
  streamAssist,
  type AssistStreamAbort,
  type AssistStreamEvent,
  type AssistStreamFetch,
} from "./assist-stream";
import { api } from "./client";
import type { components } from "./generated/schema";

type Schemas = components["schemas"];
export type OfficerAssistScreen = Schemas["OfficerScreenEnum"];
export type OfficerAssistAsk = Schemas["OfficerAssistAsk"];
export type OfficerAssistConversation = Schemas["OfficerAssistConversation"];
export type OfficerAssistAnswer = Schemas["AssistAnswer"];
export type OfficerAssistMessage = Schemas["AssistMessage"];

/** Canvas 1d: past this the console stops waiting and offers a retry with the question kept. */
export const ASSIST_TIMEOUT_MS = 25_000;

/**
 * `OFFICER_SCREENS` in backend/apps/soul_assist/models.py. A `Record` so `tsc`
 * refuses a missing member of the generated enum; the frontend drift test
 * holds the list equal to the backend tuple.
 */
const SCREEN_SET: Record<OfficerAssistScreen, true> = {
  about: true, actors: true, admin: true, audit: true, corpus: true, "cross-judgments": true, dashboard: true,
  "death-sync": true, dispatch: true, disposition: true, judgment: true, ledger: true, menus: true,
  moderation: true, notifications: true, organizations: true, permissions: true, profile: true,
  realms: true, "rebirth-applications": true, "recycle-bin": true, scheduler: true,
  "sentence-requests": true, social: true, "soul-credentials": true, "soul-inbox": true, souls: true,
  tenants: true, users: true, welcome: true, workflow: true, other: true,
};
export const OFFICER_SCREENS = Object.keys(SCREEN_SET) as OfficerAssistScreen[];

/** The route's top-level segment (`/workflow/12` → `workflow`), or `other`. */
export function officerAssistScreen(pathname: string): OfficerAssistScreen {
  const segment = pathname.split("/")[1] ?? "";
  return segment in SCREEN_SET ? (segment as OfficerAssistScreen) : "other";
}

/**
 * The `code`s `/assist/` answers with: `AssistError` in apps/soul_assist/service.py and
 * the throttle, the same `_AssistErrors` as the soul side. Not imported from
 * ./soul-assist on purpose: that module pulls in the soul client (./soul), which
 * the officer console never loads.
 */
export const OFFICER_ASSIST_ERROR_CODES = [
  "assistant_not_configured",
  "assistant_unavailable",
  "rate_limited",
  "assistant_busy",
  "not_found",
] as const;
export type OfficerAssistErrorCode = (typeof OFFICER_ASSIST_ERROR_CODES)[number];

export function officerAssistErrorCode(error: unknown): OfficerAssistErrorCode | null {
  const code = refusalBody(error)?.code;
  return (OFFICER_ASSIST_ERROR_CODES as readonly unknown[]).includes(code) ? (code as OfficerAssistErrorCode) : null;
}

/** `retry_at` of a 429 `rate_limited`, or `null`. */
export function officerAssistRetryAt(error: unknown): string | null {
  const at = refusalBody(error)?.retry_at;
  return typeof at === "string" ? at : null;
}

/**
 * `OFFICER_EMPTY_ANSWER` in apps/soul_assist/service.py: the server's fixed
 * reply when the model returns nothing — the only answer the console can tell
 * is a "cannot answer" (canvas 1f ④). Pinned word for word by a frontend test.
 */
export const OFFICER_EMPTY_ANSWER: Record<"zh-Hans" | "en", string> = {
  "zh-Hans": "这个问题我答不了。这类问题请询问本殿殿主或管理员。",
  en: "I can't answer that. Please ask your hall's realm lead or the administrator.",
};

export function isOfficerEmptyAnswer(content: string): boolean {
  return Object.values(OFFICER_EMPTY_ANSWER).includes(content.trim());
}

export const officerAssistApi = {
  ask: (body: OfficerAssistAsk, signal?: GenericAbortSignal) =>
    api.post<OfficerAssistAnswer>("/assist/", body, { timeout: ASSIST_TIMEOUT_MS, signal }).then((r) => r.data),
  /** Answered as it is written (§13); stop = `controller.abort()`, the server stores the partial answer. */
  stream: (fetch: AssistStreamFetch, body: OfficerAssistAsk, controller: AssistStreamAbort, onEvent: (event: AssistStreamEvent) => void) =>
    streamAssist({
      fetch,
      path: "/assist/",
      body,
      controller,
      onEvent,
      refresh: () => api.get("/assist/conversations/"),
    }),
  /** Newest first, each with its messages in order. */
  conversations: () => api.get<OfficerAssistConversation[]>("/assist/conversations/").then((r) => r.data),
  /** 204; someone else's (or a gone one) is 404 `not_found`. */
  deleteConversation: (id: string) => api.delete(`/assist/conversations/${id}/`).then(() => undefined),
};
