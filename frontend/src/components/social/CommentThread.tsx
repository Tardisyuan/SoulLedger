"use client";

import { useState } from "react";
import Link from "next/link";
import { useComments, useCreateComment, useDeleteComment, useReactions } from "@soulledger/core/hooks/useSocial";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { ConfirmDialog } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { fieldControl } from "@/src/components/ui/Field";
import { cn } from "@/lib/utils";
import { ReactionBar } from "./ReactionBar";
import { Avatar } from "./Avatar";
import type { Comment } from "@soulledger/core/api";

/**
 * 评论区(A5 详情):卡片 surface-1 / 1px line / padding 20;h2「评论 · N」。
 * 每条:`32px 1fr` 网格,上边 1px line;嵌套回复在父评论里,左 1px line 竖线 + 左 14,28 头像,
 * 姓名后「回复 某某」。操作行 12px ink-muted、每项 44 高:「回复」「◇ 表态 · N」(作者另有「删除」)。
 *
 * 「◇ 表态 · N」是一个开关,点开才是完整的五种表态条 —— 稿上只画了一格,而评论原本就能
 * 五种表态,收成一格会丢掉其中四种。N 是这条评论的表态条数(`/social/reactions/?comment=`,
 * 和表态条用同一个查询,缓存共享)。
 *
 * 底部输入:回复对象标签「回复 某某 ✕」+ 48 高输入框 + 48 高「发送」。
 */
const ACTION =
  "inline-flex min-h-(--control-h-sm) items-center px-1 text-xs text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))]";

function nameOf(c: Comment) {
  return c.author_name || c.author_username;
}

function CommentItem({ comment, parent, depth, onReply, children }: {
  comment: Comment;
  parent?: Comment;
  depth: number;
  onReply: (id: string) => void;
  children?: React.ReactNode;
}) {
  const { t, formatDate } = useI18n();
  const { user } = useTenant();
  const deleteComment = useDeleteComment();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [reacting, setReacting] = useState(false);
  const { data: reactions } = useReactions({ comment: comment.id });
  const isAuthor = !!user && String(user.id) === String(comment.author);
  const nested = depth > 0;

  const handleDelete = () => {
    if (deleteComment.isPending) return;
    deleteComment.mutate(comment.id, { onSuccess: () => setShowDeleteConfirm(false) });
  };

  return (
    <div
      data-comment={comment.id}
      data-depth={depth}
      className={cn(
        "grid gap-x-3",
        nested
          ? "mt-2 grid-cols-[28px_1fr] border-l border-[oklch(var(--color-line))] pl-[14px]"
          : "grid-cols-[32px_1fr] border-t border-[oklch(var(--color-line))] py-3",
      )}
    >
      <Avatar name={nameOf(comment)} size={nested ? 28 : 32} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <Link href={`/social/profile/${comment.author}`} className="text-sm font-medium text-[oklch(var(--color-ink))] hover:underline">
            {nameOf(comment)}
          </Link>
          {nested && parent ? (
            <span className="text-xs text-[oklch(var(--color-ink-muted))]">
              {t("soul_app.circle.comment.reply_to", { name: nameOf(parent) })}
            </span>
          ) : null}
          <span className="font-mono text-xs tabular-nums text-[oklch(var(--color-ink-muted))]">
            {formatDate(comment.create_time)}
          </span>
        </div>
        <p className="whitespace-pre-wrap text-md text-[oklch(var(--color-ink))]">{comment.content}</p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => onReply(comment.id)} className={ACTION}>
            {t("soul_app.circle.comment.reply")}
          </button>
          <button
            type="button"
            onClick={() => setReacting((v) => !v)}
            aria-expanded={reacting}
            className={ACTION}
          >
            <span aria-hidden="true">◇&nbsp;</span>
            {t("social.reactions")} · <span className="ml-1 font-mono tabular-nums">{reactions?.results?.length ?? 0}</span>
          </button>
          {isAuthor && (
            <button type="button" onClick={() => setShowDeleteConfirm(true)} className={ACTION}>
              {t("common.delete")}
            </button>
          )}
        </div>
        {reacting ? <ReactionBar commentId={comment.id} /> : null}
        {children}
      </div>

      {/* 同 PostCard:作者自删不进回收站,不可撤回;评论没有名称 → 普通确认框。 */}
      {isAuthor && (
        <ConfirmDialog
          isOpen={showDeleteConfirm}
          title={t("common.confirm_delete")}
          message={t("social.delete_comment_confirm")}
          confirmText={<><span aria-hidden="true">✕</span>{t("common.confirm_delete")}</>}
          confirmLoading={deleteComment.isPending}
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  );
}

function buildTree(comments: Comment[]): Map<string | null, Comment[]> {
  const map = new Map<string | null, Comment[]>();
  for (const c of comments) {
    const key = c.parent ?? null;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(c);
  }
  return map;
}

function renderThread(
  tree: Map<string | null, Comment[]>, parent: Comment | undefined,
  depth: number, onReply: (id: string) => void,
): React.ReactNode {
  return (tree.get(parent?.id ?? null) ?? []).map((c) => (
    <CommentItem key={c.id} comment={c} parent={parent} depth={depth} onReply={onReply}>
      {renderThread(tree, c, depth + 1, onReply)}
    </CommentItem>
  ));
}

export function CommentThread({ postId, count }: { postId: string; count?: number }) {
  const { t } = useI18n();
  const [newComment, setNewComment] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const { data, isLoading } = useComments(postId);
  const createComment = useCreateComment();
  const comments = data?.results ?? [];
  const tree = buildTree(comments);
  const replyTarget = replyTo ? comments.find((x) => x.id === replyTo) : undefined;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    createComment.mutate(
      { post: postId, content: newComment.trim(), ...(replyTo ? { parent: replyTo } : {}) },
      { onSuccess: () => { setNewComment(""); setReplyTo(null); } },
    );
  };

  return (
    <section
      aria-labelledby="comments-heading"
      className="flex flex-col gap-1 border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] p-[20px] max-[768px]:border-x-0 max-[768px]:p-4"
    >
      <h2 id="comments-heading" className="pb-2 text-lg text-[oklch(var(--color-ink))]">
        {t("social.comments")} · <span className="font-mono tabular-nums">{count ?? comments.length}</span>
      </h2>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 bg-[oklch(var(--color-surface-2))]" />
          ))}
        </div>
      ) : comments.length === 0 ? (
        <p className="border-t border-[oklch(var(--color-line))] py-4 text-sm text-[oklch(var(--color-ink-subtle))]">
          {t("social.no_comments")}
        </p>
      ) : (
        <div>{renderThread(tree, undefined, 0, setReplyTo)}</div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-2 border-t border-[oklch(var(--color-line))] pt-3">
        {replyTarget && (
          <span className="inline-flex h-7 items-center gap-1 self-start rounded-control bg-[oklch(var(--color-surface-2))] pl-2 text-xs text-[oklch(var(--color-ink))]">
            {t("soul_app.circle.comment.reply_to", { name: nameOf(replyTarget) })}
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              aria-label={t("common.cancel")}
              className="flex h-7 w-7 items-center justify-center text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))]"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </span>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder={t("social.add_comment")}
            aria-label={t("social.add_comment")}
            className={cn(fieldControl({ size: "md" }), "min-w-0 flex-1 text-md")}
          />
          <Button type="submit" variant="primary" disabled={!newComment.trim()} loading={createComment.isPending}>
            {t("social.send")}
          </Button>
        </div>
      </form>
    </section>
  );
}
