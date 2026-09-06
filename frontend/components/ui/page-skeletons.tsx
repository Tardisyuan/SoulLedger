/**
 * Route-level loading shapes, written once.
 *
 * ── WHAT THIS REPLACES ────────────────────────────────────────────────────
 *
 * Seven route-level `loading.tsx` files under `app/` — judgment, cross-judgments, dispatch,
 * disposition, souls, recycle-bin, notifications — were each `return
 * <PageSpinner />`. Seven routes with completely different shapes, one centred
 * ring, and no hint of what was about to appear. Meanwhile `app/dashboard`
 * already had a same-shape skeleton, and its comment gives the reason this
 * matters beyond looks: the page it stands in for has `text-08` figures in it,
 * and a loading state that does not hold their height lets the whole page jump
 * a line when the data lands.
 *
 * ── WHY A SHARED COMPONENT AND NOT SEVEN HAND-WRITTEN ONES ────────────────
 *
 * Because seven hand-written ones drift, and a skeleton that no longer matches
 * its page is worse than a spinner: it is a picture of a layout that is not
 * coming. Two shapes cover all seven routes, and both take the few numbers
 * that actually differ.
 *
 * ── THE COLOUR IS NOT A CHOICE ────────────────────────────────────────────
 *
 * `--color-hairline`, matching `app/dashboard/loading.tsx` and
 * `components/ui/skeleton.tsx`. `src/__tests__/cssTokenReferenceContract.test.ts`
 * holds new skeletons to it: on a `--color-surface-*` the block measures
 * 1.021:1 against the page and is invisible to anyone who is not looking
 * straight at it.
 *
 * `animate-pulse` is left as-is rather than moved onto a motion token. The
 * universal `prefers-reduced-motion` block in `app/globals.css` already
 * collapses it, and a skeleton that has stopped pulsing still reads as a
 * skeleton — the shape is doing the work, not the animation.
 */

const BLOCK = "bg-[hsl(var(--color-hairline))] animate-pulse";

function PageHead({ withTabs }: { withTabs?: boolean }) {
  return (
    <>
      <header className="border-b border-[hsl(var(--color-hairline))]">
        <div className="max-w-page mx-auto px-6 pt-10 pb-6">
          <div className="flex items-start gap-4">
            <div className={`h-10 w-64 ${BLOCK}`} />
            <div className={`ml-auto h-9 w-32 ${BLOCK}`} />
          </div>
          <div className={`h-6 w-96 ${BLOCK} mt-3`} />
        </div>
      </header>
      {withTabs && (
        <div className="border-b border-[hsl(var(--color-hairline))]">
          <div className="max-w-page mx-auto px-6 flex items-center gap-1">
            <div className={`h-10 w-24 ${BLOCK}`} />
            <div className={`h-10 w-24 ${BLOCK}`} />
          </div>
        </div>
      )}
    </>
  );
}

/**
 * A page whose body is a `DataTable`: header, optional tab strip, a header row
 * and `rows` body rows.
 *
 * `h-11` per row rather than a guess: `DataTable`'s default `comfortable`
 * density is `px-4 py-3` at `text-03`, which its own prop comment measures at
 * ~44px. A skeleton row shorter than the real one shifts the page upward as
 * the data lands, which is the specific harm this is here to avoid.
 */
export function TablePageSkeleton({
  rows = 8,
  withTabs = false,
}: {
  rows?: number;
  withTabs?: boolean;
}) {
  return (
    <div className="bg-[hsl(var(--color-canvas))]">
      <PageHead withTabs={withTabs} />
      <div className="max-w-page mx-auto px-6 py-6">
        <div className="border border-[hsl(var(--color-hairline))]">
          <div className={`h-11 ${BLOCK} opacity-70`} />
          <div className="divide-y divide-[hsl(var(--color-hairline))]">
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className={`h-11 ${BLOCK}`} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A page whose body is a stack of cards rather than a table — notifications,
 * cross-judgments, disposition, and both sections of dispatch.
 *
 * `sections` draws a titled group per entry, which is what `app/dispatch`
 * renders: two `PageSection`s, "pending" over "history". One section is the
 * common case and stays the default.
 */
export function CardListPageSkeleton({
  cards = 4,
  sections = 1,
  cardHeight = "h-24",
}: {
  cards?: number;
  sections?: number;
  cardHeight?: string;
}) {
  return (
    <div className="bg-[hsl(var(--color-canvas))]">
      <PageHead />
      <div className="max-w-page mx-auto px-6 py-6 space-y-6">
        {Array.from({ length: sections }, (_, s) => (
          <div key={s} className="space-y-3">
            {sections > 1 && <div className={`h-6 w-40 ${BLOCK}`} />}
            {Array.from({ length: cards }, (_, i) => (
              <div
                key={i}
                className={`${cardHeight} ${BLOCK} border border-[hsl(var(--color-hairline))]`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
