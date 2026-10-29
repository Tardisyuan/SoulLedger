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
import { OrgTreeSelect } from "@/src/components/organizations/OrgTreeSelect";

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
  // 每殿只有一个根(后端 org/0010 建):新建与移动都要选上级;只有根自己编辑时上级仍为空(数据范围 B1)。
  const parentOk = parent !== null || (editing !== null && editing.parent === null);
  const valid = name.trim() !== "" && code.trim() !== "" && parentOk;

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
        {/* 与其它机构选择同一个树选择(ds-b6-web 遗留):「根」是无上级那一项,自己和自己的下级置灰。 */}
        <OrgTreeSelect
          mode="single"
          label={t("org.form.parent")}
          organizations={organizations}
          value={parent}
          onChange={setParent}
          noneLabel={t("organization.root")}
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
  organizations = [],
}: {
  org: Organization | null;
  canViewPeople: boolean;
  onClose: () => void;
  /** 只有名下灵魂 / 审判挡着时,在这里挑一个同殿机构「转移到…」再删(`?move_to=`,数据范围 B3a)。 */
  organizations?: readonly Organization[];
}) {
  const { t } = useI18n();
  const del = useDeleteOrganization();
  const [blocked, setBlocked] = useState<OrganizationNotEmpty | null>(null);
  const [moveTo, setMoveTo] = useState<number | null>(null);
  const close = () => {
    setBlocked(null);
    setMoveTo(null);
    onClose();
  };
  if (!org) return null;

  if (blocked) {
    // 子机构与人员不随 move_to 走;只剩名下灵魂 / 审判时才给「转移到…」。
    const movable = !blocked.units && !blocked.people && organizations.length > 0;
    const body =
      blocked.units && blocked.people
        ? t("org.delete_blocked_body.both", { units: String(blocked.units), people: String(blocked.people) })
        : blocked.units
          ? t("org.delete_blocked_body.units", { units: String(blocked.units) })
          : blocked.people
            ? t("org.delete_blocked_body.people", { people: String(blocked.people) })
            : t("org.delete_blocked_body.records", {
                souls: String(blocked.souls ?? 0),
                judgments: String(blocked.judgments ?? 0),
              });
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
            {movable && (
              <Button
                type="button"
                variant="primary"
                disabled={moveTo == null}
                loading={del.isPending}
                onClick={() => moveTo != null && del.mutate({ id: org.id, moveTo }, { onSuccess: close })}
              >
                {t("org.move_and_delete")}
              </Button>
            )}
            <Button type="button" variant={movable ? "ghost" : "primary"} onClick={close}>
              {t(movable ? "common.cancel" : "common.dismiss")}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-[oklch(var(--color-ink))]">{body}</p>
        {movable && (
          <div className="mt-3">
            <OrgTreeSelect
              mode="single"
              label={t("org.move_to")}
              organizations={organizations.filter((o) => o.id !== org.id && o.tenant === org.tenant)}
              value={moveTo}
              onChange={setMoveTo}
            />
          </div>
        )}
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
