"use client";

import { useEffect, useRef, useState } from "react";
import { assistAdminErrorCode, type AssistAdminConfig } from "@soulledger/core/api/assist-admin";
import {
  useAssistAdminConfig,
  useAssistBackup,
  useAssistEmbedding,
  useUpdateAssistAdminConfig,
  useUpdateAssistBackup,
  useUpdateAssistEmbedding,
} from "@soulledger/core/hooks/useAssistAdmin";
import { useI18n } from "@/src/contexts/I18nContext";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { TextField } from "@/src/components/ui/Field";
import { ConfirmDialog } from "@/src/components/ui/Modal";
import { QueryError } from "@/src/components/ui/PageError";
import { ListSkeleton } from "@/components/ui/skeleton";
import { BATCH_BAR } from "@/components/ui/data-table";
import { AssistAdminTabs, MONO, MUTED, SUBTLE, Section, Switch } from "./parts";
import { BackupBlock, KeyRow, ProviderSection, SamePlatformNote, Segment, segmentKey } from "./ProviderSection";
import { HallSwitches } from "./HallSwitches";
import { EvalPanel } from "./EvalPanel";
import { TryPanel } from "./TryPanel";
import { CorpusSection } from "./CorpusSection";
import { EmbeddingSection, RebuildNotice } from "./EmbeddingSection";
import {
  backupSaveBlock,
  connectionDraft,
  embeddingSaveBlock,
  saveBlock,
  samePlatform,
  setDraft,
  setEmbeddingDraft,
  type Draft,
  type DraftKey,
  type EmbeddingDraft,
  type SavedConnection,
} from "./draft";

const READ_ONLY = ["max_concurrent", "timeout_seconds", "history_turns", "retention_days"] as const;

