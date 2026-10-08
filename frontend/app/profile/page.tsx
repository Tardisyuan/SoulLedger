"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authApi, notificationsApi } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { showToast } from "@/src/components/ui/Toast";
import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { Badge } from "@/src/components/ui/Badge";
import { TextField, fieldControl } from "@/src/components/ui/Field";
import { cn } from "@/lib/utils";

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
  const email = profile?.email || user?.email || "";

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
          className="mb-6 py-2 border-b border-[oklch(var(--color-rule))] flex items-center justify-between gap-4"
        >
          <p className="text-sm text-[oklch(var(--color-danger))]">
            <span aria-hidden="true">✕ </span>
            {t("profile.load_failed")}
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="text-sm text-[oklch(var(--color-ink))] underline underline-offset-2 shrink-0"
          >
            {t("error.retry")}
          </button>
        </div>
      )}

      {/* 规范 v1:区块标压线,行线代替卡片;标签在左,值在右,393 px 下同样两列。 */}
      <section className="mb-6">
        {/* v3 面板标题(与 `components/ui/page-section.tsx` 同一档);v2 节首的匾纹片段撤掉。 */}
        <h2 className="pt-6 text-lg text-[oklch(var(--color-ink))]">
          <span aria-hidden="true">甲 · </span>
          {t("profile.basic_info")}
        </h2>
        <dl className="grid grid-cols-[8rem_1fr] max-sm:grid-cols-[6rem_1fr] text-sm">
          <dt className={DT}>{t("profile.username")}</dt>
          <dd className={DD}>
            {isLoading ? (
              <Skeleton className="h-4 w-32" />
            ) : (
              <span className="font-medium truncate" title={profile?.username || user?.username}>
                {profile?.username || user?.username}
              </span>
            )}
          </dd>

          {(
            [
              ["email", "email", t("profile.email"), profile?.email || user?.email || "", "w-48"],
              ["first_name", "text", t("profile.first_name"), profile?.first_name || "", "w-24"],
              ["last_name", "text", t("profile.last_name"), profile?.last_name || "", "w-24"],
            ] as const
          ).map(([field, type, label, value, skeleton]) => (
            <EditableRow
              key={field}
              field={field}
              type={type}
              label={label}
              value={value}
              loading={isLoading}
              skeletonClass={skeleton}
              editing={editingField === field}
              draft={editValue}
              onDraft={setEditValue}
              onEdit={() => {
                setEditingField(field);
                setEditValue(value);
              }}
              onSave={() => handleEditSave(field)}
              onCancel={() => setEditingField(null)}
            />
          ))}

          <dt className={DT}>{t("profile.role")}</dt>
          <dd className={DD}>
            {isLoading ? (
              <Skeleton className="h-5 w-20" />
            ) : (
              /* 角色是身份,不是系统状态:中性徽章,与用户页、神祇名录同一条(v3:红只给出错)。
                 此前 ADMIN 用 error 红、JUDGE 用 warning 橙。 */
              <Badge tone="neutral">
                {t(`users.roles.${role}`)}
              </Badge>
            )}
          </dd>

          <dt className={DT}>{t("profile.tenant")}</dt>
          <dd className={DD}>
            {isLoading ? (
              <Skeleton className="h-4 w-32" />
            ) : (
              <span
                className="truncate"
                title={user?.tenant?.display_name || user?.tenant?.code || undefined}
              >
                {/* /auth/profile/ is UserSerializer, which has no `tenant`
                    field at all — the two leading branches this expression
                    used to start with were dead. */}
                {user?.tenant?.display_name || user?.tenant?.code || "-"}
              </span>
            )}
          </dd>
        </dl>
      </section>

      {/* Change Password Section */}
      <section>
        <h2 className="pt-6 text-lg text-[oklch(var(--color-ink))]">
          <span aria-hidden="true">乙 · </span>
          {t("profile.change_password")}
        </h2>
        <div className="pt-3">
        {!isLoading && !showPasswordForm ? (
          <Button variant="secondary" type="button" onClick={() => setShowPasswordForm(true)}>
            {t("profile.change_password")}
          </Button>
        ) : isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
          </div>
        ) : showPasswordForm ? (
          <form onSubmit={handlePasswordSubmit} className="max-w-[440px] space-y-4">
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
            <div className="flex justify-end gap-2 border-t border-[oklch(var(--color-block))] pt-3">
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
              <Button
                type="submit"
                variant="primary"
                loading={changePasswordMutation.isPending}
              >
                {changePasswordMutation.isPending
                  ? (t("common.loading"))
                  : (t("common.save"))}
              </Button>
            </div>
          </form>
        ) : null}
        </div>
      </section>

      {/* 邮件通道:待处理的站内通知再发一封到邮箱(apps/notifications/tasks.py)。默认关。 */}
      <section>
        <h2 className="pt-6 text-lg text-[oklch(var(--color-ink))]">
          <span aria-hidden="true">丙 · </span>
          {t("profile.email_notifications")}
        </h2>
        <EmailNotificationsToggle hasAddress={email !== ""} />
      </section>
    </PageShell>
  );
}

