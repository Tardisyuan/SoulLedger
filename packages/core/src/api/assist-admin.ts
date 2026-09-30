/**
 * 助手管理 (ADMIN only): `/api/v1/assist-admin/*`, officer token, the shared
 * `api` client. backend/apps/soul_assist/admin_views.py is the contract;
 * docs/ARCHITECTURE-assist-admin.md §7–§8 the decisions.
 *
 * The API key is write-only: the config response carries only `api_key.{set,
 * last4, set_at, source}`, and nothing here ever reads a key back.
 */
import { refusalBody, streamAssist, type AssistStreamAbort, type AssistStreamFetch, type AssistTryStreamEvent } from "./assist-stream";
import { api } from "./client";
import type { components } from "./generated/schema";

type Schemas = components["schemas"];
export type AssistAdminConfig = Schemas["Config"];
export type AssistAdminConfigUpdate = Schemas["PatchedConfigUpdate"];
export type AssistAdminCandidate = Schemas["Candidate"];
export type AssistAdminProvider = Schemas["ProviderEnum"];
export type AssistAdminPrice = Schemas["Price"];
export type AssistAdminConnectivity = Schemas["ConnectivityResult"];
export type AssistAdminPlatformId = Schemas["AssistPlatformEnum"];
export type AssistAdminPlatform = Schemas["Platform"];
export type AssistAdminModelList = Schemas["ModelList"];
export type AssistAdminPriceReference = Schemas["PriceReference"];
export type AssistAdminHall = Schemas["Hall"];
export type AssistAdminEvalIdentities = Schemas["EvalIdentities"];
export type AssistAdminEvalSide = Schemas["EvalPreviewRequestSideEnum"];
export type AssistAdminEvalPreview = Schemas["EvalPreview"];
export type AssistAdminEvalProblem = Schemas["ProblemsEnum"];
export type AssistAdminEvalRun = Schemas["EvalRun"];
export type AssistAdminEvalRunDetail = Schemas["EvalRunDetail"];
export type AssistAdminEvalResult = Schemas["EvalResult"];
export type AssistAdminUsage = Schemas["Usage"];
export type AssistAdminEvalCase = Schemas["EvalCase"];
export type AssistAdminTryRequest = Schemas["TryRequest"];
export type AssistAdminTryResult = Schemas["TryResult"];
export type AssistAdminCorpus = Schemas["Corpus"];
export type AssistAdminCorpusEntry = Schemas["CorpusEntry"];
export type AssistAdminEmbedding = Schemas["EmbeddingConfig"];
export type AssistAdminEmbeddingUpdate = Schemas["PatchedEmbeddingUpdate"];
export type AssistAdminEmbeddingCandidate = Schemas["EmbeddingCandidate"];
export type AssistAdminEmbeddingTest = Schemas["EmbeddingTestResult"];
export type AssistAdminEmbeddingRebuild = Schemas["EmbeddingRebuild"];
export type AssistAdminEmbeddingErrorKind = Schemas["EmbeddingErrorKindEnum"];
export type AssistAdminBackup = Schemas["BackupConfig"];
export type AssistAdminBackupUpdate = Schemas["PatchedBackupUpdate"];
export type AssistAdminApiKeyState = Schemas["ApiKeyState"];
export type AssistAdminFallbackReason = Schemas["FallbackReasonEnum"];

/** The `code`s the admin views answer 400/404 with (`_error` in admin_views.py). */
export const ASSIST_ADMIN_ERROR_CODES = [
  "untested_connection",
  "api_key_required",
  "unpriced_model",
  "invalid_confirm_token",
  "invalid_month",
  "not_found",
  // 试问 (POST try/): the eval identity for that side is missing or deactivated; too many tries this hour;
  // and the two `service.ask` failures it passes through (503 / 429).
  "no_eval_soul",
  "no_eval_officer",
  "rate_limited",
  "assistant_unavailable",
  "assistant_busy",
  // 向量模型 (§7.6): PATCH embedding/ with a changed url / model / dims not tested in the last 15 min (400);
  // POST embedding/rebuild/ while another runs (409), or the embedding service failed — nothing changed (503).
  "untested_embedding",
  "rebuild_running",
  "embedding_unavailable",
  // 备用供应商 (§13.5): PATCH config/backup/ (and the primary's PATCH) with a monthly cap and an unpriced backup model.
  "unpriced_backup_model",
  // Not a `code` in the body: DRF answers a PATCH carrying `eval_soul_account` /
  // `eval_officer` with a field error (ConfigUpdateSerializer.validate). Mapped below.
  "read_only_field",
] as const;
export type AssistAdminErrorCode = (typeof ASSIST_ADMIN_ERROR_CODES)[number];

/** Reads an axios refusal and a 试问 stream's (`AssistStreamHttpError`) alike. */
export function assistAdminErrorCode(error: unknown): AssistAdminErrorCode | null {
  const body = refusalBody(error);
  if (!body) return null;
  if ((ASSIST_ADMIN_ERROR_CODES as readonly unknown[]).includes(body.code)) return body.code as AssistAdminErrorCode;
  if ("eval_soul_account" in body || "eval_officer" in body) return "read_only_field";
  return null;
}

const BASE = "/assist-admin";

