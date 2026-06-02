import { type Page, type BrowserContext } from "@playwright/test";

/** Default test user for E2E tests. */
const TEST_USER = {
  username: "test_admin",
  role: "ADMIN",
  tenantCode: "CN_DIYU",
  tenantDisplayName: "Chinese Diyu",
};

/** Default JWT-like token for mocked auth state. */
const MOCK_ACCESS_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwidXNlcm5hbWUiOiJ0ZXN0X2FkbWluIiwidGVuYW50X2NvZGUiOiJDTl9ESVlVIn0.mock_signature";
const MOCK_REFRESH_TOKEN = "mock_refresh_token";

/**
 * Seeds localStorage with mock authentication tokens so the app
 * treats the user as logged in without hitting the real login endpoint.
 */
export function seedAuthLocalStorage(page: Page): Promise<void> {
  return page.evaluate(
    ({ accessToken, refreshToken, user }) => {
      localStorage.setItem("access_token", accessToken);
      localStorage.setItem("refresh_token", refreshToken);
      localStorage.setItem("user", JSON.stringify(user));
    },
    {
      accessToken: MOCK_ACCESS_TOKEN,
      refreshToken: MOCK_REFRESH_TOKEN,
      user: TEST_USER,
    },
  );
}

/**
 * Seeds a page context with auth state. Call this in a test's
 * `beforeEach` to ensure the page starts authenticated.
 */
export async function setupAuthenticatedPage(page: Page): Promise<void> {
  await page.goto("/");
  await seedAuthLocalStorage(page);
  await page.reload();
}
