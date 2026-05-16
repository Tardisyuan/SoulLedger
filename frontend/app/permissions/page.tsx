"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { permApi, Permission, Role } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Skeleton, TableSkeleton } from "@/components/ui/skeleton";
import { PageSection } from "@/components/ui/page-section";

const CATEGORIES = ["soul", "judgment", "karma", "reincarnation", "system"];

export default function PermissionsPage() {
  const { t } = useI18n();
  const { isAdmin, user } = useTenant();
  const queryClient = useQueryClient();

  const [selectedRoleName, setSelectedRoleName] = useState("ADMIN");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingPerm, setEditingPerm] = useState<Permission | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deletingPerm, setDeletingPerm] = useState<Permission | null>(null);
  const [selectedPermIds, setSelectedPermIds] = useState<number[]>([]);

  // Role management state
  const [isRoleCreateOpen, setIsRoleCreateOpen] = useState(false);
  const [isRoleEditOpen, setIsRoleEditOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [isRoleDeleteOpen, setIsRoleDeleteOpen] = useState(false);
  const [deletingRole, setDeletingRole] = useState<Role | null>(null);

  // Fetch all permissions
  const { data: allPerms = [], isLoading: isPermsLoading } = useQuery({
    queryKey: ["permissions"],
    queryFn: async () => {
      const res = await permApi.list();
      return res.data as Permission[];
    },
  });

  // Fetch roles from API
  const { data: roles = [], isLoading: isRolesLoading } = useQuery({
    queryKey: ["roles"],
    queryFn: async () => {
      const res = await permApi.roles.list();
      return res.data as Role[];
    },
  });

  // Fetch role's current permissions
  const { data: roleData, isLoading: isRoleDataLoading } = useQuery({
    queryKey: ["role-permissions", selectedRoleName],
    queryFn: async () => {
      const res = await permApi.rolePermissions(selectedRoleName);
      return res.data as { role: string; permissions: string[]; details: Permission[] };
    },
    enabled: !!selectedRoleName,
  });

  // Assign mutation
  const assignMutation = useMutation({
    mutationFn: ({ role, ids }: { role: string; ids: number[] }) =>
      permApi.assign(role, ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["role-permissions"] });
    },
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: { codename: string; name: string; category: string }) =>
      permApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["permissions"] });
      setIsCreateOpen(false);
    },
  });

  // Edit mutation
  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { codename: string; name: string; category: string } }) =>
      permApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["permissions"] });
      setIsEditOpen(false);
      setEditingPerm(null);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: number) => permApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["permissions"] });
      setIsDeleteOpen(false);
      setDeletingPerm(null);
    },
  });

  // Role CRUD mutations
  const roleCreateMutation = useMutation({
    mutationFn: (data: { name: string; display_name: string }) =>
      permApi.roles.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      setIsRoleCreateOpen(false);
    },
  });

  const roleEditMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name: string; display_name: string } }) =>
      permApi.roles.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      setIsRoleEditOpen(false);
      setEditingRole(null);
    },
  });

  const roleDeleteMutation = useMutation({
    mutationFn: (id: number) => permApi.roles.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      setIsRoleDeleteOpen(false);
      setDeletingRole(null);
    },
  });

  // Build permission map by category
  const permsByCategory = CATEGORIES.reduce<Record<string, Permission[]>>((acc, cat) => {
    acc[cat] = allPerms.filter((p) => p.category === cat);
    return acc;
  }, {});

  // Sync selectedPermIds when roleData changes
  useEffect(() => {
    if (roleData?.details) {
      setSelectedPermIds(roleData.details.map((p: Permission) => p.id));
    }
  }, [roleData]);

  function togglePermId(id: number) {
    setSelectedPermIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function handleAssignSave() {
    assignMutation.mutate({ role: selectedRoleName, ids: selectedPermIds });
  }

  return (
    <div className="min-h-screen bg-[hsl(var(--color-canvas))] text-[hsl(var(--color-ink))]">
      {/* Page header - realms style */}
      <div className="px-6 pt-6 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold text-[hsl(var(--color-accent))]">{t("permissions.title")}</h1>
            <p className="text-sm sm:text-base text-[hsl(var(--color-ink-subtle))] mt-1 hidden sm:block">{t("permissions.subtitle")}</p>
          </div>
          {isAdmin && (
            <button
              onClick={() => setIsRoleCreateOpen(true)}
              className="px-3 py-1.5 sm:px-4 sm:py-2 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] text-black rounded text-xs sm:text-sm font-medium transition-colors shrink-0"
            >
              + {t("permissions.create_role")}
            </button>
          )}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-8">
        {/* ── Role Selector + Assignment ── */}
        <PageSection
          title={t("permissions.select_role")}
          isLoading={isRolesLoading}
          actions={
            isAdmin && !isRolesLoading ? (
              <button
                onClick={() => setIsRoleCreateOpen(true)}
                className="text-xs text-[hsl(var(--color-accent))] hover:text-[hsl(var(--color-accent-hover))] underline"
              >
                {t("permissions.roles_title")} →
              </button>
            ) : undefined
          }
        >
          {isRolesLoading ? (
            <div className="flex gap-2 flex-wrap">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-24" />
              ))}
            </div>
          ) : (
            <div className="flex gap-2 mb-4 flex-wrap">
              {roles.map((role) => (
                <button
                  key={role.name}
                  onClick={() => setSelectedRoleName(role.name)}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    selectedRoleName === role.name
                      ? "bg-[hsl(var(--color-accent))] text-black"
                      : "bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-muted))] border border-hairline hover:border-[hsl(var(--color-accent))]"
                  }`}
                >
                  {role.display_name || role.name}
                </button>
              ))}
            </div>
          )}

          {/* Role permissions assignment — ADMIN only */}
          {isAdmin ? (
            <div className="bg-[hsl(var(--color-surface-1))] rounded-lg border border-[hsl(var(--color-hairline))] p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-[hsl(var(--color-ink))]">{t("permissions.assign")}</h3>
                <button
                  onClick={handleAssignSave}
                  disabled={assignMutation.isPending || isRoleDataLoading}
                  className="px-4 py-1.5 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] disabled:opacity-50 text-black rounded text-sm font-medium transition-colors"
                >
                  {assignMutation.isPending ? t("permissions.submitting") : t("permissions.assign_button")}
                </button>
              </div>

              {/* Sync selected IDs when roleData changes */}
              {isRoleDataLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i}>
                      <Skeleton className="h-3 w-16 mb-2" />
                      <div className="flex flex-wrap gap-2">
                        {[1, 2, 3, 4].map((j) => (
                          <Skeleton key={j} className="h-7 w-32" />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : roleData ? (
                <div
                  className="mt-2 space-y-4"
                  key={selectedRoleName}
                  data-role={selectedRoleName}
                >
                  {CATEGORIES.map((cat) =>
                    permsByCategory[cat]?.length > 0 ? (
                      <div key={cat}>
                        <p className="text-xs text-[hsl(var(--color-ink-muted))] uppercase mb-2">{cat}</p>
                        <div className="flex flex-wrap gap-2">
                          {permsByCategory[cat].map((perm) => {
                            const checked = selectedPermIds.includes(perm.id);
                            return (
                              <label
                                key={perm.id}
                                className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer text-sm transition-colors ${
                                  checked
                                    ? "bg-[hsl(var(--color-accent))]/20 text-[hsl(var(--color-accent))]"
                                    : "bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-muted))]"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  className="accent-[hsl(var(--color-accent))]"
                                  checked={checked}
                                  onChange={() => {
                                    if (checked) {
                                      setSelectedPermIds((prev) =>
                                        prev.filter((id) => id !== perm.id)
                                      );
                                    } else {
                                      setSelectedPermIds((prev) => [...prev, perm.id]);
                                    }
                                  }}
                                />
                                <span className="font-mono text-xs">{perm.codename}</span>
                                <span className="text-xs text-[hsl(var(--color-ink-subtle))]">— {perm.name}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ) : null
                  )}
                </div>
              ) : null}

              {assignMutation.isSuccess && (
                <p className="mt-2 text-sm text-green-400">{t("permissions.assign_success")}</p>
              )}
              {assignMutation.isError && (
                <p className="mt-2 text-sm text-red-400">{t("permissions.assign_error")}</p>
              )}
            </div>
          ) : (
            <div className="bg-[hsl(var(--color-surface-1))] rounded-lg border border-[hsl(var(--color-hairline))] p-4">
              <p className="text-[hsl(var(--color-ink-muted))] text-sm">{t("permissions.admin_only")}</p>
              {isRoleDataLoading ? (
                <div className="flex flex-wrap gap-2 mt-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-6 w-20" />
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2 mt-2">
                  {(roleData?.permissions ?? []).map((perm: string) => (
                    <span key={perm} className="px-2 py-1 bg-[hsl(var(--color-accent))]/20 text-[hsl(var(--color-accent))] rounded text-sm font-mono">
                      {perm}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </PageSection>

        {/* ── All Permissions Table + CRUD ── */}
        <PageSection
          title={t("permissions.all_permissions")}
          isLoading={isPermsLoading}
          actions={
            isAdmin && !isPermsLoading ? (
              <button
                onClick={() => setIsCreateOpen(true)}
                className="px-4 py-1.5 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] text-black rounded text-sm font-medium transition-colors"
              >
                + {t("permissions.create")}
              </button>
            ) : undefined
          }
        >
          {isPermsLoading ? (
            <TableSkeleton rows={8} cols={4} />
          ) : (
            <div className="bg-[hsl(var(--color-surface-1))] rounded-lg border border-[hsl(var(--color-hairline))] overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-muted))]">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">{t("permissions.codename")}</th>
                    <th className="text-left px-4 py-3 font-medium">{t("permissions.name")}</th>
                    <th className="text-left px-4 py-3 font-medium">{t("permissions.category")}</th>
                    {isAdmin && <th className="text-right px-4 py-3 font-medium">{t("souls.action")}</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[hsl(var(--color-hairline))]">
                  {allPerms.map((perm) => (
                    <tr key={perm.id} className="hover:bg-[hsl(var(--color-surface-2))]/50 transition-colors">
                      <td className="px-4 py-3 font-mono text-[hsl(var(--color-accent))] text-xs">{perm.codename}</td>
                      <td className="px-4 py-3 text-[hsl(var(--color-ink))]">{perm.name}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-muted))] rounded text-xs">
                          {perm.category}
                        </span>
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => { setEditingPerm(perm); setIsEditOpen(true); }}
                            className="text-[hsl(var(--color-accent))] hover:text-[hsl(var(--color-accent-hover))] text-xs mr-3"
                          >
                            {t("permissions.edit")}
                          </button>
                          <button
                            onClick={() => { setDeletingPerm(perm); setIsDeleteOpen(true); }}
                            className="text-red-400 hover:text-red-300 text-xs"
                          >
                            {t("permissions.delete")}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </PageSection>

        {/* ── Roles Grid (ADMIN only) ── */}
        {isAdmin && (
          <PageSection title={t("permissions.roles_title")} isLoading={isRolesLoading}>
            {isRolesLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded-lg p-4">
                    <Skeleton className="h-4 w-2/3 mb-2" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {roles.map((role) => (
                  <div key={role.id} className="bg-surface-1 border border-hairline rounded-lg p-3 hover:border-[hsl(var(--color-accent))]/30 transition-colors">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-medium text-[hsl(var(--color-ink))] truncate text-sm">{role.display_name || role.name}</h3>
                      <p className="text-xs text-[hsl(var(--color-ink-muted))] font-mono truncate">{role.name}</p>
                    </div>
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => { setEditingRole(role); setIsRoleEditOpen(true); }}
                        className="flex-1 px-2 py-1 text-xs text-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent))]/10 rounded transition-colors border border-[hsl(var(--color-accent))]/30"
                      >
                        {t("permissions.edit_role")}
                      </button>
                      <button
                        onClick={() => { setDeletingRole(role); setIsRoleDeleteOpen(true); }}
                        className="flex-1 px-2 py-1 text-xs text-red-400 hover:bg-red-400/10 rounded transition-colors border border-red-400/30"
                      >
                        {t("permissions.delete_role")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </PageSection>
        )}
      </div>

      {/* ── Create Permission Modal ── */}
      <PermissionFormModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSubmit={(data) => createMutation.mutate(data)}
        isPending={createMutation.isPending}
        error={createMutation.isError ? t("permissions.create_error") : null}
        title={t("permissions.create")}
      />

      {/* ── Edit Permission Modal ── */}
      <PermissionFormModal
        isOpen={isEditOpen}
        onClose={() => { setIsEditOpen(false); setEditingPerm(null); }}
        onSubmit={(data) => editingPerm && editMutation.mutate({ id: editingPerm.id, data })}
        isPending={editMutation.isPending}
        error={editMutation.isError ? t("permissions.edit_error") : null}
        title={t("permissions.edit")}
        initialData={editingPerm ?? undefined}
      />

      {/* ── Delete Confirmation Modal ── */}
      <BaseModal
        isOpen={isDeleteOpen}
        onClose={() => { setIsDeleteOpen(false); setDeletingPerm(null); }}
        title={t("permissions.confirm_delete")}
        footer={
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => { setIsDeleteOpen(false); setDeletingPerm(null); }}
              disabled={deleteMutation.isPending}
              className="flex-1 px-4 py-2 bg-surface-1 border border-hairline text-[hsl(var(--color-ink-muted))] hover:bg-surface-2 disabled:opacity-50 rounded text-sm transition-colors"
            >
              {t("permissions.cancel_delete")}
            </button>
            <button
              type="button"
              onClick={() => deletingPerm && deleteMutation.mutate(deletingPerm.id)}
              disabled={deleteMutation.isPending}
              className="flex-1 px-4 py-2 bg-red-700 hover:bg-red-600 disabled:bg-red-900/50 text-white rounded text-sm font-medium transition-colors"
            >
              {deleteMutation.isPending ? t("permissions.deleting") : t("permissions.confirm_delete_action")}
            </button>
          </div>
        }
      >
        <p className="text-[hsl(var(--color-ink))] text-sm">{t("permissions.confirm_delete_message")}</p>
      </BaseModal>

      {/* ── Role Management Modals ── */}
      <RoleFormModal
        isOpen={isRoleCreateOpen}
        onClose={() => setIsRoleCreateOpen(false)}
        onSubmit={(data) => roleCreateMutation.mutate(data)}
        isPending={roleCreateMutation.isPending}
        error={roleCreateMutation.isError ? t("permissions.role_create_error") : null}
        title={t("permissions.create_role")}
      />

      <RoleFormModal
        isOpen={isRoleEditOpen}
        onClose={() => { setIsRoleEditOpen(false); setEditingRole(null); }}
        onSubmit={(data) => editingRole && roleEditMutation.mutate({ id: editingRole.id, data })}
        isPending={roleEditMutation.isPending}
        error={roleEditMutation.isError ? t("permissions.role_edit_error") : null}
        title={t("permissions.edit_role")}
        initialData={editingRole ?? undefined}
      />

      <BaseModal
        isOpen={isRoleDeleteOpen}
        onClose={() => { setIsRoleDeleteOpen(false); setDeletingRole(null); }}
        title={t("permissions.confirm_delete_role")}
        footer={
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => { setIsRoleDeleteOpen(false); setDeletingRole(null); }}
              disabled={roleDeleteMutation.isPending}
              className="flex-1 px-4 py-2 bg-surface-1 border border-hairline text-[hsl(var(--color-ink-muted))] hover:bg-surface-2 disabled:opacity-50 rounded text-sm transition-colors"
            >
              {t("permissions.cancel_delete")}
            </button>
            <button
              type="button"
              onClick={() => deletingRole && roleDeleteMutation.mutate(deletingRole.id)}
              disabled={roleDeleteMutation.isPending}
              className="flex-1 px-4 py-2 bg-red-700 hover:bg-red-600 disabled:bg-red-900/50 text-white rounded text-sm font-medium transition-colors"
            >
              {roleDeleteMutation.isPending ? t("permissions.deleting") : t("permissions.confirm_delete_action")}
            </button>
          </div>
        }
      >
        <p className="text-[hsl(var(--color-ink))] text-sm">{t("permissions.confirm_delete_role_message")}</p>
      </BaseModal>

    </div>
  );
}

// ── Permission Form Modal ─────────────────────────────────────────────

function PermissionFormModal({
  isOpen,
  onClose,
  onSubmit,
  isPending,
  error,
  title,
  initialData,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { codename: string; name: string; category: string }) => void;
  isPending: boolean;
  error: string | null;
  title: string;
  initialData?: Permission;
}) {
  const { t } = useI18n();
  const [codename, setCodename] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("soul");

  // Reset form when modal opens with new data (useEffect avoids setState during render)
  useEffect(() => {
    if (isOpen) {
      setCodename(initialData?.codename ?? "");
      setName(initialData?.name ?? "");
      setCategory(initialData?.category ?? "soul");
    }
  }, [isOpen, initialData]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!codename.trim()) return;
    if (!name.trim()) return;
    onSubmit({ codename: codename.trim(), name: name.trim(), category });
  }

  function handleClose() {
    setCodename("");
    setName("");
    setCategory("soul");
    onClose();
  }

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleClose}
      title={title}
      footer={
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={isPending}
            className="flex-1 px-4 py-2 bg-surface-1 border border-hairline text-[hsl(var(--color-ink-muted))] hover:bg-surface-2 disabled:opacity-50 rounded text-sm transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || !codename.trim() || !name.trim()}
            className="flex-1 px-4 py-2 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] disabled:opacity-50 text-black rounded text-sm font-medium transition-colors"
          >
            {isPending ? t("permissions.submitting") : t("permissions.submit")}
          </button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <div>
          <label className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("permissions.codename_label")}</label>
          <input
            type="text"
            value={codename}
            onChange={(e) => setCodename(e.target.value)}
            placeholder={t("permissions.codename_placeholder")}
            className="w-full px-3 py-2 bg-surface-2 border border-hairline rounded text-[hsl(var(--color-ink))] text-sm focus:outline-none focus:border-[hsl(var(--color-accent))]"
          />
        </div>
        <div>
          <label className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("permissions.name_label")}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("permissions.name_placeholder")}
            className="w-full px-3 py-2 bg-surface-2 border border-hairline rounded text-[hsl(var(--color-ink))] text-sm focus:outline-none focus:border-[hsl(var(--color-accent))]"
          />
        </div>
        <div>
          <label className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("permissions.category_label")}</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full px-3 py-2 bg-surface-2 border border-hairline rounded text-[hsl(var(--color-ink))] text-sm focus:outline-none focus:border-[hsl(var(--color-accent))]"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </form>
    </BaseModal>
  );
}

// ── Role Form Modal ─────────────────────────────────────────────

function RoleFormModal({
  isOpen,
  onClose,
  onSubmit,
  isPending,
  error,
  title,
  initialData,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { name: string; display_name: string }) => void;
  isPending: boolean;
  error: string | null;
  title: string;
  initialData?: Role;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    if (isOpen) {
      setName(initialData?.name ?? "");
      setDisplayName(initialData?.display_name ?? "");
    }
  }, [isOpen, initialData]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (!displayName.trim()) return;
    onSubmit({ name: name.trim().toUpperCase(), display_name: displayName.trim() });
  }

  function handleClose() {
    setName("");
    setDisplayName("");
    onClose();
  }

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleClose}
      title={title}
      footer={
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={isPending}
            className="flex-1 px-4 py-2 bg-surface-1 border border-hairline text-[hsl(var(--color-ink-muted))] hover:bg-surface-2 disabled:opacity-50 rounded text-sm transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || !name.trim() || !displayName.trim()}
            className="flex-1 px-4 py-2 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] disabled:opacity-50 text-black rounded text-sm font-medium transition-colors"
          >
            {isPending ? t("permissions.submitting") : t("permissions.submit")}
          </button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <div>
          <label className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("permissions.role_name_label")}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("permissions.role_name_placeholder")}
            className="w-full px-3 py-2 bg-surface-2 border border-hairline rounded text-[hsl(var(--color-ink))] text-sm focus:outline-none focus:border-[hsl(var(--color-accent))]"
          />
        </div>
        <div>
          <label className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("permissions.display_name_label")}</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t("permissions.display_name_placeholder")}
            className="w-full px-3 py-2 bg-surface-2 border border-hairline rounded text-[hsl(var(--color-ink))] text-sm focus:outline-none focus:border-[hsl(var(--color-accent))]"
          />
        </div>
      </form>
    </BaseModal>
  );
}
