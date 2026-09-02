"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authApi } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { showToast } from "@/src/components/ui/Toast";
import { PageSection } from "@/components/ui/page-section";
import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { Badge, type BadgeTone } from "@/src/components/ui/Badge";
import { TextField, fieldControl } from "@/src/components/ui/Field";
import { cn } from "@/lib/utils";

/**
 * Role → badge tone. `GUARDIAN` and the roles below it used to reach for
 * `--color-status-lost`, which `Badge` has no tone for; `neutral` is what a
 * role with no severity actually means, and it is the tone the data grid
 * already gives an unremarkable enum member.
 */
const ROLE_TONES: Record<string, BadgeTone> = {
  ADMIN: "error",
  JUDGE: "warning",
  GUARDIAN: "info",
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
  const { data: profile, isLoading, isError, refetch } = useQuery({
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

  const role = profile?.role || user?.role || "";

  return (
    <PageShell title={t("profile.title")} variant="prose">
      {/* A banner, not a full-page error state. Every field here falls back to
          the auth context's `user`, so a failed fetch does not blank the page
          — it shows values that may be stale without saying so, which is the
          worse failure. Replacing the whole page with QueryError would hide
          content that is still usable. The error was not read at all before
          this. */}
      {isError && (
        <div
          role="alert"
          className="mb-6 border border-[hsl(var(--color-status-error)/0.5)] bg-[hsl(var(--color-status-error)/0.08)] px-4 py-3 flex items-center justify-between gap-4"
        >
          <p className="text-03 text-[hsl(var(--color-ink))]">{t("profile.load_failed")}</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="text-03 text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] transition-colors shrink-0"
          >
            {t("error.retry")}
          </button>
        </div>
      )}

      {/* Basic Info Section */}
      <PageSection
        title={t("profile.basic_info")}
        isLoading={isLoading}
        className="mb-6"
      >
        {/* Username (read-only) */}
        <div className="flex items-center px-4 py-3 border-b border-[hsl(var(--color-hairline))]">
          <label className="w-32 text-01 uppercase text-[hsl(var(--color-ink-subtle))] shrink-0">
            {t("profile.username")}
          </label>
          {isLoading ? (
            <Skeleton className="h-4 w-32" />
          ) : (
            <span className="text-04 text-[hsl(var(--color-ink))] font-medium truncate">
              {profile?.username || user?.username}
            </span>
          )}
        </div>

        {/* Email */}
        <div className="flex items-center px-4 py-3 border-b border-[hsl(var(--color-hairline))]">
          <label className="w-32 text-01 uppercase text-[hsl(var(--color-ink-subtle))] shrink-0">
            {t("profile.email")}
          </label>
          {editingField === "email" ? (
            <div className="flex-1 min-w-0 flex gap-2">
              <input
                type="email"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className={cn(fieldControl({ size: "sm" }), "flex-1")}
                autoFocus
              />
              <Button variant="primary" size="sm" type="button" onClick={() => handleEditSave("email")}>
                {t("common.save")}
              </Button>
              <Button variant="secondary" size="sm" type="button" onClick={() => setEditingField(null)}>
                {t("common.cancel")}
              </Button>
            </div>
          ) : (
            <div className="flex-1 min-w-0 flex items-center gap-2">
              {isLoading ? (
                <Skeleton className="h-4 w-48" />
              ) : (
                <span className="text-04 text-[hsl(var(--color-ink))] truncate">
                  {profile?.email || user?.email || "-"}
                </span>
              )}
              {!isLoading && (
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  className="ml-auto"
                  onClick={() => {
                    setEditingField("email");
                    setEditValue(profile?.email || user?.email || "");
                  }}
                >
                  {t("common.edit")}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* First Name */}
        <div className="flex items-center px-4 py-3 border-b border-[hsl(var(--color-hairline))]">
          <label className="w-32 text-01 uppercase text-[hsl(var(--color-ink-subtle))] shrink-0">
            {t("profile.first_name")}
          </label>
          {editingField === "first_name" ? (
            <div className="flex-1 min-w-0 flex gap-2">
              <input
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className={cn(fieldControl({ size: "sm" }), "flex-1")}
                autoFocus
              />
              <Button variant="primary" size="sm" type="button" onClick={() => handleEditSave("first_name")}>
                {t("common.save")}
              </Button>
              <Button variant="secondary" size="sm" type="button" onClick={() => setEditingField(null)}>
                {t("common.cancel")}
              </Button>
            </div>
          ) : (
            <div className="flex-1 min-w-0 flex items-center gap-2">
              {isLoading ? (
                <Skeleton className="h-4 w-24" />
              ) : (
                <span className="text-04 text-[hsl(var(--color-ink))] truncate">
                  {profile?.first_name || "-"}
                </span>
              )}
              {!isLoading && (
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  className="ml-auto"
                  onClick={() => {
                    setEditingField("first_name");
                    setEditValue(profile?.first_name || "");
                  }}
                >
                  {t("common.edit")}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Last Name */}
        <div className="flex items-center px-4 py-3 border-b border-[hsl(var(--color-hairline))]">
          <label className="w-32 text-01 uppercase text-[hsl(var(--color-ink-subtle))] shrink-0">
            {t("profile.last_name")}
          </label>
          {editingField === "last_name" ? (
            <div className="flex-1 min-w-0 flex gap-2">
              <input
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className={cn(fieldControl({ size: "sm" }), "flex-1")}
                autoFocus
              />
              <Button variant="primary" size="sm" type="button" onClick={() => handleEditSave("last_name")}>
                {t("common.save")}
              </Button>
              <Button variant="secondary" size="sm" type="button" onClick={() => setEditingField(null)}>
                {t("common.cancel")}
              </Button>
            </div>
          ) : (
            <div className="flex-1 min-w-0 flex items-center gap-2">
              {isLoading ? (
                <Skeleton className="h-4 w-24" />
              ) : (
                <span className="text-04 text-[hsl(var(--color-ink))] truncate">
                  {profile?.last_name || "-"}
                </span>
              )}
              {!isLoading && (
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  className="ml-auto"
                  onClick={() => {
                    setEditingField("last_name");
                    setEditValue(profile?.last_name || "");
                  }}
                >
                  {t("common.edit")}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Role (read-only) */}
        <div className="flex items-center px-4 py-3 border-b border-[hsl(var(--color-hairline))]">
          <label className="w-32 text-01 uppercase text-[hsl(var(--color-ink-subtle))] shrink-0">
            {t("profile.role")}
          </label>
          {isLoading ? (
            <Skeleton className="h-5 w-20" />
          ) : (
            <Badge tone={ROLE_TONES[role] ?? "neutral"}>
              {t(`users.roles.${role}`) || role}
            </Badge>
          )}
        </div>

        {/* Tenant (read-only) */}
        <div className="flex items-center px-4 py-3">
          <label className="w-32 text-01 uppercase text-[hsl(var(--color-ink-subtle))] shrink-0">
            {t("profile.tenant")}
          </label>
          {isLoading ? (
            <Skeleton className="h-4 w-32" />
          ) : (
            <span className="text-04 text-[hsl(var(--color-ink))] truncate">
              {/* /auth/profile/ is UserSerializer, which has no `tenant`
                  field at all — the two leading branches this expression
                  used to start with were dead. */}
              {user?.tenant?.display_name || user?.tenant?.code || "-"}
            </span>
          )}
        </div>
      </PageSection>

      {/* Change Password Section */}
      <PageSection title={t("profile.change_password")}>
        {!isLoading && !showPasswordForm ? (
          <Button variant="secondary" type="button" onClick={() => setShowPasswordForm(true)}>
            {t("profile.change_password")}
          </Button>
        ) : isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
          </div>
        ) : showPasswordForm ? (
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <TextField
              type="password"
              label={t("profile.old_password")}
              value={passwordForm.oldPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, oldPassword: e.target.value })}
              required
            />
            <TextField
              type="password"
              label={t("profile.new_password")}
              value={passwordForm.newPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
              minLength={8}
              required
            />
            <TextField
              type="password"
              label={t("profile.confirm_password")}
              value={passwordForm.confirmPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
              minLength={8}
              required
            />
            <div className="flex gap-2 pt-2">
              <Button
                type="submit"
                variant="primary"
                loading={changePasswordMutation.isPending}
              >
                {changePasswordMutation.isPending
                  ? (t("common.loading"))
                  : (t("common.save"))}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowPasswordForm(false);
                  setPasswordForm({ oldPassword: "", newPassword: "", confirmPassword: "" });
                }}
              >
                {t("common.cancel")}
              </Button>
            </div>
          </form>
        ) : null}
      </PageSection>
    </PageShell>
  );
}
