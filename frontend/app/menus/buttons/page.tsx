"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { menuButtonsApi, menusApi, permApi, PAGE_SIZE, type MenuButton, type MenuItem, type PaginatedResponse, type Permission } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { Modal } from "@/src/components/ui/Modal";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { DataTable } from "@/components/ui/data-table";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { Badge } from "@/src/components/ui/Badge";
import { SelectField, TextField, fieldControl } from "@/src/components/ui/Field";
import { cn } from "@/lib/utils";

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

  // GET /perm/permissions/ — a MenuButton's `permission` is required and, unlike
  // Menu.permission, is already live: MenuTreeSerializer/MenuSerializer.get_buttons()
  // filters buttons through user_has_permission(user, button.permission) for every
  // non-ADMIN request. A codename that doesn't exist doesn't error — it just makes
  // user_has_permission return False for everyone, silently hiding the button from
  // every non-ADMIN role. Checked here so that failure mode is visible at edit time.
  const { data: allPermissions = [], isSuccess: permissionsLoaded } = useQuery<Permission[]>({
    queryKey: ["permissions-for-menu-button-codename-check"],
    queryFn: async () => (await permApi.list()).data,
  });
  const realCodenames = useMemo(
    () => new Set(allPermissions.map((p) => p.codename)),
    [allPermissions]
  );

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
    /* `page` (1200px), up from `max-w-5xl` (1024). */
    <PageShell
      variant="page"
      title={t("menu_buttons.title")}
      /* MenuButton only carries one of the menu editor's five visibility gates
         (is_active) — roles, `visible`, the permission/derivation ambiguity and
         menu_type all live on the parent Menu, not here. That is a standing
         fact about this page, which is what `subtitle` is for; it used to be a
         `text-xs` paragraph floating above the table. */
      subtitle={
        <>
          {t("menu_buttons.gates_note")}{" "}
          <Link href="/menus" className="text-[hsl(var(--color-accent-ink))] hover:underline">
            {t("menus.title")}
          </Link>
        </>
      }
      actions={
        <RequirePermission permissions="menu.manage">
          <Button type="button" variant="primary" onClick={openCreate}>
            + {t("menu_buttons.create")}
          </Button>
        </RequirePermission>
      }
      filters={
        /* This select was sitting in the title bar next to the create button,
           where it read as a page action rather than as what it is — the one
           filter this list has. It belongs in the sticky slot with every other
           page's filters, on the shared `fieldControl` skin. */
        <select
          id={menuFilterId}
          value={selectedMenuId ?? ""}
          onChange={(e) => {
            setSelectedMenuId(e.target.value ? Number(e.target.value) : undefined);
            setPage(1);
          }}
          aria-label={t("menu_buttons.filter_by_menu") === "menu_buttons.filter_by_menu" ? "Filter by menu" : t("menu_buttons.filter_by_menu")}
          className={cn(fieldControl({ size: "md" }), "w-auto")}
        >
          <option value="">{t("menu_buttons.all_menus")}</option>
          {menus.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      }
    >
      {/* No `pagination` slot — DataTable renders its own <Pagination>
          (components/ui/data-table.tsx:288) from the four props at the end. */}
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
            {/* Codenames are identifiers, which is what the 02 step is for. */}
            <td className="px-4 py-3 text-02 font-mono text-[hsl(var(--color-ink-muted))]">{btn.code}</td>
            <td className="px-4 py-3 text-02 font-mono text-[hsl(var(--color-ink-muted))]">{btn.permission}</td>
            <td className="px-4 py-3 text-[hsl(var(--color-ink-muted))]">{btn.order}</td>
            <td className="px-4 py-3">
              {/* is_active IS a system state — the gate is either in force or
                  it is not — so this one legitimately takes a Badge tone
                  rather than a domain palette. */}
              <Badge tone={btn.is_active ? "success" : "neutral"}>
                {btn.is_active ? t("menus.active") : t("menus.inactive")}
              </Badge>
            </td>
            <td className="px-4 py-3 text-right">
              {/* See app/permissions/page.tsx: inline siblings concatenate
                  their labels in the accessibility tree and on copy. */}
              <div className="flex justify-end gap-2">
                <RequirePermission permissions="menu.manage">
                  <Button type="button" size="sm" onClick={() => openEdit(btn)}>
                    {t("menus.edit")}
                  </Button>
                </RequirePermission>
                <RequirePermission permissions="menu.manage">
                  <Button type="button" size="sm" variant="danger" onClick={() => deleteMutation.mutate(btn.id)}>
                    {t("menus.delete")}
                  </Button>
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

      <Modal
        isOpen={isCreateModalOpen || editingButton !== null}
        onClose={() => { setIsCreateModalOpen(false); setEditingButton(null); }}
        title={editingButton ? t("menu_buttons.edit") : t("menu_buttons.create")}
      >
        {/* Every control below was a hand-written `label` + `input` pair with
            the same 42-signature class string this pass exists to remove; they
            are `TextField` / `SelectField` now, which also brings the wiring
            those pairs never had — `aria-required` on the control, and
            `aria-describedby` pointing at the help text. */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <TextField
            id={nameId}
            label={t("menu_buttons.name")}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <TextField
            id={codeId}
            label={t("menu_buttons.code")}
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            required
            placeholder={t("menu_buttons.code_placeholder")}
          />
          <div className="flex flex-col gap-1">
            <TextField
              id={permissionId}
              label={t("menu_buttons.permission")}
              value={form.permission}
              onChange={(e) => setForm({ ...form, permission: e.target.value })}
              required
              placeholder={t("menu_buttons.permission_placeholder")}
            />
            {/* Not `error`: an unknown codename is a warning, not a rejection —
                the form still submits, and a red field would say otherwise. */}
            {permissionsLoaded && form.permission.trim() && !realCodenames.has(form.permission.trim()) && (
              <p className="text-02 text-[hsl(var(--color-status-warning))]">
                {t("menu_buttons.permission_mismatch_warning", { codename: form.permission.trim() })}
              </p>
            )}
          </div>
          {!editingButton && (
            <SelectField
              id={bindMenuId}
              label={t("menu_buttons.bind_menu")}
              value={form.menu ?? ""}
              onChange={(e) => setForm({ ...form, menu: e.target.value ? Number(e.target.value) : null })}
              required
              options={[
                { value: "", label: t("menu_buttons.select_menu") },
                ...menus.map((m) => ({ value: String(m.id), label: m.name })),
              ]}
            />
          )}
          <TextField
            id={orderId}
            label={t("menus.order")}
            type="number"
            value={form.order}
            onChange={(e) => setForm({ ...form, order: Number(e.target.value) })}
          />
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id={isActiveId}
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            />
            <label htmlFor={isActiveId} className="text-03 text-[hsl(var(--color-ink))]">{t("menus.active")}</label>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => { setIsCreateModalOpen(false); setEditingButton(null); }}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary">
              {editingButton ? t("menus.save") : t("menu_buttons.create")}
            </Button>
          </div>
        </form>
      </Modal>
    </PageShell>
  );
}
