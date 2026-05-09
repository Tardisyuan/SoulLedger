"use client";

import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { BaseModal } from "@/src/components/ui/Modal";

interface UserModalProps {
  open: boolean;
  onClose: () => void;
}

export function UserModal({ open, onClose }: UserModalProps) {
  const { user } = useTenant();
  const { t } = useI18n();

  const footer = (
    <button
      onClick={onClose}
      className="w-full py-2 rounded-lg bg-surface-1 border border-hairline hover:bg-surface-2 text-ink-muted text-sm transition-colors"
    >
      {t("common.close") || "关闭"}
    </button>
  );

  return (
    <BaseModal
      isOpen={open}
      onClose={onClose}
      title={t("nav.user_profile") || "用户信息"}
      footer={footer}
    >
      {/* Avatar */}
      <div className="flex flex-col items-center mb-6">
        <div className="w-16 h-16 rounded-full bg-amber-500/20 border-2 border-amber-500 flex items-center justify-center mb-4">
          <span className="text-2xl text-amber-500 font-bold">
            {user?.username?.charAt(0).toUpperCase()}
          </span>
        </div>

        {/* Username */}
        <h2 className="text-ink text-xl font-semibold mb-1">
          {user?.username}
        </h2>

        {/* Email */}
        <p className="text-ink-subtle text-sm mb-4">{user?.email}</p>

        {/* Role badge */}
        <div className="inline-block px-3 py-1 rounded-full bg-amber-500/20 text-amber-500 text-xs font-medium mb-4">
          {user?.role}
        </div>

        {/* Tenant */}
        {user?.tenant && (
          <p className="text-ink-tertiary text-xs">
            {user.tenant.display_name} · {user.tenant.code}
          </p>
        )}
      </div>
    </BaseModal>
  );
}
