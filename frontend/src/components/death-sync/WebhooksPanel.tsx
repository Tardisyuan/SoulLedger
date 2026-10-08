"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deathSyncApi,
  PAGE_SIZE,
  type AdminWebhook,
  type AdminWebhookCreate,
  type AdminWebhookEvent,
  type WebhookDelivery,
  type WebhookDeliveryStatus,
} from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { DataTable } from "@/components/ui/data-table";
import { PageSection } from "@/components/ui/page-section";
import { Button } from "@/src/components/ui/Button";
import { BaseModal, ConfirmDialog } from "@/src/components/ui/Modal";
import { SelectField, TextField } from "@/src/components/ui/Field";
import { MissingValue } from "@/src/components/ui/DomainValue";
import { StatusBadge } from "@/src/components/ui/StatusBadge";
import type { BadgeTone } from "@/src/components/ui/Badge";

const WEBHOOKS_QUERY = ["death-sync", "webhooks"] as const;
const DELIVERIES_QUERY = ["death-sync", "webhook-deliveries"] as const;
const DELIVERY_TONE: Record<WebhookDeliveryStatus, BadgeTone> = {
  PENDING: "neutral",
  SUCCESS: "success",
  FAILED: "warning",
  ABANDONED: "error",
};

/**
 * Death-Sync webhooks: list, create, edit, disable, and the delivery log.
 * ADMIN-only on the wire (`AdminWebhookViewSet`), so the route mounts this
 * inside `RequireAdmin` and nothing here re-checks the role.
 *
 * WHERE THE SECRET LIVES: `_signing_secret` arrives once, in the 201 of
 * `create`, and is kept in this component's `useState` only — same shape as
 * `ApiKeysPanel`. Closing the dialog drops it; the server cannot show it again.
 *
 * The event checklist is `GET admin-webhooks/event-types/` — the `EventType`
 * enum the delivery handler filters on — shown by its wire name, because that
 * name is what the receiver sees in `X-SoulLedger-Event`.
 */
export function WebhooksPanel() {
  const { t } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<AdminWebhook | "new" | null>(null);
  const [created, setCreated] = useState<AdminWebhook | null>(null);
  const [disabling, setDisabling] = useState<AdminWebhook | null>(null);
  const [deliveriesFor, setDeliveriesFor] = useState<AdminWebhook | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [...WEBHOOKS_QUERY, page],
    queryFn: async () => (await deathSyncApi.webhooks({ page: String(page) })).data,
    placeholderData: (previous) => previous,
  });
  const hooks = data?.results ?? [];
  const invalidate = () => queryClient.invalidateQueries({ queryKey: WEBHOOKS_QUERY });

  const disable = useMutation({
    mutationFn: (id: string) => deathSyncApi.disableWebhook(id),
    onSuccess: () => {
      showToast(t("death_sync.webhooks.disabled_ok"), "success");
      setDisabling(null);
      void invalidate();
    },
    onError: () => showToast(t("death_sync.webhooks.disable_failed"), "error"),
  });
  const enable = useMutation({
    mutationFn: (id: string) => deathSyncApi.updateWebhook(id, { is_active: true }),
    onSuccess: () => {
      showToast(t("death_sync.webhooks.saved_ok"), "success");
      void invalidate();
    },
    onError: () => showToast(t("death_sync.webhooks.save_failed"), "error"),
  });

  return (
    <>
      <PageSection
        title={t("death_sync.webhooks.title")}
        actions={
          <Button type="button" size="sm" onClick={() => setEditing("new")}>
            {t("death_sync.webhooks.create")}
          </Button>
        }
      >
        <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("death_sync.webhooks.intro")}</p>
        <DataTable<AdminWebhook>
          caption={t("death_sync.webhooks.title")}
          columns={[
            { key: "url", header: t("death_sync.webhooks.url") },
            { key: "api_key", header: t("death_sync.webhooks.api_key") },
            { key: "events", header: t("death_sync.webhooks.events") },
            { key: "status", header: t("death_sync.webhooks.status_label") },
            { key: "actions", header: t("common.row_actions"), align: "right", srOnlyHeader: true },
          ]}
          data={hooks}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => refetch()}
          emptyMessage={t("death_sync.webhooks.no_webhooks")}
          keyExtractor={(hook) => hook.id}
          renderRow={(hook) => (
            <>
              <td className="px-3 py-2 font-mono text-xs break-all text-[oklch(var(--color-ink))]">{hook.url}</td>
              <td className="px-3 py-2 text-sm text-[oklch(var(--color-ink-muted))]">{hook.api_key_name}</td>
              <td className="px-3 py-2 font-mono text-xs text-[oklch(var(--color-ink-muted))]">
                {(hook.events ?? []).length === 0 ? t("death_sync.webhooks.all_events") : (hook.events ?? []).join(", ")}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <StatusBadge
                  namespace="death_sync.webhooks.status"
                  value={hook.is_active ? "ACTIVE" : "DISABLED"}
                  tone={hook.is_active ? "success" : "neutral"}
                />
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                <Button type="button" variant="ghost" size="sm" onClick={() => setDeliveriesFor(hook)}>
                  {t("death_sync.webhooks.deliveries")}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(hook)}>
                  {t("common.edit")}
                </Button>
                {hook.is_active ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setDisabling(hook)}>
                    {t("death_sync.webhooks.disable")}
                  </Button>
                ) : (
                  <Button type="button" variant="ghost" size="sm" loading={enable.isPending} onClick={() => enable.mutate(hook.id)}>
                    {t("death_sync.webhooks.enable")}
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

        {editing !== null && (
          <WebhookDialog
            webhook={editing === "new" ? null : editing}
            onClose={() => setEditing(null)}
            onSaved={(hook, isNew) => {
              setEditing(null);
              if (isNew) setCreated(hook);
              else showToast(t("death_sync.webhooks.saved_ok"), "success");
              void invalidate();
            }}
          />
        )}
        {created && <SecretDialog webhook={created} onClose={() => setCreated(null)} />}
        <ConfirmDialog
          isOpen={disabling !== null}
          title={t("death_sync.webhooks.disable_title", { url: disabling?.url ?? "" })}
          message={t("death_sync.webhooks.disable_message")}
          confirmText={t("death_sync.webhooks.disable")}
          confirmLoading={disable.isPending}
          onConfirm={() => disabling && disable.mutate(disabling.id)}
          onCancel={() => setDisabling(null)}
        />
      </PageSection>

      <DeliveriesSection key={deliveriesFor?.id ?? "all"} webhook={deliveriesFor} onClear={() => setDeliveriesFor(null)} />
    </>
  );
}

