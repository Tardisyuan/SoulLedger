"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { dossiersApi, type DeskRow } from "@soulledger/core/api/dossiers";
import type { JudgmentQueueGroup } from "@soulledger/core/api/judgment";
import { judgmentKeys } from "@soulledger/core/query_keys";
import type { VerdictCode } from "@soulledger/core/hooks/useJudgmentQueue";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";
import { useHotkeys } from "@/src/lib/hotkeys";
import { verdictNamespace } from "@/src/lib/domainNames";
import { Kbd, VERDICT_KEY_CLASS, VERDICT_KEY_COMPACT, VerdictKeyContent } from "@/src/components/judgment/JudgmentDesk";
import { claimRefusalMessage } from "@/src/components/judgment/JudgmentClaimDialogs";
import { reasonsShown } from "@/src/components/judgment/RejectReasonPanel";
import { useSealReadback } from "@/src/components/judgment/SealReadback";
import { DossierSeal } from "@/src/components/dossier/DossierSeal";
import { hallOf, spineCivOf } from "@/src/components/dossier/spineModel";
import { heldBeforeClaim } from "./deskRules";
import s from "./desk.module.css";

export type DeskVerdictDraft = { verdict: VerdictCode; notes: string };

const VERDICTS: { code: VerdictCode; key: string }[] = [
  { code: "PASSED", key: "1" },
  { code: "FAILED", key: "2" },
  { code: "PURGATORY", key: "3" },
  { code: "RETRY", key: "4" },
];

/** 选中的裁决:与审判台、快审同一道内框。 */
const OPT_CHOSEN = "shadow-[inset_0_0_0_1.5px_oklch(var(--color-ink))] [&_kbd]:text-[oklch(var(--color-ink))]";

/**
 * 案卷台的判栏(fe-ia §3.5 / fe-ia-r2 §3,用户 2026-11-14 决定做「就地判」;样子是 Design 第四十六批第一节):
 * 案卷台最右一栏(CaseDesk 的 `.side`,宽 `--verdict-rail-w`:1280–1439 宽 288、≥1440 宽 320;<1280 收成页底的判决条)。
 * 栏头「判栏 · 1–4 · ⌘⏎」与撤回条在 CaseDesk。自上而下:四个裁决键(1–4,只选中;要写理由的写「要写理由 ↗」)· 判词 ·
 * 栏底:印(64)与「落印 ⌘⏎」。
 *
 * 三种状态,都读服务端的 `actions`(`GET /dossiers/{id}/`,与 OpenCase 同一把缓存键,不多发请求):
 * - 待认领、能认领:整栏只有「认领 C」—— 未认领的先认领(用户决定)。
 * - 我认领的、`actions.conclude`:判。
 * - 别的(他人手上、待定、候审、只读):一句为什么,与「打开卷宗」。
 *
 * 判决逻辑不在这里:落印交给 `onSeal`(CaseDesk 的撤回窗口,与快审同一个 `useStagedCommit`,同一个 `conclude/`)。
 * 要选理由的裁决(原审「不过」、希腊「通过」)这里没有理由面板:选中后栏底换成一句为什么与描边的「去卷宗整页写理由 →」,
 * ⌘⏎ 也是打开卷宗(`onOpen`),与快审一样。393 宽不画这一栏(`.side` 在 ≤768 隐藏),窄屏照旧「打开卷宗」。
 * 由 CaseDesk 以 `next/dynamic` 懒加载;`key={row.id}`,换一件就是一个新的判栏(判词与选中不带到下一件)。
 */
