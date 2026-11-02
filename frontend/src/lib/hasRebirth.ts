/**
 * Europe and Egypt have no wheel: Heaven, Purgatory and Hell, or the Field of Reeds and Ammit, are where a soul ends
 * (docs/01_欧洲天堂地狱整体架构.md, docs/01_埃及冥界整体架构.md). Their screens do not talk about rebirth.
 */
export function hasRebirth(civilization?: string | null): boolean {
  return civilization !== "EUROPEAN" && civilization !== "EGYPTIAN";
}
