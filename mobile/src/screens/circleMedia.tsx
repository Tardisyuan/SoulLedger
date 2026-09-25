/**
 * 朋友圈帖子图片:动态流与帖子里的方格、全屏查看、写帖子时的上传格。
 *
 * - 方格(`MediaGrid`):1 张一大格;2–4 张两列;5–9 张三列。方角,细线框,不圆角
 *   (theme.ts `radius.none`)——与审核后台 C-08 的 MediaTile 同一个样子。
 * - 地址是服务器签给当前灵魂的短时路径(约一小时),经 `mediaUrl` 接到 API 的主机上;
 *   过期或帖子被隐藏后取不到,格子里写「图片加载失败」,不留一个空白。
 * - 上传(`ComposeMediaTray`):一张一个请求,各自的进度与失败;失败的可重试或移除。
 *   传之前先在本机压缩(`compressForUpload`:长边 2048、JPEG 0.85)。expo-image-manipulator 是
 *   原生模块:加它之后 dev client 要重新构建(`npx expo run:ios` / `run:android`),旧的 dev client 里没有它。
 *   发出按钮在还有图在传、或有图没传上去时不可用 —— 见 ComposePostScreen。
 */
import { mediaGridColumns, mediaUrl, SOUL_POST_MEDIA_MAX, type PostMedia } from "@soulledger/core/api/soul-social";
import type { useSoulMediaUploads } from "@soulledger/core/hooks/useSoulMediaUploads";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "../emblems";
import { useI18n } from "../i18n";
import { Txt, useLayout, useTheme } from "../ui";

const GAP = 3;

/** 列数:1 张一大格,2–4 张两列,5–9 张三列(与审核后台同一条规则,定义在 core)。 */
export const gridColumns = mediaGridColumns;

/** 内容宽度:屏宽减两侧留白。测试环境里没有 onLayout,所以不靠它。 */
function useContentWidth(): number {
  const { width } = useWindowDimensions();
  const { gutter } = useLayout();
  return Math.max(0, width - 2 * gutter);
}

function Tile({ uri, size, label, testID, onPress }: { uri: string; size: number; label: string; testID: string; onPress?: () => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [broken, setBroken] = useState(false);
  return (
    <Pressable
      testID={testID}
      accessibilityRole={onPress ? "imagebutton" : "image"}
      accessibilityLabel={label}
      disabled={!onPress}
      onPress={onPress}
      style={[styles.tile, { width: size, height: size, borderColor: t.hair, backgroundColor: t.s2 }]}
    >
      {broken ? (
        <Txt testID={`${testID}-broken`} variant="caption" tone="subtle" style={styles.broken}>
          {tr("soul_app.circle.media.load_failed")}
        </Txt>
      ) : (
        <Image source={{ uri }} style={styles.fill} resizeMode="cover" onError={() => setBroken(true)} />
      )}
    </Pressable>
  );
}

/** 帖子的图片方格。`onOpen(i)` 打开全屏查看。 */
export function MediaGrid({ media, onOpen, testID = "media-grid" }: { media: PostMedia[]; onOpen: (index: number) => void; testID?: string }) {
  const { t: tr } = useI18n();
  const width = useContentWidth();
  if (!media.length) return null;
  const cols = gridColumns(media.length);
  const size = cols === 1 ? Math.round((width * 2) / 3) : Math.floor((width - GAP * (cols - 1)) / cols);
  return (
    <View testID={testID} accessibilityLabel={tr("soul_app.circle.media.count", { n: String(media.length), max: String(SOUL_POST_MEDIA_MAX) })} style={[styles.grid, { width: cols === 1 ? size : width }]}>
      {media.map((m, i) => (
        <Tile
          key={m.id}
          testID={`${testID}-tile-${i}`}
          uri={mediaUrl(m.url)}
          size={size}
          label={tr("soul_app.circle.media.image", { i: String(i + 1) })}
          onPress={() => onOpen(i)}
        />
      ))}
    </View>
  );
}

/** 全屏查看:左右翻页,顶上是「图片 i / n」与关闭。 */
export function MediaViewer({ media, index, onClose }: { media: PostMedia[]; index: number | null; onClose: () => void }) {
  return (
    <Modal visible={index !== null} animationType="fade" onRequestClose={onClose} transparent={false}>
      {/* 以打开的那一张为 key:每次打开都从被点的那张开始,计数与页一致。 */}
      {index !== null ? <ViewerPages key={index} media={media} start={index} onClose={onClose} /> : null}
    </Modal>
  );
}

function ViewerPages({ media, start, onClose }: { media: PostMedia[]; start: number; onClose: () => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState(start);
  return (
    <View testID="media-viewer" style={[styles.viewer, { backgroundColor: t.s0, paddingTop: insets.top }]}>
      <View style={[styles.viewerBar, { borderBottomColor: t.hair }]}>
        <Txt testID="media-viewer-counter" variant="value" tone="muted">
          {tr("soul_app.circle.media.viewer", { i: String(current + 1), n: String(media.length) })}
        </Txt>
        <Pressable testID="media-viewer-close" accessibilityRole="button" accessibilityLabel={tr("soul_app.circle.media.close")} onPress={onClose} hitSlop={10}>
          <Icon name="close" size={18} color={t.ink} />
        </Pressable>
      </View>
      <ScrollView
        testID="media-viewer-pages"
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        contentOffset={{ x: start * width, y: 0 }}
        onMomentumScrollEnd={(e) => setCurrent(Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width)))}
      >
        {media.map((m, i) => (
          <Image
            key={m.id}
            testID={`media-viewer-image-${i}`}
            accessibilityLabel={tr("soul_app.circle.media.viewer", { i: String(i + 1), n: String(media.length) })}
            source={{ uri: mediaUrl(m.url) }}
            resizeMode="contain"
            style={{ width, height: height - insets.top - insets.bottom - 48 }}
          />
        ))}
      </ScrollView>
    </View>
  );
}

