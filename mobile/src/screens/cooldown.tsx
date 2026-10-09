import { soulApi, soulErrorMessage, type MeRebirthApplicationList, type SoulErrorMessage } from "@soulledger/core/api/soul";
import { useEffect, useState, type ReactNode } from "react";
import { Animated, StyleSheet, View } from "react-native";

import { useToast } from "../feedback";
import { useI18n } from "../i18n";
import { formatStamp } from "../rules";
import { radius, space } from "../theme";
import { Button, Input, Interp, Notice, Txt, useReducedMotion, useTheme } from "../ui";
import { daysLeft } from "../voiceCache";

/** 6% ink over the page, as an 8-digit hex (the theme's ink is `#RRGGBB`): 0.06 × 255 ≈ 0x0F. */
const WASH = "0F";
/** The wash fades over 1.2s (A11 「从推送进入时的高亮」); not scrolled to, not moved, not flashed. */
const FADE_MS = 1200;

/**
 * A11: a glyph column (16) and the sentence, 8 apart. The spec has 10; the spacing scale
 * (2/4/8/12/16/24/32/48) has no 10, and 8 keeps the glyph reading as part of its line.
 */
function StatusLine({ glyph, children }: { glyph: string; children: ReactNode }) {
  return (
    <View style={styles.statusRow}>
      <Txt variant="bodyLg" tone="muted" style={styles.glyph} accessibilityElementsHidden importantForAccessibility="no">
        {glyph}
      </Txt>
      <View style={styles.fill}>{children}</View>
    </View>
  );
}

/**
 * The light wash behind the block when the page was opened from a tapped push: ink at 6%,
 * 8pt beyond the block on every side, gone over 1.2s. Under reduce-motion there is no fade —
 * the wash is simply not drawn.
 */
function LandingWash({ on, children }: { on: boolean; children: ReactNode }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!on || reduced) return;
    Animated.timing(opacity, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start();
  }, [on, opacity, reduced]);
  return (
    <View testID="cooldown-block">
      {on && !reduced ? (
        <Animated.View
          testID="cooldown-landing"
          pointerEvents="none"
          style={[styles.wash, { opacity, backgroundColor: `${theme.ink}${WASH}` }]}
        />
      ) : null}
      {children}
    </View>
  );
}

/**
 * 「申请缩短冷却」: the lower half of the eligibility panel on the applications page. The server
 * says whether the entry is offered (`can_shorten_cooldown` — once per cooldown, like the appeal)
 * and carries the latest request (`cooldown_shortening`); one of five states shows at a time:
 * the entry (with its one-line promise), the form, then ◐ pending / ✓ approved (the new end date
 * is the list's `cooldown_until`) / ✕ rejected with the officer's note.
 *
 * `landed`: the page was opened from a tapped push — the block is washed once (see LandingWash).
 */
