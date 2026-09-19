/**
 * A scripted transport for core's REAL soul client (`soulHttp`): its
 * interceptors — refresh, 401 → onUnauthorized, 403 → password change — run
 * exactly as on a device; only the network is replaced.
 */
import { soulHttp } from "@soulledger/core/api/soul";
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";

export type Reply = { status: number; data?: unknown } | "offline";

export function stubApi(routes: Record<string, Reply | Reply[]>) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  soulHttp.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const url = config.url ?? "";
    const method = (config.method ?? "get").toUpperCase();
    calls.push({ method, url, body: config.data ? JSON.parse(config.data as string) : undefined });
    const route = routes[`${method} ${url}`] ?? routes[url];
    const reply = Array.isArray(route) ? (route.length > 1 ? route.shift() : route[0]) : route;
    if (!reply) throw new Error(`unscripted request: ${method} ${url}`);
    if (reply === "offline") throw new AxiosError("Network Error", "ERR_NETWORK", config);
    const response = { status: reply.status, data: reply.data, headers: {}, config, statusText: "" } as AxiosResponse;
    if (reply.status >= 400) throw new AxiosError("fail", "ERR_BAD_RESPONSE", config, null, response);
    return response;
  };
  return calls;
}

export const PROFILE = {
  soul_code: "SL-CN-000042",
  name: "张三",
  birth_name: "张三",
  civilization: "CHINESE",
  tenant: { code: "CN_DIYU", display_name: "中国地府", hall_names: { "zh-Hans": "第五殿", en: "The Fifth Court", egy: "Yanluo Qedi" } },
  home_tenant: { code: "CN_DIYU", display_name: "中国地府", hall_names: { "zh-Hans": "第五殿", en: "The Fifth Court", egy: "Yanluo Qedi" } },
  home_civilization: "CHINESE",
  is_residing: false,
  current_state: "JUDGING",
  birth_date: { year: 1901, month: 3, day: null },
  death_date: { year: 1980, month: null, day: null },
  origin_location: "成都",
  merit_score: 12,
  demerit_score: 3,
  account: { cycle: 1, must_change_password: false, initial_password_expires_at: null, created_at: "2026-09-01T00:00:00Z" },
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