// ── 写帖子 ─────────────────────────────────────────────────────────────

/** 图库里选出的一张:上传用它的 uri,名字与类型只是给 multipart 的,服务器不信它们。 */
export type PickedImage = { uri: string; name: string; type: string };

/** 上传前把长边缩到这么多像素以内(2026-09-26 产品定)。服务器的限制不变,这只是让多数图远在它之内。 */
export const UPLOAD_LONG_EDGE = 2048;
export const UPLOAD_JPEG_QUALITY = 0.85;

/**
 * 上传前压缩:长边超过 2048 就等比缩到 2048,然后**一律**重新编码成 JPEG(质量 0.85)。
 * 不留 PNG(产品给的两个选项里取「只出 JPEG」):带透明的 PNG 透明处会被铺底,朋友圈是照片为主,
 * 为少数贴图去判透明不值得。
 * 尺寸取解码后的图(不信图库报的宽高:那可能是旋转之前的)。
 * 压缩失败(格式解不开之类)就传原图 —— 服务器照旧校验,能不能收由它说。
 */
export async function compressForUpload(image: PickedImage): Promise<PickedImage> {
  try {
    const decoded = await ImageManipulator.manipulate(image.uri).renderAsync();
    const long = Math.max(decoded.width, decoded.height);
    const fitted =
      long > UPLOAD_LONG_EDGE
        ? await ImageManipulator.manipulate(decoded)
            .resize(decoded.width >= decoded.height ? { width: UPLOAD_LONG_EDGE } : { height: UPLOAD_LONG_EDGE })
            .renderAsync()
        : decoded;
    const saved = await fitted.saveAsync({ format: SaveFormat.JPEG, compress: UPLOAD_JPEG_QUALITY });
    return { uri: saved.uri, name: image.name.replace(/\.[^.]*$/, "") + ".jpg", type: "image/jpeg" };
  } catch {
    return image;
  }
}

/** 一张图的 multipart 请求体(先压缩)。字段名 `file`(backend `MeSocialMediaView`)。 */
export async function uploadBody(image: PickedImage): Promise<FormData> {
  const body = new FormData();
  // React Native 的 FormData 收 `{ uri, name, type }` 这种文件描述;DOM 的类型不认它。
  body.append("file", (await compressForUpload(image)) as unknown as Blob);
  return body;
}

/**
 * 打开系统图库,最多选 `room` 张。`quality` < 1 让 iOS 把 HEIC 转成 JPEG(服务器只收
 * PNG / JPEG / WebP),也让一张手机原图多半落在 5 MB 之内;`exif: false` 本地也不读 EXIF
 * —— 服务器反正会去掉。返回 null:没有相册权限。
 */
export async function pickImages(room: number): Promise<PickedImage[] | null> {
  if (room <= 0) return [];
  try {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: room,
      orderedSelection: true,
      quality: 0.8,
      exif: false,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (res.canceled) return [];
    return res.assets.slice(0, room).map((a, i) => ({
      uri: a.uri,
      name: a.fileName ?? `image-${i + 1}.jpg`,
      type: a.mimeType ?? "image/jpeg",
    }));
  } catch {
    return null;
  }
}

type Uploads = ReturnType<typeof useSoulMediaUploads<PickedImage>>;

