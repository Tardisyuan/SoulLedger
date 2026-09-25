"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { permApi, type Role, type RoleDeleteRefusal } from "@soulledger/core/api";
import { roleDeleteRefusal, useCopyRole, useDeleteRole } from "@soulledger/core/hooks/usePermissionMatrix";
import { permKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { Button } from "@/src/components/ui/Button";
import { Badge } from "@/src/components/ui/Badge";
import { Drawer } from "@/src/components/ui/Drawer";
import { Modal } from "@/src/components/ui/Modal";
import { TextField } from "@/src/components/ui/Field";
import { DataTable, ROW_LINK } from "@/components/ui/data-table";

/**
 * 角色表(E-11b)。行尾不放「编辑 / 删除」:整行点开右侧 480 px 抽屉。代码创建后
 * 不能改(审批流按代码引用角色),所以抽屉里它是只读字段。复制为新角色与移入回收站
 * 放在抽屉的 ⋯ 里,后者置底、危险色;被审批流引用时服务器拒绝,并列出是哪几条。
 */
export function RolesSection({
  roles,
  isLoading,
  isError,
  onRetry,
  onOpenMatrix,
}: {
  roles: Role[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onOpenMatrix: (role: string) => void;
}) {
  const { t } = useI18n();
  const [openId, setOpenId] = useState<number | null>(null);
  const openers = useRef(new Map<number, HTMLButtonElement>());
  const lastOpen = useRef<number | null>(null);
  const index = roles.findIndex((r) => r.id === openId);
  const open = index >= 0 ? roles[index] : null;
  const show = (id: number) => {
    lastOpen.current = id;
    setOpenId(id);
  };
  const step = (d: number) => {
    const next = roles[index + d];
    return next ? () => show(next.id) : undefined;
  };

  return (
    <>
      <DataTable<Role>
        caption={t("permissions.roles_title")}
        linkedRows
        columns={[
          { key: "name", header: t("permissions.name") },
          { key: "code", header: t("permissions.codename") },
          { key: "kind", header: t("permissions.roles.kind") },
          { key: "members", header: t("permissions.roles.members"), align: "right" },
          { key: "perms", header: t("permissions.roles.permissions"), align: "right" },
          { key: "updated", header: t("permissions.roles.updated"), align: "right" },
        ]}
        data={roles}
        isLoading={isLoading}
        isError={isError}
        onRetry={onRetry}
        emptyMessage={t("permissions.matrix.no_roles")}
        keyExtractor={(role) => String(role.id)}
        renderRow={(role) => (
          <>
            <td className="px-3 py-2 font-medium text-[oklch(var(--color-ink))]">
              <button
                type="button"
                ref={(el) => {
                  if (el) openers.current.set(role.id, el);
                  else openers.current.delete(role.id);
                }}
                onClick={() => show(role.id)}
                className={`${ROW_LINK} text-left`}
              >
                {role.display_name || role.name}
              </button>
            </td>
            <td className="px-3 py-2 font-mono text-xs">{role.name}</td>
            <td className="px-3 py-2 text-xs text-[oklch(var(--color-ink-muted))]">
              {t(role.is_builtin ? "permissions.roles.builtin" : "permissions.roles.custom")}
            </td>
            <td className="px-3 py-2 text-right font-mono text-xs">{role.member_count}</td>
            <td className="px-3 py-2 text-right font-mono text-xs">{role.permission_count}</td>
            <td className="px-3 py-2 text-right font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
              {role.update_time?.slice(0, 10)}
            </td>
          </>
        )}
      />
      <p className="mt-2 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{t("permissions.roles.foot")}</p>

      <RoleDrawer
        role={open}
        onClose={() => setOpenId(null)}
        onNext={step(1)}
        onPrev={step(-1)}
        finalFocus={() => openers.current.get(lastOpen.current ?? -1) ?? null}
        onOpenMatrix={(name) => {
          setOpenId(null);
          onOpenMatrix(name);
        }}
      />
    </>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[oklch(var(--color-rule))] py-2">
      <dt className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{label}</dt>
      <dd className="text-sm text-[oklch(var(--color-ink))]">{children}</dd>
    </div>
  );
}

function RoleDrawer({
  role,
  onClose,
  onNext,
  onPrev,
  finalFocus,
  onOpenMatrix,
}: {
  role: Role | null;
  onClose: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  finalFocus: () => HTMLElement | null;
  onOpenMatrix: (role: string) => void;
}) {
  const { t } = useI18n();
  return (
    <Drawer
      isOpen={role !== null}
      onClose={onClose}
      title={role ? t("permissions.roles.drawer_title", { name: role.display_name || role.name }) : ""}
      hint={t("souls.preview.hint")}
      onNext={onNext}
      onPrev={onPrev}
      finalFocus={finalFocus}
    >
      {/* Keyed by role, so J / K to the next role starts its form afresh. */}
      {role && <RoleDrawerBody key={role.id} role={role} onClose={onClose} onOpenMatrix={onOpenMatrix} />}
    </Drawer>
  );
}

function RoleDrawerBody({ role, onClose, onOpenMatrix }: { role: Role; onClose: () => void; onOpenMatrix: (role: string) => void }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const copy = useCopyRole();
  const del = useDeleteRole();

  const [displayName, setDisplayName] = useState(role.display_name);
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyCode, setCopyCode] = useState("");
  const [copyName, setCopyName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [refusal, setRefusal] = useState<RoleDeleteRefusal | null>(null);

  const save = async () => {
    if (!displayName.trim()) return;
    setSaving(true);
    try {
      await permApi.roles.update(role.id, { name: role.name, display_name: displayName.trim() });
      await queryClient.invalidateQueries({ queryKey: permKeys.roles });
      showToast(t("permissions.roles.saved"), "success");
    } catch {
      showToast(t("permissions.role_edit_error"), "error");
    } finally {
      setSaving(false);
    }
  };

  const submitCopy = (e: React.FormEvent) => {
    e.preventDefault();
    if (!copyCode.trim() || !copyName.trim()) return;
    copy.mutate(
      { sourceId: role.id, data: { name: copyCode.trim(), display_name: copyName.trim() } },
      {
        onSuccess: () => {
          showToast(t("permissions.roles.copied", { name: copyName.trim() }), "success");
          setCopying(false);
        },
        onError: () => showToast(t("permissions.role_create_error"), "error"),
      }
    );
  };

  const confirmDelete = () => {
    setRefusal(null);
    del.mutate(role.id, {
      onSuccess: () => {
        showToast(t("souls.detail.delete_to_recycle_bin"), "success");
        setDeleting(false);
        onClose();
      },
      onError: (error) => {
        const r = roleDeleteRefusal(error);
        if (r) setRefusal(r);
        else showToast(t("permissions.role_delete_error"), "error");
      },
    });
  };

  return (
    <div className="space-y-4" data-role-drawer={role.name}>
      <TextField
        label={t("permissions.display_name_label")}
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        maxLength={100}
      />
      <div>
        <div className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{t("permissions.codename")}</div>
        <div className="mt-1 font-mono text-sm text-[oklch(var(--color-ink))]" aria-readonly="true">
          {role.name}
        </div>
        <p className="mt-1 text-xs text-[oklch(var(--color-ink-subtle))]">{t("permissions.roles.code_immutable")}</p>
      </div>

      <dl>
        <Stat label={t("permissions.roles.members")}>{role.member_count}</Stat>
        <Stat label={t("permissions.roles.permissions")}>
          {role.permission_count}
          {" · "}
          <button type="button" onClick={() => onOpenMatrix(role.name)} className="text-[oklch(var(--color-accent-ink))] hover:underline">
            {t("permissions.roles.edit_in_matrix")} →
          </button>
        </Stat>
        <Stat label={t("permissions.roles.references")}>
          {t("permissions.roles.workflow_count", { n: String(role.workflow_template_count) })}
        </Stat>
      </dl>

      {copying && (
        <form onSubmit={submitCopy} className="space-y-3 border-t border-[oklch(var(--color-block))] pt-3" aria-label={t("permissions.roles.copy")}>
          <TextField
            label={t("permissions.role_name_label")}
            value={copyCode}
            onChange={(e) => setCopyCode(e.target.value.toUpperCase())}
            placeholder={t("permissions.role_name_placeholder")}
          />
          <TextField label={t("permissions.display_name_label")} value={copyName} onChange={(e) => setCopyName(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setCopying(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={copy.isPending} disabled={!copyCode.trim() || !copyName.trim()}>
              {t("permissions.roles.copy")}
            </Button>
          </div>
        </form>
      )}

      <div className="flex items-center gap-2 border-t border-[oklch(var(--color-block))] pt-3">
        <div className="relative">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={menuOpen}
            aria-controls="role-drawer-more"
            aria-label={t("permissions.roles.more")}
            onClick={() => setMenuOpen((v) => !v)}
          >
            ⋯
          </Button>
          {menuOpen && (
            <div
              id="role-drawer-more"
              className="absolute bottom-full left-0 z-10 mb-1 flex min-w-48 flex-col border border-[oklch(var(--color-block))] bg-[oklch(var(--color-canvas))] shadow-overlay"
            >
              <button
                type="button"
                className="px-3 py-2 text-left text-sm hover:bg-[oklch(var(--color-surface-2))]"
                onClick={() => {
                  setMenuOpen(false);
                  setCopyCode(`${role.name}_COPY`);
                  setCopyName(role.display_name);
                  setCopying(true);
                }}
              >
                {t("permissions.roles.copy")}
              </button>
              <button
                type="button"
                disabled={role.is_builtin}
                className="border-t border-[oklch(var(--color-rule))] px-3 py-2 text-left text-sm text-[oklch(var(--color-danger))] hover:bg-[oklch(var(--color-danger-tint))] disabled:cursor-not-allowed disabled:text-[oklch(var(--color-disabled-ink))]"
                onClick={() => {
                  setMenuOpen(false);
                  setRefusal(null);
                  setDeleting(true);
                }}
              >
                {t("permissions.roles.recycle")}
                {role.is_builtin && <span className="block text-xs">{t("permissions.roles.builtin_locked")}</span>}
              </button>
            </div>
          )}
        </div>
        <span className="flex-1" />
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          loading={saving}
          disabled={!displayName.trim() || displayName.trim() === role.display_name}
          onClick={save}
        >
          {t("common.save")}
        </Button>
      </div>

      <Modal
        isOpen={deleting}
        onClose={() => !del.isPending && setDeleting(false)}
        title={t("permissions.roles.recycle_title", { name: role.display_name || role.name })}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setDeleting(false)} disabled={del.isPending}>
              {t("common.cancel")}
            </Button>
            <Button type="button" variant="danger" onClick={confirmDelete} loading={del.isPending} disabled={refusal !== null}>
              {t("permissions.roles.recycle_action")}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-[oklch(var(--color-ink-muted))]">
          {t("permissions.roles.recycle_body", {
            members: String(role.member_count),
            workflows: String(role.workflow_template_count),
          })}
        </p>
        {refusal && (
          <div role="alert" className="mt-4 border-l-2 border-[oklch(var(--color-danger))] bg-[oklch(var(--color-danger-tint))] px-3 py-2 text-sm">
            <p className="text-[oklch(var(--color-danger))]">
              <span aria-hidden="true">! </span>
              {t(`permissions.roles.refused.${refusal.code}`, {
                n: String(refusal.user_count ?? refusal.templates?.length ?? 0),
              })}
            </p>
            {refusal.templates && refusal.templates.length > 0 && (
              <ul className="mt-2 space-y-1" aria-label={t("permissions.roles.referencing")}>
                {refusal.templates.map((tpl) => (
                  <li key={tpl.template_id} className="text-[oklch(var(--color-ink))]">
                    {tpl.template_name}
                    {!tpl.is_active && (
                      <Badge tone="neutral" className="ml-2">
                        {t("permissions.roles.inactive")}
                      </Badge>
                    )}
                    <span className="block font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
                      {tpl.steps.map((s) => `#${s.step_order} ${s.step_name}`).join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
