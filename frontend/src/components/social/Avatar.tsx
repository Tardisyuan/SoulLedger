/**
 * 朋友圈的首字头像(A5):帖子 40、评论 32、嵌套回复 28、关注行 32、个人页 72。
 * 圆形是头像例外(`ROUND_ALLOW`),单独成文件好让例外只覆盖这一个元素。装饰性:名字总在旁边写着。
 */
const SIZE = {
  28: "size-7 text-2xs",
  32: "size-8 text-xs",
  40: "size-10 text-sm",
  72: "size-18 font-title text-xl",
} as const;

export function Avatar({ name, size }: { name?: string | null; size: keyof typeof SIZE }) {
  return (
    <span
      aria-hidden="true"
      className={`${SIZE[size]} inline-flex shrink-0 items-center justify-center rounded-full bg-[oklch(var(--color-surface-2))] font-semibold text-[oklch(var(--color-ink))]`}
    >
      {name?.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
