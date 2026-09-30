/**
 * Transient feedback: the toast (bottom, 110pt up, 1.9s, success / failure)
 * and the sign-out confirmation sheet. Both only fade — 160ms / 120ms, or 0
 * under reduce-motion. And `Sheet`, v2's bottom sheet, at the end.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ANIMATION_SOURCE,
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
  useBottomSheetInternal,
  useBottomSheetTimingConfigs,
  useGestureEventsHandlersDefault,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import { Animated, BackHandler, Modal, Pressable, StyleSheet, View } from "react-native";
import { Easing } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "./emblems";
import { useI18n } from "./i18n";
import { Button, GUTTER, Txt, useReducedMotion, useReducedMotionDurations, useTheme } from "./ui";

type ToastKind = "success" | "failure";
type Show = (message: string, kind?: ToastKind) => void;

/** Without a provider (a screen rendered alone in a test) a toast is a no-op, not a crash. */
const ToastContext = createContext<Show>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useTheme();
  const durations = useReducedMotionDurations();
  const [toast, setToast] = useState<{ message: string; kind: ToastKind; id: number } | null>(null);
  const [opacity] = useState(() => new Animated.Value(0));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback<Show>((message, kind = "success") => setToast({ message, kind, id: Date.now() }), []);

  useEffect(() => {
    if (!toast) return;
    const duration = durations.toast;
    Animated.timing(opacity, { toValue: 1, duration, useNativeDriver: true }).start();
    timer.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration, useNativeDriver: true }).start(() => setToast(null));
    }, durations.toastHold);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [toast, opacity, durations]);

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
        <View style={[styles.scrim, { backgroundColor: t.scrim }]}>
          <Pressable style={styles.fill} onPress={cancel} accessibilityLabel={tr("soul_app.logout.cancel")} />
          <View
            testID="confirm-sheet"
            accessibilityViewIsModal
            style={[styles.sheet, { backgroundColor: t.s1, borderTopColor: t.hair2, paddingBottom: 32 + insets.bottom }]}
          >
            <Txt variant="title">
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
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 1,
  },
  toastText: { flex: 1, fontSize: 13 },
  scrim: { flex: 1 },
  sheet: { borderTopWidth: 1, paddingTop: 24, paddingHorizontal: GUTTER, gap: 8 },
  sheetButtons: { marginTop: 12, gap: 12 },
});

/**
 * A bottom sheet (v2 动效, 交互与动效 第 2 轮 原型 06) on @gorhom/bottom-sheet: it opens
 * over 200ms (`motion.sheetIn`), closes over 120 (`motion.sheetOut`; both 0 under
 * reduce-motion), drags down to close past 90pt or 0.6pt/ms (`useSheetGestures`), and also
 * closes on the scrim, on Android's back key, and from whatever button the caller puts
 * in it. Controlled — `open` in, `onClose` out, whichever way it was closed — so a
 * caller holds one boolean, as it did with the `Modal` this replaces. Square, no
 * shadow, a 1px top edge in `edge` (补足 A2). Needs `BottomSheetModalProvider` above
 * (navigation.tsx); the sheet renders in that provider, so it sees only its contexts.
 */
/** 交互与动效 第 2 轮 原型 06: a release past 90pt, or faster than 0.6pt/ms downward, closes. */
export const SHEET_CLOSE_DRAG_PT = 90;
export const SHEET_CLOSE_SPEED_PT_PER_MS = 0.6;

/** 第 2 轮 §一 ease.exit / ease.standard. */
const EASE_EXIT = Easing.bezier(0.4, 0, 1, 1);
const EASE_STANDARD = Easing.bezier(0.2, 0, 0, 1);

/** `velocityY` is Gesture Handler's, in pt per SECOND. */
export function sheetReleaseCloses(translationY: number, velocityY: number): boolean {
  "worklet";
  return translationY > SHEET_CLOSE_DRAG_PT || velocityY / 1000 > SHEET_CLOSE_SPEED_PT_PER_MS;
}

/**
 * The library's own drag handling, with its release swapped for the prototype's: it
 * decides by snap-point projection, which has no distance or speed to name. Closing
 * runs `sheetOut` (fast 120), springing back `sheetIn` (base 200); both 0 under
 * reduce-motion. The upward pull keeps the library's resistance (√d × 2.5: ≈16pt at 40).
 */
export function useSheetGestures() {
  const handlers = useGestureEventsHandlersDefault();
  const { animatedDetentsState, animateToPosition } = useBottomSheetInternal();
  const { sheetIn, sheetOut } = useReducedMotionDurations();
  const handleOnEnd: typeof handlers.handleOnEnd = useCallback(
    (source, payload) => {
      "worklet";
      const { closedDetentPosition, highestDetentPosition } = animatedDetentsState.get();
      if (closedDetentPosition === undefined || highestDetentPosition === undefined) return handlers.handleOnEnd(source, payload);
      const close = sheetReleaseCloses(payload.translationY, payload.velocityY);
      animateToPosition(close ? closedDetentPosition : highestDetentPosition, ANIMATION_SOURCE.GESTURE, 0, {
        duration: close ? sheetOut : sheetIn,
        easing: close ? EASE_EXIT : EASE_STANDARD,
      });
    },
    [handlers, animatedDetentsState, animateToPosition, sheetIn, sheetOut]
  );
  return { ...handlers, handleOnEnd };
}

export function Sheet({ open, onClose, edge, closeLabel, children }: { open: boolean; onClose: () => void; edge: string; closeLabel: string; children: ReactNode }) {
  const t = useTheme();
  const ref = useRef<BottomSheetModal>(null);
  const { sheetIn, sheetOut } = useReducedMotionDurations();
  const timing = useBottomSheetTimingConfigs({ duration: sheetIn, easing: Easing.bezier(0, 0, 0.2, 1) });
  // Dismiss only a sheet that is up. Calling `dismiss()` on one that never opened (the mount,
  // `open` false) or already closed itself (a drag, the scrim) left @gorhom's modal status stuck at
  // DISMISSING, and every later `present()` rendered an empty portal: the long-lamp confirm did
  // not open on a post's first tap, and never again after a drag-close (emulator, 2026-10-01,
  // traced with the library's own logging: `handlePresent … status:6`).
  const up = useRef(false);
  useEffect(() => {
    if (open && !up.current) {
      up.current = true;
      ref.current?.present();
    } else if (!open && up.current) {
      up.current = false;
      ref.current?.dismiss({ duration: sheetOut, easing: EASE_EXIT });
    }
  }, [open, sheetOut]);
  const dismissed = useCallback(() => {
    up.current = false;
    onClose();
  }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [open, onClose]);
  const backdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={1}
        pressBehavior="close"
        accessibilityLabel={closeLabel}
        style={[props.style, { backgroundColor: t.scrim }]}
      />
    ),
    [t.scrim, closeLabel]
  );
  return (
    <BottomSheetModal
      ref={ref}
      onDismiss={dismissed}
      animationConfigs={timing}
      gestureEventsHandlersHook={useSheetGestures}
      backdropComponent={backdrop}
      backgroundStyle={{ backgroundColor: t.s1, borderRadius: 0, borderTopWidth: 1, borderTopColor: edge }}
      handleIndicatorStyle={{ backgroundColor: t.hair2 }}
    >
      <BottomSheetView>{children}</BottomSheetView>
    </BottomSheetModal>
  );
}
