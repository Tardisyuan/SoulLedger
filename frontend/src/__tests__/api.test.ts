/**
 * Tests for lib/api.ts — API client, interceptors, auth flows.
 *
 * Strategy: mock axios so that axios.create() returns a mockInstance we can
 * assert against. Interceptor callbacks are captured at module-load time and
 * invoked directly in tests to verify behaviour.
 */

// Capture interceptor callbacks before the module executes
let requestInterceptor: ((config: Record<string, unknown>) => Record<string, unknown>) | null = null;
let responseRejected: ((error: unknown) => Promise<unknown>) | null = null;

const mockInstance = Object.assign(
  // Callable like AxiosInstance: api(config) => Promise
  jest.fn().mockResolvedValue({ data: {} }),
  {
    interceptors: {
      request: {
        use: jest.fn((fn: typeof requestInterceptor) => { requestInterceptor = fn; }),
      },
      response: {
        use: jest.fn(
          (fulfilled: unknown, rejected: typeof responseRejected) => {
            responseRejected = rejected;
          },
        ),
      },
    },
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
);

jest.mock('axios', () => {
  const mockAxios: Record<string, unknown> = {
    create: jest.fn(() => mockInstance),
    post: jest.fn(),
    get: jest.fn(),
    isAxiosError: jest.fn(),
  };
  mockAxios.default = mockAxios;
  return mockAxios;
});

// Import AFTER mock setup — module-level code runs (axios.create, interceptors)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const axios = require('axios');
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('../../lib/api');

// Suppress jsdom navigation warnings from window.location.href = "/login"
const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
afterAll(() => consoleSpy.mockRestore());

// ── Helpers ─────────────────────────────────────────────────────────────────
function applyRequestInterceptor(config: Record<string, unknown> = {}) {
  if (!requestInterceptor) throw new Error('Request interceptor not registered');
  return requestInterceptor(config);
}

function applyResponseErrorInterceptor(error: Record<string, unknown>) {
  if (!responseRejected) throw new Error('Response error interceptor not registered');
  return responseRejected(error);
}

// ── Tests ───────────────────────────────────────────────────────────────────
describe('API Client — lib/api.ts', () => {
  beforeEach(() => {
    // Clear cookies
    document.cookie.split(';').forEach((c) => {
      const name = c.split('=')[0].trim();
      if (name) document.cookie = `${name}=; Max-Age=0; path=/`;
    });
    sessionStorage.clear();
    localStorage.clear();
    mockInstance.get.mockReset();
    mockInstance.post.mockReset();
    mockInstance.patch.mockReset();
    mockInstance.put.mockReset();
    mockInstance.delete.mockReset();
    mockInstance.mockReset();
    mockInstance.mockResolvedValue({ data: {} });
    (axios.post as jest.Mock).mockReset();
    (axios.get as jest.Mock).mockReset();
  });

  // ── Module initialization ────────────────────────────────────────────────
  describe('module initialization', () => {
    it('should call axios.create with JSON content type header', () => {
      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    it('should register request interceptor', () => {
      expect(mockInstance.interceptors.request.use).toHaveBeenCalled();
      expect(requestInterceptor).not.toBeNull();
    });

    it('should register response interceptor', () => {
      expect(mockInstance.interceptors.response.use).toHaveBeenCalled();
      expect(responseRejected).not.toBeNull();
    });
  });

  // ── getCookie (tested via request interceptor) ───────────────────────────
  describe('getCookie (via request interceptor)', () => {
    it('should read token from document.cookie', () => {
      document.cookie = 'soulledger_access=my-jwt-token; path=/';
      const config = applyRequestInterceptor({ headers: {} }) as Record<string, unknown>;
      expect((config.headers as Record<string, string>).Authorization).toBe('Bearer my-jwt-token');
    });

    it('should return null for missing cookie', () => {
      const config = applyRequestInterceptor({ headers: {} }) as Record<string, unknown>;
      expect((config.headers as Record<string, string | undefined>).Authorization).toBeUndefined();
    });
  });

  // ── getTenantId (tested via request interceptor) ─────────────────────────
  describe('getTenantId (via request interceptor)', () => {
    it('should read tenant_id from localStorage first', () => {
      localStorage.setItem('tenant_id', 'egypt-tenant');
      const config = applyRequestInterceptor({ headers: {} }) as Record<string, unknown>;
      expect((config.headers as Record<string, string>)['X-Tenant-ID']).toBe('egypt-tenant');
    });

    it('should fall back to cookie if localStorage is empty', () => {
      document.cookie = 'tenant_id=greek-underworld; path=/';
      const config = applyRequestInterceptor({ headers: {} }) as Record<string, unknown>;
      expect((config.headers as Record<string, string>)['X-Tenant-ID']).toBe('greek-underworld');
    });

    it('should not set X-Tenant-ID when tenant is unknown', () => {
      const config = applyRequestInterceptor({ headers: {} }) as Record<string, unknown>;
      expect((config.headers as Record<string, string | undefined>)['X-Tenant-ID']).toBeUndefined();
    });
  });

  // ── Request interceptor: Authorization ───────────────────────────────────
  describe('request interceptor — Authorization', () => {
    it('should add Bearer token from cookie', () => {
      document.cookie = 'soulledger_access=cookie-token; path=/';
      const config = applyRequestInterceptor({ headers: {} }) as Record<string, unknown>;
      expect((config.headers as Record<string, string>).Authorization).toBe('Bearer cookie-token');
    });

    it('should add Bearer token from sessionStorage when cookie is absent', () => {
      sessionStorage.setItem('soulledger_access', 'session-token');
      const config = applyRequestInterceptor({ headers: {} }) as Record<string, unknown>;
      expect((config.headers as Record<string, string>).Authorization).toBe('Bearer session-token');
    });

    it('should prefer cookie over sessionStorage', () => {
      document.cookie = 'soulledger_access=cookie-wins; path=/';
      sessionStorage.setItem('soulledger_access', 'session-loses');
      const config = applyRequestInterceptor({ headers: {} }) as Record<string, unknown>;
      expect((config.headers as Record<string, string>).Authorization).toBe('Bearer cookie-wins');
    });

    it('should not set Authorization when no token exists', () => {
      const config = applyRequestInterceptor({ headers: {} }) as Record<string, unknown>;
      expect((config.headers as Record<string, string | undefined>).Authorization).toBeUndefined();
    });

    it('should pass through non-header config fields unchanged', () => {
      const original = { headers: {}, url: '/test/', method: 'get', baseURL: 'http://x' };
      const result = applyRequestInterceptor(original);
      expect(result.url).toBe('/test/');
      expect(result.method).toBe('get');
    });
  });

  // ── Request interceptor: X-Tenant-ID ─────────────────────────────────────
  describe('request interceptor — X-Tenant-ID', () => {
    it('should add X-Tenant-ID from localStorage', () => {
      localStorage.setItem('tenant_id', 'chinese-ten-courts');
      const config = applyRequestInterceptor({ headers: {} }) as Record<string, unknown>;
      expect((config.headers as Record<string, string>)['X-Tenant-ID']).toBe('chinese-ten-courts');
    });
  });

  // ── Response interceptor: 401 handling ───────────────────────────────────
  describe('response interceptor — 401 handling', () => {
    it('should attempt token refresh on 401 with refresh cookie', async () => {
      document.cookie = 'soulledger_refresh=my-refresh-token; path=/';
      (axios.post as jest.Mock).mockResolvedValueOnce({
        data: { access: 'new-access', refresh: 'new-refresh' },
      });
      // api(config) retry resolves
      mockInstance.mockResolvedValueOnce({ data: { ok: true } });

      await applyResponseErrorInterceptor({
        response: { status: 401 },
        config: { _retry: false, url: '/souls/', headers: {}, method: 'get' },
      });

      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/auth/refresh/'),
        { refresh: 'my-refresh-token' },
      );
      expect(sessionStorage.getItem('soulledger_access')).toBe('new-access');
    });

    it('should reject without refresh attempt for auth endpoints', async () => {
      const error = {
        response: { status: 401 },
        config: { _retry: false, url: '/api/v1/auth/login/', headers: {} },
      };
      await expect(applyResponseErrorInterceptor(error)).rejects.toBe(error);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('should reject non-401 errors immediately', async () => {
      const error = {
        response: { status: 500 },
        config: { _retry: false, headers: {} },
      };
      await expect(applyResponseErrorInterceptor(error)).rejects.toBe(error);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('should redirect to login when no refresh token exists', async () => {
      const error = {
        response: { status: 401 },
        config: { _retry: false, url: '/souls/', headers: {} },
      };
      await expect(applyResponseErrorInterceptor(error)).rejects.toBe(error);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('should skip refresh for register endpoint', async () => {
      const error = {
        response: { status: 401 },
        config: { _retry: false, url: '/api/v1/auth/register/', headers: {} },
      };
      await expect(applyResponseErrorInterceptor(error)).rejects.toBe(error);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('should skip refresh for refresh endpoint itself', async () => {
      const error = {
        response: { status: 401 },
        config: { _retry: false, url: '/api/v1/auth/refresh/', headers: {} },
      };
      await expect(applyResponseErrorInterceptor(error)).rejects.toBe(error);
      expect(axios.post).not.toHaveBeenCalled();
    });
  });

  // ── authApi ──────────────────────────────────────────────────────────────
  describe('authApi', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { authApi } = require('../../lib/api');

    it('login() should POST to /auth/login/ with credentials', () => {
      mockInstance.post.mockResolvedValueOnce({ data: { access: 'tok' } });
      authApi.login('judge_yama', 'password123');
      expect(mockInstance.post).toHaveBeenCalledWith('/auth/login/', {
        username: 'judge_yama',
        password: 'password123',
      });
    });

    it('register() should POST to /auth/register/', () => {
      mockInstance.post.mockResolvedValueOnce({ data: {} });
      authApi.register({ username: 'new_user', email: 'u@test.com' });
      expect(mockInstance.post).toHaveBeenCalledWith('/auth/register/', {
        username: 'new_user',
        email: 'u@test.com',
      });
    });

    it('profile() should GET /auth/profile/', () => {
      mockInstance.get.mockResolvedValueOnce({ data: {} });
      authApi.profile();
      expect(mockInstance.get).toHaveBeenCalledWith('/auth/profile/');
    });

    it('changePassword() should POST to /auth/change-password/', () => {
      mockInstance.post.mockResolvedValueOnce({ data: {} });
      authApi.changePassword('old-pw', 'new-pw');
      expect(mockInstance.post).toHaveBeenCalledWith('/auth/change-password/', {
        old_password: 'old-pw',
        new_password: 'new-pw',
      });
    });
  });

  // ── soulsApi ─────────────────────────────────────────────────────────────
  describe('soulsApi', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { soulsApi } = require('../../lib/api');

    it('list() should GET /souls/ with query params', () => {
      mockInstance.get.mockResolvedValueOnce({ data: { results: [] } });
      soulsApi.list({ page: 2, civilization: 'CHINESE', search: '李四' });
      expect(mockInstance.get).toHaveBeenCalledWith('/souls/', {
        params: { page: 2, civilization: 'CHINESE', search: '李四' },
      });
    });

    it('list() should work without params', () => {
      mockInstance.get.mockResolvedValueOnce({ data: { results: [] } });
      soulsApi.list();
      expect(mockInstance.get).toHaveBeenCalledWith('/souls/', { params: undefined });
    });

    it('get() should GET /souls/:id/', () => {
      mockInstance.get.mockResolvedValueOnce({ data: { id: 'abc-123' } });
      soulsApi.get('abc-123');
      expect(mockInstance.get).toHaveBeenCalledWith('/souls/abc-123/');
    });

    it('create() should POST /souls/', () => {
      mockInstance.post.mockResolvedValueOnce({ data: {} });
      const payload = { name: '新灵魂', civilization: 'CHINESE', birth_date: '1990-01-01', origin_location: '长安' };
      soulsApi.create(payload);
      expect(mockInstance.post).toHaveBeenCalledWith('/souls/', payload);
    });

    it('update() should PATCH /souls/:id/', () => {
      mockInstance.patch.mockResolvedValueOnce({ data: {} });
      soulsApi.update('abc-123', { name: '更新名' });
      expect(mockInstance.patch).toHaveBeenCalledWith('/souls/abc-123/', { name: '更新名' });
    });

    it('delete() should DELETE /souls/:id/', () => {
      mockInstance.delete.mockResolvedValueOnce({ data: {} });
      soulsApi.delete('abc-123');
      expect(mockInstance.delete).toHaveBeenCalledWith('/souls/abc-123/');
    });
  });

  // ── judgmentApi ──────────────────────────────────────────────────────────
  describe('judgmentApi', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { judgmentApi } = require('../../lib/api');

    it('list() should GET /judgment/', () => {
      mockInstance.get.mockResolvedValueOnce({ data: [] });
      judgmentApi.list({ civilization: 'EGYPTIAN' });
      expect(mockInstance.get).toHaveBeenCalledWith('/judgment/', {
        params: { civilization: 'EGYPTIAN' },
      });
    });

    it('create() should POST /judgment/', () => {
      mockInstance.post.mockResolvedValueOnce({ data: {} });
      judgmentApi.create({ soul: 's1', court: 'c1' });
      expect(mockInstance.post).toHaveBeenCalledWith('/judgment/', { soul: 's1', court: 'c1' });
    });

    it('conclude() should POST /judgment/:id/conclude/', () => {
      mockInstance.post.mockResolvedValueOnce({ data: {} });
      judgmentApi.conclude('j-42', { verdict: 'PASSED' });
      expect(mockInstance.post).toHaveBeenCalledWith('/judgment/j-42/conclude/', { verdict: 'PASSED' });
    });
  });

  // ── karmaApi ─────────────────────────────────────────────────────────────
  describe('karmaApi', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { karmaApi } = require('../../lib/api');

    it('balance() should GET /karma/balance/:id/', () => {
      mockInstance.get.mockResolvedValueOnce({ data: {} });
      karmaApi.balance(42);
      expect(mockInstance.get).toHaveBeenCalledWith('/karma/balance/42/');
    });

    it('recalculate() should POST /karma/calculate/:id/', () => {
      mockInstance.post.mockResolvedValueOnce({ data: {} });
      karmaApi.recalculate(7);
      expect(mockInstance.post).toHaveBeenCalledWith('/karma/calculate/7/');
    });
  });

  // ── workflowApi ──────────────────────────────────────────────────────────
  describe('workflowApi', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { workflowApi } = require('../../lib/api');

    it('list() should GET /workflows/', () => {
      mockInstance.get.mockResolvedValueOnce({ data: [] });
      workflowApi.list({ status: 'PENDING' });
      expect(mockInstance.get).toHaveBeenCalledWith('/workflows/', { params: { status: 'PENDING' } });
    });

    it('advance() should POST /workflows/:id/advance/', () => {
      mockInstance.post.mockResolvedValueOnce({ data: {} });
      workflowApi.advance('wf-1');
      expect(mockInstance.post).toHaveBeenCalledWith('/workflows/wf-1/advance/');
    });

    it('approveNode() should POST /workflows/nodes/:nodeId/approve/', () => {
      mockInstance.post.mockResolvedValueOnce({ data: {} });
      workflowApi.approveNode('wf-1', 'node-5', { verdict: 'PASS', notes: 'LGTM' });
      expect(mockInstance.post).toHaveBeenCalledWith('/workflows/nodes/node-5/approve/', {
        verdict: 'PASS',
        notes: 'LGTM',
      });
    });

    it('templates.list() should GET /workflows/templates/', () => {
      mockInstance.get.mockResolvedValueOnce({ data: [] });
      workflowApi.templates.list();
      expect(mockInstance.get).toHaveBeenCalledWith('/workflows/templates/', { params: undefined });
    });
  });
});