function WebhookDialog({
  webhook,
  onClose,
  onSaved,
}: {
  webhook: AdminWebhook | null;
  onClose: () => void;
  onSaved: (hook: AdminWebhook, isNew: boolean) => void;
}) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [url, setUrl] = useState(webhook?.url ?? "");
  const [apiKey, setApiKey] = useState(webhook?.api_key ?? "");
  const [events, setEvents] = useState<AdminWebhookEvent[]>(webhook?.events ?? []);

  // ponytail: first page of keys only (20); a key-picker with search if a tenant ever has more.
  const keys = useQuery({
    queryKey: ["death-sync", "api-keys", "for-webhook"],
    queryFn: async () => (await deathSyncApi.apiKeys({ page: "1" })).data.results.filter((k) => k.is_active),
    enabled: webhook === null,
  });
  const eventTypes = useQuery({
    queryKey: ["death-sync", "webhook-event-types"],
    queryFn: async () => (await deathSyncApi.webhookEventTypes()).data,
  });
  const keyOptions = keys.data ?? [];
  const selectedKey = apiKey || keyOptions[0]?.id || "";

  const save = useMutation({
    mutationFn: (body: AdminWebhookCreate) =>
      webhook ? deathSyncApi.updateWebhook(webhook.id, { url: body.url, events: body.events }) : deathSyncApi.createWebhook(body),
    onSuccess: ({ data }) => onSaved(data, webhook === null),
    onError: () => showToast(t("death_sync.webhooks.save_failed"), "error"),
  });
  const valid = /^https?:\/\/\S+$/.test(url.trim()) && (webhook !== null || selectedKey !== "");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    save.mutate({ url: url.trim(), api_key: selectedKey, events });
  };
  const toggle = (ev: AdminWebhookEvent, on: boolean) =>
    setEvents((prev) => (on ? [...prev, ev] : prev.filter((x) => x !== ev)));
  const formId = "death-sync-webhook-form";

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title={webhook ? t("death_sync.webhooks.edit_title") : t("death_sync.webhooks.create")}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={save.isPending}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={formId} loading={save.isPending} disabled={!valid}>
            {webhook ? t("common.save") : t("common.create")}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4">
        <TextField
          label={t("death_sync.webhooks.url")}
          required
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        {webhook === null &&
          (keyOptions.length === 0 && !keys.isLoading ? (
            <p role="alert" className="text-sm text-[oklch(var(--color-status-warning))]">
              {t("death_sync.webhooks.no_keys_hint")}
            </p>
          ) : (
            <SelectField
              label={t("death_sync.webhooks.api_key")}
              value={selectedKey}
              options={keyOptions.map((k) => ({ value: k.id, label: `${k.name} (${k.key_prefix}…)` }))}
              onChange={(e) => setApiKey(e.target.value)}
            />
          ))}
        <fieldset className="space-y-2">
          <legend className="text-sm text-[oklch(var(--color-ink-muted))]">{t("death_sync.webhooks.events")}</legend>
          <p className="text-xs text-[oklch(var(--color-ink-subtle))]">{t("death_sync.webhooks.events_hint")}</p>
          <div className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
            {(eventTypes.data ?? []).map((ev) => (
              <label key={ev} className="flex items-center gap-2 font-mono text-xs">
                <input type="checkbox" checked={events.includes(ev)} onChange={(e) => toggle(ev, e.target.checked)} />
                {ev}
              </label>
            ))}
          </div>
        </fieldset>
      </form>
    </BaseModal>
  );
}

