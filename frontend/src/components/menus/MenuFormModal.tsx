"use client";

import { useId, useMemo } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { Modal } from "@/src/components/ui/Modal";
import { IconPicker } from "@/src/components/ui/IconPicker";
import { Button } from "@/src/components/ui/Button";
import { SelectField, TextField } from "@/src/components/ui/Field";
import {
  collectDescendantIds,
  deriveCodename,
  MENU_TYPE_OPTIONS,
  ROLE_OPTIONS,
  type MenuFormState,
  type MenuItemFull,
  type MenuTypeOption,
} from "./menuTypes";

/**
 * The create/edit menu form. The `form` state itself stays on the page — it is
 * seeded by openCreate/openEdit there, and moving it here would change when it
 * resets. Everything derived purely from `form` (the codename guess, the
 * sibling-icon collision, the legal parents) is computed here.
 */
export function MenuFormModal({
  isOpen,
  onClose,
  editingMenu,
  menus,
  realCodenames,
  permissionsLoaded,
  form,
  setForm,
  iconError,
  setIconError,
  onSubmit,
  isSubmitting = false,
}: {
  isOpen: boolean;
  onClose: () => void;
  editingMenu: MenuItemFull | null;
  menus: MenuItemFull[];
  realCodenames: Set<string>;
  permissionsLoaded: boolean;
  form: MenuFormState;
  setForm: React.Dispatch<React.SetStateAction<MenuFormState>>;
  iconError: boolean;
  setIconError: (value: boolean) => void;
  onSubmit: (e: React.FormEvent) => void;
  /** Locks the submit button while a create/update is in flight. */
  isSubmitting?: boolean;
}) {
  const { t } = useI18n();
  const { isAdmin } = useTenant();

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
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingMenu ? t("menus.edit") : t("menus.create")}
    >
      <form onSubmit={onSubmit} className="space-y-4">
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
            <span id={iconLabelId} className="text-01 uppercase text-[hsl(var(--color-ink-subtle))]">
              {t("menus.icon")} <span className="text-[hsl(var(--color-status-error))]">*</span>
            </span>
            <IconPicker
              value={form.icon}
              onChange={(icon) => { setForm({ ...form, icon }); setIconError(false); }}
            />
            {iconError ? (
              <p className="text-02 text-[hsl(var(--color-status-error))]">{t("menus.icon_missing_error")}</p>
            ) : (
              <p className="text-02 text-[hsl(var(--color-ink-tertiary))]">{t("menus.icon_required_hint")}</p>
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
          <span id={rolesLabelId} className="text-01 uppercase text-[hsl(var(--color-ink-subtle))]">{t("menus.roles")}</span>
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
          <p className="text-02 text-[hsl(var(--color-ink-tertiary))]">{t("menus.roles_empty_hint")}</p>
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
              <label htmlFor={isActiveId} className="text-03 text-[hsl(var(--color-ink))]">{t("menus.active")}</label>
            </div>
          ) : (
            // Per design review: no greyed-out checkbox for a control the
            // viewer can never use — a disabled control advertises a
            // capability that's permanently out of reach. Plain text instead.
            <div className="flex items-center gap-2 text-03">
              <span className="text-[hsl(var(--color-ink-muted))]">{t("menus.active")}:</span>
              <span className={form.is_active ? "text-[hsl(var(--color-status-success))]" : "text-[hsl(var(--color-ink-subtle))]"}>
                {form.is_active ? t("menus.active") : t("menus.inactive")}
              </span>
            </div>
          )}
          <p className="text-02 text-[hsl(var(--color-ink-tertiary))]">
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
            <label htmlFor={visibleId} className="text-03 text-[hsl(var(--color-ink))]">{t("menus.visible_label")}</label>
          </div>
          <p className="text-02 text-[hsl(var(--color-ink-tertiary))]">{t("menus.visible_hint")}</p>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
          >
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {editingMenu ? t("menus.save") : t("menus.create")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
