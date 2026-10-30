/**
 * The cold start: the soul app's animation (`mobile/src/coldStartView.tsx`, shared) in the
 * officer's colours -- INK strokes on a PAPER ground, where the soul app writes gold on its dark
 * brand ground. Once per process; not under the OS "reduce motion" setting; a tap skips to the end.
 * The soul app's own shell (`mobile/src/coldStart.tsx`) is not imported: it reads the soul session
 * and the civilization welcome.
 */
import { OFFICER_BRAND } from "./brand";
import { ColdStartView } from "./shared";

export { coldStart } from "./shared";

export function ColdStart({ booting }: { booting: boolean }) {
  return <ColdStartView booting={booting} ground={OFFICER_BRAND.ground} mark={OFFICER_BRAND.mark} />;
}
