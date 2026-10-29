/**
 * 审判详情的两行只读(Design 第五十九批 M-1):
 *  - 罪目(#6):「罪目 · 杀生」,副行「判有罪时送 第九殿 · 平等王」—— 官员看审批时要知道这案会去哪一殿。官员 App 不下判,不能选。
 *  - 审批流程(#1):浅底一块「◇ 审批流程 · 第 n / 共 n 站」,下面写处置为什么还不能执行(`flow_progress.waiting`,
 *    驳回时是驳回那一句),再给「查看审批流程」。执行只在网页上做,所以这里不画执行按钮,置灰的也不画。
 *    流程走完(COMPLETED)整块不画。
 */
import type { JudgmentDetail } from "@soulledger/core/api/judgment";
import { offenceCourt } from "@soulledger/core/domain/diyuCase";
import { View } from "react-native";

import { SmallButton, Txt, space, useI18n, useTheme } from "../shared";

type T = (key: string, vars?: Record<string, string>) => string;

const APPROVAL_CODES = ["approval_in_progress", "approval_rejected", "approval_cancelled"];
const WEIGHING_CODES = ["weighing_in_progress", "weighing_rejected", "weighing_wavers"];

/** `weighing.unfinished_flow` 的码 → 原因(同网页处置页);别的码或 null 为 null。 */
export function flowWaitingText(code: string | null | undefined, t: T): string | null {
  if (!code) return null;
  if (APPROVAL_CODES.includes(code)) return t(`disposition.flow_waiting.${code}`);
  if (WEIGHING_CODES.includes(code)) return t(`judgment.weighing.errors.${code}`);
  return null;
}

export function JudgmentFlowBlock({ data, onOpenFlow }: { data: JudgmentDetail; onOpenFlow?: (workflowId: string) => void }) {
  const { t } = useI18n();
  const theme = useTheme();
  const offence = data.offence ?? "";
  const court = offenceCourt(offence);
  const flow = data.flow_progress;
  const reason = flow ? flowWaitingText(flow.waiting, t) : null;
  return (
    <>
      {offence ? (
        <View testID="judgment-offence" style={{ gap: space[1] }}>
          <Txt variant="body">{`${t("judgment.offence_field.label")} · ${t(`judgment.offences.${offence}`)}`}</Txt>
          {court ? (
            <Txt variant="caption" tone="muted" testID="judgment-offence-route">
              {t("judgment.offence_field.routes_to", { court: `${t(`workflow.court.court_${court}`)} · ${t(`judgment.offence_field.kings.${court}`)}` })}
            </Txt>
          ) : null}
        </View>
      ) : null}
      {flow && flow.status !== "COMPLETED" ? (
        <View testID="judgment-flow" style={{ backgroundColor: theme.s2, padding: space[3], gap: space[2] }}>
          <Txt variant="bodyLg">{`◇ ${t("officer_app.judgment.flow_progress", { n: String(flow.index), total: String(flow.total) })}`}</Txt>
          {reason ? <Txt variant="body" testID="judgment-flow-reason">{reason}</Txt> : null}
          {onOpenFlow ? <SmallButton testID="judgment-flow-open" title={t("crossJudgments.flow.view")} onPress={() => onOpenFlow(flow.workflow)} /> : null}
        </View>
      ) : null}
    </>
  );
}
