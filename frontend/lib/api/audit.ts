import { api } from "./client";

export const auditApi = {
  list: (params?: Record<string, string>) => api.get("/audit-logs/", { params }),
};
