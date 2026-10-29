/**
 * 城隍初审(第五十三批 M-2 / M-3):一件案子的资料,两个整宽按钮 —— 解送十殿(主)、退回补正(描边)。
 * 点「解送十殿」先出一个底部小确认,可写批语;退回补正是底部弹层,批语必填,下面一句会通知本殿管理员。
 * 退回补正的案子只剩解送(后端不许再退)。改交与城隍管理留在网页上(「改交在网页上办」)。
 * `can_act=false` 时两个按钮置灰,上方一句「你不在这位城隍名下」。
 * 不持 `judgment.execute`(后端 city_god_views 解送 / 退回都要它)的人不画这两个按钮(RBAC A6)。
 */
import { cityGodCasesApi, CITY_GOD_CASE_ERROR_CODES } from "@soulledger/core/api/judgment";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { confirmedDecision, notConfirmedKey, useBioWord } from "../deviceCheck";
import { formatWhen } from "../format";
import { ActionButton, StateView, detailStateOf } from "../kit";
import { useCan } from "../session";
import { Input, Notice, Screen, Sheet, Txt, space, useI18n, useRemote, useTheme, useToast } from "../shared";

function refusalKey(e: unknown): string {
  if (!(e as { response?: unknown } | null)?.response) return "officer_app.confirm.reasons.network";
  const code = (e as { response?: { data?: { code?: string } } })?.response?.data?.code;
  return code && (CITY_GOD_CASE_ERROR_CODES as readonly string[]).includes(code) ? `cityGodCases.error.${code}` : "judgment.claim.refused.generic";
}