/** 写帖子时的图片格:三列,每格一张,最后一格是「添加图片」。 */
export function ComposeMediaTray({ uploads, onAdd }: { uploads: Uploads; onAdd: () => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const width = useContentWidth();
  const size = Math.floor((width - GAP * 2) / 3);
  return (
    <View testID="compose-media">
      <View style={styles.grid}>
        {uploads.items.map((it, i) => {
          const failed = it.status === "failed";
          const uploading = it.status === "uploading";
          const percent = Math.round(it.progress * 100);
          return (
            <View
              key={it.key}
              testID={`upload-${i}`}
              accessibilityLabel={tr("soul_app.circle.media.image", { i: String(i + 1) })}
              accessibilityState={{ busy: uploading }}
              style={[styles.tile, { width: size, height: size, borderColor: failed ? t.negStrong : t.hair, backgroundColor: t.s2 }]}
            >
              <Image source={{ uri: it.source.uri }} style={[styles.fill, (uploading || failed) && styles.dim]} resizeMode="cover" />
              {uploading ? (
                <View style={styles.overlay}>
                  <Txt testID={`upload-${i}-progress`} variant="value" tone="ink" style={styles.mono}>
                    {tr("soul_app.circle.media.uploading", { percent: String(percent) })}
                  </Txt>
                  <View style={[styles.track, { backgroundColor: t.hair }]}>
                    <View style={[styles.bar, { width: `${percent}%`, backgroundColor: t.accent }]} />
                  </View>
                </View>
              ) : null}
              {failed ? (
                <View style={[styles.overlay, { backgroundColor: t.negBg }]}>
                  <Txt testID={`upload-${i}-failed`} variant="caption" tone="negInk">
                    {tr("soul_app.circle.media.failed")}
                  </Txt>
                  <View style={styles.actions}>
                    <Pressable testID={`upload-${i}-retry`} accessibilityRole="button" onPress={() => uploads.retry(it.key)} hitSlop={6} style={[styles.action, { borderColor: t.hair2 }]}>
                      <Txt variant="label">{tr("soul_app.circle.media.retry")}</Txt>
                    </Pressable>
                    <Pressable testID={`upload-${i}-remove`} accessibilityRole="button" onPress={() => uploads.remove(it.key)} hitSlop={6} style={[styles.action, { borderColor: t.hair2 }]}>
                      <Txt variant="label">{tr("soul_app.circle.media.remove")}</Txt>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable
                  testID={`upload-${i}-remove`}
                  accessibilityRole="button"
                  accessibilityLabel={tr("soul_app.circle.media.remove")}
                  onPress={() => uploads.remove(it.key)}
                  hitSlop={6}
                  style={[styles.corner, { backgroundColor: t.s0, borderColor: t.hair2 }]}
                >
                  <Icon name="close" size={12} color={t.ink} />
                </Pressable>
              )}
            </View>
          );
        })}
        {uploads.room > 0 ? (
          <Pressable
            testID="media-add"
            accessibilityRole="button"
            accessibilityLabel={tr("soul_app.circle.media.add")}
            onPress={onAdd}
            style={[styles.tile, styles.add, { width: size, height: size, borderColor: t.hair2 }]}
          >
            <Icon name="plus" size={18} color={t.inkMuted} />
            <Txt variant="caption" tone="muted">
              {tr("soul_app.circle.media.add")}
            </Txt>
          </Pressable>
        ) : null}
      </View>
      <Txt testID="media-count" variant="value" tone="subtle" style={styles.count}>
        {tr("soul_app.circle.media.count", { n: String(uploads.items.length), max: String(SOUL_POST_MEDIA_MAX) })}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP, marginTop: 10 },
  tile: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 0, overflow: "hidden", justifyContent: "center", alignItems: "center" },
  fill: { width: "100%", height: "100%" },
  dim: { opacity: 0.45 },
  broken: { textAlign: "center", paddingHorizontal: 6 },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, justifyContent: "flex-end", padding: 6, gap: 4 },
  mono: { fontSize: 11 },
  track: { height: 3, width: "100%" },
  bar: { height: 3 },
  actions: { flexDirection: "row", gap: 4, flexWrap: "wrap" },
  action: { borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  corner: { position: "absolute", top: 4, right: 4, width: 22, height: 22, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  add: { borderStyle: "dashed", borderWidth: 1, gap: 4 },
  count: { marginTop: 6, fontSize: 11 },
  viewer: { flex: 1 },
  viewerBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, height: 48, borderBottomWidth: StyleSheet.hairlineWidth },
});
