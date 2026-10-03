"use client";

import { useState } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { TextField } from "@/src/components/ui/Field";

/**
 * 「输入名称以确认」(规范 v2 补足 A1「危险 · 永远带 ✕ 和动作文字;只出现在输入名称以确认的
 * 对话框里」)。危险按钮在这里、也只在这里:名称逐字对上之前它是禁用的。
 *
 * 只给不可撤回的动作用 —— 彻底删除、删模板、删权限 / 角色。能从回收站拿回来的动作用普通
 * ConfirmDialog,不用它。
 */
export function NameConfirmDialog({
  isOpen,
  title,
  message,
  name,
  actionLabel,
  isPending = false,
  onCancel,
  onConfirm,
}: {
  isOpen: boolean;
  title: string;
  message: React.ReactNode;
  /** 要逐字输入的名称。首尾空白不算。 */
  name: string;
  /** 危险按钮上的动作文字(前面自动加 ✕)。 */
  actionLabel: string;
  isPending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const [typed, setTyped] = useState("");
  const matches = name.length > 0 && typed.trim() === name.trim();

  const close = () => {
    if (isPending) return;
    setTyped("");
    onCancel();
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={close}
      dismissOnOutsideClick={false}
      title={title}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close} disabled={isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="danger"
            data-testid="name-confirm-action"
            /* 规范 v3「危险确认」:名称对上的那一刻按钮瞬时启用,不渐变 —— 禁用到可按
               之间的 160ms 颜色过渡会让人以为还没好。`instant` 是 0ms「不动画」那一档。 */
            className="duration-instant"
            loading={isPending}
            disabled={!matches}
            onClick={() => {
              setTyped("");
              onConfirm();
            }}
          >
            <span aria-hidden="true">✕</span>
            {actionLabel}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="text-sm text-[oklch(var(--color-ink))]">{message}</div>
        <TextField
          label={t("common.type_name_to_confirm", { name })}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          disabled={isPending}
        />
      </div>
    </BaseModal>
  );
}
