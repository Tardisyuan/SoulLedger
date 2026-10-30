/**
 * What this app borrows from the soul app, in one place.
 *
 * WHY A RE-EXPORT AND NOT A SHARED PACKAGE. The pieces the spec names (Screen, Notice, list
 * rows, tokens, the platform ports, the sheet) live in `mobile/src/` and are about 3,000 lines
 * that import each other (`ui.tsx` → `emblems`, `fonts`, `i18n`, `layout`, `theme`). Extracting
 * them into a third package would move those files and rewrite the imports and paths of ~25
 * mobile test files -- changes to the soul app that nothing in this change is allowed to run
 * the tests for. Importing the leaf modules in place changes nothing in `mobile/`.
 *
 * ONLY LEAF MODULES, on purpose. NEVER import `session`, `chrome`, `navigation`, `push`,
 * `coldStart` (the soul's shell; `coldStartView` is the shared leaf) or anything under `screens/` from here -- those pull the soul's accounts into
 * this bundle. Which `mobile/src/` files this app actually reaches (the transitive closure of
 * these imports) is pinned, and the forbidden ones refused, by `__tests__/sharedClosure.test.ts`;
 * that list is the record, not this comment. A change to one of those files is a change to both
 * apps; both apps' tests cover it.
 *
 * Metro finds these files through the monorepo `watchFolders` Expo sets up; jest transforms
 * them like any source outside `node_modules`.
 */
export {
  Button,
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
  useLayout,
  GUTTER,
  GoneState,
  useReducedMotion,
  useRemote,
  useReloadOnReconnect,
  useTheme,
} from "../../mobile/src/ui";
export { PasswordMatch, PasswordRules, usePasswordForm } from "../../mobile/src/passwordRulesView";
export { initCrashReporting, setCrashUser } from "../../mobile/src/crashReport";
export { RootErrorBoundary } from "../../mobile/src/errorBoundary";
export { VersionGate } from "../../mobile/src/versionGate";
export { createLinkInbox, pathOf, queryOf } from "../../mobile/src/deepLink";
export { clearVoiceNumbers, publishVoiceNumber } from "../../mobile/src/voiceCache";
export { Sheet, ToastProvider, useToast } from "../../mobile/src/feedback";
export { NetworkProvider, useOnline } from "../../mobile/src/network";
export { I18nProvider, useI18n, translate } from "../../mobile/src/i18n";
export { family, FONT_ASSETS } from "../../mobile/src/fonts";
export { Icon } from "../../mobile/src/emblems";
export { BrandMark } from "../../mobile/src/brandMarkView";
export { MARK_HEIGHT, MARK_WIDTH, SHAPE, STROKES, VIEWBOX, pathLength } from "../../mobile/src/brandMark";
export { ColdStartView, coldStart } from "../../mobile/src/coldStartView";
export {
  hydratePersistentStore,
  installMobilePlatform,
  setUnauthorizedHandler,
} from "../../mobile/src/platform";
export {
  motion,
  space,
  themeFor,
  type ColorScheme,
} from "../../mobile/src/theme";
