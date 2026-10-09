/**
 * What this app borrows from the soul app, in one place.
 *
 * WHY A RE-EXPORT AND NOT A SHARED PACKAGE. The pieces the spec names (Screen, Notice, list
 * rows, tokens, the platform ports, the sheet) live in `mobile/src/` and are about 3,000 lines
 * that import each other (`ui.tsx` → `emblems`, `fonts`, `i18n`, `rules`, `theme`). Extracting
 * them into a third package would move those files and rewrite the imports and paths of ~25
 * mobile test files -- changes to the soul app that nothing in this change is allowed to run
 * the tests for. Importing the leaf modules in place changes nothing in `mobile/`.
 *
 * ONLY LEAF MODULES, on purpose. Everything below is free of the soul app's session, chat,
 * navigation and screens (checked by reading their imports): `ui`, `theme`, `fonts`, `i18n`,
 * `emblems`, `feedback`, `network`, `platform`, `brandMark`, `deepLink`. NEVER import `session`, `chrome`,
 * `navigation`, `push`, `coldStart` or anything under `screens/` from here -- those pull the
 * soul's accounts into this bundle. A change to one of the modules below is a change to both
 * apps; both apps' tests cover it.
 *
 * Metro finds these files through the monorepo `watchFolders` Expo sets up; jest transforms
 * them like any source outside `node_modules`.
 */
export {
  Block,
  Button,
  Empty,
  FieldError,
  FadeIn,
  Hairline,
  Input,
  Interp,
  Loader,
  Notice,
  Screen,
  SectionLabel,
  SmallButton,
  Txt,
  TYPE,
  ThemeContext,
  GUTTER,
  useReducedMotion,
  useReducedMotionDurations,
  useRemote,
  useTheme,
} from "../../mobile/src/ui";
export { createLinkInbox, pathOf } from "../../mobile/src/deepLink";
export { Sheet, ToastProvider, useToast } from "../../mobile/src/feedback";
export { NetworkProvider, useOnline } from "../../mobile/src/network";
export { I18nProvider, useI18n, translate } from "../../mobile/src/i18n";
export { family, FONT_ASSETS, titleFamily } from "../../mobile/src/fonts";
export { Icon, type IconName } from "../../mobile/src/emblems";
export { BrandMark } from "../../mobile/src/brandMarkView";
export { MARK_HEIGHT, MARK_WIDTH, SHAPE, STROKES, VIEWBOX, pathLength } from "../../mobile/src/brandMark";
export {
  hydratePersistentStore,
  installMobilePlatform,
  setUnauthorizedHandler,
} from "../../mobile/src/platform";
export {
  GUTTER_PT,
  motion,
  radius,
  space,
  themeFor,
  type ColorScheme,
  type Theme,
} from "../../mobile/src/theme";
