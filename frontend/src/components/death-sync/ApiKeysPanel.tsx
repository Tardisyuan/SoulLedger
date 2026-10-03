"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deathSyncApi,
  PAGE_SIZE,
  type ExternalApiKey,
  type ExternalApiKeyCreate,
  type ExternalApiKeySystemType,
} from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { DataTable } from "@/components/ui/data-table";
import { PageSection } from "@/components/ui/page-section";
import { Button } from "@/src/components/ui/Button";
import { BaseModal, ConfirmDialog } from "@/src/components/ui/Modal";
import { SelectField, TextField } from "@/src/components/ui/Field";
import { DomainEnum, MissingValue } from "@/src/components/ui/DomainValue";
import { StatusBadge } from "@/src/components/ui/StatusBadge";

const SYSTEM_TYPES: ExternalApiKeySystemType[] = ["GOVERNMENT", "HOSPITAL", "POLICE", "MESSAGE_BUS", "CUSTOM"];
const GRANTS = ["can_register_death", "can_query_status", "can_manage_webhooks"] as const;
type Grant = (typeof GRANTS)[number];

const KEYS_QUERY = ["death-sync", "api-keys"] as const;

/**
 * Death-Sync API keys: list, create, revoke. ADMIN-only on the wire
 * (`ExternalApiKeyViewSet`), so the route mounts this inside `RequireAdmin`
 * and nothing here re-checks the role.
 *
 * WHERE THE SECRET LIVES: `_raw_key` arrives once, in the 201 of `create`, and
 * is kept in this component's `useState` only — not in the query cache (the
 * list refetch carries `key_prefix`, never the key) and not in the mutation
 * cache (the call is awaited directly). Closing the dialog drops it with the
 * state; the server holds a SHA-256 and cannot show it again. Same shape as
 * `soul-accounts/RevealCredentialDialog.tsx`.
 *
 * Webhooks are deliberately absent: `/death-sync/webhooks/` authenticates with
 * the external system's key only (a Bearer JWT is 401), and
 * `events.EventWebhookDelivery` has no endpoint. The note under the table says so.
 */
export function ApiKeysPanel() {
  const { t, formatDateTime } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<ExternalApiKey | null>(null);
  const [revoking, setRevoking] = useState<ExternalApiKey | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [...KEYS_QUERY, page],
    queryFn: async () => (await deathSyncApi.apiKeys({ page: String(page) })).data,
    placeholderData: (previous) => previous,
  });
  const keys = data?.results ?? [];
  const invalidate = () => queryClient.invalidateQueries({ queryKey: KEYS_QUERY });

  const revoke = useMutation({
    mutationFn: (id: string) => deathSyncApi.revokeApiKey(id),
    onSuccess: () => {
      showToast(t("death_sync.api_keys.revoked_ok"), "success");
      setRevoking(null);
      void invalidate();
    },
    onError: () => showToast(t("death_sync.api_keys.revoke_failed"), "error"),
  });

  return (
    <PageSection
      title={t("death_sync.api_keys.title")}
      actions={
        <Button type="button" size="sm" onClick={() => setCreating(true)}>
          {t("death_sync.api_keys.create")}
        </Button>
      }
    >
      <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("death_sync.api_keys.intro")}</p>
      <DataTable<ExternalApiKey>
        caption={t("death_sync.api_keys.title")}
        columns={[
          { key: "name", header: t("death_sync.api_keys.name") },
          { key: "system_type", header: t("death_sync.api_keys.system_type_label") },
          { key: "grants", header: t("death_sync.api_keys.permissions") },
          { key: "last_used", header: t("death_sync.api_keys.last_used") },
          { key: "usage_count", header: t("death_sync.api_keys.usage_count"), align: "right" },
          { key: "status", header: t("death_sync.api_keys.status_label") },
          { key: "actions", header: t("common.row_actions"), align: "right", srOnlyHeader: true },
        ]}
        data={keys}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        emptyMessage={t("death_sync.api_keys.no_keys")}
        keyExtractor={(key) => key.id}
        renderRow={(key) => (
          <>
            <td className="px-3 py-2">
              <p className="font-medium text-[oklch(var(--color-ink))]">{key.name}</p>
              {/* The 8-char prefix is a label the external system can quote back; it is not the secret. */}
              <p className="font-mono text-xs text-[oklch(var(--color-ink-subtle))]">
                {t("death_sync.api_keys.key_prefix")}: {key.key_prefix}…
              </p>
            </td>
            <td className="px-3 py-2 whitespace-nowrap">
              <DomainEnum namespace="death_sync.api_keys.system_type" value={key.system_type} />
            </td>
            <td className="px-3 py-2 text-sm text-[oklch(var(--color-ink-muted))]">
              {GRANTS.filter((g) => key[g]).map((g) => t(`death_sync.api_keys.${g}`)).join(" · ") || (
                <MissingValue kind="inapplicable" />
              )}
            </td>
            <td className="px-3 py-2 font-mono text-xs whitespace-nowrap text-[oklch(var(--color-ink-muted))]">
              {key.last_used_at ? formatDateTime(key.last_used_at) : t("death_sync.api_keys.never_used")}
            </td>
            <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-[oklch(var(--color-ink-muted))]">
              {key.usage_count}
            </td>
            <td className="px-3 py-2 whitespace-nowrap">
              <StatusBadge
                namespace="death_sync.api_keys.status"
                value={key.is_active ? "ACTIVE" : "REVOKED"}
                tone={key.is_active ? "success" : "neutral"}
              />
            </td>
            <td className="px-3 py-2 text-right whitespace-nowrap">
              {key.is_active && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setRevoking(key)}>
                  {t("death_sync.api_keys.revoke")}
                </Button>
              )}
            </td>
          </>
        )}
        page={page}
        totalPages={Math.max(1, Math.ceil((data?.count ?? 0) / PAGE_SIZE))}
        totalCount={data?.count ?? 0}
        onPageChange={setPage}
      />
      <p className="text-xs text-[oklch(var(--color-ink-subtle))]">{t("death_sync.api_keys.webhooks_note")}</p>

      {creating && (
        <CreateKeyDialog
          onClose={() => setCreating(false)}
          onCreated={(key) => {
            setCreating(false);
            setCreated(key);
            void invalidate();
          }}
        />
      )}
      {created && <NewKeyDialog apiKey={created} onClose={() => setCreated(null)} />}
      <ConfirmDialog
        isOpen={revoking !== null}
        title={t("death_sync.api_keys.revoke_title", { name: revoking?.name ?? "" })}
        message={t("death_sync.api_keys.revoke_message")}
        confirmText={t("death_sync.api_keys.revoke")}
        confirmLoading={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
        onCancel={() => setRevoking(null)}
      />
    </PageSection>
  );
}

function CreateKeyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (key: ExternalApiKey) => void }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [form, setForm] = useState<ExternalApiKeyCreate>({
    name: "",
    system_type: "CUSTOM",
    can_register_death: true,
    can_query_status: true,
    can_manage_webhooks: false,
  });
  const create = useMutation({
    mutationFn: (body: ExternalApiKeyCreate) => deathSyncApi.createApiKey(body),
    onSuccess: ({ data }) => onCreated(data),
    onError: () => showToast(t("death_sync.api_keys.create_failed"), "error"),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    create.mutate({ ...form, name: form.name.trim() });
  };
  const formId = "death-sync-create-key";

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title={t("death_sync.api_keys.create")}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={create.isPending}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={formId} loading={create.isPending} disabled={!form.name.trim()}>
            {t("common.create")}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4">
        <TextField
          label={t("death_sync.api_keys.name")}
          required
          value={form.name}
          placeholder={t("death_sync.api_keys.name_placeholder")}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <SelectField
          label={t("death_sync.api_keys.system_type_label")}
          value={form.system_type}
          options={SYSTEM_TYPES.map((s) => ({ value: s, label: t(`death_sync.api_keys.system_type.${s}`) }))}
          onChange={(e) => setForm({ ...form, system_type: e.target.value as ExternalApiKeySystemType })}
        />
        <fieldset className="space-y-2">
          <legend className="text-sm text-[oklch(var(--color-ink-muted))]">{t("death_sync.api_keys.permissions")}</legend>
          {GRANTS.map((g: Grant) => (
            <label key={g} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={Boolean(form[g])} onChange={(e) => setForm({ ...form, [g]: e.target.checked })} />
              {t(`death_sync.api_keys.${g}`)}
            </label>
          ))}
        </fieldset>
      </form>
    </BaseModal>
  );
}

/** The plaintext, exactly once. Outside clicks are ignored — a stray click would destroy what cannot be fetched again. */
function NewKeyDialog({ apiKey, onClose }: { apiKey: ExternalApiKey; onClose: () => void }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(apiKey._raw_key);
      showToast(t("death_sync.api_keys.copied"), "success");
    } catch {
      showToast(t("death_sync.api_keys.copy_failed"), "error");
    }
  };
  return (
    <BaseModal
      isOpen
      onClose={onClose}
      dismissOnOutsideClick={false}
      title={t("death_sync.api_keys.shown_title")}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="primary" onClick={onClose}>
            {t("death_sync.api_keys.close")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p role="alert" className="text-sm text-[oklch(var(--color-status-warning))]">
          {t("death_sync.api_keys.shown_warning")}
        </p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          <dt className="text-[oklch(var(--color-ink-subtle))]">{t("death_sync.api_keys.name")}</dt>
          <dd className="text-[oklch(var(--color-ink))]">{apiKey.name}</dd>
          <dt className="text-[oklch(var(--color-ink-subtle))]">{t("death_sync.api_keys.key_label")}</dt>
          <dd className="font-mono text-md break-all select-all text-[oklch(var(--color-ink))]" data-testid="revealed-api-key">
            {apiKey._raw_key}
          </dd>
        </dl>
        <Button type="button" size="sm" variant="secondary" onClick={() => void copy()}>
          {t("death_sync.api_keys.copy")}
        </Button>
      </div>
    </BaseModal>
  );
}
