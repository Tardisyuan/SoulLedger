/**
 * 枉死申诉审核(Design 第五十九批 M-4 / M-4b / M-5):「待我处理 › 枉死申诉」的一行打开它,id 是审判。
 *
 * 死因、候至哪天、申诉原文(serif)只读;冤情等级可在这里改(四段,`PATCH judgment/<id>/` 的 `grievance_level`)。
 * 审核意见必填(同网页)。还押在城里时三个动作:不属实 / 属实 · 提前释放… / 属实 · 超度…,后两个先出底部确认
 * (ink 实底,不用危险色);等级不到「重」时两个「属实」置灰,原因写在它们之间。阳寿已到或已结案:只剩
 * 不属实 / 属实(只记结论),上面一句 `late_hint`。规则都在服务端(`apps/judgment/wangsi.py`),这里只照着画。
 */
import { judgmentApi, wangsiApi, WANGSI_ERROR_CODES, type Judgment } from "@soulledger/core/api/judgment";
import { GRIEVANCE_LEVELS, GRIEVANCE_RELEASE_LEVELS } from "@soulledger/core/domain/diyuCase";
import { formatIsoDay, isHeldUntilFatedDate } from "@soulledger/core/domain/dates";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { ActionButton, Segmented, StateView, detailStateOf } from "../kit";
import { noCityGod } from "../rules";
import { useCan } from "../session";
import { Input, Notice, Screen, SectionLabel, Sheet, Txt, family, space, useI18n, useOnline, useRemote, useTheme, useToast } from "../shared";

type T = (key: string, vars?: Record<string, string>) => string;

/** 拒绝的 code → 文案;认不得的退回通用一句。 */
export function wangsiRefusalText(e: unknown, t: T): string {
  const code = (e as { response?: { data?: { code?: string } } })?.response?.data?.code;
  return code && (WANGSI_ERROR_CODES as readonly string[]).includes(code) ? t(`judgment.wangsi.error.${code}`) : t("common.error");
}

/** 此刻还押在枉死城:服务端按它的日期算好的 `wangsi_held`;只有老的服务端没给时才退回本机日期。 */
export function wangsiHeld(j: Pick<Judgment, "held_until" | "wangsi_held">, now?: Date): boolean {
  return j.wangsi_held ?? isHeldUntilFatedDate(j, now);
}

/** 这件案子此刻能做哪些审核动作:`held` 三个、`late` 两个(只记结论)、`none` 没有待审的申诉。 */
export function wangsiMode(
  j: Pick<Judgment, "grievance_status" | "held_until" | "wangsi_held" | "verdict" | "is_final">,
  now?: Date
): "held" | "late" | "none" {
  if (j.grievance_status !== "FILED") return "none";
  return !j.verdict && !j.is_final && wangsiHeld(j, now) ? "held" : "late";
}

