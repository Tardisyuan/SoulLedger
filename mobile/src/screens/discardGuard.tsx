import { useNavigation } from "@react-navigation/native";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { StyleSheet } from "react-native";

import { useI18n } from "../i18n";
import { Button, Txt } from "../ui";
import { ButtonPair, MfaSheet } from "./mfaParts";

/**
 * Unsent words are not dropped by a back gesture: while `dirty`, leaving the screen
 * (swipe, Android back, a Cancel button) asks the same 「放弃修改?」 the web's post
 * editor asks. Render `sheet` once in the screen; call `release()` right before a
 * successful send navigates away so the send itself is not asked about.
 */
export function useDiscardGuard(dirty: boolean, testIDPrefix: string): { sheet: ReactElement; release: () => void } {
  const { t } = useI18n();
  const navigation = useNavigation();
  const [leaving, setLeaving] = useState<null | (() => void)>(null);
  const done = useRef(false);

  useEffect(
    () =>
      navigation.addListener("beforeRemove", (event) => {
        if (done.current || !dirty) return;
        event.preventDefault();
        setLeaving(() => () => navigation.dispatch(event.data.action));
      }),
    [navigation, dirty]
  );

  const sheet = (
    <MfaSheet testID={`${testIDPrefix}-discard-sheet`} open={!!leaving} onClose={() => setLeaving(null)} closeLabel={t("social.edit_keep")}>
      <Txt variant="title" accessibilityRole="header">
        {t("social.edit_discard_title")}
      </Txt>
      <Txt variant="bodyLg">{t("social.edit_discard_message")}</Txt>
      <ButtonPair>
        <Button testID={`${testIDPrefix}-keep`} kind="secondary" title={t("social.edit_keep")} onPress={() => setLeaving(null)} style={styles.fill} />
        <Button
          testID={`${testIDPrefix}-discard`}
          kind="danger"
          title={t("social.edit_discard_confirm")}
          onPress={() => {
            const go = leaving;
            setLeaving(null);
            done.current = true;
            go?.();
          }}
          style={styles.fill}
        />
      </ButtonPair>
    </MfaSheet>
  );
  return {
    sheet,
    release: () => {
      done.current = true;
    },
  };
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
