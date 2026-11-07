/**
 * 滑卡审判(v4 S09,Design 第三~六批):「我手上」的案子叠成三张卡,一次判一件。
 *
 * - 右滑过 35% 宽度(或点 72 的圆钮):通过,直接落印。希腊要先选文书(《高尔吉亚》/《理想国》),所以弹一个
 *   只有这一问的底页 —— 定稿没有画它,后端要(`greek_account_required`)。
 * - 左滑过线(或点左边圆钮):卡停在左边,底部弹出「不过」的理由(S10),选够了「不过 · 落印」才可点。
 * - 按住:只认中间圆钮(卡片本身不响应按住,免得和滚动、长按菜单冲突),0.5 秒外圈走满,卡片上浮 26 并浮出
 *   「待定」印;松手后写理由(用户 D5:待定仍必填理由),放进待定分组,换下一张,顶部 5 秒「撤回」。
 * - 埃及:天平判了通过就挡左滑,判了不过就挡右滑 —— 只拖得出 14,同方向的圆钮变淡不可点,提示 2 秒。
 *
 * 发落交给自动选殿;要自选去处或引用条文的案子在官员台做(这里不画那两样)。服务端判不了的
 * (`conclude_refusal` 非空:城隍、候审、防腐、杜阿特未走完、未渡)不进卡堆,仍在队列里。
 * 落印走 `confirmedDecision`(我的 › 批准前验证面容 / 指纹),同其他决定。
 */
