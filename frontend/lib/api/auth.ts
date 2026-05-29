import { api } from "./client";

export const authApi = {
  login: (usernameOrData: string | { username: string; password: string }, password?: string) => {
    const data = typeof usernameOrData === "string"
      ? { username: usernameOrData, password: password! }
      : usernameOrData;
    return api.post("/auth/login/", data);
  },
  register: (data: object) => api.post("/auth/register/", data),
  refresh: (data: { refresh: string }) => api.post("/auth/refresh/", data),
  logout: () => api.post("/auth/logout/"),
  profile: () => api.get("/auth/profile/"),
  updateProfile: (data: object) => api.patch("/auth/profile/", data),
  changePassword: (oldPasswordOrData: string | { old_password: string; new_password: string }, newPassword?: string) => {
    const data = typeof oldPasswordOrData === "string"
      ? { old_password: oldPasswordOrData, new_password: newPassword! }
      : oldPasswordOrData;
    return api.post("/auth/change-password/", data);
  },
};
