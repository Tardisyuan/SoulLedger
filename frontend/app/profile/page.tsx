"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authApi } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { showToast } from "@/src/components/ui/Toast";
import { PageSection } from "@/components/ui/page-section";
import { Skeleton } from "@/components/ui/skeleton";

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "管理员",
  JUDGE: "审判者",
  GUARDIAN: "守护者",
  VIEWER: "查看者",
};

export default function ProfilePage() {
  const { t } = useI18n();
  const { user, setUser } = useTenant();
  const queryClient = useQueryClient();

  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [passwordForm, setPasswordForm] = useState({
    oldPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  // Fetch latest profile
  const { data: profile, isLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const res = await authApi.profile();
      return res.data;
    },
  });

  // Update profile mutation
  const updateMutation = useMutation({
    mutationFn: async (data: { first_name?: string; last_name?: string; email?: string }) => {
      const res = await authApi.updateProfile(data);
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      if (user && data) {
        setUser({ ...user, ...data });
      }
      setEditingField(null);
      showToast(t("profile.profile_updated"), "success");
    },
    onError: () => {
      showToast(t("profile.profile_update_failed"), "error");
    },
  });

  // Change password mutation
  const changePasswordMutation = useMutation({
    mutationFn: async ({ oldPassword, newPassword }: { oldPassword: string; newPassword: string }) => {
      const res = await authApi.changePassword(oldPassword, newPassword);
      return res.data;
    },
    onSuccess: () => {
      setPasswordForm({ oldPassword: "", newPassword: "", confirmPassword: "" });
      setShowPasswordForm(false);
      showToast(t("profile.password_changed"), "success");
    },
    onError: () => {
      showToast(t("profile.password_change_failed"), "error");
    },
  });

  const handleEditSave = (field: string) => {
    if (!editValue.trim()) {
      setEditingField(null);
      return;
    }
    updateMutation.mutate({ [field]: editValue.trim() });
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      showToast(t("profile.password_mismatch"), "error");
      return;
    }
    if (passwordForm.newPassword.length < 8) {
      showToast(t("profile.password_too_short"), "error");
      return;
    }
    changePasswordMutation.mutate({
      oldPassword: passwordForm.oldPassword,
      newPassword: passwordForm.newPassword,
    });
  };

  return (
    <div className="min-h-screen bg-[hsl(var(--color-canvas))] text-[hsl(var(--color-ink))]">
      {/* Page header */}
      <div className="h-12 flex items-center px-6 gap-4 border-b border-[hsl(var(--color-hairline))]/50">
        <h1 className="text-lg font-bold text-[hsl(var(--color-accent))] flex-1">
          {t("profile.title") || "个人中心"}
        </h1>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8">
        {/* Basic Info Section */}
        <PageSection
          title={t("profile.basic_info") || "基本信息"}
          isLoading={isLoading}
          className="mb-8"
        >
          {/* Username (read-only) */}
          <div className="flex items-center px-4 py-3 border-b border-[hsl(var(--color-hairline))]">
            <label className="w-32 text-sm text-[hsl(var(--color-ink-subtle))] shrink-0">
              {t("profile.username") || "用户名"}
            </label>
            {isLoading ? (
              <Skeleton className="h-4 w-32" />
            ) : (
              <span className="text-sm text-[hsl(var(--color-ink))] font-medium">
                {profile?.username || user?.username}
              </span>
            )}
          </div>

          {/* Email */}
          <div className="flex items-center px-4 py-3 border-b border-[hsl(var(--color-hairline))]">
            <label className="w-32 text-sm text-[hsl(var(--color-ink-subtle))] shrink-0">
              {t("profile.email") || "邮箱"}
            </label>
            {editingField === "email" ? (
              <div className="flex-1 flex gap-2">
                <input
                  type="email"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="flex-1 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded px-2 py-1 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
                  autoFocus
                />
                <button
                  onClick={() => handleEditSave("email")}
                  className="px-2 py-1 bg-[hsl(var(--color-accent))] text-black rounded text-xs hover:bg-[hsl(var(--color-accent-hover))]"
                >
                  {t("common.save") || "保存"}
                </button>
                <button
                  onClick={() => setEditingField(null)}
                  className="px-2 py-1 bg-surface-2 border border-hairline rounded text-xs text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))]"
                >
                  {t("common.cancel") || "取消"}
                </button>
              </div>
            ) : (
              <div className="flex-1 flex items-center gap-2">
                {isLoading ? (
                  <Skeleton className="h-4 w-48" />
                ) : (
                  <span className="text-sm text-[hsl(var(--color-ink))]">
                    {profile?.email || user?.email || "-"}
                  </span>
                )}
                {!isLoading && (
                  <button
                    onClick={() => {
                      setEditingField("email");
                      setEditValue(profile?.email || user?.email || "");
                    }}
                    className="ml-auto text-xs text-[hsl(var(--color-accent))] hover:text-[hsl(var(--color-accent-hover))]"
                  >
                    {t("common.edit") || "编辑"}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* First Name */}
          <div className="flex items-center px-4 py-3 border-b border-[hsl(var(--color-hairline))]">
            <label className="w-32 text-sm text-[hsl(var(--color-ink-subtle))] shrink-0">
              {t("profile.first_name") || "名"}
            </label>
            {editingField === "first_name" ? (
              <div className="flex-1 flex gap-2">
                <input
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="flex-1 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded px-2 py-1 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
                  autoFocus
                />
                <button
                  onClick={() => handleEditSave("first_name")}
                  className="px-2 py-1 bg-[hsl(var(--color-accent))] text-black rounded text-xs hover:bg-[hsl(var(--color-accent-hover))]"
                >
                  {t("common.save") || "保存"}
                </button>
                <button
                  onClick={() => setEditingField(null)}
                  className="px-2 py-1 bg-surface-2 border border-hairline rounded text-xs text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))]"
                >
                  {t("common.cancel") || "取消"}
                </button>
              </div>
            ) : (
              <div className="flex-1 flex items-center gap-2">
                {isLoading ? (
                  <Skeleton className="h-4 w-24" />
                ) : (
                  <span className="text-sm text-[hsl(var(--color-ink))]">
                    {profile?.first_name || "-"}
                  </span>
                )}
                {!isLoading && (
                  <button
                    onClick={() => {
                      setEditingField("first_name");
                      setEditValue(profile?.first_name || "");
                    }}
                    className="ml-auto text-xs text-[hsl(var(--color-accent))] hover:text-[hsl(var(--color-accent-hover))]"
                  >
                    {t("common.edit") || "编辑"}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Last Name */}
          <div className="flex items-center px-4 py-3 border-b border-[hsl(var(--color-hairline))]">
            <label className="w-32 text-sm text-[hsl(var(--color-ink-subtle))] shrink-0">
              {t("profile.last_name") || "姓"}
            </label>
            {editingField === "last_name" ? (
              <div className="flex-1 flex gap-2">
                <input
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="flex-1 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded px-2 py-1 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
                  autoFocus
                />
                <button
                  onClick={() => handleEditSave("last_name")}
                  className="px-2 py-1 bg-[hsl(var(--color-accent))] text-black rounded text-xs hover:bg-[hsl(var(--color-accent-hover))]"
                >
                  {t("common.save") || "保存"}
                </button>
                <button
                  onClick={() => setEditingField(null)}
                  className="px-2 py-1 bg-surface-2 border border-hairline rounded text-xs text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))]"
                >
                  {t("common.cancel") || "取消"}
                </button>
              </div>
            ) : (
              <div className="flex-1 flex items-center gap-2">
                {isLoading ? (
                  <Skeleton className="h-4 w-24" />
                ) : (
                  <span className="text-sm text-[hsl(var(--color-ink))]">
                    {profile?.last_name || "-"}
                  </span>
                )}
                {!isLoading && (
                  <button
                    onClick={() => {
                      setEditingField("last_name");
                      setEditValue(profile?.last_name || "");
                    }}
                    className="ml-auto text-xs text-[hsl(var(--color-accent))] hover:text-[hsl(var(--color-accent-hover))]"
                  >
                    {t("common.edit") || "编辑"}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Role (read-only) */}
          <div className="flex items-center px-4 py-3 border-b border-[hsl(var(--color-hairline))]">
            <label className="w-32 text-sm text-[hsl(var(--color-ink-subtle))] shrink-0">
              {t("profile.role") || "角色"}
            </label>
            {isLoading ? (
              <Skeleton className="h-5 w-20" />
            ) : (
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                profile?.role === "ADMIN"
                  ? "bg-red-500/20 text-red-400"
                  : profile?.role === "JUDGE"
                  ? "bg-amber-500/20 text-amber-400"
                  : profile?.role === "GUARDIAN"
                  ? "bg-blue-500/20 text-blue-400"
                  : "bg-gray-500/20 text-gray-400"
              }`}>
                {ROLE_LABELS[profile?.role || user?.role || ""] || profile?.role || user?.role}
              </span>
            )}
          </div>

          {/* Tenant (read-only) */}
          <div className="flex items-center px-4 py-3">
            <label className="w-32 text-sm text-[hsl(var(--color-ink-subtle))] shrink-0">
              {t("profile.tenant") || "租户"}
            </label>
            {isLoading ? (
              <Skeleton className="h-4 w-32" />
            ) : (
              <span className="text-sm text-[hsl(var(--color-ink))]">
                {profile?.tenant?.display_name || profile?.tenant?.code || user?.tenant?.display_name || user?.tenant?.code || "-"}
              </span>
            )}
          </div>
        </PageSection>

        {/* Change Password Section */}
        <PageSection title={t("profile.change_password") || "修改密码"}>
          {!isLoading && !showPasswordForm ? (
            <button
              onClick={() => setShowPasswordForm(true)}
              className="px-4 py-2 bg-surface-2 hover:bg-surface-3 border border-hairline rounded text-sm text-[hsl(var(--color-ink))] transition-colors"
            >
              {t("profile.change_password") || "修改密码"}
            </button>
          ) : isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
            </div>
          ) : showPasswordForm ? (
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-[hsl(var(--color-ink-subtle))] mb-1">
                  {t("profile.old_password") || "旧密码"}
                </label>
                <input
                  type="password"
                  value={passwordForm.oldPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, oldPassword: e.target.value })}
                  className="w-full bg-surface-2 border border-hairline rounded px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-amber-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-[hsl(var(--color-ink-subtle))] mb-1">
                  {t("profile.new_password") || "新密码"}
                </label>
                <input
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                  className="w-full bg-surface-2 border border-hairline rounded px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-amber-500"
                  minLength={8}
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-[hsl(var(--color-ink-subtle))] mb-1">
                  {t("profile.confirm_password") || "确认密码"}
                </label>
                <input
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                  className="w-full bg-surface-2 border border-hairline rounded px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-amber-500"
                  minLength={8}
                  required
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={changePasswordMutation.isPending}
                  className="px-4 py-2 bg-[hsl(var(--color-accent))] text-black rounded text-sm font-medium hover:bg-[hsl(var(--color-accent-hover))] disabled:opacity-50 transition-colors"
                >
                  {changePasswordMutation.isPending
                    ? (t("common.loading") || "提交中...")
                    : (t("common.save") || "保存")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowPasswordForm(false);
                    setPasswordForm({ oldPassword: "", newPassword: "", confirmPassword: "" });
                  }}
                  className="px-4 py-2 bg-surface-2 border border-hairline rounded text-sm text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] transition-colors"
                >
                  {t("common.cancel") || "取消"}
                </button>
              </div>
            </form>
          ) : null}
        </PageSection>
      </div>
    </div>
  );
}