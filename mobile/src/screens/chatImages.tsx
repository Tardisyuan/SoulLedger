/**
 * 书信里的图片(2026-10-10):输入栏的「图」键、会话里的图片消息、发送中的遮罩与失败重试、全屏查看。
 *
 * 规格(Design 的文字稿,画稿未到,所以只用现有组件):图和文字是两条消息,不混排;图按原比例画,
 * 最大宽为会话宽度的 60%;发送中叠半透明遮罩与进度;失败时图下写「! 没能发出 · 重试」,点它重发;
 * 全屏看图是黑底、左右滑动、点一下关闭,不提供保存(与朋友圈一致)。
 *
 * - 选图与压缩是朋友圈的同一套(`pickImages`、`compressForUpload`,见 circleMedia.tsx):长边 2048、JPEG 0.85。
 *   压缩在**选完当下**做,发件箱里存的是压缩后的本地文件 —— 那才是重启之后还在的东西。
 * - 图的文件**不在 Matrix 里**。消息里只有引用(`ChatMessage.image`),地址要向后端问
 *   (`soulChatApi.imageUrl`):后端核对「你是不是这个会话的参与方」才给一个约一小时的签名路径。
 *   缓存按图的 id(`cacheKey`),不按地址 —— 签名每次不同,按地址缓存等于每次重下;已缓存的图过期后照样显示。
 * - 老版本 App 遇到图片消息:正文是「[图片]」,走普通气泡,显示一行字,不崩(这个文件只在新版本里)。
 */
import { soulChatApi, SOUL_CHAT_ERROR_CODES } from "@soulledger/core/api/soul-chat";
import type { ChatImageRef } from "@soulledger/core/api/matrix";
import { mediaUrl } from "@soulledger/core/api/soul-social";
import { Image, type ImageSource } from "expo-image";
import { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Outgoing } from "../chat";
import { bubbleStamp } from "../chatRules";
import { useI18n } from "../i18n";
import { Loader, Txt, useTheme } from "../ui";

/** 一次最多挑几张(规格;服务器按会话限制未发出的张数,同值)。 */
export const CHAT_IMAGE_MAX = 4;
/** 图的最大宽度占会话宽度的比例(规格)。 */
export const CHAT_IMAGE_SHARE = 0.6;
/** 会话列表两侧的留白(conversation.tsx 的 `thread.paddingHorizontal`)。 */
const THREAD_GUTTER = 20;
/** 签名路径约一小时有效;留出余量,到点重新问。 */
const URL_FRESH_MS = 50 * 60_000;

// ── 取地址 ─────────────────────────────────────────────────────────────

const urls = new Map<string, { path: string; at: number }>();
const asking = new Map<string, Promise<string>>();

/** 图 `id` 此刻可用的完整地址。同一张图同时被问只发一个请求。 */
function resolveImage(id: string, force = false): Promise<string> {
  const known = urls.get(id);
  if (known && !force && Date.now() - known.at < URL_FRESH_MS) return Promise.resolve(mediaUrl(known.path));
  const inFlight = asking.get(id);
  if (inFlight) return inFlight;
  const request = soulChatApi
    .imageUrl(id)
    .then((view) => {
      urls.set(id, { path: view.url, at: Date.now() });
      return mediaUrl(view.url);
    })
    .finally(() => asking.delete(id));
  asking.set(id, request);
  return request;
}

/** 测试用:忘掉记过的地址。 */
export function forgetChatImageUrls() {
  urls.clear();
  asking.clear();
}

