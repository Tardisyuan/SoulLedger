"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import { useTheme } from "@/src/contexts/ThemeContext";

/**
 * The light/dark switch in the masthead — one component, for the two places
 * that draw a masthead.
 *
 * WHY IT IS A FILE. It was written twice, byte-identical for the eighteen
 * lines that matter (the sun and moon paths) and DIFFERENT in the wrapper
 * three ways, which is the state a copy is in just before its values diverge
 * too:
 *
 *   app/page.tsx:63-68        src/components/layout/AppLayout.tsx:394-398
 *   hover accent-ink          hover accent          <- a contrast defect
 *   no aria-label             aria-label            <- an a11y defect
 *   type="button"             (default "submit")
 *
 * Neither copy was the correct one. The merged control takes the better half
 * of each: `--color-accent-ink` on hover, an `aria-label`, and an explicit
 * `type="button"`.
 *
 * WHY accent-ink AND NOT accent. globals.css declares the light-mode pair as
 * `--color-accent: 38 92% 50%` and `--color-accent-ink: 32 92% 31%`, and says
 * why on the token itself: the accent measures 2.13:1 against light-mode white
 * and 4.16:1 was already under AA on the tinted surfaces, so "anything
 * rendering the brand colour AS TEXT must use this instead". A hover colour is
 * how this control announces it is a control; painting it in the token that
 * fails both the 4.5:1 text floor and the 3:1 non-text floor makes the
 * affordance *less* visible than its resting `--color-ink-subtle` (4.53:1).
 *
 * The rule is not read off the text/icon distinction, which would exempt an
 * 18px stroke glyph: `app/welcome/page.tsx:134-138` had four stat ICONS on the
 * accent and moved them to accent-ink for this exact measurement, and
 * `src/components/ui/Badge.tsx:70-74` states the same rule for the badge tone.
 *
 * `type="button"` is not cosmetic even outside a <form>: the HTML default is
 * "submit", so a later refactor that wraps a masthead in a form turns a theme
 * switch into a submit button, silently.
 */
export function ThemeToggle() {
  const { t } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const label = theme === "dark" ? t("nav.theme_light") : t("nav.theme_dark");

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={label}
      aria-label={label}
      className="text-[hsl(var(--color-ink-subtle))] hover:text-[hsl(var(--color-accent-ink))] transition-colors p-1"
    >
      {theme === "dark" ? (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}