export default function VerdictRail({
  row,
  group,
  claim,
  sealed,
  stampKey,
  draft,
  paused = false,
  onSeal,
  onOpen,
}: {
  row: DeskRow;
  group: JudgmentQueueGroup;
  claim: { busy: boolean; run: () => void } | null;
  /** 这一件刚落了印(撤回窗口里或已发出):印实落,键不再接。 */
  sealed: boolean;
  stampKey: number;
  /** 撤回回来的这一件:带着当时选的裁决与判词。 */
  draft: DeskVerdictDraft | null;
  /** 回读层开着:层里的按键归层,1–4 与 ⌘⏎ 不接。 */
  paused?: boolean;
  onSeal: (input: DeskVerdictDraft) => void;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  // OpenCase already fetched this dossier; the rail mounts later (lazy), so it reads the cache instead of
  // refetching on mount (caseDeskRequests: one cold open = two requests).
  const { data } = useQuery({ queryKey: judgmentKeys.dossier(row.id), queryFn: async () => (await dossiersApi.get(row.id)).data, staleTime: 30_000 });
  const [selected, setSelected] = useState<VerdictCode | null>(draft?.verdict ?? null);
  const [notes, setNotes] = useState(draft?.notes ?? "");
  const civ = spineCivOf(row.civilization);
  const readback = useSealReadback();

  const judging = group === "mine" && !!data?.actions.conclude && !heldBeforeClaim(row) && !row.is_final;
  const live = judging && !sealed;
  // 原审判「不过」(希腊判「通过」也一样)要先选理由 / 文书:这一栏没有理由面板,与快审一样送去卷宗整页,
  // 而不是发一个必然被 400 `fail_reason_required` 拒的请求。
  const needsReason = (code: VerdictCode) => (data?.judgment.kind ?? "ORIGINAL") === "ORIGINAL" && reasonsShown(row.civilization, code);
  const seal = () => {
    if (!live || !selected) return;
    if (needsReason(selected)) {
      onOpen();
      return;
    }
    onSeal({ verdict: selected, notes });
  };

  // 393 宽这一栏不画(`.side` 隐藏),键也不接:窄屏照旧「打开卷宗」(用户决定)。在按下时问,不在渲染时问。
  const wide = () => !window.matchMedia?.("(max-width: 768px)")?.matches;
  useHotkeys(
    {
      ...Object.fromEntries(VERDICTS.map((v) => [v.key, () => wide() && setSelected(v.code)])),
      "mod+Enter": () => wide() && seal(),
      n: () => wide() && document.getElementById("desk-verdict-notes")?.focus(),
    },
    live && !paused,
  );

  if (claim) {
    return (
      <div className={s.rail} data-testid="desk-rail" data-state="claim">
        <p className={s.railNote}>{t("caseDesk.verdict.claim_first")}</p>
        <div className={s.railFoot}>
          <Button variant="primary" size="lg" className="w-full gap-2" disabled={claim.busy} onClick={claim.run} data-testid="desk-rail-claim" aria-keyshortcuts="C">
            {t("officer_app.queue.claim")}
            <Kbd>C</Kbd>
          </Button>
        </div>
      </div>
    );
  }

  if (!judging && !sealed) {
    // 为什么不能在这里判:服务端的拒绝码(他人认领、候审、城隍……),与认领的拒绝同一张译文表;没有码(读不到、待定)写通用的一句。
    const code = data?.actions.refusals?.conclude;
    const why =
      group === "deferred"
        ? t("caseDesk.verdict.deferred")
        : code === "claimed_by_other"
          ? t("judgment.claim.claimed_by", { name: row.claimed_by_name ?? "" })
          : code === "permission_denied"
            ? t("judgment.queue.read_only")
            : code
              ? claimRefusalMessage({ response: { data: { code, held_until: row.held_until } } }, t)
              : data
                ? t("caseDesk.verdict.elsewhere")
                : t("common.loading");
    return (
      <div className={s.rail} data-testid="desk-rail" data-state="read">
        <p className={s.railNote} data-testid="desk-rail-why">
          {why}
        </p>
        <div className={s.railFoot}>
          <Button variant="secondary" className="w-full gap-2" onClick={onOpen}>
            {t("caseDesk.actions.open")}
            <Kbd>↵</Kbd>
          </Button>
        </div>
      </div>
    );
  }

  // 第 7 条:要写理由的判决选中后,判词与印位让开,落印键换成描边的「去卷宗整页写理由 →」(⌘⏎ 同样打开卷宗)。
  const toDossier = live && !!selected && needsReason(selected);
  return (
    <section className={s.rail} data-testid="desk-rail" data-state={sealed ? "sealed" : "judge"} aria-labelledby="desk-rail-head">
      <div className={s.railOpts} role="group" aria-labelledby="desk-rail-head">
        {VERDICTS.map((v) => (
          <button
            key={v.code}
            type="button"
            data-verdict={v.code}
            aria-keyshortcuts={v.key}
            aria-pressed={selected === v.code}
            disabled={!live}
            onClick={() => setSelected(v.code)}
            className={`${VERDICT_KEY_CLASS} ${VERDICT_KEY_COMPACT} ${selected === v.code ? OPT_CHOSEN : ""}`}
          >
            <VerdictKeyContent code={v.code} keyHint={v.key} namespace={verdictNamespace(t, row.civilization, v.code)} />
            {needsReason(v.code) ? (
              <span className={s.optHint} data-testid={`desk-rail-reason-${v.code}`}>
                {t("caseDesk.verdict.reason_hint")}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {toDossier ? null : (
        <>
          <label htmlFor="desk-verdict-notes" className="sr-only">
            {t("caseDesk.dossier.judge.words")}
          </label>
          <textarea
            id="desk-verdict-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            disabled={!live}
            aria-keyshortcuts="N"
            placeholder={t("caseDesk.dossier.judge.words")}
            className={s.railWords}
          />
        </>
      )}
      <div className={s.railFoot}>
        {toDossier && selected ? (
          <>
            <p className={s.railNote} data-testid="desk-rail-needs-reason">
              {t("caseDesk.verdict.needs_reason", { verdict: t(`${verdictNamespace(t, row.civilization, selected)}.${selected}`) })}
            </p>
            <Button variant="secondary" size="lg" className="w-full gap-2" onClick={onOpen} aria-keyshortcuts="Meta+Enter Control+Enter" data-testid="desk-rail-to-dossier">
              {t("caseDesk.verdict.to_dossier")}
            </Button>
          </>
        ) : (
          <>
            {/* 第 5 条:印 64,在落印键正上方,左印右说明。未落是虚线待落印,落下盖成实印(同时那一行开始划线)。 */}
            <div className={s.railSeal}>
              {sealed ? (
                <DossierSeal key={stampKey} civ={civ} hall={hallOf(row.court)} size={64} stamp />
              ) : (
                <DossierSeal civ={civ} hall={hallOf(row.court)} size={64} pending />
              )}
              <p>{sealed ? t("caseDesk.verdict.sealed") : t(readback ? "caseDesk.verdict.hint_readback" : "caseDesk.verdict.hint")}</p>
            </div>
            <Button
              variant="primary"
              size="lg"
              className="w-full gap-2"
              disabled={!live || !selected}
              onClick={seal}
              aria-keyshortcuts="Meta+Enter Control+Enter"
              data-testid="desk-rail-seal"
            >
              {t("caseDesk.dossier.judge.seal")}
              <Kbd>⌘⏎</Kbd>
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
