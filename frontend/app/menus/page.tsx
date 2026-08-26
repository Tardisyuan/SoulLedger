"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { menusApi, permApi, PAGE_SIZE, type Permission } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { ConfirmDialog } from "@/src/components/ui/Modal";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { DataTable } from "@/components/ui/data-table";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button, buttonVariants } from "@/src/components/ui/Button";
import type { MenuFormState, MenuItemFull, MenuTypeOption } from "@/src/components/menus/menuTypes";
import { MenuGatesReference } from "@/src/components/menus/MenuGatesReference";
import { MenuRowCells } from "@/src/components/menus/MenuRowCells";
import { MenuFormModal } from "@/src/components/menus/MenuFormModal";

export default function MenusPage() {
  const { t } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  // Recycle bin (Stage 4 §4.7): absent by default, opt-in via this toggle —
  // matches the design doc's rule that a deleted row is never shown unless
  // asked for. Mirrors SoulViewSet's ?show_deleted= convention.
  const [showDeleted, setShowDeleted] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<MenuItemFull | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["menus", page, showDeleted],
    queryFn: async () => {
      // menusApi.all() (GET /menus/list-public/) only ever returns top-level,
      // is_active=True, role-filtered menus — an editor built on that source
      // could never find an inactive or non-top-level row to fix, which
      // defeats the point of an is_active control. .list() hits the
      // ModelViewSet directly: ADMIN's get_queryset() returns Menu.objects.all(),
      // which is what an editor whose job is "say which gate is in force"
      // needs to see.
      const res = await menusApi.list({
        page: String(page),
        ...(showDeleted ? { show_deleted: "true" } : {}),
      });
      return res.data;
    },
  });
  const menus = (data?.results ?? []) as MenuItemFull[];
  const totalPages = data ? Math.ceil(data.count / PAGE_SIZE) : 0;

  // GET /perm/permissions/ — used only to check whether a codename (typed or
  // derived) actually exists, so the editor can flag a guess that won't
  // resolve. Available to any authenticated user (views.py:list_permissions
  // requires only IsAuthenticated), not just ADMIN.
  const { data: allPermissions = [], isSuccess: permissionsLoaded } = useQuery<Permission[]>({
    queryKey: ["permissions-for-menu-codename-check"],
    queryFn: async () => (await permApi.list()).data,
  });
  const realCodenames = useMemo(
    () => new Set(allPermissions.map((p) => p.codename)),
    [allPermissions]
  );

  const createMutation = useMutation({
    mutationFn: (data: Partial<MenuItemFull>) => menusApi.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["menus"] }),
    onError: () => showToast(t("menus.create_error") || "Failed to create menu", "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => menusApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["menus"] });
      setPendingDelete(null);
    },
    onError: () => {
      showToast(t("menus.delete_error") || "Failed to delete menu", "error");
      setPendingDelete(null);
    },
  });

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingMenu, setEditingMenu] = useState<MenuItemFull | null>(null);
  const [iconError, setIconError] = useState(false);
  const [form, setForm] = useState<MenuFormState>({
    name: "",
    path: "",
    icon: "",
    order: 0,
    component: "",
    roles: [] as string[],
    is_active: true,
    visible: true,
    permission: "",
    menu_type: "MENU" as MenuTypeOption,
    parent: null as number | null,
  });

  const openCreate = () => {
    setForm({
      name: "", path: "", icon: "", order: 0, component: "",
      roles: [], is_active: true, visible: true, permission: "",
      menu_type: "MENU", parent: null,
    });
    setIconError(false);
    setIsCreateModalOpen(true);
  };

  const openEdit = (menu: MenuItemFull) => {
    setForm({
      name: menu.name,
      path: menu.path,
      icon: menu.icon || "",
      order: menu.order,
      component: menu.component || "",
      roles: menu.roles,
      is_active: menu.is_active,
      visible: menu.visible ?? true,
      permission: menu.permission ?? "",
      menu_type: menu.menu_type ?? "MENU",
      parent: menu.parent,
    });
    setIconError(false);
    setEditingMenu(menu);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Icon is required (see icon_required_hint below for why) — the picker
    // isn't a native input, so this has to be checked by hand rather than
    // relying on the browser's own required-field validation.
    if (!form.icon) {
      setIconError(true);
      return;
    }
    if (editingMenu) {
      await menusApi.update(editingMenu.id, form);
      queryClient.invalidateQueries({ queryKey: ["menus"] });
      setEditingMenu(null);
    } else {
      await createMutation.mutateAsync(form);
      setIsCreateModalOpen(false);
    }
  };

  return (
    /* `page` (1200px), up from `max-w-5xl` (1024). Seven columns, one of them a
       wrapping list of role chips. */
    <PageShell
      variant="page"
      title={
        <>
          {t("menus.title")}
          <MenuGloss path="/menus" />
        </>
      }
      actions={
        <div className="flex items-center gap-3">
          <Link href="/menus/buttons" className={buttonVariants({ variant: "secondary", size: "md" })}>
            {t("menu_buttons.title")}
          </Link>
          <RequirePermission permissions="menu.create">
            <Button type="button" variant="primary" onClick={openCreate}>
              + {t("menus.create")}
            </Button>
          </RequirePermission>
        </div>
      }
      filters={
        /* Recycle bin (Stage 4 §4.7): absent by default — a deleted row only
           ever renders when this is on. It is a filter over the list, so it
           lives in the filter slot rather than floating above the table. */
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="menus-show-deleted"
            checked={showDeleted}
            onChange={(e) => setShowDeleted(e.target.checked)}
          />
          <label htmlFor="menus-show-deleted" className="text-03 text-ink-muted">
            {t("menus.show_deleted")}
          </label>
        </div>
      }
    >
      <MenuGatesReference />

      {/* No `pagination` slot — DataTable renders its own <Pagination>
          (components/ui/data-table.tsx:288) from the four props at the end. */}
      <DataTable<MenuItemFull>
        caption={t("menus.title")}
        columns={[
          { key: "name", header: t("menus.name") },
          { key: "path", header: t("menus.path") },
          { key: "type", header: t("menus.type") },
          { key: "roles", header: t("menus.roles") },
          { key: "order", header: t("menus.order") },
          { key: "status", header: t("menus.status") },
          { key: "action", header: t("menus.action"), align: "right" },
        ]}
        data={menus}
        isLoading={isLoading}
        isError={Boolean(error)}
        keyExtractor={(menu) => String(menu.id)}
        renderRow={(menu) => (
          <MenuRowCells menu={menu} onEdit={openEdit} onDelete={setPendingDelete} />
        )}
        emptyMessage={t("menus.no_menus")}
        page={page}
        totalPages={totalPages}
        totalCount={data?.count}
        onPageChange={setPage}
      />

      {/* Create/Edit Modal */}
      <MenuFormModal
        isOpen={isCreateModalOpen || editingMenu !== null}
        onClose={() => { setIsCreateModalOpen(false); setEditingMenu(null); }}
        editingMenu={editingMenu}
        menus={menus}
        realCodenames={realCodenames}
        permissionsLoaded={permissionsLoaded}
        form={form}
        setForm={setForm}
        iconError={iconError}
        setIconError={setIconError}
        onSubmit={handleSubmit}
      />

      {/* Delete confirmation (Stage 4 §4.7): the verb is "移至回收站"
          (move to recycle bin), never "删除" — it names what the backend
          actually does (soft delete), and states the retention window
          because reversibility that expires isn't reversibility unless the
          user knows the window. */}
      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title={t("menus.delete_confirm_title")}
        message={t("menus.delete_confirm_message", {
          name: pendingDelete?.name ?? "",
          days: "30",
        })}
        confirmText={t("menus.delete_confirm_action")}
        cancelText={t("common.cancel")}
        variant="danger"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
      />
    </PageShell>
  );
}
