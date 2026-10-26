import { api } from "./client";
import { ACCESS_TOKEN_KEY, getAccessToken, platform, setAccessToken } from "../platform/index";
import {
  IMPERSONATION_KEY,
  getImpersonation,
  notifyImpersonation,
  type ImpersonationState,
} from "./impersonationState";

export * from "./impersonationState";

interface StartResponse {
  access: string;
  impersonation_id: number;
  started_at: string;
  expires_at: string;
  reason: string;
  target: { id: number; name: string; role: string; tenant_code: string | null; hall: Record<string, string> | null };
}

/** 开始代看。失败(400/403/404)原样抛给调用方,什么也没改。 */
export async function startImpersonation(userId: number, reason: string): Promise<ImpersonationState> {
  const { data } = await api.post<StartResponse>("/auth/impersonate/", { user_id: userId, reason });
  // 服务器时钟与本机的差,折进到点时刻:本机钟快了几分钟,倒计时也不会提前到零。
  const skew = Date.parse(data.started_at) - Date.now();
  const state: ImpersonationState = {
    id: data.impersonation_id,
    target: { id: data.target.id, name: data.target.name, role: data.target.role, hall: data.target.hall },
    reason: data.reason,
    expiresAt: Date.parse(data.expires_at) - skew,
    adminAccess: getAccessToken(),
  };
  platform().session.set(IMPERSONATION_KEY, JSON.stringify(state));
  setAccessToken(data.access);
  notifyImpersonation();
  return state;
}

interface HallViewResponse {
  access: string;
  impersonation_id: number;
  started_at: string;
  expires_at: string;
  code: string;
  hall_names: Record<string, string>;
}

/**
 * 全局管理员只读进入某殿(`POST /tenants/{code}/view/`,第五十四批 O-2)。与代看同一份状态、同一个横幅位置、
 * 同一条退出路径(`endImpersonation`);失败原样抛,什么也没改。
 */
export async function startHallView(code: string): Promise<ImpersonationState> {
  const { data } = await api.post<HallViewResponse>(`/tenants/${encodeURIComponent(code)}/view/`);
  const skew = Date.parse(data.started_at) - Date.now();
  const state: ImpersonationState = {
    id: data.impersonation_id,
    target: { id: 0, name: "", role: "ADMIN", hall: data.hall_names },
    reason: "",
    expiresAt: Date.parse(data.expires_at) - skew,
    adminAccess: getAccessToken(),
    hallView: { code: data.code },
  };
  platform().session.set(IMPERSONATION_KEY, JSON.stringify(state));
  setAccessToken(data.access);
  notifyImpersonation();
  return state;
}

/**
 * 结束代看并把管理员的会话放回去。服务端那一步失败(已到点 / 已结束 / 离线)不拦着放回:
 * 服务端以记录为准,令牌随记录作废;到点没人来结束的,下一次代看或结束时补写结束行。
 */
export async function endImpersonation(): Promise<void> {
  const state = getImpersonation();
  if (!state) return;
  try {
    await api.post("/auth/impersonate/end/");
  } catch {
    // 见上:放回照做。
  }
  if (state.adminAccess) {
    setAccessToken(state.adminAccess);
  } else {
    platform().session.remove(ACCESS_TOKEN_KEY);
  }
  platform().session.remove(IMPERSONATION_KEY);
  notifyImpersonation();
}
