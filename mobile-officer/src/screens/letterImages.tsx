/**
 * 灵魂来信里的图片(2026-10-10),官员 App 的线程里。
 *
 * 排法与灵魂端一致:一条消息一张图、不带文字;按原比例、宽不超过线程宽度的 60%;点开是黑底全屏,
 * 左右滑动看线程里的每一张,点一下关闭,没有保存。官员回信暂不支持发图 —— 这里只有显示,没有选图与上传。
 *
 * 官员端没有 expo-image(不为这一处加原生模块),用 React Native 自带的 `Image`、`Modal`、`ScrollView`。
 * 地址是服务器在消息里签给当前官员的短时路径(取文件时再按码名与殿司查一次),每次打开线程重新取;
 * 取不到(过期、失去权限)就写「图片加载失败」,不留空白。
 */
import { mediaUrl } from "@soulledger/core/domain/postMedia";
import { useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Txt, space, useI18n, useTheme } from "../shared";

export interface LetterImageRef {
  id: string;
  url: string;
  width: number;
  height: number;
}

/** 图的最大宽度占线程内容宽度的比例(规格)。线程两侧各留 `space[5]`。 */
export const LETTER_IMAGE_SHARE = 0.6;

export function LetterImage({ image, onOpen }: { image: LetterImageRef; onOpen: () => void }) {
  const { t } = useI18n();
  const theme = useTheme();
  const { width: screen } = useWindowDimensions();
  const [broken, setBroken] = useState(false);
  const width = Math.round(Math.max(0, screen - 2 * space[5]) * LETTER_IMAGE_SHARE);
  const label = t("soul_app.circle.media.image", { i: "1" });
  if (broken) {
    return (
      <Txt testID="letter-image-broken" variant="caption" tone="muted">
        {t("soul_app.circle.media.load_failed")}
      </Txt>
    );
  }
  return (
    <Pressable
      testID="letter-image"
      accessibilityRole="imagebutton"
      accessibilityLabel={label}
      onPress={onOpen}
      style={{ width, aspectRatio: image.width / image.height, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.hair, backgroundColor: theme.s2 }}
    >
      <Image source={{ uri: mediaUrl(image.url) }} style={styles.fill} resizeMode="cover" accessibilityLabel={label} onError={() => setBroken(true)} />
    </Pressable>
  );
}

/** 黑底、左右滑动、点一下关闭。`index` 为 null 时不显示。 */
export function LetterImageViewer({ images, index, onClose }: { images: LetterImageRef[]; index: number | null; onClose: () => void }) {
  return (
    <Modal visible={index !== null} animationType="fade" transparent={false} onRequestClose={onClose} statusBarTranslucent>
      {/* 以打开的那一张为 key:每次打开都从被点的那张开始。 */}
      {index !== null ? <Pages key={index} images={images} start={index} onClose={onClose} /> : null}
    </Modal>
  );
}

function Pages({ images, start, onClose }: { images: LetterImageRef[]; start: number; onClose: () => void }) {
  const { t } = useI18n();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pageHeight = height - insets.top - insets.bottom;
  return (
    <View testID="letter-image-viewer" style={[styles.viewer, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <ScrollView testID="letter-image-viewer-pages" horizontal pagingEnabled showsHorizontalScrollIndicator={false} contentOffset={{ x: start * width, y: 0 }}>
        {images.map((image) => (
          <Pressable
            key={image.id}
            accessibilityRole="button"
            accessibilityLabel={t("soul_app.circle.media.close")}
            onPress={onClose}
            style={{ width, height: pageHeight, justifyContent: "center" }}
          >
            <Image testID={`letter-viewer-image-${image.id}`} source={{ uri: mediaUrl(image.url) }} style={{ width, height: pageHeight }} resizeMode="contain" />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { width: "100%", height: "100%" },
  viewer: { flex: 1, backgroundColor: "#000000" },
});
