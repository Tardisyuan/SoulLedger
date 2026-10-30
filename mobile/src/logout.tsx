/**
 * The sign-out confirmation sheet, out of `feedback.tsx` (cq-apps 2026-10-30 #2a): the officer app
 * shares `feedback.tsx`, and this sheet's body comes from `loginRules` (the soul's biometric and
 * initial-password wording), which pulled that file into the officer bundle. Fades 120ms, or 0
 * under reduce-motion.
 */
import { platform } from "@soulledger/core/platform";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useI18n } from "./i18n";
import { BIO_KEY, logoutBody } from "./loginRules";
import { radius } from "./theme";
import { Button, GUTTER, Txt, useReducedMotion, useTheme } from "./ui";

const LogoutContext = createContext<() => void>(() => {});
/** Opens the sign-out confirmation. Signing out is never one tap away. */
export const useAskLogout = () => useContext(LogoutContext);

/**
 * The sign-out confirmation, shown from the bottom over a dimmed screen. It
 * says what signing back in will take, because the initial password is gone.
 */
export function LogoutProvider({ children, onConfirm }: { children: ReactNode; onConfirm: () => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(false);
  const ask = useCallback(() => setVisible(true), []);
  const cancel = () => setVisible(false);
  // Read when the sheet is drawn: the flag changes in Settings while this provider stays mounted.
  const body = logoutBody(visible ? platform().persistent.get(BIO_KEY) : null);
  return (
    <LogoutContext.Provider value={ask}>
      {children}
      <Modal visible={visible} transparent animationType={reduced ? "none" : "fade"} onRequestClose={cancel}>
        <View style={[styles.scrim, { backgroundColor: t.scrim }]}>
          <Pressable style={styles.fill} accessibilityRole="button" onPress={cancel} accessibilityLabel={tr("soul_app.logout.cancel")} />
          <View
            testID="confirm-sheet"
            accessibilityViewIsModal
            style={[styles.sheet, { backgroundColor: t.s1, borderTopColor: t.hair2, paddingBottom: 32 + insets.bottom }]}
          >
            <Txt variant="title">
              {tr("soul_app.logout.title")}
            </Txt>
            <Txt testID="logout-body" variant="caption" tone="muted">
              {body.bioKey ? tr(body.key, { bio: tr(body.bioKey) }) : tr(body.key)}
            </Txt>
            <Txt testID="logout-forget-hint" variant="caption" tone="muted">
              {tr("soul_app.logout.forget_hint")}
            </Txt>
            <View style={styles.sheetButtons}>
              <Button
                testID="logout-confirm"
                kind="danger"
                title={tr("soul_app.life.logout")}
                onPress={() => {
                  setVisible(false);
                  onConfirm();
                }}
              />
              <Button testID="logout-cancel" kind="secondary" title={tr("soul_app.logout.cancel")} onPress={cancel} />
            </View>
          </View>
        </View>
      </Modal>
    </LogoutContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrim: { flex: 1 },
  sheet: { borderTopWidth: 1, borderTopLeftRadius: radius.dialog, borderTopRightRadius: radius.dialog, paddingTop: 24, paddingHorizontal: GUTTER, gap: 8 },
  sheetButtons: { marginTop: 12, gap: 12 },
});
