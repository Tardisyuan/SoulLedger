/**
 * Tests for src/contexts/I18nContext.tsx
 *
 * Tests the t() translation function, locale switching, and provider behaviour.
 * Mocks the message JSON files to keep tests deterministic and fast.
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';

// Mock message files with minimal fixtures
jest.mock('@soulledger/core/messages/zh-Hans.json', () => ({
  __esModule: true,
  default: {
    nav: {
      title: '灵魂账本',
      greeting: '你好, {{username}}!',
      complex: '{count} 个{{item}}',
    },
    auth: {
      login: '登录',
    },
    missing: {
      nested: '找到嵌套',
    },
  },
}));

jest.mock('@soulledger/core/messages/en.json', () => ({
  __esModule: true,
  default: {
    nav: {
      title: 'Soul Ledger',
      greeting: 'Hello, {{username}}!',
    },
    auth: {
      login: 'Login',
    },
  },
}));

jest.mock('@soulledger/core/messages/egy.json', () => ({
  __esModule: true,
  default: {
    nav: {
      title: '𓂀 Soul Book 𓂀',
    },
  },
}));

// Import AFTER mock setup
 
const { I18nProvider, useI18n } = require('@/src/contexts/I18nContext');

// ── Helper: render useI18n hook inside the provider ─────────────────────────
function renderI18n() {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <I18nProvider>{children}</I18nProvider>
  );
  return renderHook(() => useI18n(), { wrapper });
}

// ── Tests ───────────────────────────────────────────────────────────────────
describe('I18nContext', () => {
  beforeEach(() => {
    // Clear locale cookie
    document.cookie = 'soulledger-locale=; Max-Age=0; path=/';
  });

  // ── Initial state ────────────────────────────────────────────────────────
  describe('initial state', () => {
    it('should default to zh-Hans locale', () => {
      const { result } = renderI18n();
      expect(result.current.locale).toBe('zh-Hans');
    });

    it('should hydrate on mount', () => {
      const { result } = renderI18n();
      expect(result.current.hydrated).toBe(true);
    });
  });

  // ── t() — simple key lookup ──────────────────────────────────────────────
  describe('t() — simple key lookup', () => {
    it('should resolve a top-level key', () => {
      const { result } = renderI18n();
      expect(result.current.t('nav.title')).toBe('灵魂账本');
    });

    it('should resolve a different top-level key', () => {
      const { result } = renderI18n();
      expect(result.current.t('auth.login')).toBe('登录');
    });
  });

  // ── t() — nested key lookup ──────────────────────────────────────────────
  describe('t() — nested key lookup', () => {
    it('should resolve a deeply nested key', () => {
      const { result } = renderI18n();
      expect(result.current.t('missing.nested')).toBe('找到嵌套');
    });

    it('should return the key itself when path is not found', () => {
      const { result } = renderI18n();
      expect(result.current.t('nonexistent.key')).toBe('nonexistent.key');
    });

    it('should return the key when intermediate path is not an object', () => {
      const { result } = renderI18n();
      // "nav.title" resolves to a string, so "nav.title.extra" should return the key
      expect(result.current.t('nav.title.extra.deep')).toBe('nav.title.extra.deep');
    });

    it('should return key for completely unknown path', () => {
      const { result } = renderI18n();
      expect(result.current.t('x.y.z.w')).toBe('x.y.z.w');
    });
  });

  // ── t() — parameter interpolation ───────────────────────────────────────
  describe('t() — parameter interpolation', () => {
    it('should interpolate {{param}} placeholders', () => {
      const { result } = renderI18n();
      expect(result.current.t('nav.greeting', { username: '阎罗王' })).toBe('你好, 阎罗王!');
    });

    it('should interpolate {param} (single brace) placeholders', () => {
      const { result } = renderI18n();
      // "nav.complex": "{count} 个{{item}}"
      expect(result.current.t('nav.complex', { count: '3', item: '灵魂' })).toBe('3 个灵魂');
    });

    it('should leave unmatched placeholders as-is', () => {
      const { result } = renderI18n();
      // Only pass username, but the template has {{username}}
      expect(result.current.t('nav.greeting', {})).toBe('你好, {{username}}!');
    });

    it('should return raw string when params is undefined', () => {
      const { result } = renderI18n();
      expect(result.current.t('nav.greeting')).toBe('你好, {{username}}!');
    });
  });

  // ── t() — returns key when value is not a string ─────────────────────────
  describe('t() — non-string values', () => {
    it('should return key when resolved value is an object', () => {
      const { result } = renderI18n();
      // "nav" resolves to an object, not a string
      expect(result.current.t('nav')).toBe('nav');
    });
  });

  // ── Locale switching ─────────────────────────────────────────────────────
  //
  // SWITCHING IS ASYNCHRONOUS NOW. Only the default bundle is statically
  // imported; `en` and `egy` arrive by dynamic import (see the LAZY_BUNDLES
  // note in I18nContext). Between `setLocale('en')` and the chunk landing,
  // `t()` answers from the default bundle through the same fallback path a
  // missing key takes — so these tests await the arrival rather than asserting
  // on the frame in between.
  //
  // The window itself is asserted below, deliberately: it is a real,
  // user-visible consequence of lazy-loading and it should be a stated
  // property rather than something a future reader discovers.
  describe('locale switching', () => {
    it('should switch to English and reflect in t() output', async () => {
      const { result } = renderI18n();
      expect(result.current.t('nav.title')).toBe('灵魂账本');

      act(() => {
        result.current.setLocale('en');
      });

      expect(result.current.locale).toBe('en');
      await waitFor(() => expect(result.current.t('nav.title')).toBe('Soul Ledger'));
    });

    it('shows the default copy until the bundle arrives, not a raw key', async () => {
      const { result } = renderI18n();

      act(() => {
        result.current.setLocale('en');
      });

      // The frame in between: Chinese copy, not "nav.title". A raw key here
      // would mean the fallback had been lost along with the eager import.
      expect(result.current.t('nav.title')).toBe('灵魂账本');
      await waitFor(() => expect(result.current.t('nav.title')).toBe('Soul Ledger'));
    });

    it('should switch to Egyptian and reflect in t() output', async () => {
      const { result } = renderI18n();

      act(() => {
        result.current.setLocale('egy');
      });

      expect(result.current.locale).toBe('egy');
      await waitFor(() => expect(result.current.t('nav.title')).toBe('𓂀 Soul Book 𓂀'));
    });

    it('should fall back to the default locale when a key is missing', async () => {
      const { result } = renderI18n();

      act(() => {
        result.current.setLocale('egy');
      });

      // Wait for the bundle first, or this passes for the wrong reason: before
      // it lands EVERY key falls back, so the assertion would hold even if egy
      // did contain `auth.login`.
      await waitFor(() => expect(result.current.t('nav.title')).toBe('𓂀 Soul Book 𓂀'));

      // "auth.login" exists in zh-Hans but NOT in egy — a partially translated
      // bundle should show real copy from the default locale, not a raw key.
      expect(result.current.t('auth.login')).toBe('登录');
    });

    it('should return the key when it is missing from every locale', () => {
      const { result } = renderI18n();

      act(() => {
        result.current.setLocale('egy');
      });

      expect(result.current.t('auth.totally_absent')).toBe('auth.totally_absent');
    });

    it('should support switching back to zh-Hans', async () => {
      const { result } = renderI18n();

      act(() => {
        result.current.setLocale('en');
      });
      // Await the arrival, or the second half proves nothing: before the
      // bundle lands the fallback already renders Chinese, so "switched back"
      // and "never switched" look identical.
      await waitFor(() => expect(result.current.t('nav.title')).toBe('Soul Ledger'));

      act(() => {
        result.current.setLocale('zh-Hans');
      });
      // Synchronous on the way back — the default bundle is always resident.
      expect(result.current.t('nav.title')).toBe('灵魂账本');
    });

    it('should persist locale to cookie', () => {
      const { result } = renderI18n();

      act(() => {
        result.current.setLocale('en');
      });

      expect(document.cookie).toContain('soulledger-locale=en');
    });
  });

  // ── tf() — translate, or the literal written at the call site ────────────
  //
  // `tf` lived on app/souls/[id]/page.tsx and was drilled into four children as
  // a prop. It is on the context now, and these are the checks that make the
  // move safe to trust.
  //
  // WHAT MAKES IT DIFFERENT FROM THE 26 DEAD `t(k) || "fallback"` CALL SITES
  // deleted in b491f8c: those could never reach their right-hand side, because
  // `t` answers a miss with the key — a truthy string. `tf` compares against
  // the key, so it can see the miss. The first case below is the one that goes
  // red if `t` ever stops echoing (returning "" or null instead), which would
  // silently invert every `tf` call in the app.
  describe('tf() — code-level fallback for a key no bundle has', () => {
    it('falls back on a missing key, and the fallback is not the key', () => {
      const { result } = renderI18n();
      // Stated together on purpose: the second line only works BECAUSE of the
      // first. `tf` has no way into `t`'s lookup; the echo is its whole signal.
      expect(result.current.t('souls.detail.more_actions')).toBe('souls.detail.more_actions');
      expect(result.current.tf('souls.detail.more_actions', '更多操作')).toBe('更多操作');
    });

    it('prefers the bundle when the key exists — the fallback is unreachable', () => {
      const { result } = renderI18n();
      // Absence as well as presence. A `tf` that always returned its fallback
      // would pass the case above and would hide every translation in the app.
      expect(result.current.tf('nav.title', 'NEVER-SHOWN')).toBe('灵魂账本');
      expect(result.current.tf('nav.title', 'NEVER-SHOWN')).not.toBe('NEVER-SHOWN');
    });

    it('interpolates {{name}} into the fallback', () => {
      const { result } = renderI18n();
      expect(result.current.tf('no.such.key', 'Life {{n}}', { n: '3' })).toBe('Life 3');
    });

    it('interpolates through the bundle when the key exists', () => {
      const { result } = renderI18n();
      expect(result.current.tf('nav.greeting', 'Hi {{username}}', { username: '阎罗王' }))
        .toBe('你好, 阎罗王!');
    });

    it('leaves a fallback placeholder alone when no params are given', () => {
      const { result } = renderI18n();
      expect(result.current.tf('no.such.key', 'Life {{n}}')).toBe('Life {{n}}');
    });

    it('follows a locale switch', async () => {
      // THE DEPENDENCY-ARRAY CHECK. `tf` is memoised on `t`, which is memoised
      // on `[locale, loadedBundles]`. Get that wrong — `useMemo(…, [])` — and
      // `tf` keeps answering out of the bundle map as it was at mount, so a
      // reader who switches language keeps seeing the old copy for every string
      // that goes through `tf`. Nothing in contextValueIdentity.test.tsx sees
      // that: a stale `tf` is a perfectly stable one.
      const { result } = renderI18n();
      expect(result.current.tf('nav.title', 'NEVER-SHOWN')).toBe('灵魂账本');

      act(() => {
        result.current.setLocale('en');
      });
      await waitFor(() => expect(result.current.tf('nav.title', 'NEVER-SHOWN')).toBe('Soul Ledger'));
    });

    it('falls back with no provider at all, because the default t echoes too', () => {
      // The context default is not decoration here: `RebirthFormSelect` is
      // rendered outside a provider by its own suite, and half its copy has no
      // key in any bundle.
      const { result } = renderHook(() => useI18n());
      expect(result.current.t('anything.at.all')).toBe('anything.at.all');
      expect(result.current.tf('anything.at.all', '轮回形态')).toBe('轮回形态');
    });
  });

  // ── useI18n hook ─────────────────────────────────────────────────────────
  describe('useI18n() hook', () => {
    it('should expose locale, setLocale, t, and hydrated', () => {
      const { result } = renderI18n();
      expect(result.current).toHaveProperty('locale');
      expect(result.current).toHaveProperty('setLocale');
      expect(result.current).toHaveProperty('t');
      expect(result.current).toHaveProperty('tf');
      expect(result.current).toHaveProperty('hydrated');
      expect(typeof result.current.t).toBe('function');
      expect(typeof result.current.tf).toBe('function');
      expect(typeof result.current.setLocale).toBe('function');
    });
  });
});