export const assistAdminApi = {
  config: () => api.get<AssistAdminConfig>(`${BASE}/config/`).then((r) => r.data),
  updateConfig: (body: AssistAdminConfigUpdate) => api.patch<AssistAdminConfig>(`${BASE}/config/`, body).then((r) => r.data),
  /** One real request with the candidate (unsaved) connection; the backend remembers it passed for 15 min. */
  testConnection: (body: AssistAdminCandidate) =>
    api.post<AssistAdminConnectivity>(`${BASE}/config/test/`, body).then((r) => r.data),
  /** 「获取模型」: the saved key, if used, stays on the server. `status: "no_list"` is not an error. */
  listModels: (body: AssistAdminCandidate) =>
    api.post<AssistAdminModelList>(`${BASE}/config/models/`, body).then((r) => r.data),
  /** LiteLLM reference price (USD per 1M tokens), cached server-side; `found: false` never blocks saving. */
  priceReference: (platform: AssistAdminPlatformId, model: string) =>
    api.get<AssistAdminPriceReference>(`${BASE}/config/price/`, { params: { platform, model } }).then((r) => r.data),
  halls: () => api.get<AssistAdminHall[]>(`${BASE}/halls/`).then((r) => r.data),
  updateHall: (id: number, assistant_enabled: boolean) =>
    api.patch<AssistAdminHall>(`${BASE}/halls/${id}/`, { assistant_enabled }).then((r) => r.data),
  /** Idempotent: creates only the missing eval soul / officer. */
  ensureEvalIdentities: () => api.post<AssistAdminEvalIdentities>(`${BASE}/eval/identities/`).then((r) => r.data),
  evalCases: () => api.get<AssistAdminEvalCase[]>(`${BASE}/eval/cases/`).then((r) => r.data),
  evalPreview: (side: AssistAdminEvalSide, candidates: AssistAdminCandidate[]) =>
    api.post<AssistAdminEvalPreview>(`${BASE}/eval/preview/`, { side, candidates }).then((r) => r.data),
  evalStart: (confirm_token: string) =>
    api.post<AssistAdminEvalRun>(`${BASE}/eval/runs/`, { confirm_token }).then((r) => r.data),
  evalRuns: () => api.get<AssistAdminEvalRun[]>(`${BASE}/eval/runs/`).then((r) => r.data),
  evalRun: (id: number) => api.get<AssistAdminEvalRunDetail>(`${BASE}/eval/runs/${id}/`).then((r) => r.data),
  /** 试问 (plan §3.3): one real, paid question as the eval identity; not counted in usage. Tool names only. */
  tryQuestion: (body: AssistAdminTryRequest) => api.post<AssistAdminTryResult>(`${BASE}/try/`, body).then((r) => r.data),
  /** 试问, answered as it is written (§13); `done` carries the try result plus `provider_role` / `fallback_reason`. */
  tryStream: (fetch: AssistStreamFetch, body: AssistAdminTryRequest, controller: AssistStreamAbort, onEvent: (event: AssistTryStreamEvent) => void) =>
    streamAssist<AssistTryStreamEvent>({ fetch, path: `${BASE}/try/`, body, controller, onEvent, refresh: () => api.get(`${BASE}/config/`) }),
  /** 备用供应商 (§13.5): same draft → test → save as the primary, with its own prices. DELETE keeps the platform keys. */
  backup: () => api.get<AssistAdminBackup>(`${BASE}/config/backup/`).then((r) => r.data),
  updateBackup: (body: AssistAdminBackupUpdate) => api.patch<AssistAdminBackup>(`${BASE}/config/backup/`, body).then((r) => r.data),
  deleteBackup: () => api.delete<AssistAdminBackup>(`${BASE}/config/backup/`).then((r) => r.data),
  testBackup: (body: AssistAdminCandidate) =>
    api.post<AssistAdminConnectivity>(`${BASE}/config/backup/test/`, body).then((r) => r.data),
  /** The help corpus, read-only (plan §5): entries with their token estimates, and the largest prompt vs the threshold. */
  corpus: () => api.get<AssistAdminCorpus>(`${BASE}/corpus/`).then((r) => r.data),
  /** 向量模型 settings + rebuild status. The URL comes back redacted, like `base_url`. */
  embedding: () => api.get<AssistAdminEmbedding>(`${BASE}/embedding/`).then((r) => r.data),
  updateEmbedding: (body: AssistAdminEmbeddingUpdate) =>
    api.patch<AssistAdminEmbedding>(`${BASE}/embedding/`, body).then((r) => r.data),
  /** One embed of a fixed question with the candidate; a pass is remembered for 15 min, like the provider test. */
  testEmbedding: (body: AssistAdminEmbeddingCandidate) =>
    api.post<AssistAdminEmbeddingTest>(`${BASE}/embedding/test/`, body).then((r) => r.data),
  /** Synchronous and all-or-nothing: on 503 no vector changed. */
  rebuildEmbedding: () => api.post<AssistAdminEmbeddingRebuild>(`${BASE}/embedding/rebuild/`).then((r) => r.data),
  usage: (month?: string) =>
    api.get<AssistAdminUsage>(`${BASE}/usage/`, { params: month ? { month } : undefined }).then((r) => r.data),
};
