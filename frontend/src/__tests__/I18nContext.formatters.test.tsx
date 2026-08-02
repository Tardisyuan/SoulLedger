/**
 * Tests for the formatDate / formatDateTime / formatNumber helpers exported
 * by src/contexts/I18nContext.tsx.
 *
 * Mocks the message JSON files the same way I18nContext.test.tsx does, since
 * the provider imports them eagerly.
 */

import React from 'react';
import { renderHook, act } from '@testing-library/react';

jest.mock('../../messages/zh-Hans.json', () => ({
  __esModule: true,
  default: { nav: { title: '灵魂账本' } },
}));

jest.mock('../../messages/en.json', () => ({
  __esModule: true,
  default: { nav: { title: 'Soul Ledger' } },
}));

jest.mock('../../messages/egy.json', () => ({
  __esModule: true,
  default: { nav: { title: '𓂀 Soul Book 𓂀' } },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { I18nProvider, useI18n } = require('@/src/contexts/I18nContext');

function renderI18n() {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <I18nProvider>{children}</I18nProvider>
  );
  return renderHook(() => useI18n(), { wrapper });
}

const FIXED_DATE = new Date('2026-07-30T13:58:02Z');

describe('I18nContext — formatters', () => {
  beforeEach(() => {
    document.cookie = 'soulledger-locale=; Max-Age=0; path=/';
  });

  describe('formatDate()', () => {
    it('formats using the zh-Hans locale by default', () => {
      const { result } = renderI18n();
      const formatted = result.current.formatDate(FIXED_DATE);
      expect(formatted).toBe(
        new Intl.DateTimeFormat('zh-Hans').format(FIXED_DATE)
      );
    });

    it('formats using en once the locale is switched', () => {
      const { result } = renderI18n();
      act(() => result.current.setLocale('en'));
      const formatted = result.current.formatDate(FIXED_DATE);
      expect(formatted).toBe(new Intl.DateTimeFormat('en').format(FIXED_DATE));
    });

    it('falls back to en formatting for the egy pseudo-locale', () => {
      const { result } = renderI18n();
      act(() => result.current.setLocale('egy'));
      const formatted = result.current.formatDate(FIXED_DATE);
      // "egy" is not a valid BCP-47 tag, so Intl calls must use "en" under the hood.
      expect(formatted).toBe(new Intl.DateTimeFormat('en').format(FIXED_DATE));
    });

    it('accepts string and number inputs, not just Date objects', () => {
      const { result } = renderI18n();
      const iso = FIXED_DATE.toISOString();
      expect(result.current.formatDate(iso)).toBe(result.current.formatDate(FIXED_DATE));
      expect(result.current.formatDate(FIXED_DATE.getTime())).toBe(result.current.formatDate(FIXED_DATE));
    });

    it('passes through Intl.DateTimeFormatOptions', () => {
      const { result } = renderI18n();
      const formatted = result.current.formatDate(FIXED_DATE, { year: 'numeric', month: 'long' });
      expect(formatted).toBe(
        new Intl.DateTimeFormat('zh-Hans', { year: 'numeric', month: 'long' }).format(FIXED_DATE)
      );
    });
  });

  describe('formatDateTime()', () => {
    it('defaults to medium date + medium time style', () => {
      const { result } = renderI18n();
      const formatted = result.current.formatDateTime(FIXED_DATE);
      expect(formatted).toBe(
        new Intl.DateTimeFormat('zh-Hans', { dateStyle: 'medium', timeStyle: 'medium' }).format(FIXED_DATE)
      );
    });

    it('lets callers override the default style options', () => {
      const { result } = renderI18n();
      const formatted = result.current.formatDateTime(FIXED_DATE, { dateStyle: 'short', timeStyle: 'short' });
      expect(formatted).toBe(
        new Intl.DateTimeFormat('zh-Hans', { dateStyle: 'short', timeStyle: 'short' }).format(FIXED_DATE)
      );
    });

    it('falls back to en formatting for the egy pseudo-locale', () => {
      const { result } = renderI18n();
      act(() => result.current.setLocale('egy'));
      const formatted = result.current.formatDateTime(FIXED_DATE);
      expect(formatted).toBe(
        new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'medium' }).format(FIXED_DATE)
      );
    });

    // Intl throws RangeError when dateStyle/timeStyle is combined with
    // individual component options, so the default style must be dropped
    // rather than spread underneath whatever the caller passed.
    it('drops the default style when given component options', () => {
      const { result } = renderI18n();
      const components: Intl.DateTimeFormatOptions = {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      };
      expect(() => result.current.formatDateTime(FIXED_DATE, components)).not.toThrow();
      expect(result.current.formatDateTime(FIXED_DATE, components)).toBe(
        new Intl.DateTimeFormat('zh-Hans', components).format(FIXED_DATE)
      );
    });

    it('still applies the default style for options with no components', () => {
      const { result } = renderI18n();
      const formatted = result.current.formatDateTime(FIXED_DATE, { hour12: false });
      expect(formatted).toBe(
        new Intl.DateTimeFormat('zh-Hans', {
          dateStyle: 'medium',
          timeStyle: 'medium',
          hour12: false,
        }).format(FIXED_DATE)
      );
    });
  });

  describe('formatNumber()', () => {
    it('formats using the current locale', () => {
      const { result } = renderI18n();
      expect(result.current.formatNumber(1234.5)).toBe(new Intl.NumberFormat('zh-Hans').format(1234.5));
    });

    it('falls back to en formatting for the egy pseudo-locale', () => {
      const { result } = renderI18n();
      act(() => result.current.setLocale('egy'));
      expect(result.current.formatNumber(1234.5)).toBe(new Intl.NumberFormat('en').format(1234.5));
    });

    it('passes through Intl.NumberFormatOptions', () => {
      const { result } = renderI18n();
      const formatted = result.current.formatNumber(0.42, { style: 'percent' });
      expect(formatted).toBe(new Intl.NumberFormat('zh-Hans', { style: 'percent' }).format(0.42));
    });
  });

  describe('useI18n() hook', () => {
    it('exposes formatDate, formatDateTime, and formatNumber', () => {
      const { result } = renderI18n();
      expect(typeof result.current.formatDate).toBe('function');
      expect(typeof result.current.formatDateTime).toBe('function');
      expect(typeof result.current.formatNumber).toBe('function');
    });
  });
});
