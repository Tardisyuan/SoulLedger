"use client";

import { Fragment } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { useI18n } from "@/src/contexts/I18nContext";

/**
 * 「确认退出登录」对话框。原先长在 AppLayout.tsx 的 return 里，随文件一起越过
 * 500 行的上限之后搬到这里。
 *
 * 纯展示：状态仍然归 AppLayout（它同时要控制那个触发按钮），这里只收三个 prop。
 * 除了缩进和把 `logoutConfirmOpen` / `setLogoutConfirmOpen(false)` / `handleLogout`
 * 换成 `open` / `onClose` / `onConfirm` 之外，标记逐字未改。
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
    <Transition appear show={open} as={Fragment}>
      <Dialog as="div" className="relative z-[99998]" onClose={() => onClose()}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-md rounded-xl bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] p-6 shadow-2xl">
                <Dialog.Title className="text-lg font-semibold text-[hsl(var(--color-ink))]">
                  {t("auth.confirm_logout")}
                </Dialog.Title>
                <Dialog.Description className="mt-2 text-sm text-[hsl(var(--color-ink-muted))]">
                  {t("auth.confirm_logout_desc")}
                </Dialog.Description>

                <div className="mt-6 flex justify-end gap-3">
                  <button
                    onClick={() => onClose()}
                    className="px-4 py-2 rounded-md bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink))] text-sm hover:bg-[hsl(var(--color-surface-3))] transition-colors"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    onClick={onConfirm}
                    className="px-4 py-2 rounded-md bg-[hsl(var(--color-status-error)/0.1)] text-[hsl(var(--color-status-error))] text-sm hover:bg-[hsl(var(--color-status-error)/0.3)] transition-colors"
                  >
                    {t("auth.confirm_logout_btn")}
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
