"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { permApi } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";

interface PermissionPayload {
  codename: string;
  name: string;
  category: string;
}

interface RolePayload {
  name: string;
  display_name: string;
}

/**
 * The six Permission/Role CRUD mutations, unchanged in behavior — each still
 * invalidates the same query key and shows the same error toast. `onSettled*`
 * callbacks stand in for the `setIsCreateOpen(false)` / `setEditingPerm(null)`
 * lines that used to sit inside each `onSuccess`, so the modal state stays
 * owned by the page.
 */
export function usePermissionCrud(closers: {
  onCreated: () => void;
  onEdited: () => void;
  onDeleted: () => void;
  onRoleCreated: () => void;
  onRoleEdited: () => void;
  onRoleDeleted: () => void;
}) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (data: PermissionPayload) => permApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["permissions"] });
      closers.onCreated();
    },
    onError: () => showToast(t("permissions.create_error") || "Failed to create permission", "error"),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: PermissionPayload }) => permApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["permissions"] });
      closers.onEdited();
    },
    onError: () => showToast(t("permissions.edit_error") || "Failed to update permission", "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => permApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["permissions"] });
      closers.onDeleted();
    },
    onError: () => showToast(t("permissions.delete_error") || "Failed to delete permission", "error"),
  });

  const roleCreateMutation = useMutation({
    mutationFn: (data: RolePayload) => permApi.roles.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      closers.onRoleCreated();
    },
    onError: () => showToast(t("permissions.role_create_error") || "Failed to create role", "error"),
  });

  const roleEditMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: RolePayload }) => permApi.roles.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      closers.onRoleEdited();
    },
    onError: () => showToast(t("permissions.role_edit_error") || "Failed to update role", "error"),
  });

  const roleDeleteMutation = useMutation({
    mutationFn: (id: number) => permApi.roles.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      closers.onRoleDeleted();
    },
    onError: () => showToast(t("permissions.role_delete_error") || "Failed to delete role", "error"),
  });

  return { createMutation, editMutation, deleteMutation, roleCreateMutation, roleEditMutation, roleDeleteMutation };
}
