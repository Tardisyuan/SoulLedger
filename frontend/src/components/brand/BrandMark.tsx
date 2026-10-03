import { MARK_HEIGHT, MARK_WIDTH, SHAPE, VIEWBOX } from "@soulledger/core/config/brandMark";
import { cn } from "@/lib/utils";

export type BrandMarkTone = "ink" | "gold" | "white";

/**
 * The S-and-L balance mark (A9 §一), filled: the outline from `@soulledger/core/config/brandMark`
 * (the same paths the app's cold start draws), fill-rule evenodd so the right pan's triangle is cut.
 *
 * Tone, when not given: ink on the light theme, `--brand-mark` gold on the dark one — the gold is
 * too faint on v3's light canvas. Gold is the mark's colour only; it is not an interface colour.
 *
 * Hidden from assistive tech unless `label` is given: everywhere it sits, the text beside it names
 * the app. Where it stands alone (the collapsed nav), pass `label`.
 */
const TONE: Record<BrandMarkTone | "auto", string> = {
  auto: "fill-[oklch(var(--color-ink))] dark:fill-(--brand-mark)",
  ink: "fill-[oklch(var(--color-ink))]",
  gold: "fill-(--brand-mark)",
  white: "fill-white",
};

export function BrandMark({
  size,
  tone,
  label,
  className,
}: {
  /** Width in px; the height follows the mark's own aspect. */
  size: number;
  tone?: BrandMarkTone;
  label?: string;
  className?: string;
}) {
  return (
    <svg
      data-brand-mark=""
      data-tone={tone ?? "auto"}
      width={size}
      height={Math.round((size * MARK_HEIGHT) / MARK_WIDTH)}
      viewBox={VIEWBOX}
      className={cn("shrink-0", TONE[tone ?? "auto"], className)}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true, focusable: false })}
    >
      {SHAPE.map((d) => (
        <path key={d.slice(0, 16)} d={d} fillRule="evenodd" clipRule="evenodd" />
      ))}
    </svg>
  );
}