/** The plaintext, exactly once. Outside clicks are ignored — a stray click would destroy what cannot be fetched again. */
function SecretDialog({ webhook, onClose }: { webhook: AdminWebhook; onClose: () => void }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const secret = webhook._signing_secret ?? "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
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
      title={t("death_sync.webhooks.shown_title")}
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
          {t("death_sync.webhooks.shown_warning")}
        </p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          <dt className="text-[oklch(var(--color-ink-subtle))]">{t("death_sync.webhooks.url")}</dt>
          <dd className="font-mono text-xs break-all text-[oklch(var(--color-ink))]">{webhook.url}</dd>
          <dt className="text-[oklch(var(--color-ink-subtle))]">{t("death_sync.webhooks.secret_label")}</dt>
          <dd className="font-mono text-md break-all select-all text-[oklch(var(--color-ink))]" data-testid="revealed-webhook-secret">
            {secret}
          </dd>
        </dl>
        <Button type="button" size="sm" variant="secondary" onClick={() => void copy()}>
          {t("death_sync.webhooks.copy")}
        </Button>
      </div>
    </BaseModal>
  );
}

function DeliveriesSection({ webhook, onClear }: { webhook: AdminWebhook | null; onClear: () => void }) {
  const { t, formatDateTime } = useI18n();
  const [page, setPage] = useState(1);
  const params = { page: String(page), ...(webhook ? { webhook: webhook.id } : {}) };
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [...DELIVERIES_QUERY, webhook?.id ?? "all", page],
    queryFn: async () => (await deathSyncApi.webhookDeliveries(params)).data,
    placeholderData: (previous) => previous,
  });
  const rows = data?.results ?? [];
  return (
    <PageSection
      title={webhook ? t("death_sync.webhooks.deliveries_for", { url: webhook.url }) : t("death_sync.webhooks.deliveries")}
      actions={
        webhook && (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            {t("death_sync.webhooks.all_deliveries")}
          </Button>
        )
      }
    >
      <DataTable<WebhookDelivery>
        caption={t("death_sync.webhooks.deliveries")}
        columns={[
          { key: "time", header: t("death_sync.webhooks.delivery.time") },
          { key: "event", header: t("death_sync.webhooks.delivery.event") },
          { key: "url", header: t("death_sync.webhooks.url") },
          { key: "status", header: t("death_sync.webhooks.status_label") },
          { key: "attempt", header: t("death_sync.webhooks.delivery.attempt"), align: "right" },
          { key: "response", header: t("death_sync.webhooks.delivery.response"), align: "right" },
          { key: "error", header: t("death_sync.webhooks.delivery.error") },
        ]}
        data={rows}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        isFiltered={webhook !== null}
        emptyMessage={t("death_sync.webhooks.no_deliveries")}
        filteredEmptyMessage={t("death_sync.webhooks.no_deliveries")}
        keyExtractor={(row) => row.id}
        renderRow={(row) => (
          <>
            <td className="px-3 py-2 font-mono text-xs whitespace-nowrap text-[oklch(var(--color-ink-muted))]">
              {formatDateTime(row.create_time)}
            </td>
            <td className="px-3 py-2 font-mono text-xs">{row.event_type}</td>
            <td className="px-3 py-2 font-mono text-xs break-all text-[oklch(var(--color-ink-muted))]">{row.webhook_url}</td>
            <td className="px-3 py-2 whitespace-nowrap">
              <StatusBadge namespace="death_sync.webhooks.delivery.status" value={row.status} tone={DELIVERY_TONE[row.status]} />
            </td>
            <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">{row.attempt}</td>
            <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
              {row.response_status ?? <MissingValue kind="inapplicable" />}
            </td>
            <td className="px-3 py-2 text-xs break-all text-[oklch(var(--color-ink-muted))]">
              {row.error || <MissingValue kind="inapplicable" />}
            </td>
          </>
        )}
        page={page}
        totalPages={Math.max(1, Math.ceil((data?.count ?? 0) / PAGE_SIZE))}
        totalCount={data?.count ?? 0}
        onPageChange={setPage}
      />
    </PageSection>
  );
}