export function CityGodCase({ id, onSettled, onDone }: { id: string; onSettled: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const theme = useTheme();
  const toast = useToast();
  const bio = useBioWord();
  const load = useCallback(() => cityGodCasesApi.get(id).then((r) => r.data), [id]);
  const { data: c, error, reload } = useRemote(load);
  const [sheet, setSheet] = useState<"send" | "return" | null>(null);
  const [note, setNote] = useState("");
  const [flagged, setFlagged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const canExecute = useCan("city_god.execute");

  const state = detailStateOf({ data: c, error });
  if (state || !c) return <StateView state={state ?? "loading"} onRetry={() => void reload()} />;

  const open = c.city_god_status !== "SENT_ON" && canExecute;
  const locked = !c.can_act;
  const close = () => {
    setSheet(null);
    setNote("");
    setFlagged(false);
    setFailure(null);
  };
  const confirm = () => {
    if (sheet === "return" && !note.trim()) {
      setFlagged(true);
      return;
    }
    setBusy(true);
    setFailure(null);
    // 解送 / 退回 are the city god's decision: the phone's own check first, when the officer keeps it on.
    confirmedDecision(t("officer_app.biometric.prompt"), () => (sheet === "send" ? cityGodCasesApi.sendOn(id, note.trim()) : cityGodCasesApi.returnCase(id, note.trim())))
      .then(() => {
        toast(t(sheet === "send" ? "cityGodCases.sent_on_toast" : "cityGodCases.returned_toast"), "success");
        close();
        onSettled();
        if (sheet === "send") onDone();
        else void reload();
      })
      .catch((e: unknown) => {
        const unconfirmed = notConfirmedKey(e);
        if (unconfirmed) return setFailure(t(unconfirmed, { bio: bio.start }));
        setFailure(t(refusalKey(e)));
        if (refusalKey(e) === "cityGodCases.error.not_pending") void reload();
      })
      .finally(() => setBusy(false));
  };

  const line = (label: string, value: string) => (
    <View style={{ gap: space[1] }}>
      <Txt variant="caption" tone="subtle">{label}</Txt>
      <Txt variant="body">{value}</Txt>
    </View>
  );
  const years = c.soul_birth_year === null && c.soul_death_year === null ? "—" : `${c.soul_birth_year ?? "?"} — ${c.soul_death_year ?? "?"}`;

  return (
    <Screen testID="city-god-case" edges={["left", "right"]}>
      <View style={{ padding: space[5], gap: space[4] }}>
        <Txt variant="caption" tone="muted">{`${c.case_number} · ${c.city_god_name}`}</Txt>
        <Txt variant="title">{c.soul_name}</Txt>
        <Txt variant="body" testID="city-god-case-status">
          {[t(`cityGodCases.status.${c.city_god_status}`), c.untimely ? t("cityGodCases.untimely_badge") : null].filter(Boolean).join(" · ")}
        </Txt>
        {line(t("cityGodCases.origin_location"), c.origin_location || "—")}
        {line(t("cityGodCases.life"), years)}
        {line(t("souls.fated_death_date"), c.soul_fated_death_year != null ? String(c.soul_fated_death_year) : "—")}
        {line(
          t("cityGodCases.registered_via"),
          `${t(c.registered_via === "DEATH_SYNC" ? "cityGodCases.source.death_sync" : "cityGodCases.source.manual")} · ${formatWhen(c.created_at)}`
        )}
        {c.city_god_status === "RETURNED" ? (
          <View testID="city-god-case-returned" style={{ backgroundColor: theme.s2, padding: space[3], gap: space[1] }}>
            <Txt variant="caption" tone="muted">
              {t("cityGodCases.returned_line", { city_god: c.city_god_name, date: c.returned_at ? formatWhen(c.returned_at) : "—" })}
            </Txt>
            {c.city_god_note ? <Txt variant="body">{c.city_god_note}</Txt> : null}
          </View>
        ) : null}
        {open ? (
          <View style={{ gap: space[3] }}>
            {locked ? <Txt variant="body" tone="muted" testID="city-god-case-cannot">{t("cityGodCases.cannot_act")}</Txt> : null}
            <ActionButton testID="city-god-send-on" kind="primary" disabled={locked} title={t("cityGodCases.send_on")} onPress={() => setSheet("send")} style={{ minHeight: 48 }} />
            {c.city_god_status === "PENDING" ? (
              <ActionButton testID="city-god-return" kind="outline" disabled={locked} title={t("cityGodCases.return")} onPress={() => setSheet("return")} style={{ minHeight: 48 }} />
            ) : null}
            <Txt variant="caption" tone="subtle">{t("cityGodCases.transfer_on_web")}</Txt>
          </View>
        ) : null}
      </View>
      <Sheet open={sheet !== null} onClose={close} edge={theme.hair} closeLabel={t("soul_app.common.cancel")}>
        <View testID={`city-god-sheet-${sheet ?? "none"}`} style={{ padding: space[5], gap: space[4] }}>
          <Txt variant="title">{t(sheet === "return" ? "cityGodCases.return" : "cityGodCases.send_on")}</Txt>
          <Input
            testID="city-god-note"
            label={t(sheet === "return" ? "cityGodCases.return_note" : "cityGodCases.send_on_note")}
            multiline
            value={note}
            onChangeText={(v: string) => {
              setNote(v);
              setFlagged(false);
            }}
            error={sheet === "return" && flagged ? t("cityGodCases.return_note_required") : null}
          />
          {sheet === "return" ? <Txt variant="caption" tone="muted">{t("cityGodCases.return_hint")}</Txt> : null}
          {failure ? <Notice tone="neg" testID="city-god-failure">{failure}</Notice> : null}
          <View style={{ flexDirection: "row", gap: space[3] }}>
            <ActionButton testID="city-god-cancel" kind="outline" title={t("soul_app.common.cancel")} onPress={close} />
            <ActionButton
              testID="city-god-confirm"
              kind={sheet === "return" ? "ink" : "primary"}
              busy={busy}
              title={t(sheet === "return" ? "cityGodCases.return" : "cityGodCases.send_on")}
              onPress={confirm}
            />
          </View>
        </View>
      </Sheet>
    </Screen>
  );
}
