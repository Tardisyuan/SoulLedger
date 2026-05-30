"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usersApi, type User, type CreateUserInput, type UpdateUserInput, type PaginatedResponse } from "@/lib/api";
import { showToast } from "@/src/components/ui/Toast";
import { useI18n } from "@/src/contexts/I18nContext";
import { userKeys } from "@/lib/query_keys";

// ── Queries ──────────────────────────────────────────────────────────

export function useUsers(params?: Record<string, string | number | undefined>) {
  return useQuery({
    queryKey: userKeys.list(params),
    queryFn: async () => {
      const res = await usersApi.list(params);
      return res.data as PaginatedResponse<User>;
    },
    staleTime: 30_000,
  });
}

export function useUser(id: string) {
  return useQuery({
    queryKey: userKeys.detail(id),
    queryFn: async () => {
      const res = await usersApi.get(id);
      return res.data as User;
    },
    enabled: !!id,
    staleTime: 30_000,
  });
}

// ── Mutations ────────────────────────────────────────────────────────

export function useCreateUser() {
  const qc = useQueryClient();
  const { t } = useI18n();

  return useMutation({
    mutationFn: (data: CreateUserInput) => usersApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userKeys.all });
      showToast(t("users.create_success") || "User created", "success");
    },
    onError: () => {
      showToast(t("users.create_error") || "Failed to create user", "error");
    },
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  const { t } = useI18n();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateUserInput }) =>
      usersApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userKeys.all });
      showToast(t("users.update_success") || "User updated", "success");
    },
    onError: () => {
      showToast(t("users.update_error") || "Failed to update user", "error");
    },
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  const { t } = useI18n();

  return useMutation({
    mutationFn: (id: string) => usersApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userKeys.all });
      showToast(t("users.delete_success") || "User deleted", "success");
    },
    onError: () => {
      showToast(t("users.delete_error") || "Failed to delete user", "error");
    },
  });
}

export function useToggleUserStatus() {
  const qc = useQueryClient();
  const { t } = useI18n();

  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      isActive ? usersApi.activate(id) : usersApi.deactivate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userKeys.all });
    },
    onError: () => {
      showToast(t("users.status_error") || "Failed to update user status", "error");
    },
  });
}
