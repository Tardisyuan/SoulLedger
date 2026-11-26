/**
 * What this app shares with the soul app, in one place.
 *
 * The pieces (Screen, Notice, list rows, tokens, the platform ports, the sheet ...) live in the
 * workspace package `@soulledger/mobile-ui` (packages/mobile-ui/src/). They lived in `mobile/src/`
 * and were imported in place until 2026-11-21 (refactor/mobile-ui); the move changed no code.
 *
 * NOTHING FROM `mobile/` HERE. The soul's shell (`session`, `chrome`, `navigation`, `push`,
 * `coldStart`, `screens/`) stays in the soul app; importing it would pull the soul's accounts into
 * this bundle. `__tests__/sharedClosure.test.ts` pins which package files this app reaches and that
 * it reaches no `mobile/` file; that list is the record, not this comment. A change to the package
 * is a change to both apps; both apps' tests cover it.
 *
 * Metro finds the package through the monorepo `watchFolders` Expo sets up; jest transforms it like
 * any source outside `node_modules` (the workspace link resolves to packages/mobile-ui).
 */
export {
  BusyLine,
  Button,
  EASE,
  FadeModal,
  PhotoPager,
  thumbRef,
  useFrontPhoto,
  Grow,
  Skeleton,
  runTopline,
  useAfter,
  FieldError,
  Input,
  Loader,
  Notice,
  Screen,
  SectionLabel,
  SmallButton,
  SwitchMark,
  Txt,
  ThemeContext,
  OneLine,
  Press,
  useLayout,
  GUTTER,
  GoneState,
  useLandingFade,
  useReducedMotion,
  useReducedMotionDurations,
  useRemote,
  useReloadOnReconnect,
  useTheme,
} from "@soulledger/mobile-ui/src/ui";
export { PasswordMatch, PasswordRules, usePasswordForm } from "@soulledger/mobile-ui/src/passwordRulesView";
export { initCrashReporting, setCrashUser } from "@soulledger/mobile-ui/src/crashReport";
export { RootErrorBoundary } from "@soulledger/mobile-ui/src/errorBoundary";
export { VersionGate } from "@soulledger/mobile-ui/src/versionGate";
export { createLinkInbox, pathOf, queryOf } from "@soulledger/mobile-ui/src/deepLink";
export { clearVoiceNumbers, publishVoiceNumber } from "@soulledger/mobile-ui/src/voiceCache";
export { Sheet, ToastProvider, useDismissToast, useToast } from "@soulledger/mobile-ui/src/feedback";
export { NetworkProvider, useOnline } from "@soulledger/mobile-ui/src/network";
export { I18nProvider, useI18n, translate } from "@soulledger/mobile-ui/src/i18n";
export { family, FONT_ASSETS, titleFamily } from "@soulledger/mobile-ui/src/fonts";
export { Emblem, GlowTop, Icon } from "@soulledger/mobile-ui/src/emblems";
export { HeadMark, HeadTexture, Topline, markFits } from "@soulledger/mobile-ui/src/civHead";
export { BrandMark } from "@soulledger/mobile-ui/src/brandMarkView";
export { RememberedCard } from "@soulledger/mobile-ui/src/rememberedCard";
export { LOCK_AFTER_MS, LockView, useAppLock } from "@soulledger/mobile-ui/src/lockView";
export { STROKES } from "@soulledger/mobile-ui/src/brandMark";
export { ColdStartView, coldStart } from "@soulledger/mobile-ui/src/coldStartView";
export { easProjectId, installNotificationHandler, listenForTaps, permission, pushCore, type Permission, type Registration } from "@soulledger/mobile-ui/src/pushCore";
export {
  fileField,
  hydratePersistentStore,
  installMobilePlatform,
  onForeground,
  setUnauthorizedHandler,
} from "@soulledger/mobile-ui/src/platform";
export { DossierSeal as SealArt, MeritMark } from "@soulledger/mobile-ui/src/dossierMarks";
export {
  CredentialStoreError,
  deviceCredential,
  readBiometry,
  resetBiometryCache,
  useBiometry,
  type Biometry,
} from "@soulledger/mobile-ui/src/deviceCredential";
export {
  GONE_OPACITY,
  PENDING_OPACITY,
  HIGHLIGHT_ALPHA,
  civKeyOf,
  motion,
  radius,
  space,
  themeFor,
  touch as sharedTouch,
  withAlpha,
  type ColorScheme,
} from "@soulledger/mobile-ui/src/theme";
