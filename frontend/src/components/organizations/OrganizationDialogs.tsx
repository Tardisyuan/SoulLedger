"use client";

import { useState } from "react";
import Link from "next/link";
import { organizationNotEmptyOf, type Organization, type OrganizationNotEmpty } from "@soulledger/core/api";
import { CIVILIZATION_OPTIONS } from "@soulledger/core/config/civilizations";
import { useDeleteOrganization, useSaveOrganization } from "@soulledger/core/hooks/useOrganizations";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";
import { ConfirmDialog, Modal } from "@/src/components/ui/Modal";
import { SelectField, TextField } from "@/src/components/ui/Field";
import { flattenTree } from "@/src/components/ui/TreeRow";
import { cn } from "@/lib/utils";

/**
 * 机构增删改(第三十四批 W-4)。新建、编辑、移动共用一张表单;移动不做拖拽,在表单里改上级。
 * 删除:下面还有下级机构或人员就拒绝并说明数量(后端 409 `not_empty`),不替用户批量移走。
 */

export type OrganizationFormMode =
  | { kind: "create"; parent: Organization | null }
  | { kind: "edit" | "move"; org: Organization };

/** `org` 和它的所有下级 id —— 上级选择器里置灰的那些(挂到自己下面会成环)。 */
export function selfAndDescendants(org: Organization, all: readonly Organization[]): Set<number> {
  const out = new Set<number>([org.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const o of all) {
      if (o.parent != null && out.has(o.parent) && !out.has(o.id)) {
        out.add(o.id);
        grew = true;
      }
    }
  }
  return out;
}

