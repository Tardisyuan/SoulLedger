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
import { Modal, ConfirmDialog } from "@/src/components/ui/Modal";
import { IconPicker } from "@/src/components/ui/IconPicker";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { DataTable } from "@/components/ui/data-table";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button, buttonVariants } from "@/src/components/ui/Button";
import { Badge } from "@/src/components/ui/Badge";
import { SelectField, TextField } from "@/src/components/ui/Field";

type LucideIconName = keyof typeof LucideIcons;

const ROLE_OPTIONS = ["ADMIN", "JUDGE", "GUARDIAN", "VIEWER"];

/**
 * The five visibility gates, as i18n keys. Five near-identical `<tr>` blocks
 * became one loop when the row height and the header spelling were unified —
 * the copy is the only thing that differed between them, and now that is the
 * only thing written down per row.
 */
const GATE_ROWS = [
  { name: "menus.active", effect: "menus.gate_is_active_effect", nonadmin: "menus.gate_is_active_nonadmin" },
  { name: "menus.visible_label", effect: "menus.gate_visible_effect", nonadmin: "menus.gate_visible_nonadmin" },
  { name: "menus.permission_field", effect: "menus.gate_permission_effect", nonadmin: "menus.gate_permission_nonadmin" },
  { name: "menus.roles", effect: "menus.gate_roles_effect", nonadmin: "menus.gate_roles_nonadmin" },
  { name: "menus.type", effect: "menus.gate_menu_type_effect", nonadmin: "menus.gate_menu_type_nonadmin" },
] as const;
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
  // Recycle bin (Stage 4 §4.7) — same "extend locally" move as above.
  // MenuSerializer now includes these three (backend/apps/menus/serializers.py).
  is_deleted?: boolean;
  deleted_at?: string | null;
  delete_reason?: string;
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
      {/* Five-gate reference: an entry can be invisible for five unrelated
          reasons (is_active, visible, permission, roles, menu_type), none
          of them named anywhere in the UI. This names them. Left open to
          anyone who can reach this page — menu.read is granted to every
          role — since the ADMIN-only write gate (menu.manage) doesn't mean
          only ADMIN benefits from knowing why an entry is missing.

          WHY THIS STAYS A HAND-WRITTEN <table> AND DOES NOT BECOME A DataTable.
          DataTable's contract is `data: T[]` + `keyExtractor` + `renderRow`,
          with loading / error / empty / sort / pagination states attached. None
          of those has a referent here: there is no request, no page, no row
          identity and no possible empty state — the five gates are five facts
          about the schema, spelled out in copy. Passing it a literal array of
          five i18n keys would invent a data source in order to satisfy a
          signature, and would hang a `<caption class="sr-only">`, a bordered
          card and a pagination-capable footer off a paragraph.

          What WAS wrong is the part that is fixed below. The brief counted
          three header spellings across the app's hand-written tables; this one
          was the "no background at all" variant, with `text-ink-subtle` heads
          and a `py-1.5` row height on nobody's ladder. Its `<thead>` is now
          character-for-character DataTable's own — `bg-surface-2
          text-ink-muted`, `px-4 py-3 font-medium`, hairline rule under the row
          — so the two tables on this page read as one table style even though
          only one of them is the component. */}
      <details className="mb-4 bg-surface-2 border border-hairline">
        <summary className="cursor-pointer px-4 py-3 text-03 font-medium text-ink">
          {t("menus.gates_title")}
        </summary>
        <div className="px-4 pb-4">
          <p className="text-03 text-ink-muted mb-3">{t("menus.gates_intro")}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-03 border-collapse">
              <thead className="bg-surface-2 text-ink-muted">
                <tr className="text-left border-b border-hairline">
                  <th className="px-4 py-3 font-medium">{t("menus.gate_col_name")}</th>
                  <th className="px-4 py-3 font-medium">{t("menus.gate_col_effect")}</th>
                  <th className="px-4 py-3 font-medium">{t("menus.gate_col_nonadmin")}</th>
                </tr>
              </thead>
              <tbody className="text-ink-muted">
                {GATE_ROWS.map((row) => (
                  <tr key={row.name} className="border-b border-hairline last:border-0">
                    <td className="px-4 py-3 font-medium text-ink whitespace-nowrap">{t(row.name)}</td>
                    <td className="px-4 py-3">{t(row.effect)}</td>
                    <td className="px-4 py-3">{t(row.nonadmin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-02 text-ink-subtle mt-2">{t("menus.gates_footnote")}</p>
        </div>
      </details>

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
        renderRow={(menu) => {
          const MenuIcon = menu.icon
            ? (LucideIcons[menu.icon as LucideIconName] as unknown as LucideIcon)
            : null;
          // Deleted-row state (Stage 4 §4.7): ink-subtle text, strikethrough
          // on the name only, plus a "已删除" badge — never hidden data,
          // just de-emphasized. Only reachable when showDeleted is on,
          // since the backend only returns these rows with ?show_deleted=true.
          const isDeleted = Boolean(menu.is_deleted);
          return (
            <>
              <td className={`px-4 py-3 ${isDeleted ? "text-ink-subtle" : ""}`}>
                <div className="flex items-center gap-2">
                  {MenuIcon ? (
                    <MenuIcon className="w-4 h-4 text-[hsl(var(--color-accent-ink))]" />
                  ) : null}
                  <span className={`font-medium ${isDeleted ? "line-through text-ink-subtle" : "text-ink"}`}>
                    {menu.name}
                  </span>
                  {isDeleted && (
                    <Badge className="shrink-0 text-ink-subtle">
                      {t("menus.deleted_badge")}
                    </Badge>
                  )}
                </div>
              </td>
              {/* Paths are identifiers — the 02 step, and monospaced. */}
              <td className="px-4 py-3 text-02 font-mono text-ink-muted">{menu.path}</td>
              <td className="px-4 py-3">
                <Badge>{t(`menus.menu_types.${menu.menu_type ?? "MENU"}`)}</Badge>
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {menu.roles.map((role) => (
                    /* `pill`, and this is the one place on the page that
                       earns it: a role IS an identity token, which is the
                       documented meaning of a round badge here. */
                    <Badge key={role} tone="accent" shape="pill">
                      {t(`users.roles.${role}`)}
                    </Badge>
                  ))}
                </div>
              </td>
              <td className="px-4 py-3 text-ink-muted">{menu.order}</td>
              <td className="px-4 py-3">
                <div className="flex flex-col items-start gap-1">
                  {/* is_active and visible are gates being in force or not —
                      a system state, so the tone table applies here. */}
                  <Badge tone={menu.is_active ? "success" : "neutral"}>
                    {menu.is_active ? t("menus.active") : t("menus.inactive")}
                  </Badge>
                  <Badge className={menu.visible !== false ? undefined : "text-ink-subtle"}>
                    {menu.visible !== false ? t("menus.shown_label") : t("menus.hidden_label")}
                  </Badge>
                </div>
              </td>
              <td className="px-4 py-3 text-right">
                {/* See app/permissions/page.tsx: inline siblings concatenate
                    their labels in the accessibility tree and on copy. */}
                <div className="flex justify-end gap-2">
                  {!isDeleted && (
                    <>
                      <RequirePermission permissions="menu.update">
                        <Button type="button" size="sm" onClick={() => openEdit(menu)}>
                          {t("menus.edit")}
                        </Button>
                      </RequirePermission>
                      <RequirePermission permissions="menu.delete">
                        <Button type="button" size="sm" variant="danger" onClick={() => setPendingDelete(menu)}>
                          {t("menus.delete")}
                        </Button>
                      </RequirePermission>
                    </>
                  )}
                  {isDeleted && (
                    <span className="text-02 text-ink-subtle">
                      {t("recycle_bin.manage_from_bin")}
                    </span>
                  )}
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

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isCreateModalOpen || editingMenu !== null}
        onClose={() => { setIsCreateModalOpen(false); setEditingMenu(null); }}
        title={editingMenu ? t("menus.edit") : t("menus.create")}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Every control in this form was a hand-written `label` + `input`
              pair carrying the same class string, spelled slightly differently
              each time. They are `TextField` / `SelectField` now — which also
              supplies the wiring the pairs never had: `aria-required` on the
              control, and `aria-describedby` pointing at the hint below it. */}
          <div className="grid grid-cols-2 gap-4">
            <SelectField
              id={menuTypeId}
              label={t("menus.type")}
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
              description={form.menu_type === "DIRECTORY" ? t("menus.menu_type_directory_hint") : undefined}
              options={MENU_TYPE_OPTIONS.map((mt) => ({ value: mt, label: t(`menus.menu_types.${mt}`) }))}
            />
            <SelectField
              id={parentSelectId}
              label={t("menus.parent_label")}
              value={form.parent ?? ""}
              onChange={(e) => setForm({ ...form, parent: e.target.value ? Number(e.target.value) : null })}
              options={[
                { value: "", label: t("menus.parent_none") },
                ...parentOptions.map((m) => ({ value: String(m.id), label: m.name })),
              ]}
            />
          </div>
          <TextField
            id={nameId}
            label={t("menus.name")}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          {form.menu_type !== "DIRECTORY" && (
            <TextField
              id={pathId}
              label={t("menus.path")}
              value={form.path}
              onChange={(e) => setForm({ ...form, path: e.target.value })}
              required
            />
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              {/* IconPicker (src/components/ui/IconPicker.tsx) renders its own trigger button
                  and is out of scope for this pass, so this label can't be wired via htmlFor —
                  it stays a visual label only. Its typography is `Field`'s label
                  spelling (`text-01 uppercase text-ink-subtle`) so it does not
                  read as a different kind of label from the ones beside it. */}
              <span id={iconLabelId} className="text-01 uppercase text-ink-subtle">
                {t("menus.icon")} <span className="text-[hsl(var(--color-status-error))]">*</span>
              </span>
              <IconPicker
                value={form.icon}
                onChange={(icon) => { setForm({ ...form, icon }); setIconError(false); }}
              />
              {iconError ? (
                <p className="text-02 text-[hsl(var(--color-status-error))]">{t("menus.icon_missing_error")}</p>
              ) : (
                <p className="text-02 text-ink-tertiary">{t("menus.icon_required_hint")}</p>
              )}
              {iconCollision && (
                <p className="text-02 text-[hsl(var(--color-status-warning))]">
                  {t("menus.icon_collision_warning", { name: iconCollision.name })}
                </p>
              )}
            </div>
            <TextField
              id={orderId}
              label={t("menus.order")}
              type="number"
              value={form.order}
              onChange={(e) => setForm({ ...form, order: Number(e.target.value) })}
            />
          </div>
          {form.menu_type !== "DIRECTORY" && (
            <TextField
              id={componentId}
              label={t("menus.component")}
              value={form.component}
              onChange={(e) => setForm({ ...form, component: e.target.value })}
              placeholder={t("menus.component_placeholder")}
            />
          )}
          {form.menu_type !== "DIRECTORY" && (
            <div className="flex flex-col gap-1">
              <TextField
                id={permissionId}
                label={t("menus.permission_field")}
                value={form.permission}
                onChange={(e) => setForm({ ...form, permission: e.target.value })}
                placeholder={t("menus.permission_codename_placeholder")}
                /* The derivation note is help text, and `description` is where
                   help text goes — it gets an id and lands in the control's
                   `aria-describedby`, which the loose `<p>` below it never did. */
                description={
                  !form.permission.trim()
                    ? derivedCodename
                      ? t("menus.permission_derived_as", { codename: derivedCodename })
                      : t("menus.permission_derived_none")
                    : undefined
                }
              />
              {/* Still a sibling and not `error`: a codename that resolves to
                  nothing is a warning — the form submits either way, and a red
                  field would claim a rejection that is not going to happen. */}
              {effectiveCodename && codenameIsReal === false && (
                <p className="text-02 text-[hsl(var(--color-status-warning))]">
                  {t("menus.permission_mismatch_warning", { codename: effectiveCodename })}
                </p>
              )}
            </div>
          )}
          <div className="flex flex-col gap-1">
            <span id={rolesLabelId} className="text-01 uppercase text-ink-subtle">{t("menus.roles")}</span>
            <div role="group" aria-labelledby={rolesLabelId} className="flex flex-wrap gap-2">
              {ROLE_OPTIONS.map((role) => (
                /* A pressed toggle is the accent fill, which is exactly
                   `Button`'s primary — including the `text-black` its contrast
                   note derives (9.82:1; `text-white` here would have been
                   2.14:1). Unpressed is the default secondary. */
                <Button
                  key={role}
                  type="button"
                  size="sm"
                  variant={form.roles.includes(role) ? "primary" : "secondary"}
                  aria-pressed={form.roles.includes(role)}
                  onClick={() => toggleRole(role)}
                >
                  {t(`users.roles.${role}`)}
                </Button>
              ))}
            </div>
            <p className="text-02 text-ink-tertiary">{t("menus.roles_empty_hint")}</p>
          </div>
          <div className="flex flex-col gap-1">
            {isAdmin ? (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id={isActiveId}
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                />
                <label htmlFor={isActiveId} className="text-03 text-ink">{t("menus.active")}</label>
              </div>
            ) : (
              // Per design review: no greyed-out checkbox for a control the
              // viewer can never use — a disabled control advertises a
              // capability that's permanently out of reach. Plain text instead.
              <div className="flex items-center gap-2 text-03">
                <span className="text-ink-muted">{t("menus.active")}:</span>
                <span className={form.is_active ? "text-[hsl(var(--color-status-success))]" : "text-ink-subtle"}>
                  {form.is_active ? t("menus.active") : t("menus.inactive")}
                </span>
              </div>
            )}
            <p className="text-02 text-ink-tertiary">
              {isAdmin ? t("menus.active_hint") : t("menus.active_readonly_note")}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id={visibleId}
                checked={form.visible}
                onChange={(e) => setForm({ ...form, visible: e.target.checked })}
              />
              <label htmlFor={visibleId} className="text-03 text-ink">{t("menus.visible_label")}</label>
            </div>
            <p className="text-02 text-ink-tertiary">{t("menus.visible_hint")}</p>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => { setIsCreateModalOpen(false); setEditingMenu(null); }}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary">
              {editingMenu ? t("menus.save") : t("menus.create")}
            </Button>
          </div>
        </form>
      </Modal>

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
