"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import { ConfirmDialog } from "@/src/components/ui/Modal";

/**
 * 「确认退出登录」对话框。
 *
 * 曾经是一份**手写的第四个确认框** —— 自己的 @headlessui `Dialog` + `Transition`、
 * 自己的两个手搓按钮、自己的一套进出场类名 —— 和 `ConfirmDialog` 讲同一件事,
 * 只是又讲了一遍。`hallmark` 的审查把这一类点名为「每个文件各自重新拼写一遍确认
 * 对话框」,这是其中之一。
 *
 * 现在它只是 `ConfirmDialog` 的一层薄壳:状态仍然归 AppLayout(它同时要控制那个
 * 触发按钮),这里只把三个 prop 转过去,外加这一处的文案。
 *
 * 换掉它连带解决了两件事:两个手搓按钮回到 `Button`(所以有了 `active:` 按压态),
 * 以及**对话框语义**变成 alert-dialog —— 退出登录这类问题不该被背景上的一次误点
 * 悄悄答成「取消」。
 *
 * 它此前特意用 `z-drawer` 而不是 `z-dialog`,因为它可能在移动端抽屉打开时被唤起。
 * 那个需要没有消失,消失的是特例:globals.css 里 dialog 与 drawer 的先后已经对调,
 * 理由写在那里。
 */
export function LogoutConfirmDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();

  return (
    <ConfirmDialog
      isOpen={open}
      title={t("auth.confirm_logout")}
      message={t("auth.confirm_logout_desc")}
      onConfirm={onConfirm}
      onCancel={onClose}
      confirmText={t("auth.confirm_logout_btn")}
      variant="danger"
    />
  );
}
