/**
 * 灵魂来信里的图片(2026-10-10),官员 App 的线程里。
 *
 * 一条消息一张图、不带文字;第六十四批起跟其他信一样进组,按原比例放进 160×120(圆角 6,发丝线边,
 * `letterImageBox`),读屏写「一张图，没有附字」(`letters.image_alt`);点开是黑底全屏,
 * 左右滑动看线程里的每一张,点一下关闭,没有保存。官员回信暂不支持发图 —— 这里只有显示,没有选图与上传。
 *
 * 官员端没有 expo-image(不为这一处加原生模块),用 React Native 自带的 `Image`(翻页是共用的 `PhotoPager`,弹层是共用的 `FadeModal`)。
 * 地址是服务器在消息里签给当前官员的短时路径(取文件时再按码名与殿司查一次),每次打开线程重新取;
 * 取不到(过期、失去权限)就写「图片加载失败」,不留空白。
 */
import { letterImageBox } from "@soulledger/core/domain/letters";
import { mediaUrl } from "@soulledger/core/domain/postMedia";
import { useEffect, useState } from "react";
import { Image, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FadeModal, PhotoPager, Txt, space, thumbRef, useFrontPhoto, useI18n, useOnline, useTheme, Press } from "../shared";

export interface LetterImageRef {
  id: string;
  url: string;
  width: number;
  height: number;
}

/**
 * `onReload` asks the thread for fresh addresses. A picture's address is signed for an hour
 * (backend `chat/images.py::URL_TTL`); after that it fails for good unless the thread is read again.
 * The caller keys this component by the address, so a new one starts over.
 */
export function LetterImage({ image, onOpen, onReload }: { image: LetterImageRef; onOpen: () => void; onReload?: () => void }) {
  const { t } = useI18n();
  const theme = useTheme();
  const [broken, setBroken] = useState(false);
  const { offline } = useOnline();
  const box = letterImageBox(image.width, image.height);
  const label = t("letters.image_alt");
  if (broken && offline) {
    // Pictures are not cached (readCache.ts): a grey block of the picture's own shape until the network is back.
    return (
      <View testID="letter-image-later" style={{ ...box, borderRadius: 6, backgroundColor: theme.s2, alignItems: "center", justifyContent: "center" }}>
        <Txt variant="caption" tone="muted">
          {t("officer_app.offline.image_later")}
        </Txt>
      </View>
    );
  }
  if (broken) {
    return (
      <Press testID="letter-image-broken" accessibilityRole="button" disabled={!onReload} onPress={onReload} style={styles.broken}>
        <Txt variant="caption" tone="muted">
          {t("soul_app.circle.media.load_failed")}
        </Txt>
        {onReload ? (
          <Txt variant="caption" style={styles.retry}>
            {t("common.retry")}
          </Txt>
        ) : null}
      </Press>
    );
  }
  return (
    <Press
      ref={thumbRef(`letter:${image.id}`)}
      dim
      testID="letter-image"
      accessibilityRole="imagebutton"
      accessibilityLabel={label}
      onPress={onOpen}
      style={{ ...box, borderRadius: 6, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: theme.hair, backgroundColor: theme.s2 }}
    >
      <Image source={{ uri: mediaUrl(image.url) }} style={styles.fill} resizeMode="cover" accessibilityLabel={label} onError={() => setBroken(true)} />
    </Press>
  );
}

/** 黑底、左右滑动、点一下关闭。`index` 为 null 时不显示。 */
export function LetterImageViewer({ images, index, onClose }: { images: LetterImageRef[]; index: number | null; onClose: () => void }) {
  // 第六十批 P6: closing shrinks back onto the thumbnail of the picture in front (`LetterImage`'s `thumbRef`).
  const { closeTo, setFront } = useFrontPhoto("letter");
  return (
    <FadeModal visible={index !== null} onRequestClose={onClose} statusBarTranslucent closeTo={closeTo}>
      {/* 以打开的那一张为 key:每次打开都从被点的那张开始。 */}
      {index !== null ? <Pages key={index} images={images} start={index} onClose={onClose} onFront={setFront} /> : null}
    </FadeModal>
  );
}

function Pages({ images, start, onClose, onFront }: { images: LetterImageRef[]; start: number; onClose: () => void; onFront: (id: string | null) => void }) {
  const { t } = useI18n();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pageHeight = height - insets.top - insets.bottom;
  const [current, setCurrent] = useState(start);
  const frontId = images[current]?.id ?? null;
  useEffect(() => onFront(frontId), [onFront, frontId]);
  return (
    <View testID="letter-image-viewer" style={[styles.viewer, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <PhotoPager
        testID="letter-image-viewer-pages"
        items={images}
        start={start}
        keyOf={(image) => String(image.id)}
        onIndex={setCurrent}
        onClose={onClose}
        // The tap that closes is PhotoPager's: it waits out a double tap, which zooms.
        tapLabel={t("soul_app.circle.media.close")}
        renderPage={(image) => (
          <Image testID={`letter-viewer-image-${image.id}`} source={{ uri: mediaUrl(image.url) }} style={{ width, height: pageHeight }} resizeMode="contain" />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { width: "100%", height: "100%" },
  broken: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: space[2] },
  retry: { textDecorationLine: "underline" },
  viewer: { flex: 1, backgroundColor: "#000000" },
});
