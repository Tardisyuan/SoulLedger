/**
 * The demo's stand-in for the server: axios and `fetch` calls end here (`install.ts`). GETs read the recording under
 * the session's overlay (`store.ts`); everything else goes to `writes.ts`.
 */
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { api } from "@soulledger/core/api/client";
import { type Answer, type DemoLang, type DemoRole, DEMO_USERNAMES, allRows, clearVisitorState, currentRole, langOf, read, recording, resetOverlay, setRole } from "./store";
import { derived } from "./flows";
import { write } from "./writes";
import type { AssistTrace } from "@soulledger/core/api/officer-assist";

const API_PREFIX = /^.*\/api\/v1/;

function parseBody(data: unknown): Record<string, unknown> {
  if (data instanceof FormData) return Object.fromEntries(data.entries());
  if (typeof data === "string") {
    try {
      return JSON.parse(data) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return (data as Record<string, unknown>) ?? {};
}

/** Back to the seed: a sign-in or sign-out leaves nothing of the last visit, in this tab's overlay or in drafts on disk. */
function freshSession(): void {
  resetOverlay();
  clearVisitorState();
}

async function auth(path: string, body: Record<string, unknown>, lang: DemoLang): Promise<Answer | null> {
  if (path === "/auth/login/" || path === "/auth/officer-login/") {
    const role = (Object.keys(DEMO_USERNAMES) as DemoRole[]).find((r) => DEMO_USERNAMES[r] === body.username) ?? "judge";
    freshSession();
    setRole(role);
    const rec = await recording(role, lang);
    return { status: 200, data: { ...rec.login, access: "demo-access", refresh: "demo-refresh" } };
  }
  if (path === "/auth/logout/") {
    freshSession();
    return { status: 200, data: { detail: "ok" } };
  }
  if (path === "/auth/refresh/") return { status: 200, data: { access: "demo-access", refresh: "demo-refresh" } };
  return null;
}

async function answer(method: string, path: string, query: URLSearchParams, body: Record<string, unknown>, lang: DemoLang): Promise<Answer> {
  const signed = method === "POST" ? await auth(path, body, lang) : null;
  if (signed) return signed;
  const evalRun = method === "GET" && path.startsWith("/assist-admin/eval/") ? await recordedEval(path) : null;
  if (evalRun) return evalRun;
  const rec = await recording(currentRole(), lang);
  return method === "GET" ? (derived(rec, path, query) ?? read(rec, path, query)) : write(rec, method, path, query, body);
}

function csv(rows: Record<string, unknown>[]): string {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].filter((c) => rows.every((row) => typeof row[c] !== "object" || row[c] === null));
  const cell = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  return [columns.join(","), ...rows.map((row) => columns.map((c) => cell(row[c])).join(","))].join("\n");
}

/** Every export is the list next to it, as CSV. The server's own column choices are not reproduced. */
async function download(path: string, lang: DemoLang): Promise<Blob> {
  const rec = await recording(currentRole(), lang);
  const list = path.replace(/[^/]+\/$/, "");
  return new Blob([`﻿${csv(allRows(rec, list))}`], { type: "text/csv;charset=utf-8" });
}

export async function axiosAnswer(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  const url = new URL(api.getUri(config), "http://demo.invalid");
  const path = url.pathname.replace(API_PREFIX, "");
  const method = (config.method ?? "get").toUpperCase();
  const lang = langOf(config.headers?.["Accept-Language"]);
  const result: Answer =
    config.responseType === "blob"
      ? { status: 200, data: await download(path, lang) }
      : await answer(method, path, url.searchParams, parseBody(config.data), lang);
  const response: AxiosResponse = { data: result.data, status: result.status, statusText: String(result.status), headers: {}, config };
  if (result.status >= 400) {
    throw new AxiosError(`Request failed with status code ${result.status}`, AxiosError.ERR_BAD_REQUEST, config, null, response);
  }
  return response;
}

function sse(events: object[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const NOT_RECORDED = {
  "zh-Hans": "这是演示环境,「问一问」没有连接模型,只回放录好的回答,这个问题没有录。正式环境里,它会依据律条与本案卷宗作答,并给出出处。",
  en: "This is the demo, so Ask is not connected to a model: it replays recorded answers, and this question has none. In production it answers from the statutes and the case file, with citations.",
};
const RECORDED = {
  "zh-Hans": "(录制的回答:在测试环境问过一次,这里回放,不是现场生成)",
  en: "(A recorded answer: asked once in the test environment and replayed here, not generated now)",
};

type AssistLang = "zh-Hans" | "en";
/** One recorded ask: a suggested question (`assist-replies.json`) or an injection case (`assist-security.json`). */
interface RecordedAsk {
  question: Record<AssistLang, string>;
  answer?: Record<AssistLang, string>;
  trace?: Record<AssistLang, AssistTrace>;
}

/**
 * A suggested question, or one of the injection cases, gets its recorded answer, labelled as one, with the trace
 * recorded beside it (「这次怎么答的」, B1). Both files are written by scripts/demo-record-assist.py.
 */
async function assistAnswer(question: unknown, locale: string): Promise<{ text: string; trace?: AssistTrace }> {
  const lang: AssistLang = locale === "zh-Hans" ? "zh-Hans" : "en";
  const replies = (await import("./data/assist-replies.json")).default.replies as RecordedAsk[];
  const cases = (await import("./data/assist-security.json")).default.cases as RecordedAsk[];
  const hit = [...replies, ...cases].find((r) => r.question["zh-Hans"] === question || r.question.en === question);
  const answer = hit?.answer?.[lang];
  return answer ? { text: `${RECORDED[lang]}\n\n${answer}`, trace: hit?.trace?.[lang] } : { text: NOT_RECORDED[lang] };
}

const EVAL_RUN = /^\/assist-admin\/eval\/runs\/(\d+)\/$/;
type RecordedRun = { id: number; results?: unknown };

/**
 * The eval tab (B2): a recorded run of two candidate models (`assist-eval-run.json`, scripts/demo-record-assist.py),
 * with the case list it was judged against. Until one is recorded the admin's own recording answers (no runs).
 */
async function recordedEval(path: string): Promise<Answer | null> {
  const { cases, runs } = (await import("./data/assist-eval-run.json")).default as { cases: unknown[]; runs: RecordedRun[] };
  if (!runs.length) return null;
  if (path === "/assist-admin/eval/cases/") return { status: 200, data: cases };
  if (path === "/assist-admin/eval/runs/") return { status: 200, data: runs.map(({ results: _results, ...run }) => run) };
  const id = EVAL_RUN.exec(path)?.[1];
  if (!id) return null;
  const run = runs.find((r) => r.id === Number(id));
  return run ? { status: 200, data: run } : { status: 404, data: { detail: "Not found." } };
}

export async function fetchAnswer(rawUrl: string, init?: RequestInit): Promise<Response> {
  const url = new URL(rawUrl, "http://demo.invalid");
  const path = url.pathname.replace(API_PREFIX, "");
  const method = (init?.method ?? "GET").toUpperCase();
  const locale = new Headers(init?.headers).get("Accept-Language") ?? "zh-Hans";
  if (method === "POST" && /assist/.test(path)) {
    const { text, trace } = await assistAnswer(parseBody(init?.body).question, locale);
    const now = new Date().toISOString();
    return sse([
      { event: "meta", conversation_id: "dec0de00-0000-4000-8000-a55157000000" },
      { event: "delta", text },
      {
        event: "done",
        conversation_id: "dec0de00-0000-4000-8000-a55157000000",
        answer: { id: Date.now(), role: "assistant", content: text, interruption: "", created_at: now, ...(trace ? { trace } : {}) },
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    ]);
  }
  const result = await answer(method, path, url.searchParams, parseBody(init?.body), langOf(locale));
  return new Response(JSON.stringify(result.data), { status: result.status, headers: { "Content-Type": "application/json" } });
}
