/**
 * 助手管理 (ADMIN only): `/api/v1/assist-admin/*`, officer token, the shared
 * `api` client. backend/apps/soul_assist/admin_views.py is the contract;
 * docs/ARCHITECTURE-assist-admin.md §7–§8 the decisions.
 *
 * The API key is write-only: the config response carries only `api_key.{set,
 * last4, set_at, source}`, and nothing here ever reads a key back.
 */
import axios from "axios";
import { api } from "./client";
import type { components } from "./generated/schema";

type Schemas = components["schemas"];
export type AssistAdminConfig = Schemas["Config"];
export type AssistAdminConfigUpdate = Schemas["PatchedConfigUpdate"];
export type AssistAdminCandidate = Schemas["Candidate"];
export type AssistAdminProvider = Schemas["ProviderEnum"];
export type AssistAdminPrice = Schemas["Price"];
export type AssistAdminConnectivity = Schemas["ConnectivityResult"];
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

/** The `code`s the admin views answer 400/404 with (`_error` in admin_views.py). */
export const ASSIST_ADMIN_ERROR_CODES = [
  "untested_connection",
  "api_key_required",
  "unpriced_model",
  "invalid_confirm_token",
  "invalid_month",
  "not_found",
  // Not a `code` in the body: DRF answers a PATCH carrying `eval_soul_account` /
  // `eval_officer` with a field error (ConfigUpdateSerializer.validate). Mapped below.
  "read_only_field",
] as const;
export type AssistAdminErrorCode = (typeof ASSIST_ADMIN_ERROR_CODES)[number];

export function assistAdminErrorCode(error: unknown): AssistAdminErrorCode | null {
  if (!axios.isAxiosError(error)) return null;
  const body = error.response?.data as Record<string, unknown> | undefined;
  if (!body || typeof body !== "object") return null;
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
  usage: (month?: string) =>
    api.get<AssistAdminUsage>(`${BASE}/usage/`, { params: month ? { month } : undefined }).then((r) => r.data),
};
