"use client";

import { useEffect, useRef, useState } from "react";
import {
  assistAdminErrorCode,
  type AssistAdminConfig,
  type AssistAdminConnectivity,
} from "@soulledger/core/api/assist-admin";
import {
  useAssistAdminConfig,
  useAssistEmbedding,
  useTestAssistConnection,
  useUpdateAssistAdminConfig,
  useUpdateAssistEmbedding,
} from "@soulledger/core/hooks/useAssistAdmin";
import { useI18n } from "@/src/contexts/I18nContext";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { SelectField, TextField } from "@/src/components/ui/Field";
import { ConfirmDialog } from "@/src/components/ui/Modal";
import { QueryError } from "@/src/components/ui/PageError";
import { ListSkeleton } from "@/components/ui/skeleton";
import { AssistAdminTabs, MONO, MUTED, SUBTLE, Section, Switch, count } from "./parts";
import { HallSwitches } from "./HallSwitches";
import { EvalPanel } from "./EvalPanel";
import { TryPanel } from "./TryPanel";
import { CorpusSection } from "./CorpusSection";
import { EmbeddingSection, RebuildNotice } from "./EmbeddingSection";
import {
  connectionDraft,
  embeddingSaveBlock,
  fingerprint,
  saveBlock,
  setDraft,
  setEmbeddingDraft,
  type Draft,
  type DraftKey,
  type EmbeddingDraft,
} from "./draft";

const READ_ONLY = ["max_concurrent", "timeout_seconds", "history_turns", "retention_days"] as const;

function invalidDraft(d: Draft): boolean {
  const badInt = (v: unknown) => v !== undefined && !(Number.isInteger(v) && (v as number) >= 1);
  const badNum = (v: unknown) => v !== undefined && v !== null && !(Number.isFinite(v) && (v as number) >= 0);
  const prices = Object.values(d.prices ?? {}).some((p) => badNum(p.input) || badNum(p.output));
  return badInt(d.soul_per_hour) || badInt(d.officer_per_hour) || badNum(d.monthly_cap) || badNum(d.eval_spend_cap) || prices;
}

export function AssistAdminConfigPage() {
  const { t } = useI18n();
  const config = useAssistAdminConfig();
  return (
    <PageShell
      variant="full"
      title={t("assist_admin.title")}
      tabs={<AssistAdminTabs />}
      isLoading={config.isLoading}
      skeleton={<ListSkeleton count={4} />}
      isEmpty={!config.data}
      empty={<QueryError onRetry={() => config.refetch()} />}
    >
      {config.data && <ConfigForm config={config.data} />}
    </PageShell>
  );
}

