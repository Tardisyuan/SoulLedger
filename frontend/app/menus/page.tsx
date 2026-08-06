"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { menusApi, permApi, PAGE_SIZE, type MenuItem, type Permission } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { Modal } from "@/src/components/ui/Modal";
import { IconPicker } from "@/src/components/ui/IconPicker";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { DataTable } from "@/components/ui/data-table";
import { MenuGloss } from "@/src/components/layout/MenuGloss";

type LucideIconName = keyof typeof LucideIcons;

const ROLE_OPTIONS = ["ADMIN", "JUDGE", "GUARDIAN", "VIEWER"];
const MENU_TYPE_OPTIONS = ["DIRECTORY", "MENU", "BUTTON"] as const;
type MenuTypeOption = (typeof MENU_TYPE_OPTIONS)[number];

/**
 * MenuItem (lib/api/menus.ts) doesn't carry these three fields yet, even
 * though MenuSerializer / MenuCreateUpdateSerializer both read and accept
 * them (backend/apps/menus/serializers.py). AppLayout.tsx hit the same gap
 * for `visible`/`menu_type` and extended the type locally rather than
 * editing lib/api/menus.ts — same move here, since that file is out of
 * scope for this pass.
 */
type MenuItemFull = MenuItem & {
  menu_type?: MenuTypeOption;
  visible?: boolean;
  permission?: string;
};

/**
 * Mirrors Menu.get_codename()'s derivation exactly (backend/apps/menus/models.py)
 * so the editor shows the same guess the backend would compute if a blank
 * `permission` field were ever resolved: strip slashes, take the first path
 * segment, lowercase it, append ".read". No other transform is applied —
 * the real codename table is the only source of truth for whether it's real.
 */
function deriveCodename(path: string): string | null {
  const trimmed = path.replace(/^\/+|\/+$/g, "");
  if (!trimmed) return null;
  const first = trimmed.split("/")[0];
  if (!first) return null;
  return `${first.toLowerCase()}.read`;
}

/** Every id reachable from `id` by following `parent` links — used to stop a
 * menu from being reparented under its own descendant, which would cycle. */
function collectDescendantIds(id: number, all: MenuItemFull[]): Set<number> {
  const result = new Set<number>();
  const stack: number[] = [id];
  while (stack.length) {
    const current = stack.pop() as number;
    for (const m of all) {
      if (m.parent === current && !result.has(m.id)) {
        result.add(m.id);
        stack.push(m.id);
      }
    }
  }
  return result;
}

