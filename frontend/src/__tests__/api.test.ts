/**
 * Tests for lib/api.ts — API client, interceptors, auth flows.
 *
 * Strategy: mock axios so that axios.create() returns a mockInstance we can
 * assert against. Interceptor callbacks are captured at module-load time and
 * invoked directly in tests to verify behaviour.
 */

// Capture interceptor callbacks before the module executes
let requestInterceptor: ((_config: Record<string, unknown>) => Record<string, unknown>) | null = null;
let responseRejected: ((_error: unknown) => Promise<unknown>) | null = null;

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
 
const axios = require('axios');
 
require('@soulledger/core/api');

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
describe('API Client — @soulledger/core/api', () => {
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
    it('reads the token from sessionStorage', () => {
      sessionStorage.setItem('soulledger_access', 'my-jwt-token');
      const config = applyRequestInterceptor({ headers: {} }) as Record<string, unknown>;
      expect((config.headers as Record<string, string>).Authorization).toBe('Bearer my-jwt-token');
    });

    it('ignores a soulledger_access cookie entirely', () => {
      // 这条曾经断的是相反的事。access token 被写进一个 `max-age=86400` 的
      // cookie(而它只活 30 分钟),读取端又是 cookie 优先 —— 于是「关标签页即
      // 失效」这条设计,在第一次静默刷新之后就不再成立。现在 access 只住在
      // sessionStorage,而刷新时会清掉残留的那个 cookie。
      document.cookie = 'soulledger_access=stale-24h; path=/';
      const config = applyRequestInterceptor({ headers: {} }) as Record<string, unknown>;
      expect((config.headers as Record<string, string | undefined>).Authorization).toBeUndefined();
    });

    it('should return null when nothing is stored', () => {
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
    it('should add Bearer token from sessionStorage', () => {
      sessionStorage.setItem('soulledger_access', 'session-token');
      const config = applyRequestInterceptor({ headers: {} }) as Record<string, unknown>;
      expect((config.headers as Record<string, string>).Authorization).toBe('Bearer session-token');
    });

    it('a stale cookie does not win over sessionStorage', () => {
      document.cookie = 'soulledger_access=cookie-stale; path=/';
      sessionStorage.setItem('soulledger_access', 'session-current');
      const config = applyRequestInterceptor({ headers: {} }) as Record<string, unknown>;
      expect((config.headers as Record<string, string>).Authorization).toBe('Bearer session-current');
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

    /* 这三条此前喂的是 `/api/v1/auth/...`,而 `baseURL` 已经含 `/api/v1` ——
       axios 交给拦截器的 `config.url` 是 `/auth/login/`。于是它们三条同时:
       用一个应用不会产生的 URL,去测一条正则,而那条正则对真实 URL 永远不匹配。
       同一个文件五十行之下就断言真实调用是 `mockInstance.post('/auth/login/')`
       —— **这份测试自带反驳材料,相隔五十行。**
       换成真实形状之后,它们守的才是那个「跳过认证端点」的保护。 */
    it('should reject without refresh attempt for auth endpoints', async () => {
      // cookie 必须在。没有它,`if (refresh)` 是假,拦截器无论如何都不会去刷新
      // —— 于是这条断言在正则完全失效时**照样通过**。实测:把正则改回带
      // `/api/v1` 前缀的那一版(它对真实 URL 永远不匹配),这三条一条不红。
      // **一条因为错误的理由而绿的断言,等价于不存在。**
      document.cookie = 'soulledger_refresh=present; path=/';
      const error = {
        response: { status: 401 },
        config: { _retry: false, url: '/auth/login/', headers: {} },
      };
      await expect(applyResponseErrorInterceptor(error)).rejects.toBe(error);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('two requests failing at once trigger exactly ONE refresh', async () => {
      /* `error.config._retry` 是**每个请求自己的 config** 上的标志。两个同时 401
         的请求各自看到 `_retry === false`、各自读到同一个 refresh token、
         各自 POST `/auth/refresh/`。后端跑
         `ROTATE_REFRESH_TOKENS: True` + `BLACKLIST_AFTER_ROTATION: True`,
         于是第一个成功**并把第二个手上那个 token 拉黑** —— 第二个必然 401、
         落进 catch、清 cookie、跳 `/login`。

         access 寿命 30 分钟,任何同时发多个查询的页面(也就是大部分页面)在
         token 过期后第一次加载就满足这个条件。

         断言的是 `axios.post` 的**调用次数**。只断言「两个请求最后都成功」的话,
         一个各刷各的实现在测试里也会通过 —— 因为测试里的 mock 不会拉黑任何东西。
         次数是唯一能把这两件事分开的量。 */
      document.cookie = 'soulledger_refresh=shared-refresh; path=/';
      (axios.post as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve({ data: { access: 'rotated', refresh: 'next' } }),
              5
            )
          )
      );
      mockInstance.mockResolvedValue({ data: { ok: true } });

      await Promise.all([
        applyResponseErrorInterceptor({
          response: { status: 401 },
          config: { _retry: false, url: '/souls/', headers: {}, method: 'get' },
        }),
        applyResponseErrorInterceptor({
          response: { status: 401 },
          config: { _retry: false, url: '/judgment/', headers: {}, method: 'get' },
        }),
      ]);

      expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it('a later 401 starts a fresh refresh, not a stale shared one', async () => {
      /* 反对照。没有它,一个「第一次刷完就永远不再刷」的实现同样满足上面那条,
         而那会让 token 第二次过期时全站卡死。 */
      document.cookie = 'soulledger_refresh=r1; path=/';
      (axios.post as jest.Mock).mockResolvedValue({
        data: { access: 'a', refresh: 'r2' },
      });
      mockInstance.mockResolvedValue({ data: { ok: true } });

      await applyResponseErrorInterceptor({
        response: { status: 401 },
        config: { _retry: false, url: '/souls/', headers: {}, method: 'get' },
      });
      await applyResponseErrorInterceptor({
        response: { status: 401 },
        config: { _retry: false, url: '/souls/', headers: {}, method: 'get' },
      });

      expect(axios.post).toHaveBeenCalledTimes(2);
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
      /* FL-20. This test used to assert only "no refresh was attempted" under
         this title, and the interceptor did not hand over to `onUnauthorized`
         at all when there was no refresh token: every query went red and the
         user stayed on a dead page. The title was the claim; nothing checked it. */
      const { webPlatform } = require('../../lib/platform/web');
      const onUnauthorized = jest.spyOn(webPlatform, 'onUnauthorized').mockImplementation(() => {});
      sessionStorage.setItem('soulledger_access', 'expired-access');
      try {
        const error = {
          response: { status: 401 },
          config: { _retry: false, url: '/souls/', headers: {} },
        };
        await expect(applyResponseErrorInterceptor(error)).rejects.toBe(error);
        expect(axios.post).not.toHaveBeenCalled();
        expect(onUnauthorized).toHaveBeenCalledTimes(1);
        expect(sessionStorage.getItem('soulledger_access')).toBeNull();
      } finally {
        onUnauthorized.mockRestore();
      }
    });

    it('a 401 from an auth endpoint does not hand over to onUnauthorized', async () => {
      // A wrong password on /login is a 401 too; it must stay on the form.
      const { webPlatform } = require('../../lib/platform/web');
      const onUnauthorized = jest.spyOn(webPlatform, 'onUnauthorized').mockImplementation(() => {});
      try {
        const error = {
          response: { status: 401 },
          config: { _retry: false, url: '/auth/login/', headers: {} },
        };
        await expect(applyResponseErrorInterceptor(error)).rejects.toBe(error);
        expect(onUnauthorized).not.toHaveBeenCalled();
      } finally {
        onUnauthorized.mockRestore();
      }
    });

    it('the web adapter does not send /login to /login', () => {
      /* With FL-20 fixed, a 401 with no refresh token now reaches onUnauthorized
         from any page — including /login itself, where TenantContext re-fetches
         permissions for a cached user envelope. Navigating there again would
         reload the page, re-fire the request, and loop. jsdom reports every
         attempted navigation through console.error; the second half proves the
         probe can see one, so the first half's silence means something. */
      const { webPlatform } = require('../../lib/platform/web');
      const attemptedNavigation = () =>
        consoleSpy.mock.calls.some((c) => String(c[0]).includes('navigation'));

      // With a query string on purpose: jsdom treats assigning the *identical*
      // URL as a no-op, which a real browser does not (it reloads). Measured —
      // on bare '/login' this assertion was green with no guard at all.
      window.history.pushState({}, '', '/login?next=%2Fsouls');
      consoleSpy.mockClear();
      webPlatform.onUnauthorized();
      const fromLogin = attemptedNavigation();

      window.history.pushState({}, '', '/souls');
      consoleSpy.mockClear();
      webPlatform.onUnauthorized();
      const fromSouls = attemptedNavigation();
      window.history.pushState({}, '', '/');

      expect(fromSouls).toBe(true);
      expect(fromLogin).toBe(false);
    });

    it('should skip refresh for register endpoint', async () => {
      document.cookie = 'soulledger_refresh=present; path=/';
      const error = {
        response: { status: 401 },
        config: { _retry: false, url: '/auth/register/', headers: {} },
      };
      await expect(applyResponseErrorInterceptor(error)).rejects.toBe(error);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('should skip refresh for refresh endpoint itself', async () => {
      document.cookie = 'soulledger_refresh=present; path=/';
      const error = {
        response: { status: 401 },
        config: { _retry: false, url: '/auth/refresh/', headers: {} },
      };
      await expect(applyResponseErrorInterceptor(error)).rejects.toBe(error);
      expect(axios.post).not.toHaveBeenCalled();
    });
  });

  // ── authApi ──────────────────────────────────────────────────────────────
  describe('authApi', () => {
     
    const { authApi } = require('@soulledger/core/api');

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
     
    const { soulsApi } = require('@soulledger/core/api');

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
     
    const { judgmentApi } = require('@soulledger/core/api');

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

  // ── ledgerApi ────────────────────────────────────────────────────────────
  describe('ledgerApi', () => {
     
    const { ledgerApi } = require('@soulledger/core/api');

    it('balance() should GET /ledger/balance/:id/', () => {
      mockInstance.get.mockResolvedValueOnce({ data: {} });
      ledgerApi.balance(42);
      expect(mockInstance.get).toHaveBeenCalledWith('/ledger/balance/42/');
    });

    it('recalculate() should POST /ledger/calculate/:id/', () => {
      mockInstance.post.mockResolvedValueOnce({ data: {} });
      ledgerApi.recalculate(7);
      expect(mockInstance.post).toHaveBeenCalledWith('/ledger/calculate/7/');
    });
  });

  // ── workflowApi ──────────────────────────────────────────────────────────
  describe('workflowApi', () => {
     
    const { workflowApi } = require('@soulledger/core/api');

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

    // approve_node is a detail action on ApprovalWorkflowViewSet
    // (apps/workflow/views.py:190), not a route on ApprovalNodeViewSet — the
    // node being decided is identified by `node_id` in the POST body, not by
    // a URL segment.
    it('approveNode() should POST /workflows/:id/approve_node/ with node_id in the body', () => {
      mockInstance.post.mockResolvedValueOnce({ data: {} });
      workflowApi.approveNode('wf-1', 'node-5', { verdict: 'PASS', notes: 'LGTM' });
      expect(mockInstance.post).toHaveBeenCalledWith('/workflows/wf-1/approve_node/', {
        node_id: 'node-5',
        verdict: 'PASS',
        notes: 'LGTM',
      });
    });

    it('templates.list() should GET /workflow/templates/', () => {
      mockInstance.get.mockResolvedValueOnce({ data: [] });
      workflowApi.templates.list();
      expect(mockInstance.get).toHaveBeenCalledWith('/workflow/templates/', { params: undefined });
    });
  });

  // ── menuButtonsApi ───────────────────────────────────────────────────────
  describe('menuButtonsApi', () => {

    const { menuButtonsApi } = require('@soulledger/core/api');

    // The parameter the backend reads is `menu_id`
    // (apps/menus/views.py::MenuButtonViewSet.get_queryset). This sent `menu`,
    // which DRF ignores, so the menu picker on /menus/buttons filtered nothing
    // and every menu showed every button (FL-03). The absence half matters: a
    // client that sent both would pass a presence-only check while still
    // carrying the dead one.
    it('list(menuId, page) sends `menu_id`, not `menu`', () => {
      mockInstance.get.mockResolvedValueOnce({ data: { results: [] } });
      menuButtonsApi.list(5, 2);
      expect(mockInstance.get).toHaveBeenCalledWith('/menus/buttons/', {
        params: { menu_id: 5, page: 2 },
      });
      const sent = mockInstance.get.mock.calls.at(-1)?.[1]?.params;
      expect(sent).not.toHaveProperty('menu');
    });

    it('list() with no menu sends no filter at all', () => {
      mockInstance.get.mockResolvedValueOnce({ data: { results: [] } });
      menuButtonsApi.list(undefined, 1);
      expect(mockInstance.get).toHaveBeenCalledWith('/menus/buttons/', { params: { page: 1 } });
    });
  });
});
