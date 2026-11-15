/**
 * Motion shared by every surface that has it (Design v4 batch 53, `motion.seal` / `motion.breathe`).
 *
 * The apps read these numbers directly; the web reads the same values as CSS tokens (`--stamp*`,
 * `--now-breath*` in packages/core/tokens/component.tokens.json), and `sealMotionTokens.test.ts` holds
 * the two equal, so a change here that skips the tokens goes red.
 */

/** 落印: one motion for the judgment page, the case desk's in-place decide, the officer app's 判 drawer and read-back. No halo. */
export const SEAL_MOTION = {
  scaleFrom: 1.18,
  scaleTo: 1,
  opacityFrom: 0,
  durationMs: 200,
  easing: [0.2, 0.8, 0.2, 1] as const,
  /** Reduce motion: no scale, a short fade. */
  reduced: { scaleFrom: 1, durationMs: 120 },
} as const;

/** The dossier spine's current point breathes three times, then stays still. Reduce motion: not at all. */
export const BREATHE_MOTION = {
  periodMs: 2400,
  iterations: 3,
  scale: [1, 1.06] as const,
  opacity: [1, 0.7] as const,
} as const;