import { concludeRefusalOf, judgmentApi, type ConcludeJudgmentPayload, type Judgment, type JudgmentDetail } from "@soulledger/core/api/judgment";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { Animated, BackHandler, Pressable, StyleSheet, View, useWindowDimensions, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Svg, { Circle } from "react-native-svg";

import { submitVerdict } from "../decisions";
import { confirmedDecision, notConfirmedKey } from "../deviceCheck";
import { ActionButton } from "../kit";
import { Icon, Txt, radius, space, useI18n, useOnline, useReducedMotion, useReducedMotionDurations, useRemote, useTheme, useToast } from "../shared";
import { BLOCKED_DRAG, SWIPE_FRACTION, blockedSide, deadlineText, passPayload, waitedDays, type Side } from "../verdict";
import { ReasonSheet } from "./judgmentActions";
import { AccountSheet, RejectSheet } from "./rejectSheet";

type T = (key: string, vars?: Record<string, string>) => string;
type Overlay = "reject" | "pass" | "defer" | null;

const HOLD_MS = 500;
const HOLD_LIFT = 26;
const UNDO_MS = 5000;
const HINT_MS = 2000;
const RING = 30; // 60 的圆钮,外圈半径
const RING_C = 2 * Math.PI * (RING - 2);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** 落印被拒:面容没过、天平、受刑计划有自己的话;别的(含 `FAIL_REASON_REFUSALS`,面板已先挡住)说一句没成。 */
export function verdictFailure(t: T, e: unknown): string {
  const unconfirmed = notConfirmedKey(e);
  if (unconfirmed) return t(unconfirmed);
  const refusal = concludeRefusalOf(e);
  if (refusal?.kind === "weighing") return t(`judgment.weighing.errors.${refusal.code}`);
  if (refusal?.kind === "plan") return t(`sentence_plan.errors.${refusal.code}`);
  return t("officer_app.state.error_title");
}

export function SwipeScreen({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const theme = useTheme();
  const toast = useToast();
  const reduced = useReducedMotion();
  const { offline } = useOnline();
  const { width } = useWindowDimensions();
  const threshold = width * SWIPE_FRACTION;

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  // ponytail: 只取「我手上」的第一页;卡堆快空时再问一次(判过的、放进待定的服务端已不在这一组)。
  const loadList = useCallback(() => judgmentApi.list({ group: "mine" }).then((r) => r.data.results), []);
  // 拆开取:在整个返回对象上调 `.reload()`,编译器就当它可能被改,连带从 `data` 算出的 `topId`。
  const { data: rows, error: listError, reload: reloadList } = useRemote(loadList);
  const loadCounts = useCallback(() => judgmentApi.queueCounts().then((r) => r.data), []);
  const { data: countsData, reload: reloadCounts } = useRemote(loadCounts);
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  // 落印(用户 2026-11-06):面容 / 指纹一过,卡片就飞出,提交在后台跑。飞出结束到服务端回话之间,那张卡
  // 不在卡堆里(`away`);被拒(网络失败同样)时它回到卡堆顶上,从飞出去的那一侧弹回原位(`back`)。
  const [away, setAway] = useState<string | null>(null);
  const [back, setBack] = useState<{ id: string; x: number } | null>(null);
  const judgeable = (j: Judgment) => !j.conclude_refusal && !done.has(j.id) && j.id !== away;
  // `topId` 直接从 `rows` 算,不经 `stack`:`stack` 与 `top` 会被交给子组件与回调,编译器当它们可能被改,
  // 依赖它的 `loadDetail` 就保不住手写的 useCallback(react-hooks/preserve-manual-memoization)。
  const topId = (rows ?? []).find(judgeable)?.id ?? null;
  const stack = (rows ?? []).filter(judgeable);
  const top = stack[0] ?? null;
  // 顶上那张的详情:埃及要天平的读数(挡哪一边)。
  const loadDetail = useCallback(() => (topId ? judgmentApi.get(topId).then((r) => r.data) : Promise.resolve(null)), [topId]);
  const { data: detailData } = useRemote(loadDetail);
  const current = detailData && detailData.id === topId ? detailData : null;
  const blocked = current ? blockedSide(current) : null;

  const [overlay, setOverlay] = useState<Overlay>(null);
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState(false);
  const [hint, setHint] = useState(false);
  const [undo, setUndo] = useState<Judgment | null>(null);
  // 每张卡一个 pan:飞出结束、下一张顶上来的那一帧,它的 pan 已经是 0。此前共用一个,要等 useEffect 才归零,
  // 下一张有一帧还在屏外(1.5 倍屏宽)。被拒弹回的那张从飞出去的位置起,在下面的 layout effect 里弹回。
  const pan = useMemo(() => new Animated.Value(back && back.id === topId ? back.x : 0), [topId, back]);
  const backX = back && back.id === topId ? back.x : 0;
  const [hold] = useState(() => new Animated.Value(0));
  // 提示条 2 秒、撤回 5 秒:计时放在 effect 里,不放 ref —— 手势回调在渲染时交给 Gesture,碰到 ref 编译器就拒绝
  // (react-hooks/refs);ui.tsx 的下拉刷新也是回调里只有 state 与 Animated 值。
  useEffect(() => {
    if (!hint) return;
    const id = setTimeout(() => setHint(false), HINT_MS);
    return () => clearTimeout(id);
  }, [hint]);
  useEffect(() => {
    if (!undo) return;
    const id = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(id);
  }, [undo]);

  const canAct = !!current && !busy && !offline && overlay === null;
  const durations = useReducedMotionDurations();

  useEffect(() => {
    hold.setValue(0);
  }, [topId, hold]);

  // 减少动态效果时直接回原位:spring 没有 duration,motion 令牌管不到它，此前照样弹两下。
  const snapBack = useCallback(() => {
    if (reduced) pan.setValue(0);
    else Animated.spring(pan, { toValue: 0, useNativeDriver: false, bounciness: 6 }).start();
  }, [pan, reduced]);
  // 已经亮着就不再设:否则每一帧拖动都重排一次 2 秒。
  const flashBlocked = () => {
    if (!hint) setHint(true);
  };

  const finish = (id: string) => {
    setDone((prev) => new Set(prev).add(id));
    setOverlay(null);
    void reloadCounts();
    if (stack.length <= 2) void reloadList();
  };

  // 飞出:验证通过的那一刻(`confirmedDecision` 在发请求前调它)。飞完才把卡拿出卡堆;中途被拒就不拿:
  // 被拒那一边先 `pan.stopAnimation()`(finished 为 false)。不能指望 snapBack 停它 —— `setBack` 换了一个新 pan,
  // 旧 pan 上的飞出照跑,200ms 后 `setAway(id)` 把刚弹回来的卡又拿走(网络失败往往比 200ms 快)。
  const flyOut = <R,>(id: string, x: number, submit: () => Promise<R>): Promise<R> => {
    setOverlay(null);
    Animated.timing(pan, { toValue: x, duration: durations.drawerOut, useNativeDriver: false }).start(({ finished }) => {
      if (finished) setAway(id);
    });
    return submit();
  };

  // 提交期间 `busy`:下一张卡能看,不能落印(`canAct`)。
  const send = (payload: ConcludeJudgmentPayload) => {
    if (!top || busy) return;
    const id = top.id;
    const x = (payload.verdict === "PASSED" ? 1.5 : -1.5) * width;
    setBusy(true);
    confirmedDecision(t("officer_app.biometric.prompt"), () => flyOut(id, x, () => submitVerdict(id, payload)))
      .then(() => finish(id))
      .catch((e: unknown) => {
        pan.stopAnimation();
        // 面容没过、服务端拒绝、网络失败:都回到原位,写出原因。卡若已经飞走,从飞出去的那一侧回来。
        toast(verdictFailure(t, e), "failure");
        setOverlay(null);
        setAway(null);
        if (notConfirmedKey(e)) snapBack();
        else setBack({ id, x });
      })
      .finally(() => setBusy(false));
  };

  // 被拒的那张回到顶上时,它的 pan 从飞出去的位置起(上面的 useMemo),这里在绘制之前开始弹回。
  useLayoutEffect(() => {
    if (backX !== 0) snapBack();
  }, [pan, backX, snapBack]);

  const pass = () => {
    if (!current) return;
    if (blocked === "right") return flashBlocked();
    if (current.civilization === "GREEK") {
      Animated.timing(pan, { toValue: threshold, duration: durations.sheetIn, useNativeDriver: false }).start();
      setOverlay("pass");
    } else send(passPayload(current.civilization));
  };
  const fail = () => {
    if (!current) return;
    if (blocked === "left") return flashBlocked();
    Animated.timing(pan, { toValue: -0.6 * width, duration: durations.sheetIn, useNativeDriver: false }).start();
    setOverlay("reject");
  };
  const putBack = () => {
    setOverlay(null);
    snapBack();
  };

  // 拖动只在顶上那张卡上,且只认横向;被挡的方向只出得去 14。每次渲染都新建(同 ui.tsx 的下拉刷新):
  // GestureDetector 留着原生的 handler,只换配置与回调,拖到一半重渲染(提示条出现)也不断。
  const drag = Gesture.Pan()
    .withTestId("swipe-drag")
    .runOnJS(true)
    .enabled(canAct)
    .activeOffsetX([-8, 8])
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      const side: Side = e.translationX < 0 ? "left" : "right";
      if (side === blocked) {
        pan.setValue(Math.sign(e.translationX) * Math.min(Math.abs(e.translationX), BLOCKED_DRAG));
        if (Math.abs(e.translationX) > BLOCKED_DRAG * 2) flashBlocked();
      } else pan.setValue(e.translationX);
    })
    .onEnd((e, ok) => {
      const side: Side = e.translationX < 0 ? "left" : "right";
      if (ok && side !== blocked && Math.abs(e.translationX) > threshold) (side === "right" ? pass : fail)();
      else snapBack();
    });

  // 按住:0.5 秒走满一圈;不到就松手,退回原样。
  const holdIn = () => {
    if (!canAct) return;
    Animated.timing(hold, { toValue: 1, duration: reduced ? 0 : HOLD_MS, useNativeDriver: false }).start();
  };
  const holdOut = () => {
    if (held) {
      setHeld(false);
      setOverlay("defer");
    } else Animated.timing(hold, { toValue: 0, duration: durations.fade, useNativeDriver: false }).start();
  };
  const dropHold = () => {
    setOverlay(null);
    Animated.timing(hold, { toValue: 0, duration: durations.fade, useNativeDriver: false }).start();
  };

  const undoDefer = (j: Judgment) => {
    setUndo(null);
    judgmentApi.undefer(j.id).then(
      () => {
        setDone((prev) => {
          const next = new Set(prev);
          next.delete(j.id);
          return next;
        });
        void reloadList();
        void reloadCounts();
      },
      () => toast(t("officer_app.state.error_title"), "failure")
    );
  };

  const deg = (width / 100) * 6; // 每 100 ≈ 6°,绕底部转
  const rotate = pan.interpolate({ inputRange: [-width, 0, width], outputRange: [`-${deg}deg`, "0deg", `${deg}deg`] });
  const passInk = pan.interpolate({ inputRange: [0, threshold], outputRange: [0, 0.85], extrapolate: "clamp" });
  const failInk = pan.interpolate({ inputRange: [-threshold, 0], outputRange: [0.85, 0], extrapolate: "clamp" });
  const lift = hold.interpolate({ inputRange: [0, 1], outputRange: [0, -HOLD_LIFT] });
  const deferInk = hold.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0, 0.85] });
  const ring = hold.interpolate({ inputRange: [0, 1], outputRange: [RING_C, 0] });

  const n = countsData ? countsData.mine : stack.length;
  const m = countsData?.deferred ?? 0;

  return (
    <View testID="swipe-screen" style={{ flex: 1, backgroundColor: theme.s0 }}>
      <Pressable
        testID="swipe-screen-back"
        accessibilityRole="button"
        accessibilityLabel={t("officer_app.back")}
        onPress={onBack}
        style={[styles.back, { borderBottomColor: theme.hair }]}
      >
        <Icon name="back" size={16} color={theme.ink} />
        <Txt variant="nav">{t("officer_app.back")}</Txt>
      </Pressable>
      <View style={styles.head}>
        <Txt variant="title">{t("swipe.title")}</Txt>
        <Txt variant="caption" tone="muted" testID="swipe-count">
          {t("swipe.count", { n: String(n), m: String(m) })}
        </Txt>
      </View>
      {undo ? (
        <View testID="swipe-undo" style={[styles.undo, { backgroundColor: theme.ink }]}>
          <Txt variant="caption" style={{ color: theme.s0, flex: 1 }}>
            {t("desk.deferred_toast")}
          </Txt>
          <Pressable testID="swipe-undo-button" accessibilityRole="button" onPress={() => undoDefer(undo)} hitSlop={8}>
            <Txt variant="nav" style={{ color: theme.s0 }}>
              {t("action.undo")}
            </Txt>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.deck}>
        {listError && !rows ? (
          <View style={styles.empty}>
            <Txt variant="body">{t("officer_app.state.error_title")}</Txt>
            <ActionButton testID="swipe-retry" kind="outline" title={t("common.retry")} onPress={() => void reloadList()} />
          </View>
        ) : rows && !top ? (
          <View testID="swipe-empty" style={styles.empty}>
            {theme.civ !== "neutral" ? <Txt variant="title">{t(`empty.${theme.civ}`)}</Txt> : null}
            <Txt variant="body" tone="muted">
              {t("empty.body")}
            </Txt>
          </View>
        ) : (
          // 后面的先画(压在下面)。按下标取,不 reverse:就地翻转让编译器把 `stack`(连同 `topId`)当成会被改动的值。
          [2, 1, 0]
            .filter((depth) => depth < stack.length)
            .map((depth) => {
              const j = stack[depth];
              if (depth > 0) {
                return (
                  <View
                    key={j.id}
                    pointerEvents="none"
                    importantForAccessibility="no-hide-descendants"
                    style={[styles.card, { backgroundColor: theme.s1, borderColor: theme.hair, opacity: depth === 1 ? 0.6 : 0.35, transform: [{ translateY: depth * 12 }, { scale: 1 - depth * 0.05 }] }]}
                  >
                    <CardBody j={j} />
                  </View>
                );
              }
              return (
                <GestureDetector key={j.id} gesture={drag}>
                <Animated.View
                  testID={`swipe-card-${j.id}`}
                  style={[
                    styles.card,
                    { backgroundColor: theme.s1, borderColor: theme.hair2, transformOrigin: "bottom", transform: [{ translateX: pan }, { translateY: lift }, { rotate }] },
                  ]}
                >
                  <CardBody j={j} detail={current} />
                  <Stamp label={t("judgment.verdicts.passed")} color={theme.pos} opacity={passInk} style={{ top: space[6], left: space[5], transform: [{ rotate: "-12deg" }] }} />
                  <Stamp label={t("judgment.verdicts.failed")} color={theme.neg} opacity={failInk} style={{ top: space[6], right: space[5], transform: [{ rotate: "12deg" }] }} />
                  <Stamp label={t("judgment.queue.defer")} color={theme.inkMuted} opacity={deferInk} dashed style={{ top: space[6], alignSelf: "center" }} />
                </Animated.View>
                </GestureDetector>
              );
            })
        )}
      </View>

      {hint ? (
        <View testID="swipe-blocked-hint" accessibilityLiveRegion="polite" style={[styles.hint, { backgroundColor: theme.warnBg }]}>
          <Icon name="info" size={14} color={theme.warn} />
          <Txt variant="caption">{t("reject_reason.eg.scale_decided")}</Txt>
        </View>
      ) : held ? (
        <Txt variant="caption" tone="muted" style={styles.hintText}>
          {t("swipe.hold_release")}
        </Txt>
      ) : null}

      {top ? (
        <View style={styles.controls}>
          <View style={styles.buttons}>
            <RoundButton
              testID="swipe-fail"
              size={60}
              label={t("judgment.verdicts.failed")}
              disabled={!canAct || blocked === "left"}
              border={theme.neg}
              onPress={fail}
            >
              <Icon name="close" size={22} color={theme.neg} strokeWidth={1.6} />
            </RoundButton>
            <Pressable
              testID="swipe-hold"
              accessibilityRole="button"
              accessibilityLabel={t("swipe.hint.hold")}
              accessibilityState={{ disabled: !canAct }}
              disabled={!canAct}
              delayLongPress={HOLD_MS}
              onPressIn={holdIn}
              onLongPress={() => setHeld(true)}
              onPressOut={holdOut}
              style={[styles.round, { width: 60, height: 60, borderColor: theme.hair2, opacity: canAct ? 1 : 0.4 }]}
            >
              <Svg width={60} height={60} style={StyleSheet.absoluteFill}>
                <AnimatedCircle
                  cx={RING}
                  cy={RING}
                  r={RING - 2}
                  stroke={theme.ink}
                  strokeWidth={2}
                  fill="none"
                  strokeDasharray={`${RING_C}`}
                  strokeDashoffset={ring}
                  transform={`rotate(-90 ${RING} ${RING})`}
                />
              </Svg>
              <Icon name="clock" size={20} color={theme.ink} />
            </Pressable>
            <RoundButton
              testID="swipe-pass"
              size={72}
              label={t("judgment.verdicts.passed")}
              disabled={!canAct || blocked === "right"}
              fill={theme.plaqueFill}
              onPress={pass}
            >
              <Icon name="check" size={26} color={theme.onPlaque} strokeWidth={1.6} />
            </RoundButton>
          </View>
          <View style={styles.labels}>
            <Txt variant="caption" tone="muted">{t("swipe.hint.left")}</Txt>
            <Txt variant="caption" tone="muted">{t("swipe.hint.hold")}</Txt>
            <Txt variant="caption" tone="muted">{t("swipe.hint.right")}</Txt>
          </View>
        </View>
      ) : null}

      {current ? (
        <>
          <RejectSheet key={`reject-${current.id}`} open={overlay === "reject"} judgment={current} busy={busy} onCancel={putBack} onConfirm={send} />
          <AccountSheet key={`pass-${current.id}`} open={overlay === "pass"} busy={busy} onCancel={putBack} onConfirm={(account) => send(passPayload("GREEK", account))} />
        </>
      ) : null}
      {top ? (
        <ReasonSheet
          key={`defer-${top.id}`}
          open={overlay === "defer"}
          testID="swipe-defer-sheet"
          title={t("officer_app.case.defer_title")}
          body={t("queue.deferred_hint")}
          label={t("officer_app.case.defer_reason")}
          confirm={t("officer_app.case.defer_confirm")}
          data={top}
          onClose={dropHold}
          onSubmit={(reason) =>
            judgmentApi.defer(top.id, reason.trim()).then(() => {
              hold.setValue(0);
              finish(top.id);
              setUndo(top);
            })
          }
        />
      ) : null}
    </View>
  );
}

