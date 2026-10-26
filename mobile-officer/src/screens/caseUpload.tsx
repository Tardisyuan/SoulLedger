/**
 * 案卷附件的「添加」一侧(Design 第五十四批 P-1 / P-2):拍照 / 从相册选 / 选 PDF 三个入口,可多选,
 * 每个文件一行各自显示进度;传完通知父级重新取列表,失败的行留在原处,能重试的给「重试」,服务端明确拒绝的只给「移除」。
 * 错误文案与网页共用 `case.attachments.*`。离线三个按钮置灰并写原因;没认领(也没有 judgment.execute)只写一行;已结案不画入口。
 */
import { judgmentApi, type CaseAttachmentList } from "@soulledger/core/api/judgment";
import { useRef, useState } from "react";
import { View } from "react-native";

import { pickerAvailable, pickFiles, type Picked, type PickKind } from "../attachmentPicker";
import { ActionButton } from "../kit";
import { SmallButton, Txt, space, useI18n, useOnline } from "../shared";

type Local = { key: number; file: Picked; state: "uploading" | "failed"; percent: number; message?: string; retryable?: boolean };

const ERROR_KEY: Record<string, string> = {
  bad_type: "case.attachments.failed_type",
  too_large: "case.attachments.too_large",
  case_full: "case.attachments.full",
  too_many: "case.attachments.too_many",
};
const KINDS: { kind: PickKind; label: string }[] = [
  { kind: "camera", label: "officer_app.case.attach_camera" },
  { kind: "library", label: "officer_app.case.attach_library" },
  { kind: "file", label: "officer_app.case.attach_file" },
];

export function CaseUpload({ judgmentId, list, canWrite, onUploaded }: { judgmentId: string; list: CaseAttachmentList | null; canWrite: boolean; onUploaded: () => void }) {
  const { t } = useI18n();
  const { offline } = useOnline();
  const [rows, setRows] = useState<Local[]>([]);
  const seq = useRef(0);
  const aborts = useRef(new Map<number, AbortController>());
  const patch = (key: number, next: Partial<Local>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...next } : r)));
  const drop = (key: number) => {
    aborts.current.delete(key);
    setRows((rs) => rs.filter((r) => r.key !== key));
  };
  const maxMb = Math.round((list?.max_file_bytes ?? 20 * 1048576) / 1048576);

  if (list?.concluded) return <Txt variant="caption" tone="muted" testID="attach-concluded">{t("officer_app.case.attach_concluded")}</Txt>;
  if (!canWrite) return <Txt variant="caption" tone="muted" testID="attach-need-claim">{t("officer_app.case.attach_need_claim")}</Txt>;

  const send = async (key: number, file: Picked) => {
    const controller = new AbortController();
    aborts.current.set(key, controller);
    patch(key, { state: "uploading", percent: 0, message: undefined });
    const body = new FormData();
    // React Native 的 FormData 收 `{ uri, name, type }` 这种文件描述;DOM 的类型不认它。
    body.append("file", { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
    try {
      await judgmentApi.uploadAttachment(judgmentId, body, { signal: controller.signal, onProgress: (f) => patch(key, { percent: Math.round(f * 100) }) });
      drop(key);
      onUploaded();
    } catch (e) {
      if (controller.signal.aborted) return drop(key);
      const res = (e as { response?: { data?: { code?: string } } }).response;
      const code = res?.data?.code;
      if (code && ERROR_KEY[code]) {
        const max = code === "too_many" ? (list?.max_count ?? 30) : maxMb;
        patch(key, { state: "failed", message: t(ERROR_KEY[code], { max: String(max) }), retryable: false });
      } else {
        patch(key, { state: "failed", message: t(res ? "case.attachments.failed_generic" : "case.attachments.failed_network"), retryable: true });
      }
    }
  };

  const add = (picked: Picked[]) => {
    for (const file of picked) {
      const key = ++seq.current;
      const refuse = (message: string) => setRows((rs) => [...rs, { key, file, state: "failed", percent: 0, message, retryable: false }]);
      if (!/^(image\/|application\/pdf)/.test(file.type)) refuse(t("case.attachments.failed_type"));
      else if (file.size > (list?.max_file_bytes ?? 20 * 1048576)) refuse(t("case.attachments.too_large", { max: String(maxMb) }));
      else {
        setRows((rs) => [...rs, { key, file, state: "uploading", percent: 0 }]);
        void send(key, file);
      }
    }
  };
  const pick = (kind: PickKind) => void pickFiles(kind).then(add, () => {});

  return (
    <View testID="case-upload" style={{ gap: space[2] }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        {KINDS.filter((k) => pickerAvailable(k.kind)).map((k) => (
          <ActionButton key={k.kind} kind="outline" testID={`attach-${k.kind}`} title={t(k.label)} disabled={offline} onPress={() => pick(k.kind)} />
        ))}
      </View>
      {offline ? <Txt variant="caption" tone="muted" testID="attach-offline">{t("case.attachments.failed_network")}</Txt> : null}
      {rows.map((r) => (
        <View key={r.key} testID={`attach-row-${r.key}`} style={{ gap: space[1] }}>
          <Txt variant="body" numberOfLines={1}>{r.file.name}</Txt>
          <Txt variant="caption" tone="muted">{r.state === "uploading" ? t("officer_app.case.attach_uploading", { percent: String(r.percent) }) : r.message}</Txt>
          <View style={{ flexDirection: "row", gap: space[2] }}>
            {r.state === "uploading" ? (
              <SmallButton testID={`attach-cancel-${r.key}`} title={t("officer_app.case.attach_cancel")} onPress={() => aborts.current.get(r.key)?.abort()} />
            ) : (
              <>
                {r.retryable ? <SmallButton testID={`attach-retry-${r.key}`} title={t("common.retry")} onPress={() => void send(r.key, r.file)} /> : null}
                <SmallButton testID={`attach-remove-${r.key}`} title={t("case.attachments.remove")} onPress={() => drop(r.key)} />
              </>
            )}
          </View>
        </View>
      ))}
      <Txt variant="caption" tone="muted">{t("officer_app.case.attach_privacy")}</Txt>
    </View>
  );
}
