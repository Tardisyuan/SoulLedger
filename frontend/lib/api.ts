import axios from "axios";

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

// Add JWT token to every request
api.interceptors.request.use((config) => {
  const token = getCookie("soulledger_access");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 → redirect to login (skip for auth endpoints which handle their own errors)
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401 && !error.config._retry) {
      const isAuthEndpoint = error.config.url?.includes("/auth/login") ||
                             error.config.url?.includes("/auth/register");
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
          document.cookie = `soulledger_access=${access}; path=/; max-age=1800; SameSite=Lax`;
          document.cookie = `soulledger_refresh=${newRefresh}; path=/; max-age=604800; SameSite=Lax`;
          error.config.headers.Authorization = `Bearer ${access}`;
          return api(error.config);
        } catch {
          document.cookie = "soulledger_access=; Max-Age=0; path=/";
          document.cookie = "soulledger_refresh=; Max-Age=0; path=/";
          if (typeof window !== "undefined") {
            window.location.href = "/login";
          }
        }
      } else {
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
    return api.post("/auth/logout/", { refresh });
  },
  profile: () => api.get("/auth/profile/"),
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
  list: (params?: Record<string, string>) => api.get("/souls/", { params }),
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

// Realms
export const realmsApi = {
  list: (params?: Record<string, string>) => api.get("/realms/", { params }),
  get: (code: string) => api.get(`/realms/${code}/`),
};

// Actors
export const actorsApi = {
  list: (params?: Record<string, string>) => api.get("/actors/", { params }),
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

// Permissions
export const permApi = {
  list: () => api.get("/perm/permissions/"),
  rolePermissions: (role?: string) => api.get("/perm/role-permissions/", { params: role ? { role } : {} }),
  init: () => api.post("/perm/init/"),
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
  civilization: string;
  role: string;
  title: string;
}

export interface Judgment {
  id: string;
  soul: string;
  civilization: string;
  court: string;
  verdict: "PASSED" | "FAILED" | "PURGATORY" | "RETRY" | null;
  is_final: boolean;
  created_at: string;
  concluded_at: string | null;
}

export interface KarmaSummary {
  soul_id: string;
  merit_score: number;
  demerit_score: number;
  karmic_balance: number;
  total_records: number;
}

export interface SoulRecord {
  id: string;
  soul: string;
  record_type: "MERIT" | "DEMERIT";
  category: string;
  description: string;
  weight: number;
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
  created_at: string;
}

export interface User {
  id: number;
  username: string;
  email: string;
  role: "ADMIN" | "JUDGE" | "GUARDIAN" | "VIEWER";
  first_name: string;
  last_name: string;
  is_active: boolean;
}
