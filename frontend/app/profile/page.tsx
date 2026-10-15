"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authApi } from "@soulledger/core/api";
import { passwordReasonKeys } from "@soulledger/core/api/auth";
import { passwordMinLength } from "@soulledger/core/domain/passwordRules";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { showToast } from "@/src/components/ui/Toast";
import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { Badge } from "@/src/components/ui/Badge";
import { TextField, fieldControl } from "@/src/components/ui/Field";
import { PasswordRuleFields, usePasswordRules } from "@/src/components/auth/PasswordRules";
import { MfaSection } from "@/src/components/profile/MfaSection";
import { DevicesSection } from "@/src/components/profile/DevicesSection";
import { NotificationPreferences, NOTIFICATION_PREFS_ANCHOR } from "@/src/components/profile/NotificationPreferences";
import { EmailVerificationRow } from "@/src/components/profile/EmailVerificationRow";
import { cn } from "@/lib/utils";

export default function ProfilePage() {
  const { t } = useI18n();
  const { user, setUser } = useTenant();
  const queryClient = useQueryClient();
  // 密码须先改(首次登录 / 管理员重置 / 超期):只剩改密码这一节,别的节要调的接口此刻都是 403。
  const mustChange = user?.password_change_required === true;

  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const rules = usePasswordRules(oldPassword, passwordMinLength(user?.role));
  const [showPasswordForm, setShowPasswordForm] = useState(mustChange);
  useEffect(() => {
    if (mustChange) setShowPasswordForm(true);
  }, [mustChange]);
  // The server's refusal, shown under the field it is about (never the passwords themselves).
  const [oldPasswordError, setOldPasswordError] = useState<string | null>(null);

  // Fetch latest profile
  const { data: profile, isLoading, isError, refetch } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const res = await authApi.profile();
      return res.data;
    },
  });

  // The flag can be stale (the password was changed on another device): the server's profile is the truth.
  const serverSaysChanged = profile?.password_change_required === false;
  useEffect(() => {
    if (mustChange && serverSaysChanged && user) setUser({ ...user, password_change_required: false });
  }, [mustChange, serverSaysChanged, user, setUser]);

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
      setOldPassword("");
      rules.reset();
      setShowPasswordForm(false);
      setOldPasswordError(null);
      // The change signed every other device out; this one already holds a fresh token pair.
      showToast(t("profile.password_changed_others_out"), "success");
      // The page then fills out again (the other sections were hidden only while the password was owed).
      if (mustChange && user) setUser({ ...user, password_change_required: false });
    },
    onError: (err: unknown) => {
      const response = (err as { response?: { status?: number; data?: { old_password?: unknown } } })?.response;
      const data = response?.data;
      const refused = passwordReasonKeys(data).length > 0;
      const old = Array.isArray(data?.old_password) && data.old_password.length ? t("profile.password_old_wrong") : null;
      if (response?.status === 429) showToast(t("profile.password_locked"), "error");
      else if (!refused && !old) showToast(t("profile.password_change_failed"), "error");
      setOldPasswordError(old);
      // 服务器说「太常见 / 太像」:清单上的 ◇ 换成报错(password_rules.common_*),不再列 Django 的各条原因。
      if (refused) rules.reject();
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
    setOldPasswordError(null);
    if (!rules.check()) return;
    changePasswordMutation.mutate({ oldPassword, newPassword: rules.next });
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

      {mustChange ? (
        <p role="alert" data-testid="password-must-change" className="mb-6 border-b border-t-2 border-b-[oklch(var(--color-line))] border-t-[oklch(var(--color-warning))] bg-[oklch(var(--color-warning-tint))] px-4 py-3 text-sm text-[oklch(var(--color-warning))]">
          <span aria-hidden="true">! </span>
          {t("profile.password_must_change")}
        </p>
      ) : null}

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

          {/* 只有已验证的邮箱收得到「忘记密码」的重置邮件。 */}
          {!isLoading && !mustChange && <EmailVerificationRow hasEmail={email !== ""} verified={profile?.email_verified === true} />}

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
      <section id="password-section">
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
          <form onSubmit={handlePasswordSubmit} noValidate className="max-w-[440px] min-[720px]:max-w-[720px] space-y-4">
            <TextField
              type="password"
              autoComplete="current-password"
              label={t("profile.old_password")}
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              error={oldPasswordError}
              className="min-[720px]:max-w-80"
              required
            />
            <PasswordRuleFields
              rules={rules}
              idPrefix="profile-password"
              newLabel={t("profile.new_password")}
              confirmLabel={t("profile.confirm_password")}
              wide
            />
            <div className="flex justify-end gap-2 border-t border-[oklch(var(--color-block))] pt-3">
              {mustChange ? null : (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setShowPasswordForm(false);
                    setOldPassword("");
                    rules.reset();
                    setOldPasswordError(null);
                  }}
                >
                  {t("common.cancel")}
                </Button>
              )}
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

      {mustChange ? null : (
      <>
      {/* 通知:类别 × 站内 / 邮件(apps/notifications/categories.py)。通知页右上角的齿轮跳到这里。 */}
      <section id={NOTIFICATION_PREFS_ANCHOR}>
        <h2 className="pt-6 text-lg text-[oklch(var(--color-ink))]">
          <span aria-hidden="true">丙 · </span>
          {t("profile.notifications.title")}
        </h2>
        <NotificationPreferences hasAddress={email !== ""} />
      </section>

      {/* 两步验证(A12):状态、向导、恢复码、关闭。组件自己拉 /auth/mfa/status/。 */}
      <section>
        <h2 className="pt-6 text-lg text-[oklch(var(--color-ink))]">
          <span aria-hidden="true">丁 · </span>
          {t("mfa.title")}
        </h2>
        <MfaSection />
      </section>

      {/* 登录设备(Design 第二十八批 W2):一台设备一行;「不认识的设备」的出路是改密码,所以带一个直达那一节的入口。 */}
      <section>
        <h2 className="pt-6 text-lg text-[oklch(var(--color-ink))]">
          <span aria-hidden="true">戊 · </span>
          {t("profile.devices.title")}
        </h2>
        <DevicesSection
          onChangePassword={() => setShowPasswordForm(true)}
        />
      </section>
      </>
      )}
    </PageShell>
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
