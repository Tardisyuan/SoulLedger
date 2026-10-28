/**
 * 枉死城的冤情申诉(地府,docs/10 §3.3 / §4.2;2026-10-28 用户定:灵魂自己也能提)。
 *
 *   `WangsiLine`:本世 › 审判那件枉死的案子卡片底部一行 —— 押在枉死城(到哪一天)/ 申诉到哪一步 / 已出枉死城;
 *     能提时右边「申诉 ›」。审核过的写城隍批语(`Quote`,不写是谁批的)。
 *   `WangsiGrievanceScreen`:整页表单(冤情 2000 字),与审判申诉同一做法 —— 长文字放不进带键盘的半屏。
 *
 * 数据是 `GET /me/wangsi/`(本人本世枉死的案子);规则在后端 `apps/judgment/wangsi.py`,与官员端同一个函数。
 * ponytail: 界面是照审判申诉那一行搭的占位,等 Design 画。
 */
import { soulApi, soulErrorCode, soulErrorMessage, type MeWangsiCase } from "@soulledger/core/api/soul";
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from "@react-navigation/native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { useToast } from "../feedback";
import { useI18n } from "../i18n";
import { Button, FieldError, Input, Quote, Screen, SmallButton, Txt, useLayout, useTheme } from "../ui";
import { appealDay } from "./appeals";
import type { AppStackParams } from "./applications";
import { useDiscardGuard } from "./discardGuard";

/** The server's bound (`MeWangsiFileSerializer`). */
export const WANGSI_PLEA_MAX = 2000;
const REFUSALS = ["not_found", "not_pending", "not_in_wangsi", "grievance_open"];

export type WangsiGrievanceParams = { judgment: string; caseNumber: string; heldUntil: string | null };

/** 卡片底部那一行的状态句。没有申诉时按后端的 `refusal_code`:案子已不在审(结案 / 归档)不说「押在枉死城」。 */
export function wangsiStatusKey(row: MeWangsiCase): string {
  if (row.grievance_status) return `soul_app.wangsi.status.${row.grievance_status}`;
  if (row.refusal_code === "not_pending") return "soul_app.wangsi.errors.not_pending";
  return row.held ? "soul_app.wangsi.held" : "soul_app.wangsi.released";
}

export function WangsiLine({ row }: { row: MeWangsiCase | undefined }) {
  const { t } = useI18n();
  const theme = useTheme();
  const navigation = useNavigation<NavigationProp<AppStackParams>>();
  if (!row) return null;
  return (
    <View testID={`wangsi-line-${row.judgment_id}`} style={[styles.line, { borderTopColor: theme.hair }]}>
      <View style={styles.entry}>
        <Txt testID={`wangsi-status-${row.judgment_id}`} variant="caption" tone="muted" style={styles.fill}>
          {t(wangsiStatusKey(row), { date: appealDay(row.held_until) })}
        </Txt>
        {row.can_file ? (
          <SmallButton
            testID={`wangsi-file-${row.judgment_id}`}
            title={`${t("soul_app.wangsi.file")} ›`}
            onPress={() =>
              navigation.navigate("WangsiGrievance", {
                judgment: row.judgment_id,
                caseNumber: row.case_number,
                heldUntil: row.held_until,
              })
            }
          />
        ) : null}
      </View>
      {row.grievance_note ? (
        <>
          <Txt variant="caption" tone="subtle">
            {`${t("soul_app.wangsi.note_label")}${row.grievance_decided_at ? ` · ${appealDay(row.grievance_decided_at)}` : ""}`}
          </Txt>
          <Quote text={row.grievance_note} testID={`wangsi-note-${row.judgment_id}`} />
        </>
      ) : null}
    </View>
  );
}

export function WangsiGrievanceScreen() {
  const { t } = useI18n();
  const toast = useToast();
  const { gutter } = useLayout();
  const navigation = useNavigation<NavigationProp<AppStackParams>>();
  const params = useRoute<RouteProp<{ WangsiGrievance: WangsiGrievanceParams }, "WangsiGrievance">>().params;
  const [plea, setPlea] = useState("");
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guard = useDiscardGuard(!!plea.trim(), "wangsi");

  const submit = async () => {
    if (busy) return;
    if (!plea.trim()) return setMissing(true);
    setBusy(true);
    setError(null);
    try {
      await soulApi.fileWangsiGrievance(params.judgment, plea.trim());
      guard.release();
      toast(t("soul_app.wangsi.submitted_toast"));
      navigation.goBack();
    } catch (e) {
      const code = soulErrorCode(e);
      if (code && REFUSALS.includes(code)) setError(t(`soul_app.wangsi.errors.${code}`));
      else {
        const m = soulErrorMessage(e);
        setError(t(m.key, m.params));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen testID="wangsi-grievance" belowHeader>
      <View style={[styles.form, { paddingHorizontal: gutter }]}>
        <Txt variant="caption" tone="subtle">
          {`${params.caseNumber} · ${t("soul_app.wangsi.held", { date: appealDay(params.heldUntil) })}`}
        </Txt>
        <View>
          <Input
            testID="wangsi-plea"
            label={t("soul_app.wangsi.plea_label")}
            value={plea}
            onChangeText={(v) => {
              setPlea(v);
              if (v.trim()) setMissing(false);
            }}
            multiline
            maxLength={WANGSI_PLEA_MAX}
            editable={!busy}
            error={missing ? t("soul_app.wangsi.plea_required") : null}
          />
          <Txt testID="wangsi-plea-count" variant="caption" tone="subtle" style={styles.count}>
            {`${plea.length}/${WANGSI_PLEA_MAX}`}
          </Txt>
        </View>
        <Txt testID="wangsi-file-body" variant="body" tone="muted">
          {t("soul_app.wangsi.file_body")}
        </Txt>
        {error ? <FieldError testID="wangsi-error" text={error} /> : null}
        <Button testID="wangsi-submit" title={t("soul_app.wangsi.submit")} busy={busy} onPress={() => void submit()} />
        <Button testID="wangsi-cancel" kind="secondary" title={t("soul_app.common.cancel")} onPress={() => navigation.goBack()} />
      </View>
      {guard.sheet}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  line: { marginTop: 12, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, gap: 4 },
  entry: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 12 },
  form: { paddingVertical: 24, gap: 20 },
  count: { alignSelf: "flex-end", marginTop: 4 },
});
