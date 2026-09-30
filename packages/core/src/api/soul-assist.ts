/**
 * 「问一问」, the soul-side help assistant: `/me/assist/*`. Rides `soulHttp`
 * (./soul) like the chat and circle clients. backend/apps/soul_assist/views.py
 * is the contract; docs/ARCHITECTURE-soul-assist.md is the design.
 *
 * `stream` is how the App asks (§13, ./assist-stream): stopping closes the
 * connection and the server stores the partial answer. `ask` is the one-shot
 * JSON form: the server gives up at 22 s and answers 503 `assistant_unavailable`.
 */
import type { GenericAbortSignal } from "axios";
import type { Locale } from "../config/locale";
import {
  refusalBody,
  streamAssist,
  type AssistStreamAbort,
  type AssistStreamEvent,
  type AssistStreamFetch,
} from "./assist-stream";
import { soulHttp } from "./soul";
import type { components } from "./generated/schema";

type Schemas = components["schemas"];
export type AssistScreen = Schemas["ScreenEnum"];
export type AssistMessage = Schemas["AssistMessage"];
export type AssistConversation = Schemas["AssistConversation"];
export type AssistAnswer = Schemas["AssistAnswer"];
export type AssistAsk = Schemas["AssistAsk"];

/** Canvas 1e: past this the App stops waiting and offers a retry with the question kept. */
export const ASSIST_TIMEOUT_MS = 25_000;

/** The `code`s `/me/assist/` answers with (`AssistError` in apps/soul_assist/service.py and the throttle). */
export const SOUL_ASSIST_ERROR_CODES = [
  "assistant_not_configured",
  "assistant_unavailable",
  "rate_limited",
  "assistant_busy",
  "not_found",
] as const;
export type SoulAssistErrorCode = (typeof SOUL_ASSIST_ERROR_CODES)[number];

/** Reads an axios refusal and a stream request's (`AssistStreamHttpError`) alike. */
export function soulAssistErrorCode(error: unknown): SoulAssistErrorCode | null {
  const code = refusalBody(error)?.code;
  return (SOUL_ASSIST_ERROR_CODES as readonly unknown[]).includes(code) ? (code as SoulAssistErrorCode) : null;
}

/** `retry_at` of a 429 `rate_limited`, or `null`. */
export function soulAssistRetryAt(error: unknown): string | null {
  const at = refusalBody(error)?.retry_at;
  return typeof at === "string" ? at : null;
}

/** The language the server answers in for a UI locale (`corpus.corpus_locale`): `egy` gets English. */
export function assistAnswerLocale(locale: Locale): "zh-Hans" | "en" {
  return locale === "zh-Hans" ? "zh-Hans" : "en";
}

/**
 * The server's fixed reply when the model returns nothing (`EMPTY_ANSWER` in
 * apps/soul_assist/service.py) — the only answer the App can tell is a
 * "cannot answer". mobile's assist drift test pins these to the backend's text.
 */
export const ASSIST_EMPTY_ANSWER: Record<"zh-Hans" | "en", string> = {
  "zh-Hans": "这个问题我答不了。需要人来处理的事，请写信给殿司。",
  en: "I can't answer that. For anything that needs a person, write to the hall office.",
};

export function isEmptyAnswer(content: string): boolean {
  return Object.values(ASSIST_EMPTY_ANSWER).includes(content.trim());
}

export const soulAssistApi = {
  /** `signal` lets the App stop waiting; the server still finishes and stores the answer. */
  ask: (body: AssistAsk, signal?: GenericAbortSignal) =>
    soulHttp.post<AssistAnswer>("/me/assist/", body, { timeout: ASSIST_TIMEOUT_MS, signal }).then((r) => r.data),
  /**
   * The same question, answered as it is written (§13). `fetch` must read the body as it arrives —
   * the App passes `expo/fetch`. Stop = `controller.abort()`: the server stores the partial answer.
   */
  stream: (fetch: AssistStreamFetch, body: AssistAsk, controller: AssistStreamAbort, onEvent: (event: AssistStreamEvent) => void) =>
    streamAssist({
      fetch,
      path: "/me/assist/",
      body,
      controller,
      onEvent,
      refresh: () => soulHttp.get("/me/assist/conversations/"),
    }),
  /** Newest first, each with its messages in order. */
  conversations: () => soulHttp.get<AssistConversation[]>("/me/assist/conversations/").then((r) => r.data),
  /** 204; someone else's (or a gone one) is 404 `not_found`. */
  deleteConversation: (id: string) =>
    soulHttp.delete(`/me/assist/conversations/${id}/`).then(() => undefined),
};
