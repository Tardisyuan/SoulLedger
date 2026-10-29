"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { menusApi, permApi, PAGE_SIZE, type Permission } from "@soulledger/core/api";
import { menuKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { useHall } from "@/src/components/plaque/useHall";
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
import { FilterChipToggle } from "@/src/components/ui/FilterChip";
import { flattenTree } from "@/src/components/ui/TreeRow";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";

export default function MenusPage() {
  // 页级门(rbac-web L-1):menus/ 列表要 menu.read。
  return (
    <RequirePermission permissions="menu.read" fallback={<PermissionDenied permission="menu.read" />}>
      <MenusPageContent />
    </RequirePermission>
  );
}

function MenusPageContent() {
  const { t } = useI18n();
  usePlaque({ hall: useHall(t("plaque.office.rules")) });
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  // Menus live under two cache roots (see `menuKeys` for why), and the sidebar's
  // is the one nobody was invalidating: `staleTime` there is five minutes, and
  // `AppLayout` never unmounts, so an edit made here stayed invisible in the
  // sidebar, the breadcrumbs and the `MenuGloss` titles until it expired.
  const invalidateMenus = () =>
    menuKeys.invalidateAll.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));

  const [page, setPage] = useState(1);
  // Recycle bin (Stage 4 §4.7): absent by default, opt-in via this toggle —
  // matches the design doc's rule that a deleted row is never shown unless
  // asked for. Mirrors SoulViewSet's ?show_deleted= convention.
  const [showDeleted, setShowDeleted] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<MenuItemFull | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["menus", "all", showDeleted],
    queryFn: async () => {
      // menusApi.all() (GET /menus/list-public/) only ever returns top-level,
      // is_active=True, role-filtered menus — an editor built on that source
      // could never find an inactive or non-top-level row to fix, which
      // defeats the point of an is_active control. The ModelViewSet's list
      // (every page) is what an editor whose job is "say which gate is in force"
      // needs to see.
      return menusApi.listAll(showDeleted ? { show_deleted: "true" } : {});
    },
  });
  const menus = useMemo(() => (data ?? []) as MenuItemFull[], [data]);
  // 树表行(第三类 D 组答复:「套平表会丢掉层级」)。整棵树一次取回,再**按根**分页:
  // 一页 PAGE_SIZE 个根,每个根带着它的全部下级 —— 此前按后端的页拼树,子项落到下一页就脱离了父项
  // (rbac-snowy 2026-10-29)。父级不在列表里的(如回收站里的父项未显示)仍当根画。
  const roots = useMemo(() => {
    const groups: { item: MenuItemFull; depth: number }[][] = [];
    for (const row of flattenTree(menus, (m) => m.id, (m) => m.parent)) {
      if (row.depth === 0 || groups.length === 0) groups.push([]);
      groups[groups.length - 1].push(row);
    }
    return groups;
  }, [menus]);
  const totalPages = Math.ceil(roots.length / PAGE_SIZE);
  const treeRows = useMemo(() => roots.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).flat(), [roots, page]);

  // GET /perm/permissions/ — used only to check whether a codename (typed or
  // derived) actually exists, so the editor can flag a guess that won't
  // resolve. ADMIN or a holder of menu.manage / system.settings
  // (views.py:CanReadPermissionCatalogue); on a 403 `permissionsLoaded` stays
  // false and the editor simply skips the check.
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
    onSuccess: () => invalidateMenus(),
    onError: () => showToast(t("menus.create_error") || "Failed to create menu", "error"),
  });

  // The edit path had no mutation at all: `await menusApi.update(...)` inline,
  // so a failure was an unhandled promise rejection — no toast, no cache
  // invalidation, and the modal sitting open with nothing said. Create had a
  // mutation and edit did not, on the same form, behind the same button.
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<MenuItemFull> }) =>
      menusApi.update(id, data),
    onSuccess: () => {
      invalidateMenus();
      setEditingMenu(null);
    },
    onError: () => showToast(t("menus.update_error"), "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => menusApi.delete(id),
    onSuccess: () => {
      invalidateMenus();
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
    // `mutate`, not `await mutateAsync`. Both mutations report failure through
    // their own `onError`; awaiting the async form here re-raised the same
    // rejection into this handler, where nothing caught it — so a failed
    // create toasted AND logged an unhandled rejection.
    if (editingMenu) {
      updateMutation.mutate({ id: editingMenu.id, data: form });
    } else {
      createMutation.mutate(form, {
        onSuccess: () => setIsCreateModalOpen(false),
      });
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
          <RequirePermission permissions="menu.manage">
            <Button type="button" variant="secondary" onClick={openCreate}>
              + {t("menus.create")}
            </Button>
          </RequirePermission>
        </div>
      }
      filters={
        /* Recycle bin (Stage 4 §4.7): absent by default — a deleted row only
           ever renders when this is on. It is a filter over the list, so it
           lives in the filter slot rather than floating above the table. */
        <FilterChipToggle pressed={showDeleted} onPressedChange={(on) => { setShowDeleted(on); setPage(1); }}>
          {t("menus.show_deleted")}
        </FilterChipToggle>
      }
    >
      <MenuGatesReference />

      {/* No `pagination` slot — DataTable renders its own <Pagination>
          (components/ui/data-table.tsx:288) from the four props at the end. */}
      <DataTable<{ item: MenuItemFull; depth: number }>
        caption={t("menus.title")}
        columns={[
          { key: "name", header: t("menus.name") },
          { key: "path", header: t("menus.path") },
          { key: "type", header: t("menus.type") },
          { key: "roles", header: t("menus.roles") },
          { key: "order", header: t("menus.order"), align: "right" },
          { key: "status", header: t("menus.status") },
          { key: "action", header: t("menus.action"), align: "right", srOnlyHeader: true },
        ]}
        data={treeRows}
        isLoading={isLoading}
        isError={Boolean(error)}
        keyExtractor={({ item }) => String(item.id)}
        renderRow={({ item, depth }) => (
          <MenuRowCells menu={item} depth={depth} onEdit={openEdit} onDelete={setPendingDelete} />
        )}
        emptyMessage={t("menus.no_menus")}
        page={page}
        totalPages={totalPages}
        totalCount={roots.length}
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
        // Only create had a pending state; the edit branch could be submitted
        // as many times as the operator clicked.
        isSubmitting={createMutation.isPending || updateMutation.isPending}
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
        variant="warning"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
      />
    </PageShell>
  );
}