/**
 * 卡面:名字、案号与已等几天、期限,和这一文明的读数(地府功 / 过,埃及天平)。
 * 七宗罪不上卡面(用户 2026-11-07):它只在炼狱判决里列 —— 展开详情与判决文书照旧。
 */
function CardBody({ j, detail }: { j: Judgment; detail?: JudgmentDetail | null }) {
  const { t } = useI18n();
  const weighed = detail?.admitted_balance?.weighing?.weighed_verdict;
  return (
    <View style={{ gap: space[2] }}>
      <Txt variant="display">{j.soul_name}</Txt>
      <Txt variant="caption" tone="muted">
        {t("swipe.waited", { case: j.case_number, n: String(waitedDays(j)) })}
      </Txt>
      <Txt variant="caption" tone={j.is_overdue ? "neg" : "muted"} testID={`swipe-deadline-${j.id}`}>
        {`${t("queue.col.deadline")} · ${deadlineText(t, j)}`}
      </Txt>
      {j.civilization === "CHINESE" && j.merit_score != null ? (
        <Txt variant="valueLg">{`${j.merit_score}/${j.demerit_score ?? 0}`}</Txt>
      ) : j.civilization === "EGYPTIAN" && weighed ? (
        <Txt variant="bodyLg">{t(weighed === "FAILED" ? "desk.eg.fail" : "desk.eg.pass")}</Txt>
      ) : null}
    </View>
  );
}

