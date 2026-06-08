"use client";

import { useState } from "react";
import Link from "next/link";
import { useComments, useCreateComment } from "@/src/hooks/useSocial";
import { useI18n } from "@/src/contexts/I18nContext";
import { ReactionBar } from "./ReactionBar";
import type { Comment } from "@/lib/api";

function CommentItem({ comment, postId, depth, onReply }: {
  comment: Comment; postId: string; depth: number; onReply: (id: string) => void;
}) {
  return (
    <div className={depth > 0 ? "ml-6 border-l-2 border-[hsl(var(--color-hairline))]/50 pl-4" : ""}>
      <div className="py-2">
        <div className="flex items-center gap-2 mb-1">
          <Link href={`/social/profile/${comment.author}`} className="text-sm font-medium text-[hsl(var(--color-ink))] hover:underline">
            {comment.author_name || comment.author_username}
          </Link>
          <span className="text-xs text-[hsl(var(--color-ink-muted))]">
            {new Date(comment.create_time).toLocaleDateString()}
          </span>
        </div>
        <p className="text-sm text-[hsl(var(--color-ink))] whitespace-pre-wrap">{comment.content}</p>
        <div className="flex items-center gap-3 mt-1">
          <button onClick={() => onReply(comment.id)} className="text-xs text-[hsl(var(--color-accent))] hover:underline">
            Reply
          </button>
          <ReactionBar commentId={comment.id} />
        </div>
      </div>
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
  const comments = (data?.results ?? []) as Comment[];
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
          <div className="flex items-center gap-2 mb-2 text-xs text-[hsl(var(--color-ink-muted))]">
            <span>Replying to comment</span>
            <button type="button" onClick={() => setReplyTo(null)} className="text-[hsl(var(--color-accent))] hover:underline">Cancel</button>
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text" value={newComment} onChange={(e) => setNewComment(e.target.value)}
            placeholder={t("social.add_comment") || "Write a comment..."}
            className="flex-1 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-3 py-2 text-sm text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
          />
          <button
            type="submit" disabled={!newComment.trim() || createComment.isPending}
            className="px-4 py-2 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent))] rounded-md text-sm font-medium transition-colors disabled:opacity-50"
          >
            {createComment.isPending ? "..." : t("social.send") || "Send"}
          </button>
        </div>
      </form>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="animate-pulse h-12 bg-[hsl(var(--color-surface-2))] rounded" />
          ))}
        </div>
      ) : comments.length === 0 ? (
        <p className="text-sm text-[hsl(var(--color-ink-subtle))] text-center py-4">
          {t("social.no_comments") || "No comments yet"}
        </p>
      ) : (
        <div className="divide-y divide-[hsl(var(--color-hairline))]/50">
          {renderThread(tree, null, postId, 0, setReplyTo)}
        </div>
      )}
    </div>
  );
}
