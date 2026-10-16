/**
 * 附件列表,审判案情(O-10)与待办详情(O-01)共用一份(Design 第三十四批)。
 * 图片在书信的图片查看里打开,PDF 交给系统(行尾 ↗︎);断网时 PDF 行置灰并写「联网后才能打开」。
 * 两处只差地址从哪来:待办详情随数据带着签名地址,审判附件要点开时再取一个 10 分钟有效的(`resolve`)。
 */
import { mediaUrl } from "@soulledger/core/domain/postMedia";
import { useState } from "react";
import { Linking, Pressable, View } from "react-native";

import { LetterImageViewer } from "./screens/letterImages";
import { Txt, space, useI18n, useOnline, useTheme, useToast } from "./shared";
import { isPdf, sizeText } from "./todoFacts";

export type AttachmentItem = {
  id: string;
  name: string;
  content_type: string;
  byte_size: number;
  /** 随数据带来的签名地址;没有就点开时用 `resolve` 取。 */
  url?: string;
  /** 第二行末尾的补充,如「上传人 · 时间」。 */
  meta?: string;
};

type Shown = { images: { id: string; url: string; width: number; height: number }[]; index: number };

export function AttachmentList({ items, resolve }: { items: readonly AttachmentItem[]; resolve?: (a: AttachmentItem) => Promise<string> }) {
  const { t } = useI18n();
  const theme = useTheme();
  const toast = useToast();
  const { offline } = useOnline();
  const [opening, setOpening] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const urlOf = (a: AttachmentItem) => (a.url ? Promise.resolve(a.url) : resolve ? resolve(a) : Promise.reject(new Error("no url")));
  const open = (a: AttachmentItem) => {
    if (opening) return;
    if (!isPdf(a.content_type)) {
      const images = items.filter((x) => !isPdf(x.content_type));
      if (images.every((x) => x.url)) {
        setShown({ images: images.map((x) => ({ id: x.id, url: x.url as string, width: 1, height: 1 })), index: Math.max(0, images.findIndex((x) => x.id === a.id)) });
        return;
      }
      // ponytail: 地址要现取时只看被点的这一张,不能左右翻;要翻页就一次取全部签名地址。
      setOpening(a.id);
      urlOf(a)
        .then((url) => setShown({ images: [{ id: a.id, url, width: 1, height: 1 }], index: 0 }))
        .catch(() => toast(t("officer_app.detail.attachment_failed"), "failure"))
        .finally(() => setOpening(null));
      return;
    }
    setOpening(a.id);
    urlOf(a)
      .then((url) => Linking.openURL(mediaUrl(url)))
      .catch(() => toast(t("officer_app.detail.attachment_failed"), "failure"))
      .finally(() => setOpening(null));
  };
  return (
    <View style={{ gap: space[2] }}>
      {items.map((a) => {
        const pdf = isPdf(a.content_type);
        const blocked = pdf && offline;
        const second = [pdf ? "PDF" : "IMG", sizeText(a.byte_size), a.meta, blocked ? t("officer_app.detail.attachment_offline") : pdf ? t("officer_app.detail.open_system") : null].filter(Boolean).join(" · ");
        return (
          <Pressable
            key={a.id}
            testID={`attachment-${a.id}`}
            accessibilityRole="button"
            accessibilityState={{ disabled: blocked, busy: opening === a.id }}
            disabled={blocked}
            onPress={() => open(a)}
            style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: space[3], borderBottomWidth: 1, borderBottomColor: theme.hair, opacity: blocked ? 0.5 : 1 }}
          >
            <View style={{ flex: 1, gap: space[1] }}>
              <Txt variant="body" numberOfLines={1}>{a.name}</Txt>
              <Txt variant="caption" tone="muted">{second}</Txt>
            </View>
            <Txt variant="nav">{pdf ? "↗︎" : "›"}</Txt>
          </Pressable>
        );
      })}
      <LetterImageViewer images={shown?.images ?? []} index={shown ? shown.index : null} onClose={() => setShown(null)} />
    </View>
  );
}
