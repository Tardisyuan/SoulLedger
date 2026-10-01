"use client";

import { useState } from "react";
import Link from "next/link";
import { useComments, useCreateComment, useDeleteComment } from "@soulledger/core/hooks/useSocial";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { ConfirmDialog } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { ReactionBar } from "./ReactionBar";
import type { Comment } from "@soulledger/core/api";

function CommentItem({ comment, postId, depth, onReply }: {
  comment: Comment; postId: string; depth: number; onReply: (id: string) => void;
}) {
  const { t, formatDate } = useI18n();
  const { user } = useTenant();
  const deleteComment = useDeleteComment();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const isAuthor = !!user && String(user.id) === String(comment.author);

  const handleDelete = () => {
    if (deleteComment.isPending) return;
    deleteComment.mutate(comment.id, { onSuccess: () => setShowDeleteConfirm(false) });
  };

  return (
    <div className={depth > 0 ? "ml-6 border-l-2 border-[oklch(var(--color-hairline))]/50 pl-4" : ""}>
      <div className="py-2">
        <div className="flex items-center gap-2 mb-1">
          <Link href={`/social/profile/${comment.author}`} className="text-sm font-medium text-[oklch(var(--color-ink))] hover:underline">
            {comment.author_name || comment.author_username}
          </Link>
          <span className="text-xs font-mono tabular-nums text-[oklch(var(--color-ink-muted))]">
            {formatDate(comment.create_time)}
          </span>
        </div>
        <p className="text-sm text-[oklch(var(--color-ink))] whitespace-pre-wrap">{comment.content}</p>
        <div className="flex items-center gap-3 mt-1">
          <button type="button" onClick={() => onReply(comment.id)} className="text-xs text-[oklch(var(--color-ink))] underline underline-offset-2">
            {t("soul_app.circle.comment.reply")}
          </button>
          <ReactionBar commentId={comment.id} />
          {isAuthor && (
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              aria-label={t("common.delete") || "Delete"}
              className="text-xs text-[oklch(var(--color-ink-subtle))] underline underline-offset-2 hover:text-[oklch(var(--color-ink))] transition-colors"
            >
              {t("common.delete") || "Delete"}
            </button>
          )}
        </div>
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
  tree: Map<string | null, Comment[]>, parentId: string | null,
  postId: string, depth: number, onReply: (id: string) => void,
): React.ReactNode {
  return (tree.get(parentId) ?? []).map((c) => (
    <div key={c.id}>
      <CommentItem comment={c} postId={postId} depth={depth} onReply={onReply} />
      {renderThread(tree, c.id, postId, depth + 1, onReply)}
    </div>
  ));
}

export function CommentThread({ postId }: { postId: string }) {
  const { t } = useI18n();
  const [newComment, setNewComment] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const { data, isLoading } = useComments(postId);
  const createComment = useCreateComment();
  const comments = data?.results ?? [];
  const tree = buildTree(comments);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    createComment.mutate(
      { post: postId, content: newComment.trim(), ...(replyTo ? { parent: replyTo } : {}) },
      { onSuccess: () => { setNewComment(""); setReplyTo(null); } },
    );
  };

  return (
    <div>
      <form onSubmit={handleSubmit} className="mb-4">
        {replyTo && (
          <div className="flex items-center gap-2 mb-2 text-xs text-[oklch(var(--color-ink-muted))]">
            <span>
              {t("soul_app.circle.comment.reply_to", {
                name: (() => {
                  const c = comments.find((x) => x.id === replyTo);
                  return c ? c.author_name || c.author_username : "";
                })(),
              })}
            </span>
            <button type="button" onClick={() => setReplyTo(null)} className="text-[oklch(var(--color-ink))] underline underline-offset-2">
              {t("common.cancel")}
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text" value={newComment} onChange={(e) => setNewComment(e.target.value)}
            placeholder={t("social.add_comment") || "Write a comment..."}
            aria-label={t("social.add_comment")}
            className="h-(--control-h-sm) min-w-0 flex-1 bg-[oklch(var(--color-surface-1))] border border-[oklch(var(--color-ink-subtle))] px-3 text-sm text-[oklch(var(--color-ink))] placeholder-[oklch(var(--color-ink-subtle))]"
          />
          <Button type="submit" variant="primary" disabled={!newComment.trim()} loading={createComment.isPending}>
            {t("social.send") || "Send"}
          </Button>
        </div>
      </form>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 bg-[oklch(var(--color-hairline))]" />
          ))}
        </div>
      ) : comments.length === 0 ? (
        <p className="text-sm text-[oklch(var(--color-ink-subtle))] py-4">
          {t("social.no_comments") || "No comments yet"}
        </p>
      ) : (
        <div className="divide-y divide-[oklch(var(--color-hairline))]/50">
          {renderThread(tree, null, postId, 0, setReplyTo)}
        </div>
      )}
    </div>
  );
}