/** 图的来源:向后端要地址,缓存按 id。`failed`:要不到(不是参与方、网络、地址过期)。 */
export function useChatImageSource(id: string): { source: ImageSource | null; failed: boolean; reload: () => void } {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [round, setRound] = useState(0);
  useEffect(() => {
    let alive = true;
    resolveImage(id, round > 0)
      .then((u) => alive && (setUri(u), setFailed(false)))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [id, round]);
  const reload = useCallback(() => setRound((n) => n + 1), []);
  return { source: uri ? { uri, cacheKey: `chat-image:${id}` } : null, failed, reload };
}

// ── 尺寸 ───────────────────────────────────────────────────────────────

/** 图的显示宽:会话宽度的 60%(会话宽度 = 屏宽减两侧留白)。 */
export function useChatImageWidth(): number {
  const { width } = useWindowDimensions();
  return Math.round(Math.max(0, width - 2 * THREAD_GUTTER) * CHAT_IMAGE_SHARE);
}

const ratio = (w?: number, h?: number) => (w && h && w > 0 && h > 0 ? w / h : 1);

// ── 会话里的图片消息 ──────────────────────────────────────────────────

function Picture({ image, width, onPress, testID }: { image: ChatImageRef; width: number; onPress?: () => void; testID: string }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { source, failed, reload } = useChatImageSource(image.id);
  const frame = [styles.frame, { width, aspectRatio: ratio(image.width, image.height), borderColor: t.hair2, backgroundColor: t.s2 }];
  return (
    <Pressable testID={testID} accessibilityRole="imagebutton" accessibilityLabel={tr("soul_app.circle.media.image", { i: "1" })} onPress={onPress} style={frame}>
      {failed && !source ? (
        <Pressable testID={`${testID}-broken`} accessibilityRole="button" onPress={reload} style={styles.center}>
          <Txt variant="caption" tone="subtle" style={styles.centered}>
            {tr("soul_app.circle.media.load_failed")}
          </Txt>
        </Pressable>
      ) : source ? (
        // 已缓存的图过期后照样显示;缓存里没有、地址又过期了才会落到 onError → 重新要一个地址。
        <Image source={source} style={styles.fill} contentFit="cover" cachePolicy="memory-disk" transition={0} onError={reload} />
      ) : null}
    </Pressable>
  );
}

/** 一条图片消息(对方的或我的):图 + 时间。图片不套气泡的文字边框,只有细线框。 */
export function ChatImageMessage({ image, mine, ts, now, onOpen, receipt }: { image: ChatImageRef; mine?: boolean; ts: number; now: number; onOpen: () => void; receipt?: string }) {
  const width = useChatImageWidth();
  return (
    <View style={[styles.row, mine && styles.mineRow]}>
      <View testID="chat-image-message" style={mine ? styles.endAligned : undefined}>
        <Picture image={image} width={width} onPress={onOpen} testID="chat-image" />
        <View style={[styles.meta, mine && styles.metaMine]}>
          <Txt variant="value" tone="subtle" style={styles.metaTime}>
            {bubbleStamp(ts, now)}
          </Txt>
          {receipt ? (
            <Txt variant="label" tone="subtle" style={styles.metaText}>
              {receipt}
            </Txt>
          ) : null}
        </View>
      </View>
    </View>
  );
}

// ── 发件箱里的图片 ─────────────────────────────────────────────────────

/** 失败的图是不是还值得再试:服务器说了「不行」的(静音、已关闭、文件本身不合格)不再试。 */
const retryable = (o: Outgoing) => o.state === "failed" && !o.refused;

/** 失败的原因行(有明确原因时);没有原因的失败只有「没能发出 · 重试」。 */
function reasonKey(code: string): string | null {
  if (code === "images_unavailable") return "soul_app.chat.image.errors.images_unavailable";
  if (code === "not_an_image" || code === "too_large" || code === "too_many_pixels") return `soul_app.circle.media.errors.${code}`;
  return (SOUL_CHAT_ERROR_CODES as readonly string[]).includes(code) ? `soul_app.chat.errors.${code === "self_conversation" ? "self" : code}` : null;
}

/** 还没送达的图:本地文件、发送中的遮罩与进度、失败的重试。 */
export function PendingImage({ o, progress, onResend }: { o: Outgoing; progress: number | undefined; onResend: () => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const width = useChatImageWidth();
  const image = o.image!;
  const failed = o.state === "failed";
  const percent = Math.round((progress ?? 0) * 100);
  const reason = o.refused ? reasonKey(o.refused.code) : null;
  return (
    <View style={[styles.row, styles.mineRow]}>
      <View testID={`pending-image-${o.state}`} style={styles.endAligned}>
        <View
          accessibilityLabel={tr("soul_app.circle.media.image", { i: "1" })}
          accessibilityState={{ busy: !failed }}
          style={[styles.frame, { width, aspectRatio: ratio(image.width, image.height), borderColor: failed ? t.negStrong : t.hair2, backgroundColor: t.s2 }]}
        >
          {/* 本机的文件:不进磁盘缓存(那只是把它再抄一份)。 */}
          <Image source={{ uri: image.uri }} style={styles.fill} contentFit="cover" cachePolicy="memory" transition={0} />
          {failed ? null : (
            <View testID="pending-image-mask" style={[styles.mask, { backgroundColor: t.scrim }]}>
              {o.state === "sending" && progress !== undefined && progress < 1 ? (
                <Txt testID="pending-image-progress" variant="value" tone="ink" style={styles.progress}>
                  {tr("soul_app.circle.media.uploading", { percent: String(percent) })}
                </Txt>
              ) : (
                <Loader size={16} testID="pending-image-wait" />
              )}
              {o.state === "queued" ? (
                <Txt variant="label" tone="ink" style={styles.metaText}>
                  {tr("soul_app.chat.receipt.queued")}
                </Txt>
              ) : null}
            </View>
          )}
        </View>
        {failed ? (
          <View style={styles.failedRow}>
            <Txt testID="pending-image-error" variant="label" tone="negInk" style={styles.metaText}>
              {`! ${tr("soul_app.chat.image.failed")}`}
            </Txt>
            {retryable(o) ? (
              <Pressable testID="resend" accessibilityRole="button" onPress={onResend} hitSlop={15}>
                <Txt variant="label" tone="ink" style={[styles.metaText, styles.underline]}>
                  {` · ${tr("soul_app.circle.media.retry")}`}
                </Txt>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {failed && reason ? (
          <Txt testID="pending-image-reason" variant="caption" tone="muted" style={styles.reason}>
            {tr(reason)}
          </Txt>
        ) : null}
      </View>
    </View>
  );
}

// ── 全屏查看 ───────────────────────────────────────────────────────────

/** 黑底、左右滑动、点一下关闭;没有保存、没有任何按钮(与朋友圈一致)。`index` 为 null 时不显示。 */
export function ChatImageViewer({ images, index, onClose }: { images: ChatImageRef[]; index: number | null; onClose: () => void }) {
  return (
    <Modal visible={index !== null} animationType="fade" onRequestClose={onClose} transparent={false} statusBarTranslucent>
      {/* 以打开的那一张为 key:每次打开都从被点的那张开始。 */}
      {index !== null ? <ViewerPages key={index} images={images} start={index} onClose={onClose} /> : null}
    </Modal>
  );
}

function ViewerPage({ image, width, height, onClose }: { image: ChatImageRef; width: number; height: number; onClose: () => void }) {
  const { t: tr } = useI18n();
  const { source, failed, reload } = useChatImageSource(image.id);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={tr("soul_app.circle.media.close")} onPress={onClose} style={{ width, height, justifyContent: "center", alignItems: "center" }}>
      {source ? (
        <Image testID={`chat-viewer-image-${image.id}`} source={source} contentFit="contain" cachePolicy="memory-disk" transition={0} style={{ width, height }} onError={reload} />
      ) : failed ? (
        <Txt variant="caption" style={styles.viewerText}>
          {tr("soul_app.circle.media.load_failed")}
        </Txt>
      ) : (
        <Loader size={20} />
      )}
    </Pressable>
  );
}

function ViewerPages({ images, start, onClose }: { images: ChatImageRef[]; start: number; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pageHeight = height - insets.top - insets.bottom;
  return (
    <View testID="chat-image-viewer" style={[styles.viewer, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <ScrollView testID="chat-image-viewer-pages" horizontal pagingEnabled showsHorizontalScrollIndicator={false} contentOffset={{ x: start * width, y: 0 }}>
        {images.map((image) => (
          <ViewerPage key={image.id} image={image} width={width} height={pageHeight} onClose={onClose} />
        ))}
      </ScrollView>
    </View>
  );
}

// ── 输入栏的「图」键 ───────────────────────────────────────────────────

/** 44×44(Android 48),在输入框左侧。`disabled`:正在选图时不再接第二次点击。 */
export function ImageButton({ size, onPress, disabled }: { size: number; onPress: () => void; disabled?: boolean }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  return (
    <Pressable
      testID="chat-image-add"
      accessibilityRole="button"
      accessibilityLabel={tr("soul_app.circle.media.add")}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { width: size, height: size, borderColor: t.hair2, backgroundColor: pressed ? t.s1 : "transparent" }]}
    >
      <Txt style={[styles.buttonText, { color: t.ink }]}>{tr("soul_app.chat.image.button")}</Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { width: "100%", height: "100%" },
  row: { flexDirection: "row", marginBottom: 16 },
  mineRow: { justifyContent: "flex-end" },
  endAligned: { alignItems: "flex-end" },
  frame: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 0, overflow: "hidden" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 8 },
  centered: { textAlign: "center" },
  mask: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", gap: 8 },
  progress: { fontSize: 12 },
  meta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  metaMine: { justifyContent: "flex-end" },
  metaTime: { fontSize: 11, lineHeight: 14 },
  metaText: { fontSize: 11, lineHeight: 14, letterSpacing: 0 },
  failedRow: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  underline: { textDecorationLine: "underline" },
  reason: { marginTop: 2 },
  viewer: { flex: 1, backgroundColor: "#000000" },
  viewerText: { color: "#FFFFFF" },
  button: { borderWidth: 1, alignItems: "center", justifyContent: "center" },
  buttonText: { fontSize: 15, lineHeight: 20 },
});