export default function MenusPage() {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { isAdmin } = useTenant();
  const queryClient = useQueryClient();

  // Unique prefix so field ids never collide across multiple Modal instances.
  const formId = useId();
  const nameId = `${formId}-name`;
  const pathId = `${formId}-path`;
  const iconLabelId = `${formId}-icon-label`;
  const orderId = `${formId}-order`;
  const componentId = `${formId}-component`;
  const rolesLabelId = `${formId}-roles-label`;
  const isActiveId = `${formId}-is-active`;
  const visibleId = `${formId}-visible`;
  const permissionId = `${formId}-permission`;
  const menuTypeId = `${formId}-menu-type`;
  const parentSelectId = `${formId}-parent`;

  const [page, setPage] = useState(1);

  const { data, isLoading, error } = useQuery({
    queryKey: ["menus", page],
    queryFn: async () => {
      // menusApi.all() (GET /menus/list-public/) only ever returns top-level,
      // is_active=True, role-filtered menus — an editor built on that source
      // could never find an inactive or non-top-level row to fix, which
      // defeats the point of an is_active control. .list() hits the
      // ModelViewSet directly: ADMIN's get_queryset() returns Menu.objects.all(),
      // which is what an editor whose job is "say which gate is in force"
      // needs to see.
      const res = await menusApi.list({ page: String(page) });
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["menus"] }),
    onError: () => showToast(t("menus.delete_error") || "Failed to delete menu", "error"),
  });

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingMenu, setEditingMenu] = useState<MenuItemFull | null>(null);
  const [iconError, setIconError] = useState(false);
  const [form, setForm] = useState({
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

  const toggleRole = (role: string) => {
    setForm((f) => ({
      ...f,
      roles: f.roles.includes(role) ? f.roles.filter((r) => r !== role) : [...f.roles, role],
    }));
  };

  // Non-blocking sibling-icon collision check: same parent, different row,
  // same icon. Compared against `menus`, so it only sees whatever page of
  // the list is currently loaded — a real limit once there are enough menus
  // to paginate, but the audit backing this feature found 13 rows total.
  const iconCollision = useMemo(() => {
    if (!form.icon) return null;
    return (
      menus.find(
        (m) =>
          m.id !== editingMenu?.id &&
          (m.parent ?? null) === (form.parent ?? null) &&
          m.icon === form.icon
      ) ?? null
    );
  }, [menus, form.icon, form.parent, editingMenu]);

  const derivedCodename = useMemo(() => deriveCodename(form.path), [form.path]);
  const effectiveCodename = form.permission.trim() || derivedCodename;
  const codenameIsReal = effectiveCodename && permissionsLoaded ? realCodenames.has(effectiveCodename) : null;

  const descendantIds = useMemo(
    () => (editingMenu ? collectDescendantIds(editingMenu.id, menus) : new Set<number>()),
    [editingMenu, menus]
  );
  const parentOptions = menus.filter(
    (m) => m.id !== editingMenu?.id && !descendantIds.has(m.id)
  );

  return (
    <div className="min-h-screen bg-[hsl(var(--color-canvas))] text-[hsl(var(--color-ink))]">
      {/* Page header */}
      <div className="h-12 flex items-center px-6 gap-4 border-b border-[hsl(var(--color-hairline))]/50">
        <h1 className="text-lg font-bold text-[hsl(var(--color-accent))] flex-1">
          {t("menus.title")}
          <MenuGloss path="/menus" />
        </h1>
        <Link
          href="/menus/buttons"
          className="px-4 py-1.5 bg-[hsl(var(--color-surface-2))] hover:bg-[hsl(var(--color-surface-3))] rounded-md text-sm text-[hsl(var(--color-ink-muted))] transition-colors"
        >
          {t("menu_buttons.title")}
        </Link>
        <RequirePermission permissions="menu.create">
          <button
            onClick={openCreate}
            className="px-4 py-1.5 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] rounded-md text-sm font-medium transition-colors"
          >
            + {t("menus.create")}
          </button>
        </RequirePermission>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* Five-gate reference: an entry can be invisible for five unrelated
            reasons (is_active, visible, permission, roles, menu_type), none
            of them named anywhere in the UI. This names them. Left open to
            anyone who can reach this page — menu.read is granted to every
            role — since the ADMIN-only write gate (menu.manage) doesn't mean
            only ADMIN benefits from knowing why an entry is missing. */}
        <details className="mb-4 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md">
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-[hsl(var(--color-ink))]">
            {t("menus.gates_title")}
          </summary>
          <div className="px-4 pb-4">
            <p className="text-sm text-[hsl(var(--color-ink-muted))] mb-3">{t("menus.gates_intro")}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-left text-[hsl(var(--color-ink-subtle))] border-b border-[hsl(var(--color-hairline))]">
                    <th className="py-1.5 pr-3 font-medium">{t("menus.gate_col_name")}</th>
                    <th className="py-1.5 pr-3 font-medium">{t("menus.gate_col_effect")}</th>
                    <th className="py-1.5 font-medium">{t("menus.gate_col_nonadmin")}</th>
                  </tr>
                </thead>
                <tbody className="text-[hsl(var(--color-ink-muted))]">
                  <tr className="border-b border-[hsl(var(--color-hairline))]/50">
                    <td className="py-2 pr-3 font-medium text-[hsl(var(--color-ink))] whitespace-nowrap">{t("menus.active")}</td>
                    <td className="py-2 pr-3">{t("menus.gate_is_active_effect")}</td>
                    <td className="py-2">{t("menus.gate_is_active_nonadmin")}</td>
                  </tr>
                  <tr className="border-b border-[hsl(var(--color-hairline))]/50">
                    <td className="py-2 pr-3 font-medium text-[hsl(var(--color-ink))] whitespace-nowrap">{t("menus.visible_label")}</td>
                    <td className="py-2 pr-3">{t("menus.gate_visible_effect")}</td>
                    <td className="py-2">{t("menus.gate_visible_nonadmin")}</td>
                  </tr>
                  <tr className="border-b border-[hsl(var(--color-hairline))]/50">
                    <td className="py-2 pr-3 font-medium text-[hsl(var(--color-ink))] whitespace-nowrap">{t("menus.permission_field")}</td>
                    <td className="py-2 pr-3">{t("menus.gate_permission_effect")}</td>
                    <td className="py-2">{t("menus.gate_permission_nonadmin")}</td>
                  </tr>
                  <tr className="border-b border-[hsl(var(--color-hairline))]/50">
                    <td className="py-2 pr-3 font-medium text-[hsl(var(--color-ink))] whitespace-nowrap">{t("menus.roles")}</td>
                    <td className="py-2 pr-3">{t("menus.gate_roles_effect")}</td>
                    <td className="py-2">{t("menus.gate_roles_nonadmin")}</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-3 font-medium text-[hsl(var(--color-ink))] whitespace-nowrap">{t("menus.type")}</td>
                    <td className="py-2 pr-3">{t("menus.gate_menu_type_effect")}</td>
                    <td className="py-2">{t("menus.gate_menu_type_nonadmin")}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-[hsl(var(--color-ink-subtle))] mt-2">{t("menus.gates_footnote")}</p>
          </div>
        </details>

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
          renderRow={(menu) => {
            const MenuIcon = menu.icon
              ? (LucideIcons[menu.icon as LucideIconName] as unknown as LucideIcon)
              : null;
            return (
              <>
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
                  <span className="px-1.5 py-0.5 bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))] rounded text-xs">
                    {t(`menus.menu_types.${menu.menu_type ?? "MENU"}`)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {menu.roles.map((role) => (
                      <span key={role} className="px-1.5 py-0.5 bg-[hsl(var(--color-accent))]/20 text-[hsl(var(--color-accent))] rounded text-xs">
                        {t(`users.roles.${role}`)}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-[hsl(var(--color-ink-muted))]">{menu.order}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold w-fit ${menu.is_active ? "bg-[hsl(var(--color-status-success)/0.2)] text-[hsl(var(--color-status-success))]" : "bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))]"}`}>
                      {menu.is_active ? t("menus.active") : t("menus.inactive")}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-xs w-fit ${menu.visible !== false ? "bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))]" : "bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-subtle))]"}`}>
                      {menu.visible !== false ? t("menus.shown_label") : t("menus.hidden_label")}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  {/* See app/permissions/page.tsx: inline siblings concatenate
                      their labels in the accessibility tree and on copy. */}
                  <div className="flex justify-end gap-3">
                    <RequirePermission permissions="menu.update">
                      <button
                        onClick={() => openEdit(menu)}
                        className="text-[hsl(var(--color-accent))] hover:text-[hsl(var(--color-accent-hover))] text-sm"
                      >
                        {t("menus.edit")}
                      </button>
                    </RequirePermission>
                    <RequirePermission permissions="menu.delete">
                      <button
                        onClick={() => deleteMutation.mutate(menu.id)}
                        className="text-[hsl(var(--color-status-error))] hover:text-[hsl(var(--color-status-error)/0.8)] text-sm"
                      >
                        {t("menus.delete")}
                      </button>
                    </RequirePermission>
                  </div>
                </td>
              </>
            );
          }}
          emptyMessage={t("menus.no_menus")}
          page={page}
          totalPages={totalPages}
          totalCount={data?.count}
          onPageChange={setPage}
        />
      </div>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isCreateModalOpen || editingMenu !== null}
        onClose={() => { setIsCreateModalOpen(false); setEditingMenu(null); }}
        title={editingMenu ? t("menus.edit") : t("menus.create")}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor={menuTypeId} className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("menus.type")}</label>
              <select
                id={menuTypeId}
                value={form.menu_type}
                onChange={(e) => {
                  const menu_type = e.target.value as MenuTypeOption;
                  setForm((f) => ({
                    ...f,
                    menu_type,
                    // A DIRECTORY is a pure navigation grouping with no page
                    // (backend/apps/menus/models.py's own docstring) — clear
                    // the fields that stop applying rather than leave stale
                    // values sitting behind a hidden input.
                    ...(menu_type === "DIRECTORY" ? { path: "", component: "", permission: "" } : {}),
                  }));
                }}
                className="w-full bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
              >
                {MENU_TYPE_OPTIONS.map((mt) => (
                  <option key={mt} value={mt}>{t(`menus.menu_types.${mt}`)}</option>
                ))}
              </select>
              {form.menu_type === "DIRECTORY" && (
                <p className="text-xs text-[hsl(var(--color-ink-subtle))] mt-1">{t("menus.menu_type_directory_hint")}</p>
              )}
            </div>
            <div>
              <label htmlFor={parentSelectId} className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("menus.parent_label")}</label>
              <select
                id={parentSelectId}
                value={form.parent ?? ""}
                onChange={(e) => setForm({ ...form, parent: e.target.value ? Number(e.target.value) : null })}
                className="w-full bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
              >
                <option value="">{t("menus.parent_none")}</option>
                {parentOptions.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor={nameId} className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("menus.name")}</label>
            <input
              id={nameId}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              className="w-full bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
            />
          </div>
          {form.menu_type !== "DIRECTORY" && (
            <div>
              <label htmlFor={pathId} className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("menus.path")}</label>
              <input
                id={pathId}
                value={form.path}
                onChange={(e) => setForm({ ...form, path: e.target.value })}
                required
                className="w-full bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              {/* IconPicker (src/components/ui/IconPicker.tsx) renders its own trigger button
                  and is out of scope for this pass, so this label can't be wired via htmlFor —
                  it stays a visual label only. */}
              <span id={iconLabelId} className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">
                {t("menus.icon")} <span className="text-[hsl(var(--color-status-error))]">*</span>
              </span>
              <IconPicker
                value={form.icon}
                onChange={(icon) => { setForm({ ...form, icon }); setIconError(false); }}
              />
              {iconError ? (
                <p className="text-xs text-[hsl(var(--color-status-error))] mt-1">{t("menus.icon_missing_error")}</p>
              ) : (
                <p className="text-xs text-[hsl(var(--color-ink-subtle))] mt-1">{t("menus.icon_required_hint")}</p>
              )}
              {iconCollision && (
                <p className="text-xs text-[hsl(var(--color-status-warning))] mt-1">
                  {t("menus.icon_collision_warning", { name: iconCollision.name })}
                </p>
              )}
            </div>
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
          </div>
          {form.menu_type !== "DIRECTORY" && (
            <div>
              <label htmlFor={componentId} className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("menus.component")}</label>
              <input
                id={componentId}
                value={form.component}
                onChange={(e) => setForm({ ...form, component: e.target.value })}
                placeholder={t("menus.component_placeholder")}
                className="w-full bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
              />
            </div>
          )}
          {form.menu_type !== "DIRECTORY" && (
            <div>
              <label htmlFor={permissionId} className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("menus.permission_field")}</label>
              <input
                id={permissionId}
                value={form.permission}
                onChange={(e) => setForm({ ...form, permission: e.target.value })}
                placeholder={t("menus.permission_codename_placeholder")}
                className="w-full bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
              />
              {!form.permission.trim() && (
                <p className="text-xs text-[hsl(var(--color-ink-subtle))] mt-1">
                  {derivedCodename
                    ? t("menus.permission_derived_as", { codename: derivedCodename })
                    : t("menus.permission_derived_none")}
                </p>
              )}
              {effectiveCodename && codenameIsReal === false && (
                <p className="text-xs text-[hsl(var(--color-status-warning))] mt-1">
                  {t("menus.permission_mismatch_warning", { codename: effectiveCodename })}
                </p>
              )}
            </div>
          )}
          <div>
            <span id={rolesLabelId} className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("menus.roles")}</span>
            <div role="group" aria-labelledby={rolesLabelId} className="flex flex-wrap gap-2">
              {ROLE_OPTIONS.map((role) => (
                <button
                  key={role}
                  type="button"
                  aria-pressed={form.roles.includes(role)}
                  onClick={() => toggleRole(role)}
                  className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                    form.roles.includes(role)
                      ? "bg-[hsl(var(--color-accent))] text-black font-medium"
                      : "bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-muted))] border border-hairline hover:border-[hsl(var(--color-accent))]"
                  }`}
                >
                  {t(`users.roles.${role}`)}
                </button>
              ))}
            </div>
            <p className="text-xs text-[hsl(var(--color-ink-subtle))] mt-1">{t("menus.roles_empty_hint")}</p>
          </div>
          <div>
            {isAdmin ? (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id={isActiveId}
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                />
                <label htmlFor={isActiveId} className="text-sm text-[hsl(var(--color-ink))]">{t("menus.active")}</label>
              </div>
            ) : (
              // Per design review: no greyed-out checkbox for a control the
              // viewer can never use — a disabled control advertises a
              // capability that's permanently out of reach. Plain text instead.
              <div className="flex items-center gap-2 text-sm">
                <span className="text-[hsl(var(--color-ink-muted))]">{t("menus.active")}:</span>
                <span className={form.is_active ? "text-[hsl(var(--color-status-success))]" : "text-[hsl(var(--color-ink-subtle))]"}>
                  {form.is_active ? t("menus.active") : t("menus.inactive")}
                </span>
              </div>
            )}
            <p className="text-xs text-[hsl(var(--color-ink-subtle))] mt-1">
              {isAdmin ? t("menus.active_hint") : t("menus.active_readonly_note")}
            </p>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id={visibleId}
                checked={form.visible}
                onChange={(e) => setForm({ ...form, visible: e.target.checked })}
              />
              <label htmlFor={visibleId} className="text-sm text-[hsl(var(--color-ink))]">{t("menus.visible_label")}</label>
            </div>
            <p className="text-xs text-[hsl(var(--color-ink-subtle))] mt-1">{t("menus.visible_hint")}</p>
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