/** No backup saved: every field starts empty, so a new backup's draft holds all of them. */
const NO_BACKUP: SavedConnection = { platform: null, provider: null, base_url: null, model: null, effort: null, fallbacks: null, prices: {} };

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
  const { t, formatDateTime } = useI18n();
  const [draft, setDraftState] = useState<Draft>({});
  const [testedFp, setTestedFp] = useState<string | null>(null);
  const [replacingKey, setReplacingKey] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const save = useUpdateAssistAdminConfig();
  // 向量模型 (1a 六): a second draft behind the same footer, saved through its own PATCH.
  const embedding = useAssistEmbedding();
  const saveEmbedding = useUpdateAssistEmbedding();
  const [edraft, setEdraft] = useState<EmbeddingDraft>({});
  const [eTestedFp, setETestedFp] = useState<string | null>(null);
  // 备用供应商 (frames 6a–6e): a third draft behind the same footer, saved through config/backup/.
  const backupQuery = useAssistBackup();
  const saveBackup = useUpdateAssistBackup();
  const backup = backupQuery.data;
  const bSaved: SavedConnection = backup?.configured ? backup : NO_BACKUP;
  const [bdraft, setBdraftState] = useState<Draft>({});
  const [bAdding, setBAdding] = useState(false);
  const [bRemoving, setBRemoving] = useState(false);
  const [bTested, setBTested] = useState<{ fp: string; ok: boolean } | null>(null);
  const [bReplacingKey, setBReplacingKey] = useState(false);
  const bOpen = (backup?.configured === true && !bRemoving) || bAdding;
  const bset = (key: DraftKey, v: unknown) => {
    setSaveError(null);
    setBdraftState((d) => setDraft(d, bSaved, key, v));
  };

  const set = (key: DraftKey, value: unknown) => {
    setSaveError(null);
    setDraftState((d) => setDraft(d, config, key, value));
  };
  const value = <K extends DraftKey>(key: K) =>
    (key in draft ? draft[key] : (config as unknown as Record<string, unknown>)[key === "enabled" ? "switch" : key]) as Draft[K];

  const nConfig = Object.keys(draft).length;
  const nEmbedding = Object.keys(edraft).length;
  const nBackup = bRemoving ? 1 : bOpen ? Object.keys(bdraft).length : 0;
  const n = nConfig + nEmbedding + nBackup;
  const block =
    saveBlock(draft, config, testedFp, invalidDraft(draft) || (bOpen && invalidDraft(bdraft))) ??
    (bOpen ? backupSaveBlock(bdraft, config, bSaved, bTested) : null) ??
    embeddingSaveBlock(edraft, eTestedFp);
  const saving = save.isPending || saveEmbedding.isPending || saveBackup.isPending;
  const canSave = n > 0 && block === null && !saving;
  const reason = saveError ?? (n > 0 && block ? t(`assist_admin.errors.${block}`) : null);

  const resetBackup = () => {
    setBdraftState({});
    setBAdding(false);
    setBRemoving(false);
    setBTested(null);
    setBReplacingKey(false);
  };
  const discard = () => {
    setDraftState({});
    setEdraft({});
    setReplacingKey(false);
    resetBackup();
    setSaveError(null);
  };
  // Up to three writes, config first, then the backup (PATCH, or DELETE when removed), then the embedding;
  // each clears its own draft on success, so a refused later one keeps only its own keys unsaved.
  // Saving the embedding never rebuilds (the block shows 「需要重建」).
  const doSave = async () => {
    if (!canSave) return;
    try {
      if (nConfig > 0) {
        await save.mutateAsync(draft);
        setDraftState({});
        setReplacingKey(false);
      }
      if (nBackup > 0) {
        await saveBackup.mutateAsync(bRemoving ? null : bdraft);
        resetBackup();
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

  const numberInput = (key: "soul_per_hour" | "officer_per_hour" | "eval_spend_cap", raw: string) =>
    set(key, raw === "" ? NaN : Number(raw));
  const shown = (v: unknown) => (typeof v === "number" && Number.isNaN(v) ? "" : String(v ?? ""));

  const switchOn = value("enabled") as boolean;
  const hallsInactive = !config.env_enabled
    ? t("assist_admin.switch.env_off_short")
    : !switchOn
      ? t("assist_admin.halls.inactive")
      : null;

  return (
    <div>
      {!config.env_enabled && (
        <p role="note" className="mb-4 border-l-2 border-[oklch(var(--color-warning))] pl-3 text-sm">
          {t("assist_admin.switch.env_off")}
        </p>
      )}
      {embedding.data && <RebuildNotice embedding={embedding.data} />}

      <div className="grid gap-x-12 lg:grid-cols-2">
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

          <ProviderSection config={config} backup={backup}>
            <h3 className="mb-3 text-sm font-medium">{t("assist_admin.provider.primary")}</h3>
            <Segment
              kind="primary"
              config={config}
              saved={config}
              draft={draft}
              set={set}
              onTested={(fp, ok) => setTestedFp(ok ? fp : null)}
              keyField={
                <KeyRow
                  id="aa-key"
                  state={segmentKey(config, config, draft)}
                  draftKey={draft.api_key}
                  setKey={(k) => set("api_key", k)}
                  replacing={replacingKey}
                  setReplacing={setReplacingKey}
                  onClear={() => setConfirmClear(true)}
                />
              }
            />
            {backupQuery.data && (
              <BackupBlock
                open={bOpen}
                onAdd={() => {
                  const first = config.platforms[0];
                  setBAdding(true);
                  setBRemoving(false);
                  setBdraftState({ platform: first.id, ...(first.provider ? { provider: first.provider, base_url: first.base_url ?? "" } : {}) });
                }}
                onRemove={() => {
                  resetBackup();
                  if (backup?.configured) setBRemoving(true);
                }}
              >
                <Segment
                  kind="backup"
                  config={config}
                  saved={bSaved}
                  draft={bdraft}
                  set={bset}
                  onTested={(fp, ok) => setBTested({ fp, ok })}
                  platformNote={
                    samePlatform(
                      { platform: (value("platform") as string) ?? null, base_url: (value("base_url") as string) ?? null },
                      {
                        platform: ("platform" in bdraft ? bdraft.platform : bSaved.platform) ?? null,
                        base_url: ("base_url" in bdraft ? bdraft.base_url : bSaved.base_url) ?? null,
                      }
                    ) ? (
                      <SamePlatformNote />
                    ) : null
                  }
                  keyField={
                    <KeyRow
                      id="aa-backup-key"
                      state={segmentKey(config, bSaved, bdraft, backup && { slot: backup.api_key_slot, state: backup.api_key })}
                      draftKey={bdraft.api_key}
                      setKey={(k) => bset("api_key", k)}
                      replacing={bReplacingKey}
                      setReplacing={setBReplacingKey}
                    />
                  }
                />
              </BackupBlock>
            )}
          </ProviderSection>

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
          <EvalPanel
            config={config}
            draftConnection={connectionDraft(draft)}
            afterIdentities={<TryPanel config={config} backup={backup} draftConnection={connectionDraft(draft)} />}
          />
        </div>
      </div>

      <CorpusSection />

      {/* 未保存条(规范 v3,与权限矩阵的未保存条同一规则):有改动时墨色反白 —— 条上按钮都是
          `inverse`,「保存」是唯一的实心(s1 底、ink 字、600),保存不了的原因用条的字色加 ◐,
          不借警示色(警示色在墨底上不到 4.5:1)。没有改动时是原来那条安静的说明行。 */}
      {n > 0 ? (
        <div className={`sticky bottom-0 z-filters -mx-4 px-4 py-3 ${BATCH_BAR}`}>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="mr-auto text-sm font-medium" data-testid="aa-draft-count">
              {t("assist_admin.footer.unsaved", { count: String(n) })}
            </span>
            <Button type="button" variant="inverse" onClick={discard}>
              {t("assist_admin.footer.discard")}
            </Button>
            {/* E: why Save is off sits right beside it, not on a line of its own under the bar. */}
            {reason && (
              <span id="aa-save-reason" role={saveError ? "alert" : undefined} className="max-w-md text-right text-xs">
                <span aria-hidden="true">◐ </span>
                {reason}
              </span>
            )}
            <Button
              type="button"
              variant="inverse"
              className="bg-[oklch(var(--color-surface-1))] text-[oklch(var(--color-ink))] font-semibold hover:bg-[color-mix(in_oklab,oklch(var(--color-ink))_8%,oklch(var(--color-surface-1)))] active:bg-[color-mix(in_oklab,oklch(var(--color-ink))_16%,oklch(var(--color-surface-1)))]"
              disabled={!canSave}
              loading={saving}
              aria-describedby={reason ? "aa-save-reason" : undefined}
              onClick={() => void doSave()}
            >
              {t("assist_admin.footer.save")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="sticky bottom-0 z-filters -mx-4 border-t border-[oklch(var(--color-block))] bg-[oklch(var(--color-canvas))] px-4 py-3">
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="mr-auto text-sm" data-testid="aa-draft-count">
              {t("assist_admin.footer.clean")}
            </span>
            {reason && (
              <span id="aa-save-reason" role={saveError ? "alert" : undefined} className="max-w-md text-right text-xs text-[oklch(var(--color-warning))]">
                {reason}
              </span>
            )}
            <Button type="button" variant="ghost" disabled>
              {t("assist_admin.footer.discard")}
            </Button>
            <Button type="button" variant="primary" disabled>
              {t("assist_admin.footer.save")}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmClear}
        title={t("assist_admin.key.clear_title")}
        message={t("assist_admin.key.clear_body")}
        confirmText={t("assist_admin.key.clear")}
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