/**
 * 开关记在 `preferences.email_notifications`;开的那一刻把界面语言记成 `email_locale`
 * (官员没有别的存下来的语言偏好;邮件只有 zh-Hans / en,egy 界面落到 en)。
 * 旁边是上次发送失败(`/notifications/email-status/`):没失败过什么也不显示。
 */
function EmailNotificationsToggle({ hasAddress }: { hasAddress: boolean }) {
  const { t, locale, formatDateTime } = useI18n();
  const queryClient = useQueryClient();
  const prefs = useQuery({ queryKey: ["profile", "preferences"], queryFn: () => authApi.preferences().then((r) => r.data) });
  const status = useQuery({
    queryKey: ["profile", "email-status"],
    queryFn: () => notificationsApi.emailStatus().then((r) => r.data),
  });
  const toggle = useMutation({
    mutationFn: (on: boolean) =>
      authApi
        .updatePreferences(on ? { email_notifications: true, email_locale: locale === "zh-Hans" ? "zh-Hans" : "en" } : { email_notifications: false })
        .then((r) => r.data),
    onSuccess: (data) => queryClient.setQueryData(["profile", "preferences"], data),
    onError: () => showToast(t("profile.profile_update_failed"), "error"),
  });
  const on = prefs.data?.email_notifications === true;
  const failure = status.data?.last_failure ?? null;
  return (
    <div className="pt-3 space-y-2">
      <div className="flex items-start gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={t("profile.email_notifications")}
          disabled={!prefs.data || toggle.isPending}
          onClick={() => toggle.mutate(!on)}
          // 与 SchedulerJobRow 的开关同一张皮:44 的点击区里画 32 × 18 的轨道。
          className="group inline-flex size-(--control-h-sm) shrink-0 items-center justify-center disabled:cursor-not-allowed"
        >
          <span
            aria-hidden="true"
            className={`relative inline-flex h-[18px] w-8 items-center border-[1.5px] p-0.5 transition-colors duration-instant group-disabled:border-[oklch(var(--color-line))] group-disabled:bg-[oklch(var(--color-disabled-surface))] ${
              on
                ? "justify-end bg-[oklch(var(--color-ink))] border-[oklch(var(--color-ink))]"
                : "justify-start bg-transparent border-[oklch(var(--color-line-strong))]"
            }`}
          >
            <span className={`block size-[11px] ${on ? "bg-[oklch(var(--color-canvas))]" : "bg-[oklch(var(--color-line-strong))]"}`} />
          </span>
        </button>
        <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("profile.email_notifications_note")}</p>
      </div>
      {!hasAddress ? (
        <p className="text-sm text-[oklch(var(--color-ink-subtle))]">{t("profile.email_notifications_no_address")}</p>
      ) : null}
      {failure ? (
        <p role="status" className="text-sm text-[oklch(var(--color-danger))]">
          <span aria-hidden="true">✕ </span>
          {t("profile.email_last_failure", { error: failure.error, at: formatDateTime(failure.at) })}
        </p>
      ) : null}
    </div>
  );
}

/** 一对 dt / dd 的行线与字色(与灵魂详情「甲 · 身份」同一份写法)。 */
const DT = "py-2 border-b border-[oklch(var(--color-rule))] text-[oklch(var(--color-ink-subtle))] self-stretch flex items-center";
const DD = "py-2 border-b border-[oklch(var(--color-rule))] text-[oklch(var(--color-ink))] min-w-0 flex items-center gap-2";

/**
 * 一条可就地编辑的账行。邮箱 / 名 / 姓原是三段逐字相同的标记,只差字段名;
 * 编辑时控件的 `id` 与左侧 `<label htmlFor>` 成对 —— 此前那三个 `<label>` 不指向
 * 任何控件,输入框没有可读的名字。
 */
function EditableRow({
  field,
  type,
  label,
  value,
  loading,
  skeletonClass,
  editing,
  draft,
  onDraft,
  onEdit,
  onSave,
  onCancel,
}: {
  field: string;
  type: "email" | "text";
  label: string;
  value: string;
  loading: boolean;
  skeletonClass: string;
  editing: boolean;
  draft: string;
  onDraft: (v: string) => void;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const inputId = `profile-${field}`;
  return (
    <>
      <dt className={DT}>
        {editing ? <label htmlFor={inputId}>{label}</label> : label}
      </dt>
      <dd className={cn(DD, editing && "flex-wrap")}>
        {editing ? (
          <>
            <input
              id={inputId}
              type={type}
              value={draft}
              onChange={(e) => onDraft(e.target.value)}
              className={cn(fieldControl({ size: "sm" }), "flex-1 min-w-40")}
              autoFocus
            />
            <span className="flex gap-2 ml-auto">
              <Button variant="secondary" size="sm" type="button" onClick={onCancel}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" size="sm" type="button" onClick={onSave}>
                {t("common.save")}
              </Button>
            </span>
          </>
        ) : (
          <>
            {loading ? (
              <Skeleton className={`h-4 ${skeletonClass}`} />
            ) : (
              <span className="truncate" title={value || undefined}>
                {value || "-"}
              </span>
            )}
            {!loading && (
              <Button variant="ghost" size="sm" type="button" className="ml-auto" onClick={onEdit}>
                {t("common.edit")}
              </Button>
            )}
          </>
        )}
      </dd>
    </>
  );
}
