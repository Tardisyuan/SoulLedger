import axios, { AxiosResponse } from "axios";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(";").shift() || null;
  return null;
}

function getTenantId(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("tenant_id") || getCookie("tenant_id") || "";
}

export const api = axios.create({
  baseURL: API_BASE,
  headers: { "Content-Type": "application/json" },
});

// Add JWT token and tenant ID to every request
api.interceptors.request.use((config) => {
  const token = getCookie("soulledger_access") || (typeof sessionStorage !== "undefined" ? sessionStorage.getItem("soulledger_access") : null);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const tenantId = getTenantId();
  if (tenantId) {
    config.headers["X-Tenant-ID"] = tenantId;
  }
  return config;
});

// Handle 401 → redirect to login (skip for auth endpoints which handle their own errors)
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401 && !error.config._retry) {
      const isAuthEndpoint = /^\/api\/v1\/auth\/(login|register|refresh)\/?$/.test(error.config.url || '');
      if (isAuthEndpoint) {
        // Login/register already handles 401 itself — just reject
        return Promise.reject(error);
      }

      error.config._retry = true;
      const refresh = getCookie("soulledger_refresh");
      if (refresh) {
        try {
          const res = await axios.post(`${API_BASE}/auth/refresh/`, { refresh });
          const { access, refresh: newRefresh } = res.data;
          // NOTE: HttpOnly cannot be set from JS; tokens stored in sessionStorage for XSS mitigation
          // TODO: Implement server-set httpOnly cookies via BFF pattern for production
          sessionStorage.setItem("soulledger_access", access);
          document.cookie = `soulledger_refresh=${newRefresh}; path=/; max-age=604800; SameSite=Lax`;
          error.config.headers.Authorization = `Bearer ${access}`;
          return api(error.config);
        } catch {
          document.cookie = "soulledger_access=; Max-Age=0; path=/";
          document.cookie = "soulledger_refresh=; Max-Age=0; path=/";
          sessionStorage.removeItem("soulledger_access");
          if (typeof window !== "undefined") {
            window.location.href = "/login";
          }
        }
      } else {
        sessionStorage.removeItem("soulledger_access");
        if (typeof window !== "undefined") {
          window.location.href = "/login";
        }
      }
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authApi = {
  login: (username: string, password: string) =>
    api.post("/auth/login/", { username, password }),
  register: (data: object) => api.post("/auth/register/", data),
  logout: () => {
    const refresh = getCookie("soulledger_refresh");
    sessionStorage.removeItem("soulledger_access");
    return api.post("/auth/logout/", { refresh });
  },
  profile: () => api.get("/auth/profile/"),
  updateProfile: (data: object) => api.patch("/auth/profile/", data),
  changePassword: (oldPassword: string, newPassword: string) =>
    api.post("/auth/change-password/", { old_password: oldPassword, new_password: newPassword }),
  refresh: (refresh: string) =>
    axios.post(`${API_BASE}/auth/refresh/`, { refresh }),
};

// Souls
export interface SoulInput {
  name: string;
  civilization: "CHINESE" | "EUROPEAN" | "EGYPTIAN";
  birth_date: string | null;
  origin_location: string;
  current_state?: "ALIVE" | "JUDGING" | "DISPOSED" | "REINCARNATING" | "LOST";
}

export const soulsApi = {
  list: (params?: {
    page?: number;
    search?: string;
    civilization?: string;
    state?: string;
    karma_min?: number;
    karma_max?: number;
    ordering?: string;
  }) => api.get("/souls/", { params }),
  get: (id: string) => api.get(`/souls/${id}/`),
  create: (data: object) => api.post("/souls/", data),
  update: (id: string, data: Partial<SoulInput>) => api.patch(`/souls/${id}/`, data),
  delete: (id: string) => api.delete(`/souls/${id}/`),
  die: (id: string, data?: object) => api.post(`/souls/${id}/die/`, data),
  transition: (id: string, data: object) => api.post(`/souls/${id}/transition/`, data),
  karma: (id: string) => api.get(`/souls/${id}/karma/`),
  addRecord: (id: string, data: object) => api.post(`/souls/${id}/add_record/`, data),
  records: (id: string) => api.get(`/souls/${id}/records/`),
};

// Helper: fetch all pages of a paginated response
async function fetchAllPages<T>(url: string, params: Record<string, string> = {}): Promise<T[]> {
  const results: T[] = [];
  let nextUrl: string | null = `${API_BASE}${url}?${new URLSearchParams(params)}`;

  while (nextUrl) {
    const urlObj = new URL(nextUrl);
    const relativePath = nextUrl.replace(API_BASE, "");
    const resp: AxiosResponse<PaginatedResponse<T>> = await api.get(relativePath, {
      params: Object.fromEntries(urlObj.searchParams),
    });
    results.push(...resp.data.results);
    nextUrl = resp.data.next
      ? resp.data.next.startsWith("http")
        ? resp.data.next
        : `${API_BASE}${resp.data.next}`
      : null;
  }

  return results;
}

// Realms
export const realmsApi = {
  list: async (params?: Record<string, string>) => {
    const data = await fetchAllPages<any>("/realms/", params);
    return { data: { results: data, count: data.length } };
  },
  get: (code: string) => api.get(`/realms/${code}/`),
};

// Actors
export const actorsApi = {
  list: async (params?: Record<string, string>) => {
    const data = await fetchAllPages<any>("/actors/", params);
    return { data: { results: data, count: data.length } };
  },
  get: (id: string) => api.get(`/actors/${id}/`),
};

// Judgment
export const judgmentApi = {
  list: (params?: Record<string, string>) => api.get("/judgment/", { params }),
  create: (data: object) => api.post("/judgment/", data),
  conclude: (id: string, data: object) => api.post(`/judgment/${id}/conclude/`, data),
  get: (id: string) => api.get(`/judgment/${id}/`),
};

// Disposition
export const dispositionApi = {
  list: (params?: Record<string, string>) => api.get("/disposition/", { params }),
  execute: (id: string, data?: object) => api.post(`/disposition/${id}/execute/`, data),
};

// Reincarnation
export const reincarnationApi = {
  list: (params?: Record<string, string>) => api.get("/reincarnation/", { params }),
  reborn: (data: object) => api.post("/reincarnation/reborn/", data),
};

// Workflow
export interface ApprovalWorkflow {
  id: string;
  workflow_name: string;
  soul: string;
  soul_name?: string;
  case_type: string;
  priority: number;
  status: string;
  is_appeal: boolean;
  cross_civilization: boolean;
  current_node: string | null;
  current_node_detail: ApprovalNode | null;
  nodes: ApprovalNode[];
  judgment_verdict?: string;
  created_at: string;
  completed_at: string | null;
  tenant: string;
}

export interface ApprovalNode {
  id: string;
  workflow: string;
  node_name: string;
  node_order: number;
  node_type: string;
  approver_type: string;
  approver_actor: string | null;
  approver_role: string;
  court_code: string;
  realm: string | null;
  required_verdicts: string[];
  status: string;
  verdict: string;
  evidence_json: Record<string, unknown>;
  notes: string;
  approver: string | null;
  decided_at: string | null;
  created_at: string;
}

export const workflowApi = {
  list: (params?: Record<string, string>) => api.get("/workflows/", { params }),
  get: (id: string) => api.get(`/workflows/${id}/`),
  create: (data: object) => api.post("/workflows/", data),
  advance: (id: string) => api.post(`/workflows/${id}/advance/`),
  approveNode: (id: string, nodeId: string, data: { verdict: string; notes?: string }) =>
    api.post(`/workflows/${id}/approve_node/`, { ...data, node_id: nodeId }),
  nodes: {
    list: (params?: Record<string, string>) => api.get("/nodes/", { params }),
    get: (id: string) => api.get(`/nodes/${id}/`),
  },
  templates: {
    list: (params?: Record<string, string>) => api.get("/workflow/templates/", { params }),
    get: (id: string) => api.get(`/workflow/templates/${id}/`),
    create: (data: object) => api.post("/workflow/templates/", data),
    update: (id: string, data: object) => api.patch(`/workflow/templates/${id}/`, data),
    delete: (id: string) => api.delete(`/workflow/templates/${id}/`),
  },
};

// Events
export const eventsApi = {
  list: (params?: Record<string, string>) => api.get("/events/", { params }),
};

// Karma Stats
export interface KarmaStatsOverview {
  total_souls: number;
  state_distribution: { state: string; label: string; count: number }[];
  tenants: {
    tenant_code: string;
    tenant_name: string;
    total_souls: number;
    state_breakdown: Record<string, number>;
  }[];
  karma_distribution: { label: string; count: number }[];
  recent_activity: {
    id: number;
    action: string;
    resource: string;
    resource_id: string;
    description: string;
    user: string;
    timestamp: string;
  }[];
  souls_by_realm: {
    realm_code: string;
    realm_name: string;
    civilization: string;
    count: number;
  }[];
}

export const karmaApi = {
  balance: (soulId: number) => api.get(`/karma/balance/${soulId}/`),
  effective: (soulId: number) => api.get(`/karma/effective/${soulId}/`),
  recalculate: (soulId: number) => api.post(`/karma/recalculate/${soulId}/`),
  statsOverview: () => api.get<KarmaStatsOverview>("/karma/stats/overview/"),
  exportStats: (params?: Record<string, string>) => api.get("/karma/stats/export/", { params, responseType: "blob" }),
};

// Permissions
export interface Permission {
  id: number;
  codename: string;
  name: string;
  category: string;
}

export interface Role {
  id: number;
  name: string;
  display_name: string;
}

export const permApi = {
  list: () => api.get<Permission[]>("/perm/permissions/"),
  create: (data: { codename: string; name: string; category: string }) =>
    api.post("/perm/permissions/create/", data),
  update: (id: number, data: Partial<{ codename: string; name: string; category: string }>) =>
    api.put(`/perm/permissions/${id}/`, data),
  delete: (id: number) => api.delete(`/perm/permissions/${id}/`),
  rolePermissions: (role?: string) =>
    api.get("/perm/role-permissions/", { params: role ? { role } : {} }),
  assign: (role: string, permissionIds: number[]) =>
    api.post("/perm/role-permissions/assign/", { role, permission_ids: permissionIds }),
  init: () => api.post("/perm/init/"),
  roles: {
    list: () => api.get<Role[]>("/perm/roles/"),
    create: (data: { name: string; display_name: string }) =>
      api.post("/perm/roles/create/", data),
    update: (id: number, data: Partial<{ name: string; display_name: string }>) =>
      api.put(`/perm/roles/${id}/`, data),
    delete: (id: number) => api.delete(`/perm/roles/${id}/`),
    init: () => api.post("/perm/roles/init/"),
  },
};

// Menus
export interface MenuItem {
  id: number;
  name: string;
  path: string;
  icon: string;
  order: number;
  parent: number | null;
  roles: string[];
  is_active: boolean;
  component: string;
  children: MenuItem[];
}

export const menusApi = {
  list: () => api.get("/menus/"),
  all: () => api.get("/menus/all/"),
  create: (data: Partial<MenuItem>) => api.post("/menus/create/", data),
  update: (id: number, data: Partial<MenuItem>) => api.patch(`/menus/${id}/`, data),
  delete: (id: number) => api.delete(`/menus/${id}/`),
};

// Audit
export const auditApi = {
  list: (params?: Record<string, string>) => api.get("/audit/", { params }),
  create: (data: object) => api.post("/audit/create/", data),
};

// Users
export interface User {
  id: number;
  username: string;
  email: string;
  role: "ADMIN" | "JUDGE" | "GUARDIAN" | "VIEWER";
  first_name: string;
  last_name: string;
  is_active: boolean;
  organization_id?: number;
  organization_name?: string;
  position?: string;
  tenant?: {
    id: number;
    code: string;
    display_name: string;
  };
}

// Organizations
export interface Organization {
  id: number;
  name: string;
  code: string;
  category: "CHINESE" | "EUROPEAN" | "EGYPTIAN";
  parent_id: number | null;
  level: number;
  sort?: number;
  ext?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface CreateUserInput {
  username: string;
  email: string;
  password: string;
  role: "ADMIN" | "JUDGE" | "GUARDIAN" | "VIEWER";
  first_name?: string;
  last_name?: string;
  tenant_id?: number;
}

export interface UpdateUserInput {
  email?: string;
  role?: "ADMIN" | "JUDGE" | "GUARDIAN" | "VIEWER";
  first_name?: string;
  last_name?: string;
  is_active?: boolean;
  tenant_id?: number;
  password?: string;
}

export interface UserFilters {
  page?: number;
  search?: string;
  role?: string;
}

export const usersApi = {
  list: (params?: {
    page?: number;
    search?: string;
    role?: string;
    is_active?: string;
    ordering?: string;
  }) => api.get<PaginatedResponse<User>>("/users/", { params }),
  get: (id: string) => api.get<User>(`/users/${id}/`),
  create: (data: CreateUserInput) => api.post<User>("/users/", data),
  update: (id: string, data: UpdateUserInput) => api.patch<User>(`/users/${id}/`, data),
  delete: (id: string) => api.delete(`/users/${id}/`),
  activate: (id: string) => api.post(`/users/${id}/activate/`),
  deactivate: (id: string) => api.post(`/users/${id}/deactivate/`),
  export: () => api.get("/users/export/", { responseType: "blob" }),
  import: (data: FormData) => api.post("/users/import/", data, {
    headers: { "Content-Type": "multipart/form-data" },
  }),
};

// Tenants
export interface Tenant {
  id: number;
  code: string;
  display_name: string;
  description?: string;
  is_active?: boolean;
  dispatch_enabled?: boolean;
}

export const tenantsApi = {
  list: (params?: Record<string, string>) => api.get<Tenant[]>("/tenants/", { params }),
  get: (id: number) => api.get<Tenant>(`/tenants/${id}/`),
};

// Organizations
export const organizationsApi = {
  list: (params?: { category?: string }) => api.get<Organization[]>("/organizations/", { params }),
  get: (id: number) => api.get<Organization>(`/organizations/${id}/`),
  tree: () => api.get<Organization[]>("/organizations/tree/"),
};

// Types
export interface Soul {
  id: string;
  name: string;
  civilization: "CHINESE" | "EUROPEAN" | "EGYPTIAN";
  current_state: "ALIVE" | "JUDGING" | "DISPOSED" | "REINCARNATING" | "LOST";
  birth_date: string | null;
  death_date: string | null;
  origin_location: string;
  merit_score: number;
  demerit_score: number;
  karmic_balance: number;
  created_at: string;
}

export interface Realm {
  id: string;
  realm_code: string;
  civilization: string;
  name_en: string;
  name_local: string;
  realm_type: "HELL" | "PURGATORY" | "BLISS" | "NEUTRAL";
  tier: number;
  is_eternal: boolean;
}

export interface Actor {
  id: string;
  name: string;
  name_zh?: string;
  civilization: string;
  role: string;
  title?: string;
  icon?: string;
  description?: string;
}

export interface Judgment {
  id: string;
  soul: string;
  soul_name: string;
  civilization: string;
  court: string;
  verdict: "PASSED" | "FAILED" | "PURGATORY" | "RETRY" | null;
  is_final: boolean;
  created_at: string;
  concluded_at: string | null;
}

export interface KarmaRecord {
  id: string;
  type: "MERIT" | "DEMERIT";
  category: string;
  description: string;
  original_weight: number;
  effective_weight: number;
  years_elapsed: number;
  decay_factor: number;
  civilization: string;
  recorded_at: string;
  event_date: string | null;
}

export interface KarmaSummary {
  soul_id: string;
  soul_name: string;
  merit_score: number;
  demerit_score: number;
  karmic_balance: number;
  record_count: number;
  records: KarmaRecord[];
}

export interface SoulRecord {
  id: string;
  soul: string;
  record_type: "MERIT" | "DEMERIT";
  category: string;
  description: string;
  weight: number;
  event_date?: string | null;
  created_at: string;
}

export interface Disposition {
  id: string;
  soul: string;
  destination_realm: string;
  memory_reset: string;
  is_eternal: boolean;
  is_executed: boolean;
  created_at: string;
}

export interface Reincarnation {
  id: string;
  soul: string;
  target_realm: string;
  rebirth_form: "HUMAN" | "ANIMAL" | "DIVINE" | "OTHER";
  cycle_count: number;
  new_identity: string;
  reincarnated_at: string;
}

export interface SoulEvent {
  id: string;
  soul: string;
  event_type: string;
  payload: Record<string, unknown>;
  actor: string;
  create_time: string;
}

// Notifications
export interface Notification {
  id: string;
  title: string;
  message: string;
  notification_type: string;
  is_read: boolean;
  related_resource: string | null;
  related_id: string | null;
  created_at: string;
}

export const notificationsApi = {
  list: (params?: Record<string, string>) =>
    api.get<Notification[]>("/notifications/", { params }),
  markRead: (id: string) => api.post<Notification>(`/notifications/${id}/mark_read/`),
  markAllRead: () => api.post<{ marked_read: number }>("/notifications/mark_all_read/"),
};

// Dispatch
export interface DispatchRecord {
  id: string;
  source_tenant: string;
  source_tenant_code: string;
  target_tenant: string;
  target_tenant_code: string;
  soul: string;
  soul_name: string;
  dispatched_by: string;
  dispatched_by_name: string;
  status: "PROPOSED" | "APPROVED" | "REJECTED" | "EXECUTED" | "CANCELLED";
  reason: string;
  proposed_at: string;
  decided_at: string | null;
  executed_at: string | null;
  create_time: string;
  update_time: string;
}

export interface CrossTenantJudgment {
  id: string;
  title: string;
  description: string;
  initiating_tenant: string;
  initiating_tenant_code: string;
  status: "PROPOSED" | "ACTIVE" | "CONCLUDED" | "CANCELLED";
  concluded_at: string | null;
  conclusion_type: "PASS" | "FAIL" | null;
  participants: CrossTenantJudgmentParticipant[];
  create_time: string;
  update_time: string;
}

export interface CrossTenantJudgmentParticipant {
  id: string;
  judgment: string;
  participant_tenant: string;
  participant_tenant_code: string;
  participant_actor: string | null;
  participant_actor_name: string | null;
  role: "ADVISOR" | "CO_JUDGE" | "CHAIRMAN";
  joined_at: string;
}

export const dispatchApi = {
  list: (params?: Record<string, string>) => api.get<DispatchRecord[]>("/dispatch/records/", { params }),
  get: (id: string) => api.get<DispatchRecord>(`/dispatch/records/${id}/`),
  propose: (data: {
    source_tenant: number;
    target_tenant: number;
    soul: number;
    reason: string;
  }) => api.post<DispatchRecord>("/dispatch/records/", data),
  approve: (id: string) => api.post<DispatchRecord>(`/dispatch/records/${id}/approve/`),
  reject: (id: string, reason?: string) => api.post<DispatchRecord>(`/dispatch/records/${id}/reject/`, { reason }),
  execute: (id: string) => api.post<DispatchRecord>(`/dispatch/records/${id}/execute/`),
  proposed: () => api.get<DispatchRecord[]>("/dispatch/records/proposed/"),
  history: () => api.get<DispatchRecord[]>("/dispatch/records/history/"),
};

export const crossTenantJudgmentsApi = {
  list: (params?: Record<string, string>) => api.get<CrossTenantJudgment[]>("/dispatch/cross-tenant-judgments/", { params }),
  get: (id: string) => api.get<CrossTenantJudgment>(`/dispatch/cross-tenant-judgments/${id}/`),
  create: (data: { title: string; description: string }) =>
    api.post<CrossTenantJudgment>("/dispatch/cross-tenant-judgments/", data),
  participate: (id: string, data: {
    participant_tenant: number;
    participant_actor?: number;
    role: "ADVISOR" | "CO_JUDGE" | "CHAIRMAN";
  }) => api.post<CrossTenantJudgment>(`/dispatch/cross-tenant-judgments/${id}/participate/`, data),
  conclude: (id: string, conclusion_type: "PASS" | "FAIL") =>
    api.post<CrossTenantJudgment>(`/dispatch/cross-tenant-judgments/${id}/conclude/`, { conclusion_type }),
};
