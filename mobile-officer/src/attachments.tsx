/**
 * 案卷附件列表(Design 第三十四批 O-10;O-01 的书信待办详情用同一份版式)。
 * 这是审判详情先建的小版本,若 O-01 那一支另有同名组件,合并时只留一份。
 * 点一行:取 10 分钟有效的签名地址,交给系统打开(图片、PDF);取不到就 toast。
 */
import { judgmentApi, type CaseAttachment } from "@soulledger/core/api/judgment";
import { mediaUrl } from "@soulledger/core/domain/postMedia";
import { useState } from "react";
import { Linking } from "react-native";

import { formatWhen } from "./format";
import { Row } from "./kit";
import { Txt, useI18n, useToast } from "./shared";

export function AttachmentList({ judgmentId, items }: { judgmentId: string; items: readonly CaseAttachment[] }) {
  const { t } = useI18n();
  const toast = useToast();
  const [opening, setOpening] = useState<string | null>(null);
  const open = (a: CaseAttachment) => {
    if (opening) return;
    setOpening(a.id);
    judgmentApi
      .attachmentLink(judgmentId, a.id)
      .then((link) => Linking.openURL(mediaUrl(link.url)))
      .catch(() => toast(t("officer_app.case.load_failed"), "failure"))
      .finally(() => setOpening(null));
  };
  return (
    <>
      {items.map((a) => (
        <Row
          key={a.id}
          testID={`attachment-${a.id}`}
          minHeight={56}
          title={a.name}
          lines={[`${a.uploader_name} · ${formatWhen(a.created_at)}`]}
          onPress={() => open(a)}
          right={<Txt variant="nav">›</Txt>}
        />
      ))}
    </>
  );
}