function ConfigForm({ config }: { config: AssistAdminConfig }) {
  const { t, formatDate, formatDateTime } = useI18n();
  const [draft, setDraftState] = useState<Draft>({});
  const [tested, setTested] = useState<{ fp: string; result: AssistAdminConnectivity; at: string } | null>(null);
  const [replacingKey, setReplacingKey] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const save = useUpdateAssistAdminConfig();
  const probe = useTestAssistConnection();
  // 向量模型 (1a 六): a second draft behind the same footer, saved through its own PATCH.
  const embedding = useAssistEmbedding();
  const saveEmbedding = useUpdateAssistEmbedding();
  const [edraft, setEdraft] = useState<EmbeddingDraft>({});
  const [eTestedFp, setETestedFp] = useState<string | null>(null);

  const set = (key: DraftKey, value: unknown) => {
    setSaveError(null);
    setDraftState((d) => setDraft(d, config, key, value));
  };
  const value = <K extends DraftKey>(key: K) =>
    (key in draft ? draft[key] : (config as unknown as Record<string, unknown>)[key === "enabled" ? "switch" : key]) as Draft[K];

  const nConfig = Object.keys(draft).length;
  const nEmbedding = Object.keys(edraft).length;
  const n = nConfig + nEmbedding;
  const testedFp = tested?.result.ok ? tested.fp : null;
  const block = saveBlock(draft, testedFp, invalidDraft(draft)) ?? embeddingSaveBlock(edraft, eTestedFp);
  const saving = save.isPending || saveEmbedding.isPending;
  const canSave = n > 0 && block === null && !saving;
  const reason = saveError ?? (n > 0 && block ? t(`assist_admin.errors.${block}`) : null);

  const discard = () => {
    setDraftState({});
    setEdraft({});
    setReplacingKey(false);
    setSaveError(null);
  };
  // Two PATCHes, config first; each clears its own draft on success, so a refused second one keeps
  // only its own keys unsaved. Saving the embedding never rebuilds (the block shows 「需要重建」).
  const doSave = async () => {
    if (!canSave) return;
    try {
      if (nConfig > 0) {
        await save.mutateAsync(draft);
        setDraftState({});
        setReplacingKey(false);
      }
      if (nEmbedding > 0) {
        await saveEmbedding.mutateAsync(edraft);
        setEdraft({});
      }
      setSaveError(null);
    } catch (err) {
      const code = assistAdminErrorCode(err);
      setSaveError(t(code ? `assist_admin.errors.${code}` : "assist_admin.errors.save_failed"));
    }
  };
  // ⌘/Ctrl + S saves the draft (canvas 1a 五).
  const saveRef = useRef(doSave);
  saveRef.current = doSave;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const runTest = () => {
    const fp = fingerprint(draft);
    probe.mutate(connectionDraft(draft), {
      onSuccess: (result) => setTested({ fp, result, at: new Date().toISOString() }),
      onError: (err) => {
        const code = assistAdminErrorCode(err);
        setTested(null);
        setSaveError(t(code ? `assist_admin.errors.${code}` : "assist_admin.errors.test_failed"));
      },
    });
  };

  const model = value("model") as string;
  const prices = (value("prices") ?? {}) as NonNullable<Draft["prices"]>;
  const price = prices[model];
  const setPrice = (field: "input" | "output", raw: string) => {
    const next = { ...(price ?? { input: 0, output: 0 }), [field]: raw === "" ? NaN : Number(raw) };
    set("prices", { ...prices, [model]: next });
  };
  const numberInput = (key: "soul_per_hour" | "officer_per_hour" | "eval_spend_cap", raw: string) =>
    set(key, raw === "" ? NaN : Number(raw));
  const shown = (v: unknown) => (typeof v === "number" && Number.isNaN(v) ? "" : String(v ?? ""));

  const switchOn = value("enabled") as boolean;
  const hallsInactive = !config.env_enabled
    ? t("assist_admin.switch.env_off_short")
    : !switchOn
      ? t("assist_admin.halls.inactive")
      : null;
  const stale = tested !== null && tested.fp !== fingerprint(draft);

  return (
    <div>
      {!config.env_enabled && (
        <p role="note" className="mb-4 border-l-2 border-[oklch(var(--color-warning))] pl-3 text-sm">
          {t("assist_admin.switch.env_off")}
        </p>
      )}
      {embedding.data && <RebuildNotice embedding={embedding.data} />}

      <div className="grid gap-x-10 lg:grid-cols-2">
        <div>
          <Section title={t("assist_admin.sections.switches")} id="aa-switches">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-sm">{t("assist_admin.switch.master")}</p>
                <p id="aa-master-reason" className={SUBTLE}>
                  {config.env_enabled ? t("assist_admin.switch.master_hint") : t("assist_admin.switch.env_off_short")}
                </p>
              </div>
              <Switch
                checked={switchOn}
                label={t("assist_admin.switch.master")}
                disabled={!config.env_enabled}
                describedBy="aa-master-reason"
                onChange={(on) => set("enabled", on)}
              />
            </div>
            <HallSwitches inactiveReason={hallsInactive} />
          </Section>

          <Section title={t("assist_admin.sections.provider")} id="aa-provider">
            <div className="grid gap-3">
              <SelectField
                id="aa-provider-type"
                label={t("assist_admin.provider.type")}
                value={value("provider") as string}
                onChange={(e) => set("provider", e.target.value)}
                options={[
                  { value: "openai_compatible", label: t("assist_admin.provider.openai_compatible") },
                  { value: "anthropic", label: t("assist_admin.provider.anthropic") },
                ]}
              />
              <TextField
                id="aa-base-url"
                label={t("assist_admin.provider.base_url")}
                description={t("assist_admin.provider.base_url_hint")}
                value={value("base_url") as string}
                onChange={(e) => set("base_url", e.target.value)}
              />
              <TextField
                id="aa-model"
                label={t("assist_admin.provider.model")}
                description={"model" in draft ? t("assist_admin.provider.model_was", { model: config.model }) : undefined}
                value={model}
                onChange={(e) => set("model", e.target.value)}
              />
              <SelectField
                id="aa-effort"
                label={t("assist_admin.provider.effort")}
                description={t("assist_admin.provider.effort_hint")}
                value={value("effort") as string}
                onChange={(e) => set("effort", e.target.value)}
                options={["", "low", "medium", "high"].map((v) => ({ value: v, label: t(`assist_admin.provider.effort_${v || "default"}`) }))}
              />
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm">{t("assist_admin.provider.fallbacks")}</p>
                  <p className={SUBTLE}>{t("assist_admin.provider.fallbacks_hint")}</p>
                </div>
                <Switch checked={value("fallbacks") as boolean} label={t("assist_admin.provider.fallbacks")} onChange={(on) => set("fallbacks", on)} />
              </div>
              <fieldset>
                <legend className="text-sm">{t("assist_admin.provider.price", { model })}</legend>
                <div className="mt-1 grid grid-cols-2 gap-3">
                  <TextField id="aa-price-in" type="number" min={0} step="any" label={t("assist_admin.provider.price_input")} value={shown(price?.input)} onChange={(e) => setPrice("input", e.target.value)} />
                  <TextField id="aa-price-out" type="number" min={0} step="any" label={t("assist_admin.provider.price_output")} value={shown(price?.output)} onChange={(e) => setPrice("output", e.target.value)} />
                </div>
                <p className={`mt-1 ${SUBTLE}`}>{price ? t("assist_admin.provider.price_hint") : t("assist_admin.provider.unpriced")}</p>
              </fieldset>

              <div>
                <p className="text-sm">{t("assist_admin.key.title")}</p>
                <p className="text-sm" data-testid="aa-key-state">
                  {config.api_key.set ? (
                    <>
                      {t("assist_admin.key.set")}
                      {config.api_key.last4 && <span className={`${MONO} ml-2`}>•••• {config.api_key.last4}</span>}
                      {config.api_key.set_at && <span className={`${MONO} ${SUBTLE} ml-2`}>{t("assist_admin.key.set_at", { date: formatDate(config.api_key.set_at) })}</span>}
                      {config.api_key.source === "env" && <span className={`${SUBTLE} ml-2`}>{t("assist_admin.key.from_env")}</span>}
                    </>
                  ) : (
                    t("assist_admin.key.not_set")
                  )}
                </p>
                {draft.api_key === "" && <p className="text-sm text-[oklch(var(--color-warning))]">{t("assist_admin.key.will_clear")}</p>}
                {replacingKey ? (
                  <div className="mt-2 grid gap-2">
                    <TextField
                      id="aa-new-key"
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      label={t("assist_admin.key.new")}
                      description={t("assist_admin.key.new_hint")}
                      value={draft.api_key ?? ""}
                      onChange={(e) => set("api_key", e.target.value || undefined)}
                    />
                    <div>
                      <Button type="button" size="sm" variant="ghost" onClick={() => { set("api_key", undefined); setReplacingKey(false); }}>
                        {t("assist_admin.cancel")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex gap-2">
                    <Button type="button" size="sm" onClick={() => { set("api_key", undefined); setReplacingKey(true); }}>
                      {t("assist_admin.key.replace")}
                    </Button>
                    {config.api_key.set && draft.api_key !== "" && (
                      <Button type="button" size="sm" variant="danger" onClick={() => setConfirmClear(true)}>
                        {t("assist_admin.key.clear")}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Section>

          {embedding.data && (
            <EmbeddingSection
              embedding={embedding.data}
              draft={edraft}
              set={(key, v) => {
                setSaveError(null);
                setEdraft((d) => setEmbeddingDraft(d, embedding.data!, key, v));
              }}
              onTested={setETestedFp}
            />
          )}

          <Section title={t("assist_admin.sections.limits")} id="aa-limits">
            <div className="grid grid-cols-2 gap-3">
              <TextField id="aa-soul-hour" type="number" min={1} label={t("assist_admin.limits.soul_per_hour")} value={shown(value("soul_per_hour"))} onChange={(e) => numberInput("soul_per_hour", e.target.value)} />
              <TextField id="aa-officer-hour" type="number" min={1} label={t("assist_admin.limits.officer_per_hour")} value={shown(value("officer_per_hour"))} onChange={(e) => numberInput("officer_per_hour", e.target.value)} />
              <TextField
                id="aa-cap"
                type="number"
                min={0}
                step="any"
                label={t("assist_admin.limits.monthly_cap")}
                description={t("assist_admin.limits.monthly_cap_hint")}
                value={shown(value("monthly_cap"))}
                onChange={(e) => set("monthly_cap", e.target.value === "" ? null : Number(e.target.value))}
              />
              <TextField id="aa-eval-cap" type="number" min={0} step="any" label={t("assist_admin.limits.eval_spend_cap")} value={shown(value("eval_spend_cap"))} onChange={(e) => numberInput("eval_spend_cap", e.target.value)} />
            </div>
            <p className={`mt-2 ${SUBTLE}`}>{t("assist_admin.limits.rollover")}</p>
          </Section>

          <Section title={t("assist_admin.sections.read_only")} id="aa-read-only">
            <dl className="grid gap-2 text-sm">
              {READ_ONLY.map((k) => (
                <div key={k} className="grid grid-cols-[10rem_5rem_1fr] gap-2">
                  <dt className={MUTED}>{t(`assist_admin.read_only.${k}`)}</dt>
                  <dd className={MONO}>{t(`assist_admin.read_only.${k}_value`, { value: String(config.read_only[k]) })}</dd>
                  <dd className={SUBTLE}>{t(`assist_admin.read_only.${k}_why`)}</dd>
                </div>
              ))}
            </dl>
          </Section>
        </div>

        <div>
          <Section title={t("assist_admin.sections.connectivity")} id="aa-connectivity">
            <p className={SUBTLE}>{t("assist_admin.test.hint")}</p>
            <div className="mt-2">
              <Button type="button" onClick={runTest} loading={probe.isPending}>
                {tested ? t("assist_admin.test.again") : t("assist_admin.test.run")}
              </Button>
            </div>
            {tested && (
              <div role="status" className={`mt-3 border-l-2 pl-3 text-sm ${tested.result.ok ? "border-[oklch(var(--color-success))]" : "border-[oklch(var(--color-danger))]"}`}>
                <p>{tested.result.ok ? t("assist_admin.test.ok") : t("assist_admin.test.failed")}</p>
                {!tested.result.ok && tested.result.error_kind && (
                  <p>
                    {t(`assist_admin.test.kind.${tested.result.error_kind}`)} <span className={MONO}>{tested.result.error_kind}</span>
                  </p>
                )}
                <p className={`${MONO} ${SUBTLE}`}>
                  {t("assist_admin.test.detail", {
                    provider: tested.result.provider,
                    model: tested.result.model,
                    latency: `${count(tested.result.latency_ms)} ms`,
                    input: count(tested.result.tokens.input ?? 0),
                    output: count(tested.result.tokens.output ?? 0),
                    at: formatDateTime(tested.at),
                  })}
                </p>
                {stale && <p className="text-[oklch(var(--color-warning))]">{t("assist_admin.test.stale")}</p>}
              </div>
            )}
          </Section>

          <EvalPanel
            config={config}
            draftConnection={connectionDraft(draft)}
            afterIdentities={<TryPanel config={config} draftConnection={connectionDraft(draft)} />}
          />
        </div>
      </div>

      <CorpusSection />

      <div className="sticky bottom-0 z-filters -mx-4 border-t border-[oklch(var(--color-block))] bg-[oklch(var(--color-canvas))] px-4 py-3">
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span className="mr-auto text-sm" data-testid="aa-draft-count">
            {n > 0 ? t("assist_admin.footer.unsaved", { count: String(n) }) : t("assist_admin.footer.clean")}
          </span>
          <Button type="button" variant="ghost" disabled={n === 0} onClick={discard}>
            {t("assist_admin.footer.discard")}
          </Button>
          <Button type="button" variant="primary" disabled={!canSave} loading={saving} aria-describedby={reason ? "aa-save-reason" : undefined} onClick={() => void doSave()}>
            {t("assist_admin.footer.save")}
          </Button>
        </div>
        {reason && (
          <p id="aa-save-reason" role={saveError ? "alert" : undefined} className="mt-1 text-right text-xs text-[oklch(var(--color-warning))]">
            {reason}
          </p>
        )}
      </div>

      <ConfirmDialog
        isOpen={confirmClear}
        title={t("assist_admin.key.clear_title")}
        message={t("assist_admin.key.clear_body")}
        confirmText={t("assist_admin.key.clear")}
        variant="danger"
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          set("api_key", "");
          setReplacingKey(false);
          setConfirmClear(false);
        }}
      />
    </div>
  );
}
