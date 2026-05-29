"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { menuButtonsApi, menusApi, type MenuButton, type MenuItem } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { Modal } from "@/src/components/ui/Modal";
import { TableSkeleton } from "@/components/ui/skeleton";
import { PageSection } from "@/components/ui/page-section";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";

export default function MenuButtonsPage() {
  const { t } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [selectedMenuId, setSelectedMenuId] = useState<number | undefined>();

  const { data: menus = [] } = useQuery<MenuItem[]>({
    queryKey: ["menus-all"],
    queryFn: async () => {
      const res = await menusApi.all();
      return res.data;
    },
  });

  const { data: buttons = [], isLoading, error } = useQuery<MenuButton[]>({
    queryKey: ["menu-buttons", selectedMenuId],
    queryFn: async () => {
      const res = await menuButtonsApi.list(selectedMenuId);
      return res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<MenuButton>) => menuButtonsApi.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["menu-buttons"] }),
    onError: () => showToast(t("menu_buttons.create_error") || "Failed to create button", "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => menuButtonsApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["menu-buttons"] }),
    onError: () => showToast(t("menu_buttons.delete_error") || "Failed to delete button", "error"),
  });

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingButton, setEditingButton] = useState<MenuButton | null>(null);
  const [form, setForm] = useState({
    name: "",
    code: "",
    permission: "",
    order: 0,
    is_active: true,
    menu: null as number | null,
  });

  const openCreate = () => {
    setForm({ name: "", code: "", permission: "", order: 0, is_active: true, menu: selectedMenuId ?? null });
    setIsCreateModalOpen(true);
  };

  const openEdit = (btn: MenuButton) => {
    setForm({
      name: btn.name,
      code: btn.code,
      permission: btn.permission,
      order: btn.order,
      is_active: btn.is_active,
      menu: null,
    });
    setEditingButton(btn);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingButton) {
      await menuButtonsApi.update(editingButton.id, form);
      queryClient.invalidateQueries({ queryKey: ["menu-buttons"] });
      setEditingButton(null);
    } else {
      await createMutation.mutateAsync(form);
      setIsCreateModalOpen(false);
    }
  };

  return (
    <div className="min-h-screen bg-[hsl(var(--color-canvas))] text-[hsl(var(--color-ink))]">
      <div className="h-12 flex items-center px-6 gap-4 border-b border-[hsl(var(--color-hairline))]/50">
        <h1 className="text-lg font-bold text-[hsl(var(--color-accent))] flex-1">{t("menu_buttons.title")}</h1>
        <select
          value={selectedMenuId ?? ""}
          onChange={(e) => setSelectedMenuId(e.target.value ? Number(e.target.value) : undefined)}
          className="bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-3 py-1.5 text-sm text-[hsl(var(--color-ink))]"
        >
          <option value="">{t("menu_buttons.all_menus")}</option>
          {menus.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <RequirePermission permissions="menu.create">
          <button
            onClick={openCreate}
            className="px-4 py-1.5 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] rounded-md text-sm font-medium transition-colors"
          >
            + {t("menu_buttons.create")}
          </button>
        </RequirePermission>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        <PageSection
          title={t("menu_buttons.title")}
          isLoading={isLoading}
          error={error ? String(error) : undefined}
        >
          {buttons.length === 0 && !isLoading ? (
            <div className="text-center text-[hsl(var(--color-ink-subtle))] py-12">{t("menu_buttons.no_buttons")}</div>
          ) : (
            <div className="bg-[hsl(var(--color-surface-1))] rounded-lg border border-[hsl(var(--color-hairline))] overflow-hidden">
              {isLoading ? (
                <TableSkeleton rows={5} cols={5} />
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-muted))]">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium">{t("menu_buttons.name")}</th>
                      <th className="text-left px-4 py-3 font-medium">{t("menu_buttons.code")}</th>
                      <th className="text-left px-4 py-3 font-medium">{t("menu_buttons.permission")}</th>
                      <th className="text-left px-4 py-3 font-medium">{t("menus.order")}</th>
                      <th className="text-left px-4 py-3 font-medium">{t("menus.status")}</th>
                      <th className="text-right px-4 py-3 font-medium">{t("menus.action")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[hsl(var(--color-hairline))]">
                    {buttons.map((btn) => (
                      <tr key={btn.id} className="hover:bg-[hsl(var(--color-surface-2))]/50 transition-colors">
                        <td className="px-4 py-3 font-medium text-[hsl(var(--color-ink))]">{btn.name}</td>
                        <td className="px-4 py-3 text-[hsl(var(--color-ink-muted))] text-xs font-mono">{btn.code}</td>
                        <td className="px-4 py-3 text-[hsl(var(--color-ink-muted))] text-xs font-mono">{btn.permission}</td>
                        <td className="px-4 py-3 text-[hsl(var(--color-ink-muted))]">{btn.order}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-bold ${btn.is_active ? "bg-[hsl(var(--color-status-success)/0.2)] text-[hsl(var(--color-status-success))]" : "bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))]"}`}>
                            {btn.is_active ? t("menus.active") : t("menus.inactive")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <RequirePermission permissions="menu.update">
                            <button
                              onClick={() => openEdit(btn)}
                              className="text-[hsl(var(--color-accent))] hover:text-[hsl(var(--color-accent-hover))] text-sm mr-3"
                            >
                              {t("menus.edit")}
                            </button>
                          </RequirePermission>
                          <RequirePermission permissions="menu.delete">
                            <button
                              onClick={() => deleteMutation.mutate(btn.id)}
                              className="text-[hsl(var(--color-status-error))] hover:text-[hsl(var(--color-status-error)/0.8)] text-sm"
                            >
                              {t("menus.delete")}
                            </button>
                          </RequirePermission>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </PageSection>
      </div>

      <Modal
        isOpen={isCreateModalOpen || editingButton !== null}
        onClose={() => { setIsCreateModalOpen(false); setEditingButton(null); }}
        title={editingButton ? t("menu_buttons.edit") : t("menu_buttons.create")}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("menu_buttons.name")}</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              className="w-full bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
            />
          </div>
          <div>
            <label className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("menu_buttons.code")}</label>
            <input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              required
              placeholder={t("menu_buttons.code_placeholder")}
              className="w-full bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
            />
          </div>
          <div>
            <label className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("menu_buttons.permission")}</label>
            <input
              value={form.permission}
              onChange={(e) => setForm({ ...form, permission: e.target.value })}
              required
              placeholder={t("menu_buttons.permission_placeholder")}
              className="w-full bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
            />
          </div>
          {!editingButton && (
            <div>
              <label className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("menu_buttons.bind_menu")}</label>
              <select
                value={form.menu ?? ""}
                onChange={(e) => setForm({ ...form, menu: e.target.value ? Number(e.target.value) : null })}
                required
                className="w-full bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
              >
                <option value="">{t("menu_buttons.select_menu")}</option>
                {menus.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("menus.order")}</label>
            <input
              type="number"
              value={form.order}
              onChange={(e) => setForm({ ...form, order: Number(e.target.value) })}
              className="w-full bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="btn_is_active"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            />
            <label htmlFor="btn_is_active" className="text-sm text-[hsl(var(--color-ink))]">{t("menus.active")}</label>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => { setIsCreateModalOpen(false); setEditingButton(null); }}
              className="px-4 py-2 bg-[hsl(var(--color-surface-2))] hover:bg-[hsl(var(--color-surface-3))] rounded-md text-sm text-[hsl(var(--color-ink-muted))] transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] rounded-md text-sm font-medium text-black transition-colors"
            >
              {editingButton ? t("menus.save") : t("menu_buttons.create")}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
