/**
 * Tests for src/contexts/I18nContext.tsx
 *
 * Tests the t() translation function, locale switching, and provider behaviour.
 * Mocks the message JSON files to keep tests deterministic and fast.
 */

import React from 'react';
import { renderHook, act } from '@testing-library/react';

// Mock message files with minimal fixtures
jest.mock('../../messages/zh-Hans.json', () => ({
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

jest.mock('../../messages/en.json', () => ({
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

jest.mock('../../messages/egy.json', () => ({
  __esModule: true,
  default: {
    nav: {
      title: '𓂀 Soul Book 𓂀',
    },
  },
}));

// Import AFTER mock setup
// eslint-disable-next-line @typescript-eslint/no-require-imports
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
  describe('locale switching', () => {
    it('should switch to English and reflect in t() output', () => {
      const { result } = renderI18n();
      expect(result.current.t('nav.title')).toBe('灵魂账本');

      act(() => {
        result.current.setLocale('en');
      });

      expect(result.current.locale).toBe('en');
      expect(result.current.t('nav.title')).toBe('Soul Ledger');
    });

    it('should switch to Egyptian and reflect in t() output', () => {
      const { result } = renderI18n();

      act(() => {
        result.current.setLocale('egy');
      });

      expect(result.current.locale).toBe('egy');
      expect(result.current.t('nav.title')).toBe('𓂀 Soul Book 𓂀');
    });

    it('should return key when translation is missing in new locale', () => {
      const { result } = renderI18n();

      act(() => {
        result.current.setLocale('egy');
      });

      // "auth.login" exists in zh-Hans and en but NOT in egy
      expect(result.current.t('auth.login')).toBe('auth.login');
    });

    it('should support switching back to zh-Hans', () => {
      const { result } = renderI18n();

      act(() => {
        result.current.setLocale('en');
      });
      expect(result.current.t('nav.title')).toBe('Soul Ledger');

      act(() => {
        result.current.setLocale('zh-Hans');
      });
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

  // ── useI18n hook ─────────────────────────────────────────────────────────
  describe('useI18n() hook', () => {
    it('should expose locale, setLocale, t, and hydrated', () => {
      const { result } = renderI18n();
      expect(result.current).toHaveProperty('locale');
      expect(result.current).toHaveProperty('setLocale');
      expect(result.current).toHaveProperty('t');
      expect(result.current).toHaveProperty('hydrated');
      expect(typeof result.current.t).toBe('function');
      expect(typeof result.current.setLocale).toBe('function');
    });
  });
});