export function CooldownShorteningBlock({ list, onChanged, landed }: { list: MeRebirthApplicationList; onChanged: () => void; landed?: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [desired, setDesired] = useState("");
  const [now] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SoulErrorMessage | null>(null);
  // The days field is flagged only after a submit that found it wrong (red border and 「! …」 under it).
  const [wishFlagged, setWishFlagged] = useState(false);
  const row = list.cooldown_shortening;

  // Days left, rounded up like the server's. The wish must be a whole 0 <= n < left; blank = no wish.
  const left = daysLeft(list.cooldown_until, now);
  const wish = desired.trim();
  const wishInvalid = wish !== "" && !(/^\d+$/.test(wish) && Number(wish) < left);

  const submit = async () => {
    if (!reason.trim()) return setError({ key: "soul_app.errors.validation" });
    if (wishInvalid) return setWishFlagged(true);
    setBusy(true);
    setError(null);
    try {
      await soulApi.requestCooldownShortening(reason, wish === "" ? undefined : Number(wish));
      toast(t("soul_app.cooldown.submitted"));
      setOpen(false);
      onChanged();
    } catch (e) {
      setError(soulErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <LandingWash on={!!landed}>
      <View testID="cooldown-shortening" style={styles.block}>
        {row?.status === "PENDING" ? (
          <StatusLine glyph="◐">
            <Txt testID="cooldown-shortening-status" variant="bodyLg">
              {t("soul_app.cooldown.pending")}
            </Txt>
          </StatusLine>
        ) : null}
        {row?.status === "PENDING" && row.desired_remaining_days != null ? (
          // Same copy as the officer's desk and App: one key (decision 2026-10-09). Not a sentence about a promise.
          <Txt testID="cooldown-shortening-desired-shown" variant="body" tone="muted" style={styles.noteLine}>
            {t("soul_accounts.cooldown.desired", { n: String(row.desired_remaining_days) })}
          </Txt>
        ) : null}
        {row?.status === "APPROVED" ? (
          <StatusLine glyph="✓">
            <Interp
              testID="cooldown-shortening-status"
              variant="bodyLg"
              text={t("soul_app.cooldown.approved")}
              parts={{ date: <Txt variant="value" style={styles.date}>{formatStamp(list.cooldown_until) ?? ""}</Txt> }}
            />
          </StatusLine>
        ) : null}
        {row?.status === "REJECTED" ? (
          <>
            <StatusLine glyph="✕">
              <Txt testID="cooldown-shortening-status" variant="bodyLg">
                {t("soul_app.cooldown.rejected")}
              </Txt>
            </StatusLine>
            {row.decision_note ? (
              <Txt testID="cooldown-shortening-note" variant="body" style={styles.noteLine}>
                <Txt variant="body" tone="muted">
                  {t("soul_app.cooldown.note")}
                  {/[㐀-鿿]$/.test(t("soul_app.cooldown.note")) ? "：" : ": "}
                </Txt>
                {row.decision_note}
              </Txt>
            ) : null}
          </>
        ) : null}
        {list.can_shorten_cooldown && !open ? (
          <View style={styles.entry}>
            <Button
              testID="request-cooldown-shortening"
              kind="secondary"
              title={t("soul_app.cooldown.request")}
              onPress={() => setOpen(true)}
              style={styles.entryButton}
            />
            <Txt variant="caption" tone="subtle">
              {t("soul_app.cooldown.hint")}
            </Txt>
          </View>
        ) : null}
        {list.can_shorten_cooldown && open ? (
          <View style={styles.form}>
            <Txt variant="section">{t("soul_app.cooldown.request")}</Txt>
            <Input testID="cooldown-shortening-reason" label={t("soul_app.cooldown.reason")} value={reason} onChangeText={setReason} multiline maxLength={2000} />
            <Input
              testID="cooldown-shortening-desired"
              label={t("soul_app.cooldown.desired_label")}
              hint={t("soul_app.cooldown.desired_hint", { n: String(left) })}
              value={desired}
              onChangeText={(next) => {
                setDesired(next);
                setWishFlagged(false);
              }}
              keyboardType="number-pad"
              maxLength={5}
              inputWidth={96}
              suffix={<Txt variant="body">{t("soul_accounts.cooldown.day_unit")}</Txt>}
              invalid={wishFlagged}
              error={wishFlagged ? `! ${t("soul_app.cooldown.desired_invalid", { max: String(Math.max(0, left - 1)) })}` : null}
            />
            {error ? <Notice tone="neg">{t(error.key, error.params)}</Notice> : null}
            <Button
              testID="submit-cooldown-shortening"
              title={t(busy ? "soul_app.applications.submitting" : "soul_app.cooldown.submit")}
              onPress={submit}
              busy={busy}
              style={styles.submit}
            />
          </View>
        ) : null}
      </View>
    </LandingWash>
  );
}

const styles = StyleSheet.create({
  block: { gap: space[3] },
  statusRow: { flexDirection: "row", gap: space[2] },
  glyph: { width: 16, textAlign: "center" },
  fill: { flex: 1 },
  /** Under the glyph column and its gap: 16 + 8. */
  noteLine: { marginLeft: 16 + space[2] },
  date: { fontSize: 15, lineHeight: 24 },
  entry: { gap: space[2] },
  entryButton: { alignSelf: "flex-start" },
  form: { gap: space[3] },
  submit: { alignSelf: "flex-end" },
  /** 8pt beyond the block on every side (A11). */
  wash: { position: "absolute", top: -space[2], left: -space[2], right: -space[2], bottom: -space[2], borderRadius: radius.control },
});
