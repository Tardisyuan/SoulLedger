"use client";

import { useState } from "react";
import Link from "next/link";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { useDeletePost, useRefreshPosts } from "@soulledger/core/hooks/useSocial";
import { ConfirmDialog } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { ReactionBar } from "./ReactionBar";
import { Avatar } from "./Avatar";
import { PostMediaGrid } from "./PostMedia";
import type { Post } from "@soulledger/core/api";
import { DomainEnum } from "@/src/components/ui/DomainValue";

/**
 * 帖子卡(A5 · v3 Post.dc):surface-1、1px line、padding 20、间距 12;≤ 768 通栏(只有上下线)、
 * padding 16、间距 10。
 *
 * 头部:40 圆头像 + 两行(500 作者 / 12px ink-muted「等宽时间 · 可见性」,不换行);作者本人
 * 右端 44 高幽灵「删除」。可见性是领域枚举,经 `DomainEnum`(`social.visibility.*`)读出 ——
 * v3 把它写进时间那一行,不再是徽章(v1 那四个手写的明暗色对早已撤成中性徽章,现在连徽章也撤了)。
 *
 * 配图:`PostMediaGrid`(./PostMedia)。2026-10-02 用户拍板:官员也能发图(`POST /social/media/`),
 * 官员流仍不含灵魂帖子。每张图的 `url` 是发给当前用户的签名地址(约一小时);过期的那张显示
 * 「◌ 链接已过期 · 重新获取」,重新获取 = 重拉帖子列表拿新签的地址(`useRefreshPosts`)。
 */
export function PostCard({ post }: { post: Post }) {
  const { t, formatDate } = useI18n();
  const { user } = useTenant();
  const deletePost = useDeletePost();
  const refreshPosts = useRefreshPosts();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const isAuthor = !!user && String(user.id) === String(post.author);
  const name = post.author_name || post.author_username;

  const handleDelete = () => {
    if (deletePost.isPending) return;
    deletePost.mutate(post.id, { onSuccess: () => setShowDeleteConfirm(false) });
  };

  return (
    <article
      data-post-card=""
      className="flex flex-col gap-3 border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] p-[20px] max-[768px]:gap-[10px] max-[768px]:border-x-0 max-[768px]:p-4"
    >
      <div className="flex items-center gap-3">
        <Avatar name={name} size={40} />
        <div className="min-w-0 flex-1">
          <Link
            href={`/social/profile/${post.author}`}
            title={name}
            className="block truncate text-sm font-medium text-[oklch(var(--color-ink))] hover:underline"
          >
            {name}
          </Link>
          <p title={`${formatDate(post.create_time)} · ${t(`social.visibility.${post.visibility}`)}`} className="truncate whitespace-nowrap text-xs text-[oklch(var(--color-ink-muted))]">
            <span className="font-mono tabular-nums">{formatDate(post.create_time)}</span>
            {" · "}
            <DomainEnum namespace="social.visibility" value={post.visibility} />
          </p>
        </div>
        {isAuthor && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowDeleteConfirm(true)}
            className="text-[oklch(var(--color-ink-muted))]"
          >
            {t("common.delete")}
          </Button>
        )}
      </div>

      <Link href={`/social/${post.id}`} className="block">
        <p className="whitespace-pre-wrap text-md font-normal text-pretty text-[oklch(var(--color-ink))]">{post.content}</p>
      </Link>

      <PostMediaGrid
        media={post.media ?? []}
        onRefetch={refreshPosts}
        author={name}
        time={formatDate(post.create_time)}
      />

      <div className="border-t border-[oklch(var(--color-line))] pt-2">
        <ReactionBar
          postId={post.id}
          totals={{ reactions: post.reaction_count, comments: post.comment_count }}
          counts={post.reaction_counts}
        />
      </div>

      {/* 作者自己删帖:软删但不进回收站(apps/social/apps.py 只登记官员删的),界面上拿不回来 ——
          不可撤回。帖子没有名称,所以不走「输入名称以确认」而用普通确认框(2026-09-30 用户拍板:
          让人打动作词「删除」只是多一步,不是多一层确认)。 */}
      {isAuthor && (
        <ConfirmDialog
          isOpen={showDeleteConfirm}
          title={t("common.confirm_delete")}
          message={t("social.delete_post_confirm")}
          confirmText={<><span aria-hidden="true">✕</span>{t("common.confirm_delete")}</>}
          confirmLoading={deletePost.isPending}
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </article>
  );
}
