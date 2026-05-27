/**
 * Tests for src/hooks/useAuth.ts
 *
 * useAuth() wraps useTenant() and adds hasPermission() / hasRole() helpers.
 * We mock the TenantContext module to control what useTenant() returns.
 */

import { renderHook } from '@testing-library/react';

// Mock TenantContext — provide a controllable useTenant() return value
const mockUseTenant = jest.fn();
jest.mock('@/src/contexts/TenantContext', () => ({
  useTenant: () => mockUseTenant(),
}));

// Import AFTER mock setup
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useAuth } = require('@/src/hooks/useAuth');

// ── Helpers ─────────────────────────────────────────────────────────────────
function makeTenantReturn(overrides: Record<string, unknown> = {}) {
  return {
    user: null,
    isAdmin: false,
    isJudge: false,
    isGuardian: false,
    isViewer: false,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────
describe('useAuth hook', () => {
  beforeEach(() => {
    mockUseTenant.mockReset();
  });

  // ── hasPermission ────────────────────────────────────────────────────────
  describe('hasPermission()', () => {
    it('should return false when user is null', () => {
      mockUseTenant.mockReturnValue(makeTenantReturn({ user: null }));
      const { result } = renderHook(() => useAuth());
      expect(result.current.hasPermission('soul.view')).toBe(false);
    });

    it('should return true for ADMIN regardless of permission list', () => {
      mockUseTenant.mockReturnValue(makeTenantReturn({
        user: { id: 1, username: 'yama', role: 'ADMIN', permissions: [] },
        isAdmin: true,
      }));
      const { result } = renderHook(() => useAuth());
      expect(result.current.hasPermission('soul.delete')).toBe(true);
      expect(result.current.hasPermission('anything.at.all')).toBe(true);
    });

    it('should return true when user has the specific permission', () => {
      mockUseTenant.mockReturnValue(makeTenantReturn({
        user: {
          id: 2, username: 'anubis', role: 'JUDGE',
          permissions: ['soul.view', 'judgment.create'],
        },
      }));
      const { result } = renderHook(() => useAuth());
      expect(result.current.hasPermission('soul.view')).toBe(true);
      expect(result.current.hasPermission('judgment.create')).toBe(true);
    });

    it('should return false when user lacks the specific permission', () => {
      mockUseTenant.mockReturnValue(makeTenantReturn({
        user: {
          id: 3, username: 'guard', role: 'GUARDIAN',
          permissions: ['soul.view'],
        },
      }));
      const { result } = renderHook(() => useAuth());
      expect(result.current.hasPermission('soul.delete')).toBe(false);
    });

    it('should return false when permissions array is empty', () => {
      mockUseTenant.mockReturnValue(makeTenantReturn({
        user: { id: 4, username: 'viewer', role: 'VIEWER', permissions: [] },
      }));
      const { result } = renderHook(() => useAuth());
      expect(result.current.hasPermission('soul.view')).toBe(false);
    });
  });

  // ── hasRole ──────────────────────────────────────────────────────────────
  describe('hasRole()', () => {
    it('should return true when user role matches', () => {
      mockUseTenant.mockReturnValue(makeTenantReturn({
        user: { id: 1, username: 'yama', role: 'ADMIN', permissions: [] },
      }));
      const { result } = renderHook(() => useAuth());
      expect(result.current.hasRole('ADMIN')).toBe(true);
    });

    it('should return false when user role does not match', () => {
      mockUseTenant.mockReturnValue(makeTenantReturn({
        user: { id: 2, username: 'anubis', role: 'JUDGE', permissions: [] },
      }));
      const { result } = renderHook(() => useAuth());
      expect(result.current.hasRole('ADMIN')).toBe(false);
    });

    it('should return false when user is null', () => {
      mockUseTenant.mockReturnValue(makeTenantReturn({ user: null }));
      const { result } = renderHook(() => useAuth());
      expect(result.current.hasRole('ADMIN')).toBe(false);
    });

    it('should distinguish all four roles', () => {
      const roles = ['ADMIN', 'JUDGE', 'GUARDIAN', 'VIEWER'] as const;
      roles.forEach((role) => {
        mockUseTenant.mockReturnValue(makeTenantReturn({
          user: { id: 1, username: 'test', role, permissions: [] },
        }));
        const { result } = renderHook(() => useAuth());
        roles.forEach((r) => {
          expect(result.current.hasRole(r)).toBe(r === role);
        });
      });
    });
  });

  // ── Context passthrough ──────────────────────────────────────────────────
  describe('context value passthrough', () => {
    it('should expose user from TenantContext', () => {
      const mockUser = { id: 10, username: 'osiris', role: 'JUDGE', permissions: ['x'] };
      mockUseTenant.mockReturnValue(makeTenantReturn({ user: mockUser }));
      const { result } = renderHook(() => useAuth());
      expect(result.current.user).toBe(mockUser);
    });

    it('should expose isAdmin, isJudge, isGuardian, isViewer flags', () => {
      mockUseTenant.mockReturnValue(makeTenantReturn({
        isAdmin: true, isJudge: false, isGuardian: false, isViewer: false,
      }));
      const { result } = renderHook(() => useAuth());
      expect(result.current.isAdmin).toBe(true);
      expect(result.current.isJudge).toBe(false);
      expect(result.current.isGuardian).toBe(false);
      expect(result.current.isViewer).toBe(false);
    });
  });
});
