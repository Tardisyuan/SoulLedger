/**
 * 设置 › 已拉黑 (2026-11-01 用户拍板 #3): the souls I blocked in 书信, each with 「解除」.
 * A row leaves the list when the server says yes; nothing is removed on a guess. Blocking itself is in the
 * conversation (⋯ › 拉黑, or 拉黑 under a new request); the blocked soul is only ever told 「无法送达」.
 */
import { soulChatApi, type SoulChatBlock } from "@soulledger/core/api/soul-chat";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useToast } from "../feedback";
import { useI18n } from "../i18n";
import { Empty, Screen, SectionError, Skeleton, Txt, useLayout, useReloadOnRefocus, useRemote, useTheme } from "../ui";

function BlockRow({ block, busy, onUnblock }: { block: SoulChatBlock; busy: boolean; onUnblock: () => void }) {
  const theme = useTheme();
  const { t } = useI18n();
  const { gutter } = useLayout();
  return (
    <View testID={`block-${block.id}`} style={[styles.row, { paddingHorizontal: gutter, borderBottomColor: theme.hair }]}>
      <Txt variant="bodyLg" style={styles.fill}>
        {block.peer_name}
      </Txt>
      <Pressable
        testID={`unblock-${block.id}`}
        accessibilityRole="button"
        accessibilityLabel={`${t("soul_app.chat.blocks.unblock")} ${block.peer_name}`}
        disabled={busy}
        onPress={onUnblock}
        style={[styles.action, busy && styles.dim]}
      >
        <Txt variant="bodyLg" style={styles.underline}>
          {t("soul_app.chat.blocks.unblock")}
        </Txt>
      </Pressable>
    </View>
  );
}

export function ChatBlocksScreen() {
  const { t } = useI18n();
  const toast = useToast();
  const { gutter } = useLayout();
  const blocks = useRemote(soulChatApi.blocks);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  useReloadOnRefocus(blocks.reload, { data: blocks.data, error: blocks.error });

  const unblock = (id: string) => {
    if (busy) return;
    setBusy(id);
    soulChatApi
      .unblock(id)
      .then(
        () => {
          setGone((prev) => new Set(prev).add(id));
          toast(t("soul_app.chat.blocks.unblocked"), "success");
        },
        () => toast(t("soul_app.chat.blocks.failed"), "failure")
      )
      .finally(() => setBusy(null));
  };

  const rows = blocks.data?.filter((b) => !gone.has(b.id)) ?? null;
  return (
    <Screen testID="chat-blocks" refreshing={blocks.loading && rows !== null} onRefresh={() => void blocks.reload()}>
      {rows ? (
        rows.length === 0 ? (
          <Empty testID="chat-blocks-empty" text={t("soul_app.chat.blocks.empty")} />
        ) : (
          rows.map((b) => <BlockRow key={b.id} block={b} busy={busy === b.id} onUnblock={() => unblock(b.id)} />)
        )
      ) : blocks.error ? (
        <SectionError testID="chat-blocks-error" onRetry={() => void blocks.reload()} />
      ) : (
        <View style={{ paddingHorizontal: gutter, paddingTop: 16 }}>
          <Skeleton lines={2} testID="chat-blocks-loading" />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1 },
  action: { minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "center", paddingHorizontal: 8 },
  underline: { textDecorationLine: "underline" },
  dim: { opacity: 0.5 },
});
