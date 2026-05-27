"use client";

import { useState } from "react";
import Link from "next/link";
import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { menusApi, type MenuItem } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { Modal } from "@/src/components/ui/Modal";
import { IconPicker } from "@/src/components/ui/IconPicker";
import { Skeleton, TableSkeleton } from "@/components/ui/skeleton";
import { PageSection } from "@/components/ui/page-section";

type LucideIconName = keyof typeof LucideIcons;

const ROLE_OPTIONS = ["ADMIN", "JUDGE", "GUARDIAN", "VIEWER"];

export default function MenusPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const { data: menus = [], isLoading, error } = useQuery<MenuItem[]>({
    queryKey: ["menus"],
    queryFn: async () => {
      const res = await menusApi.all();
      return res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<MenuItem>) => menusApi.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["menus"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => menusApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["menus"] }),
  });

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingMenu, setEditingMenu] = useState<MenuItem | null>(null);
  const [form, setForm] = useState({
    name: "",
    path: "",
    icon: "",
    order: 0,
    component: "",
    roles: [] as string[],
    is_active: true,
    parent: null as number | null,
  });

  const openCreate = () => {
    setForm({ name: "", path: "", icon: "", order: 0, component: "", roles: [], is_active: true, parent: null });
    setIsCreateModalOpen(true);
  };

  const openEdit = (menu: MenuItem) => {
    setForm({
      name: menu.name,
      path: menu.path,
      icon: menu.icon || "",
      order: menu.order,
      component: menu.component || "",
      roles: menu.roles,
      is_active: menu.is_active,
      parent: menu.parent,
    });
    setEditingMenu(menu);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingMenu) {
      await menusApi.update(editingMenu.id, form);
      queryClient.invalidateQueries({ queryKey: ["menus"] });
      setEditingMenu(null);
    } else {
      await createMutation.mutateAsync(form);
      setIsCreateModalOpen(false);
    }
  };

  const toggleRole = (role: string) => {
    setForm((f) => ({
      ...f,
      roles: f.roles.includes(role) ? f.roles.filter((r) => r !== role) : [...f.roles, role],
    }));
  };

  return (
    <div className="min-h-screen bg-[hsl(var(--color-canvas))] text-[hsl(var(--color-ink))]">
      {/* Page header */}
      <div className="h-12 flex items-center px-6 gap-4 border-b border-[hsl(var(--color-hairline))]/50">
        <h1 className="text-lg font-bold text-[hsl(var(--color-accent))] flex-1">{t("menus.title")}</h1>
        <button
          onClick={openCreate}
          className="px-4 py-1.5 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] rounded-md text-sm font-medium transition-colors"
        >
          + {t("menus.create")}
        </button>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        <PageSection
          title={t("menus.title")}
          isLoading={isLoading}
          error={error ? String(error) : undefined}
        >
          {menus.length === 0 && !isLoading ? (
            <div className="text-center text-[hsl(var(--color-ink-subtle))] py-12">{t("menus.no_menus")}</div>
          ) : (
            <div className="bg-[hsl(var(--color-surface-1))] rounded-lg border border-[hsl(var(--color-hairline))] overflow-hidden">
              {isLoading ? (
                <TableSkeleton rows={5} cols={6} />
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-muted))]">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium">{t("menus.name")}</th>
                      <th className="text-left px-4 py-3 font-medium">{t("menus.path")}</th>
                      <th className="text-left px-4 py-3 font-medium">{t("menus.roles")}</th>
                      <th className="text-left px-4 py-3 font-medium">{t("menus.order")}</th>
                      <th className="text-left px-4 py-3 font-medium">{t("menus.status")}</th>
                      <th className="text-right px-4 py-3 font-medium">{t("menus.action")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[hsl(var(--color-hairline))]">
                    {menus.map((menu) => {
                      const MenuIcon = menu.icon
                        ? (LucideIcons[menu.icon as LucideIconName] as unknown as LucideIcon)
                        : null;
                      return (
                      <tr key={menu.id} className="hover:bg-[hsl(var(--color-surface-2))]/50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {MenuIcon ? (
                              <MenuIcon className="w-4 h-4 text-[hsl(var(--color-accent))]" />
                            ) : null}
                            <span className="font-medium text-[hsl(var(--color-ink))]">{menu.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[hsl(var(--color-ink-muted))] text-xs font-mono">{menu.path}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {menu.roles.map((role) => (
                              <span key={role} className="px-1.5 py-0.5 bg-[hsl(var(--color-accent))]/20 text-[hsl(var(--color-accent))] rounded text-xs">
                                {role}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[hsl(var(--color-ink-muted))]">{menu.order}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-bold ${menu.is_active ? "bg-[hsl(var(--color-status-success)/0.2)] text-[hsl(var(--color-status-success))]" : "bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))]"}`}>
                            {menu.is_active ? t("menus.active") : t("menus.inactive")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => openEdit(menu)}
                            className="text-[hsl(var(--color-accent))] hover:text-[hsl(var(--color-accent-hover))] text-sm mr-3"
                          >
                            {t("menus.edit")}
                          </button>
                          <button
                            onClick={() => deleteMutation.mutate(menu.id)}
                            className="text-[hsl(var(--color-status-error))] hover:text-[hsl(var(--color-status-error)/0.8)] text-sm"
                          >
                            {t("menus.delete")}
                          </button>
                        </td>
                      </tr>
                    );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </PageSection>
      </div>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isCreateModalOpen || editingMenu !== null}
        onClose={() => { setIsCreateModalOpen(false); setEditingMenu(null); }}
        title={editingMenu ? t("menus.edit") : t("menus.create")}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("menus.name")}</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              className="w-full bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
            />
          </div>
          <div>
            <label className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("menus.path")}</label>
            <input
              value={form.path}
              onChange={(e) => setForm({ ...form, path: e.target.value })}
              required
              className="w-full bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("menus.icon")}</label>
              <IconPicker
                value={form.icon}
                onChange={(icon) => setForm({ ...form, icon })}
              />
            </div>
            <div>
              <label className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("menus.order")}</label>
              <input
                type="number"
                value={form.order}
                onChange={(e) => setForm({ ...form, order: Number(e.target.value) })}
                className="w-full bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("menus.component")}</label>
            <input
              value={form.component}
              onChange={(e) => setForm({ ...form, component: e.target.value })}
              placeholder="e.g. souls"
              className="w-full bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
            />
          </div>
          <div>
            <label className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("menus.roles")}</label>
            <div className="flex flex-wrap gap-2">
              {ROLE_OPTIONS.map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => toggleRole(role)}
                  className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                    form.roles.includes(role)
                      ? "bg-[hsl(var(--color-accent))] text-black font-medium"
                      : "bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-muted))] border border-hairline hover:border-[hsl(var(--color-accent))]"
                  }`}
                >
                  {role}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_active"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            />
            <label htmlFor="is_active" className="text-sm text-[hsl(var(--color-ink))]">{t("menus.active")}</label>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => { setIsCreateModalOpen(false); setEditingMenu(null); }}
              className="px-4 py-2 bg-[hsl(var(--color-surface-2))] hover:bg-[hsl(var(--color-surface-3))] rounded-md text-sm text-[hsl(var(--color-ink-muted))] transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] rounded-md text-sm font-medium text-black transition-colors"
            >
              {editingMenu ? t("menus.save") : t("menus.create")}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
