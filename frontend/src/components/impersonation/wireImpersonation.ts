import { api } from "@soulledger/core/api/client";
import { endImpersonation, getImpersonation, startHallView } from "@soulledger/core/api/impersonation";

let wired = false;

/**
 * 代看收场的唯一路径:结束(服务端写结束行、放回管理员的 access)并回到用户管理 —— 进殿查看则回到各殿概况。
 * 整页跳转,清掉被看者(那一殿)的缓存。
 */
export async function leaveImpersonation(): Promise<void> {
  const back = getImpersonation()?.hallView ? "/halls" : "/users";
  await endImpersonation();
  if (typeof window !== "undefined") window.location.assign(back);
}

/** 全局管理员只读进入某殿(第五十四批 O-2)并整页跳到 `path`:清掉管理员自己的缓存,页顶出现横幅。失败原样抛。 */
export async function enterHall(code: string, path: string): Promise<void> {
  await startHallView(code);
  if (typeof window !== "undefined") window.location.assign(path);
}

/**
 * 代看期间给每个请求带上当前页面(`X-Imp-Page`,服务端据此数「看过 N 个页面」),
 * 并在服务端说「代看已结束 / 已到时 / 已失效」(403 + `impersonation_*`,只读拒绝除外)时收场。
 * 注册一次;`ImpersonationBanner` 的模块作用域调用它,所以任何请求发出之前就已就位。
 */
export function wireImpersonation(): void {
  if (wired || typeof window === "undefined") return;
  wired = true;
  api.interceptors.request.use((config) => {
    if (getImpersonation()) config.headers["X-Imp-Page"] = window.location.pathname;
    return config;
  });
  api.interceptors.response.use(
    (response) => response,
    async (error) => {
      const code: unknown = error?.response?.data?.code;
      const over =
        error?.response?.status === 403 &&
        typeof code === "string" &&
        code.startsWith("impersonation_") &&
        code !== "impersonation_read_only";
      // 结束请求自己的 403 不再触发收场(它就是收场的一部分)。
      if (over && getImpersonation() && !String(error.config?.url ?? "").includes("/auth/impersonate/end/")) {
        await leaveImpersonation();
      }
      return Promise.reject(error);
    }
  );
}