export function WangsiReview({ id, onSettled, onDone }: { id: string; onSettled: () => void; onDone: () => void }) {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const toast = useToast();
  const canAct = useCan("judgment.execute");
  // 没网时不审(同审判台的认领 / 改派):这期间案卷可能已经变了。
  const { offline } = useOnline();
  const load = useCallback(() => judgmentApi.get(id).then((r) => r.data), [id]);
  const { data: j, error, reload } = useRemote(load);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState<"release" | "deliver" | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const state = detailStateOf({ data: j, error });
  if (state || !j) return <StateView state={state ?? "loading"} onRetry={() => void reload()} />;

  const mode = wangsiMode(j);
  const level = j.grievance_level ?? "";
  const canRelease = GRIEVANCE_RELEASE_LEVELS.includes(level);
  const noteMissing = note.trim() === "";
  const refused = (e: unknown) => {
    // M-6:本殿没有可收案的城隍 —— toast,文案同网页,不给按钮(设城隍只在网页)。
    if (noCityGod(e)) toast(t("judgment.error.no_city_god"), "failure");
    else setFailure(wangsiRefusalText(e, t));
  };
  const setLevel = (next: string) => {
    if (next === level || busy) return;
    setBusy(true);
    setFailure(null);
    judgmentApi
      .update(id, { grievance_level: next as Judgment["grievance_level"] })
      .then(() => reload())
      .catch(refused)
      .finally(() => setBusy(false));
  };
  const decide = (upheld: boolean, deliver = false) => {
    setBusy(true);
    setFailure(null);
    wangsiApi
      .decideGrievance(id, upheld, note.trim(), deliver)
      .then(() => {
        setConfirming(null);
        onSettled();
        onDone();
      })
      .catch((e: unknown) => {
        setConfirming(null);
        refused(e);
        void reload();
      })
      .finally(() => setBusy(false));
  };

  const fact = (label: string, value: string, testID?: string) => (
    <View style={{ flex: 1, gap: space[1] }}>
      <Txt variant="caption" tone="subtle">{label}</Txt>
      <Txt variant="body" testID={testID}>{value}</Txt>
    </View>
  );
  const cause = j.wrongful_death_cause ? t(`judgment.wrongful_death_causes.${j.wrongful_death_cause}`) : t("judgment.wangsi.unset");
  const heldDay = formatIsoDay(j.held_until, locale);
  const held = wangsiHeld(j) ? [t("judgment.held_until", { date: heldDay }), t("judgment.in_city")].join(" ") : t("judgment.untimely");
  const sendsOn = j.city_god_status === "PENDING" || j.city_god_status === "RETURNED";
  const locked = !canAct || busy || offline;

  return (
    <Screen testID="wangsi-review" edges={["left", "right"]}>
      <View style={{ padding: space[5], gap: space[4] }}>
        <Txt variant="caption" tone="muted">{[j.case_number, j.city_god_name].filter(Boolean).join(" · ")}</Txt>
        <Txt variant="title">{t("officer_app.wangsi.review_title", { name: j.soul_name })}</Txt>
        <View style={{ flexDirection: "row", gap: space[5] }}>
          {/* 两格各占一半(`fact` 的 flex:1):英文的「Held until …」长,不给 flex 时挤出屏外。 */}
          {fact(t("judgment.wangsi.cause"), cause, "wangsi-cause")}
          {fact(t("judgment.wangsi.title"), held, "wangsi-held")}
        </View>
        {j.grievance_plea ? (
          <View style={{ gap: space[1] }}>
            <Txt variant="caption" tone="subtle">{t("judgment.wangsi.plea")}</Txt>
            <Txt variant="bodyLg" testID="wangsi-plea" style={{ fontFamily: family.serifHan }}>{j.grievance_plea}</Txt>
          </View>
        ) : null}
        <View style={{ gap: space[2] }}>
          <SectionLabel>{t("judgment.wangsi.level")}</SectionLabel>
          {mode === "none" || !canAct ? (
            <Txt variant="body" testID="wangsi-level-read">{level ? t(`judgment.grievance_levels.${level}`) : t("judgment.wangsi.unset")}</Txt>
          ) : (
            <Segmented<string>
              testID="wangsi-level"
              value={level}
              onChange={setLevel}
              disabled={busy || offline}
              options={GRIEVANCE_LEVELS.map((key) => ({ key, label: t(`judgment.grievance_levels.${key}`) }))}
            />
          )}
          {/* 点一下就保存(同网页),没有「保存」按钮,所以写一句(华为真机 10-29 第二轮)。 */}
          {mode === "none" || !canAct ? null : <Txt variant="caption" tone="muted" testID="wangsi-level-saves">{t("officer_app.wangsi.level_saves")}</Txt>}
        </View>
        {mode === "none" ? (
          <Txt variant="bodyLg" testID="wangsi-status">{j.grievance_status ? t(`judgment.grievance_statuses.${j.grievance_status}`) : t("judgment.wangsi.unset")}</Txt>
        ) : (
          <View style={{ gap: space[3] }}>
            <Input testID="wangsi-note" label={t("judgment.wangsi.decision_note")} multiline maxLength={2000} value={note} onChangeText={setNote} />
            {/* 意见没写时三个按钮都灰;原因写在按钮上方,不让人猜(华为真机 10-29 第二轮)。 */}
            {noteMissing && canAct ? <Txt variant="caption" tone="muted" testID="wangsi-note-required">{t("officer_app.wangsi.note_required")}</Txt> : null}
            {mode === "late" ? <Txt variant="body" tone="muted" testID="wangsi-late-hint">{t("judgment.wangsi.late_hint")}</Txt> : null}
            {offline && canAct ? <Txt variant="caption" tone="muted" testID="wangsi-offline">{t("officer_app.offline.no_decide")}</Txt> : null}
            <ActionButton testID="wangsi-reject" kind="ink-outline" disabled={locked || noteMissing} title={t("judgment.wangsi.reject")} onPress={() => decide(false)} style={{ minHeight: 48 }} />
            {mode === "late" ? (
              <ActionButton testID="wangsi-uphold-late" kind="primary" disabled={locked || noteMissing} title={t("judgment.wangsi.uphold_late")} onPress={() => decide(true)} style={{ minHeight: 48 }} />
            ) : (
              <>
                <ActionButton
                  testID="wangsi-uphold"
                  kind="primary"
                  disabled={locked || noteMissing || !canRelease}
                  accessibilityHint={canRelease ? undefined : t("judgment.wangsi.uphold_hint")}
                  title={`${t("judgment.wangsi.uphold")}…`}
                  onPress={() => setConfirming("release")}
                  style={{ minHeight: 48 }}
                />
                {/* 等级不到「重」:原因写在两个「属实」之间,不藏。 */}
                {!canRelease ? <Txt variant="caption" tone="muted" testID="wangsi-release-gate">{t("judgment.wangsi.uphold_hint")}</Txt> : null}
                <ActionButton
                  testID="wangsi-deliver"
                  kind="outline"
                  disabled={locked || noteMissing || !canRelease}
                  accessibilityHint={canRelease ? undefined : t("judgment.wangsi.uphold_hint")}
                  title={`${t("judgment.wangsi.deliver")}…`}
                  onPress={() => setConfirming("deliver")}
                  style={{ minHeight: 48 }}
                />
              </>
            )}
          </View>
        )}
        {failure ? <Notice tone="neg" testID="wangsi-failure">{failure}</Notice> : null}
      </View>
      <Sheet open={confirming !== null} onClose={() => setConfirming(null)} edge={theme.hair} closeLabel={t("soul_app.common.cancel")}>
        <View testID={`wangsi-sheet-${confirming ?? "none"}`} style={{ padding: space[5], gap: space[4] }}>
          <Txt variant="title">{t(confirming === "deliver" ? "judgment.wangsi.deliver_title" : "judgment.wangsi.release_title", { name: j.soul_name })}</Txt>
          <Txt variant="body">
            {confirming === "deliver"
              ? t("judgment.wangsi.deliver_body", { name: j.soul_name })
              : t("judgment.wangsi.release_body", { name: j.soul_name, date: heldDay })}
          </Txt>
          {confirming === "deliver" && sendsOn ? <Txt variant="body" testID="wangsi-sends-on">{t("judgment.wangsi.deliver_sends_on")}</Txt> : null}
          <Txt variant="caption" tone="muted">{t("judgment.wangsi.release_irreversible")}</Txt>
          <View style={{ flexDirection: "row", gap: space[3] }}>
            <ActionButton testID="wangsi-cancel" kind="outline" title={t("soul_app.common.cancel")} onPress={() => setConfirming(null)} />
            <ActionButton
              testID="wangsi-confirm"
              kind="ink"
              busy={busy}
              title={t(confirming === "deliver" ? "judgment.wangsi.deliver" : "judgment.wangsi.uphold")}
              onPress={() => decide(true, confirming === "deliver")}
            />
          </View>
        </View>
      </Sheet>
    </Screen>
  );
}
