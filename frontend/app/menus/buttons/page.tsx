"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { menuButtonsApi, menusApi, PAGE_SIZE, type MenuButton, type MenuItem, type PaginatedResponse } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { Modal } from "@/src/components/ui/Modal";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { DataTable } from "@/components/ui/data-table";

export default function MenuButtonsPage() {
  const { t } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [selectedMenuId, setSelectedMenuId] = useState<number | undefined>();
  const [page, setPage] = useState(1);

  // Unique prefix so field ids never collide across multiple Modal instances.
  const formId = useId();
  const menuFilterId = `${formId}-menu-filter`;
  const nameId = `${formId}-name`;
  const codeId = `${formId}-code`;
  const permissionId = `${formId}-permission`;
  const bindMenuId = `${formId}-bind-menu`;
  const orderId = `${formId}-order`;
  const isActiveId = `${formId}-is-active`;

  const { data: menus = [] } = useQuery<MenuItem[]>({
    queryKey: ["menus-all"],
    queryFn: async () => {
      const res = await menusApi.all();
      return res.data;
    },
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ["menu-buttons", selectedMenuId, page],
    queryFn: async () => {
      const res = await menuButtonsApi.list(selectedMenuId, page);
      return res.data;
    },
  });
  const buttons = data?.results ?? [];
  const totalPages = data ? Math.ceil(data.count / PAGE_SIZE) : 0;

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
          id={menuFilterId}
          value={selectedMenuId ?? ""}
          onChange={(e) => {
            setSelectedMenuId(e.target.value ? Number(e.target.value) : undefined);
            setPage(1);
          }}
          aria-label={t("menu_buttons.filter_by_menu") === "menu_buttons.filter_by_menu" ? "Filter by menu" : t("menu_buttons.filter_by_menu")}
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
        <DataTable<MenuButton>
          caption={t("menu_buttons.title")}
          columns={[
            { key: "name", header: t("menu_buttons.name") },
            { key: "code", header: t("menu_buttons.code") },
            { key: "permission", header: t("menu_buttons.permission") },
            { key: "order", header: t("menus.order") },
            { key: "status", header: t("menus.status") },
            { key: "action", header: t("menus.action"), align: "right" },
          ]}
          data={buttons}
          isLoading={isLoading}
          isError={isError}
          keyExtractor={(btn) => String(btn.id)}
          renderRow={(btn) => (
            <>
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
                {/* See app/permissions/page.tsx: inline siblings concatenate
                    their labels in the accessibility tree and on copy. */}
                <div className="flex justify-end gap-3">
                  <RequirePermission permissions="menu.update">
                    <button
                      onClick={() => openEdit(btn)}
                      className="text-[hsl(var(--color-accent))] hover:text-[hsl(var(--color-accent-hover))] text-sm"
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
                </div>
              </td>
            </>
          )}
          emptyMessage={t("menu_buttons.no_buttons")}
          page={page}
          totalPages={totalPages}
          totalCount={data?.count}
          onPageChange={setPage}
        />
      </div>

      <Modal
        isOpen={isCreateModalOpen || editingButton !== null}
        onClose={() => { setIsCreateModalOpen(false); setEditingButton(null); }}
        title={editingButton ? t("menu_buttons.edit") : t("menu_buttons.create")}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor={nameId} className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("menu_buttons.name")}</label>
            <input
              id={nameId}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              className="w-full bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
            />
          </div>
          <div>
            <label htmlFor={codeId} className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("menu_buttons.code")}</label>
            <input
              id={codeId}
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              required
              placeholder={t("menu_buttons.code_placeholder")}
              className="w-full bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
            />
          </div>
          <div>
            <label htmlFor={permissionId} className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("menu_buttons.permission")}</label>
            <input
              id={permissionId}
              value={form.permission}
              onChange={(e) => setForm({ ...form, permission: e.target.value })}
              required
              placeholder={t("menu_buttons.permission_placeholder")}
              className="w-full bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
            />
          </div>
          {!editingButton && (
            <div>
              <label htmlFor={bindMenuId} className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("menu_buttons.bind_menu")}</label>
              <select
                id={bindMenuId}
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
            <label htmlFor={orderId} className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("menus.order")}</label>
            <input
              id={orderId}
              type="number"
              value={form.order}
              onChange={(e) => setForm({ ...form, order: Number(e.target.value) })}
              className="w-full bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id={isActiveId}
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            />
            <label htmlFor={isActiveId} className="text-sm text-[hsl(var(--color-ink))]">{t("menus.active")}</label>
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
