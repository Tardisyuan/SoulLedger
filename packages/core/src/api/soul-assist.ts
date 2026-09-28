/**
 * 「问一问」, the soul-side help assistant: `/me/assist/*`. Rides `soulHttp`
 * (./soul) like the chat and circle clients. backend/apps/soul_assist/views.py
 * is the contract; docs/ARCHITECTURE-soul-assist.md is the design.
 *
 * Non-streaming: one POST, one answer. The server gives up at 22 s and answers
 * 503 `assistant_unavailable`; this client gives up at 25 s (canvas 1e), so a
 * timeout here normally means the network, not the model.
 */
import axios, { type GenericAbortSignal } from "axios";
import type { Locale } from "../config/locale";
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

export function soulAssistErrorCode(error: unknown): SoulAssistErrorCode | null {
  if (!axios.isAxiosError(error)) return null;
  const code = (error.response?.data as { code?: unknown } | undefined)?.code;
  return (SOUL_ASSIST_ERROR_CODES as readonly unknown[]).includes(code) ? (code as SoulAssistErrorCode) : null;
}

/** `retry_at` of a 429 `rate_limited`, or `null`. */
export function soulAssistRetryAt(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null;
  const at = (error.response?.data as { retry_at?: unknown } | undefined)?.retry_at;
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
  "zh-Hans": "这个问题我答不了。需要人来处理的事,请写信给殿司。",
  en: "I can't answer that. For anything that needs a person, write to the hall office.",
};

export function isEmptyAnswer(content: string): boolean {
  return Object.values(ASSIST_EMPTY_ANSWER).includes(content.trim());
}

export const soulAssistApi = {
  /** `signal` lets the App stop waiting; the server still finishes and stores the answer. */
  ask: (body: AssistAsk, signal?: GenericAbortSignal) =>
    soulHttp.post<AssistAnswer>("/me/assist/", body, { timeout: ASSIST_TIMEOUT_MS, signal }).then((r) => r.data),
  /** Newest first, each with its messages in order. */
  conversations: () => soulHttp.get<AssistConversation[]>("/me/assist/conversations/").then((r) => r.data),
  /** 204; someone else's (or a gone one) is 404 `not_found`. */
  deleteConversation: (id: string) =>
    soulHttp.delete(`/me/assist/conversations/${id}/`).then(() => undefined),
};