/** 可搜索的树:自己和自己的下级置灰,「根」是第一项。搜索命中时保留命中项的祖先,树形不断。 */
function ParentPicker({
  organizations,
  value,
  onChange,
  disabledIds,
  label,
}: {
  organizations: readonly Organization[];
  value: number | null;
  onChange: (id: number | null) => void;
  disabledIds: ReadonlySet<number>;
  label: string;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const byId = new Map(organizations.map((o) => [o.id, o]));
  let shown = [...organizations].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  if (q) {
    const keep = new Set<number>();
    for (const o of organizations) {
      if (o.name.toLowerCase().includes(q) || o.code.toLowerCase().includes(q)) {
        for (let cur: Organization | undefined = o; cur && !keep.has(cur.id); cur = cur.parent != null ? byId.get(cur.parent) : undefined) {
          keep.add(cur.id);
        }
      }
    }
    shown = shown.filter((o) => keep.has(o.id));
  }
  const rows = flattenTree(shown, (o) => o.id, (o) => o.parent);
  const rowClass = "flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm";
  return (
    <div className="flex flex-col gap-1">
      <span id="org-parent-label" className="text-xs text-[oklch(var(--color-ink-muted))]">{label}</span>
      <input
        type="search"
        aria-label={t("souls.search")}
        placeholder={t("souls.search")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="h-(--control-h-md) border border-[oklch(var(--color-line-strong))] bg-[oklch(var(--color-surface-1))] px-3 text-sm"
      />
      <div role="radiogroup" aria-labelledby="org-parent-label" className="max-h-56 overflow-y-auto border border-[oklch(var(--color-line))]">
        <button
          type="button"
          role="radio"
          aria-checked={value === null}
          onClick={() => onChange(null)}
          className={cn(rowClass, value === null && "bg-[oklch(var(--color-surface-2))] font-semibold")}
        >
          <span aria-hidden="true">{value === null ? "●" : "○"}</span>
          {t("organization.root")}
        </button>
        {rows.map(({ item: o, depth }) => {
          const disabled = disabledIds.has(o.id);
          const selected = value === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-disabled={disabled || undefined}
              disabled={disabled}
              onClick={() => onChange(o.id)}
              style={{ paddingLeft: 12 + (depth + 1) * 16 }}
              className={cn(
                rowClass,
                selected && "bg-[oklch(var(--color-surface-2))] font-semibold",
                disabled && "cursor-not-allowed text-[oklch(var(--color-disabled-ink))]",
              )}
            >
              <span aria-hidden="true">{selected ? "●" : "○"}</span>
              {o.name}
              <span className="font-mono text-xs text-[oklch(var(--color-ink-subtle))]">{o.code}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function OrganizationFormDialog({
  mode,
  organizations,
  onClose,
}: {
  mode: OrganizationFormMode | null;
  organizations: readonly Organization[];
  onClose: () => void;
}) {
  // 每次打开重新挂载内层,表单状态不会带着上一次的值。
  if (!mode) return null;
  const key = mode.kind === "create" ? `create-${mode.parent?.id ?? "root"}` : `${mode.kind}-${mode.org.id}`;
  return <OrganizationForm key={key} mode={mode} organizations={organizations} onClose={onClose} />;
}

function OrganizationForm({
  mode,
  organizations,
  onClose,
}: {
  mode: OrganizationFormMode;
  organizations: readonly Organization[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const save = useSaveOrganization();
  const editing = mode.kind === "create" ? null : mode.org;
  const [name, setName] = useState(editing?.name ?? "");
  const [code, setCode] = useState(editing?.code ?? "");
  const [category, setCategory] = useState<string>(
    (editing ? editing.category : mode.kind === "create" ? mode.parent?.category : undefined) ?? CIVILIZATION_OPTIONS[0],
  );
  const [parent, setParent] = useState<number | null>(editing ? editing.parent : mode.kind === "create" ? mode.parent?.id ?? null : null);
  const [sort, setSort] = useState(String(editing?.sort ?? 0));
  const parentOrg = organizations.find((o) => o.id === parent);
  // 挂在某个上级之下就随上级的文明(一棵树不跨文明)。
  const effectiveCategory = parentOrg?.category ?? category;
  const disabledIds = editing ? selfAndDescendants(editing, organizations) : new Set<number>();
  const valid = name.trim() !== "" && code.trim() !== "";

  const submit = () => {
    if (!valid) return;
    save.mutate(
      {
        id: editing?.id,
        data: { name: name.trim(), code: code.trim(), category: effectiveCategory, parent, sort: Number(sort) || 0 },
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal
      isOpen
      onClose={() => !save.isPending && onClose()}
      title={mode.kind === "create" ? t("org.form.title_create") : t("org.form.title_edit")}
      footer={
        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="primary" onClick={submit} disabled={!valid} loading={save.isPending}>
            {t("org.form.save")}
          </Button>
        </div>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TextField label={t("org.form.name")} required value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
        <TextField label={t("tenants.code")} required mono value={code} maxLength={50} onChange={(e) => setCode(e.target.value)} />
        <SelectField
          label={t("souls.civilization")}
          value={effectiveCategory}
          disabled={Boolean(parentOrg)}
          onChange={(e) => setCategory(e.target.value)}
          options={CIVILIZATION_OPTIONS.map((c) => ({ value: c, label: t(`organization.civilizations.${c}`) }))}
        />
        <TextField label={t("menus.order")} type="number" value={sort} onChange={(e) => setSort(e.target.value)} />
        <ParentPicker
          label={t("org.form.parent")}
          organizations={organizations}
          value={parent}
          onChange={setParent}
          disabledIds={disabledIds}
        />
        {editing && <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("org.form.parent_hint")}</p>}
      </form>
    </Modal>
  );
}

/**
 * 删除:先是普通确认;后端回 409 `not_empty` 时同一个位置换成「还不能删」并给出数量。
 * 「查看人员」打开用户列表(`/users?organization=<id>`),只给能进用户页的人(管理员)。
 */
export function OrganizationDeleteDialog({
  org,
  canViewPeople,
  onClose,
}: {
  org: Organization | null;
  canViewPeople: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const del = useDeleteOrganization();
  const [blocked, setBlocked] = useState<OrganizationNotEmpty | null>(null);
  const close = () => {
    setBlocked(null);
    onClose();
  };
  if (!org) return null;

  if (blocked) {
    const body =
      blocked.units && blocked.people
        ? t("org.delete_blocked_body.both", { units: String(blocked.units), people: String(blocked.people) })
        : blocked.units
          ? t("org.delete_blocked_body.units", { units: String(blocked.units) })
          : t("org.delete_blocked_body.people", { people: String(blocked.people) });
    return (
      <Modal
        isOpen
        onClose={close}
        title={t("org.delete_blocked_title", { name: org.name })}
        footer={
          <div className="flex justify-end gap-3">
            {canViewPeople && blocked.people > 0 && (
              <Link
                href={`/users?organization=${org.id}`}
                onClick={close}
                className="inline-flex min-h-11 items-center border border-[oklch(var(--color-ink))] px-4 font-semibold text-[oklch(var(--color-ink))]"
              >
                {t("org.delete_blocked_people")}
              </Link>
            )}
            <Button type="button" variant="primary" onClick={close}>
              {t("common.dismiss")}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-[oklch(var(--color-ink))]">{body}</p>
      </Modal>
    );
  }

  return (
    <ConfirmDialog
      isOpen
      title={t("org.delete_title", { name: org.name })}
      message={t("org.delete_body")}
      confirmText={t("org.delete")}
      confirmLoading={del.isPending}
      onCancel={close}
      onConfirm={() =>
        del.mutate(org.id, {
          onSuccess: close,
          onError: (error) => {
            const refusal = organizationNotEmptyOf(error);
            if (refusal) setBlocked(refusal);
          },
        })
      }
    />
  );
}