function Stamp({ label, color, opacity, dashed, style }: { label: string; color: string; opacity: Animated.AnimatedInterpolation<number>; dashed?: boolean; style: ViewStyle }) {
  return (
    <Animated.View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      style={[styles.stamp, { borderColor: color, borderStyle: dashed ? "dashed" : "solid", opacity }, style]}
    >
      <Txt variant="title" style={{ color }}>
        {label}
      </Txt>
    </Animated.View>
  );
}

function RoundButton({
  testID,
  size,
  label,
  disabled,
  border,
  fill,
  onPress,
  children,
}: {
  testID: string;
  size: number;
  label: string;
  disabled: boolean;
  border?: string;
  fill?: string;
  onPress: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.round,
        { width: size, height: size, borderColor: border ?? fill ?? theme.hair2, backgroundColor: fill ?? "transparent", opacity: disabled ? 0.4 : pressed ? 0.75 : 1 },
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[5], borderBottomWidth: 1 },
  head: { paddingHorizontal: space[5], paddingTop: space[4], gap: space[1] },
  undo: { flexDirection: "row", alignItems: "center", gap: space[3], marginHorizontal: space[5], marginTop: space[3], paddingHorizontal: space[4], minHeight: 44, borderRadius: radius.control },
  deck: { flex: 1, margin: space[5] },
  card: { ...StyleSheet.absoluteFill, borderWidth: 1, borderRadius: radius.dialog, padding: space[5] },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: space[3] },
  stamp: { position: "absolute", borderWidth: 2, borderRadius: radius.control, paddingHorizontal: space[3], paddingVertical: space[1] },
  hint: { flexDirection: "row", alignItems: "center", gap: space[2], marginHorizontal: space[5], padding: space[3], borderRadius: radius.control },
  hintText: { textAlign: "center", paddingHorizontal: space[5] },
  controls: { paddingHorizontal: space[5], paddingBottom: space[5], gap: space[2] },
  buttons: { flexDirection: "row", alignItems: "center", justifyContent: "space-evenly" },
  round: { borderRadius: radius.pill, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  labels: { flexDirection: "row", justifyContent: "space-between" },
});
