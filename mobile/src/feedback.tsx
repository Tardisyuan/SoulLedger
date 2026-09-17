/**
 * Transient feedback: the toast (bottom, 110pt up, 1.9s, success / failure)
 * and the sign-out confirmation sheet. Both only fade — 160ms / 120ms, or 0
 * under reduce-motion.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "./emblems";
import { useI18n } from "./i18n";
import { motion } from "./theme";
import { Button, GUTTER, Txt, useReducedMotion, useTheme } from "./ui";

type ToastKind = "success" | "failure";
type Show = (message: string, kind?: ToastKind) => void;

/** Without a provider (a screen rendered alone in a test) a toast is a no-op, not a crash. */
const ToastContext = createContext<Show>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const [toast, setToast] = useState<{ message: string; kind: ToastKind; id: number } | null>(null);
  const [opacity] = useState(() => new Animated.Value(0));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback<Show>((message, kind = "success") => setToast({ message, kind, id: Date.now() }), []);

  useEffect(() => {
    if (!toast) return;
    const duration = reduced ? 0 : motion.toast;
    Animated.timing(opacity, { toValue: 1, duration, useNativeDriver: true }).start();
    timer.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration, useNativeDriver: true }).start(() => setToast(null));
    }, motion.toastHold);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [toast, opacity, reduced]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={[
            styles.toast,
            { opacity, backgroundColor: toast.kind === "failure" ? t.negBg : t.ink, borderColor: toast.kind === "failure" ? t.negStrong : t.ink },
          ]}
        >
          <Icon name={toast.kind === "failure" ? "alert" : "check"} size={15} color={toast.kind === "failure" ? t.neg : t.s0} strokeWidth={1.5} />
          <Txt testID="toast" variant="caption" style={[styles.toastText, { color: toast.kind === "failure" ? t.negInk : t.s0 }]}>
            {toast.message}
          </Txt>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

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
  return (
    <LogoutContext.Provider value={ask}>
      {children}
      <Modal visible={visible} transparent animationType={reduced ? "none" : "fade"} onRequestClose={cancel}>
        <View style={styles.scrim}>
          <Pressable style={styles.fill} onPress={cancel} accessibilityLabel={tr("soul_app.logout.cancel")} />
          <View
            testID="confirm-sheet"
            accessibilityViewIsModal
            style={[styles.sheet, { backgroundColor: t.s1, borderTopColor: t.hair2, paddingBottom: 30 + insets.bottom }]}
          >
            <Txt variant="title" style={styles.sheetTitle}>
              {tr("soul_app.logout.title")}
            </Txt>
            <Txt variant="caption" tone="muted">
              {tr("soul_app.logout.body")}
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
  toast: {
    position: "absolute",
    left: GUTTER,
    right: GUTTER,
    bottom: 110,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
  },
  toastText: { flex: 1, fontSize: 13.5 },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: { borderTopWidth: 1, paddingTop: 24, paddingHorizontal: GUTTER, gap: 8 },
  sheetTitle: { fontSize: 17 },
  sheetButtons: { marginTop: 12, gap: 10 },
});
