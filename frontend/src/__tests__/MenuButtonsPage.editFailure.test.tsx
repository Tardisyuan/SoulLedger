/**
 * Editing a menu button: a refused save is SAID, not swallowed.
 *
 * WHAT WENT WRONG. `app/menus/buttons/page.tsx`'s submit handler had a
 * mutation for create and delete and, for edit, a bare
 * `await menuButtonsApi.update(...)` inline. A 4xx/5xx there was an unhandled
 * promise rejection: no toast, no cache invalidation, and the modal sitting
 * open with nothing said (FL-08). `app/menus/page.tsx` had the same defect on
 * the same form shape and was fixed with an `updateMutation`; this page was
 * left behind.
 *
 * The real page with a real QueryClient; the HTTP layer and the two contexts
 * are doubles. The toast is what the operator would see, so it is the
 * assertion; that the modal stays open is the other half — closing it on a
 * failure would tell them the save landed.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MenuButtonsPage from "@/app/menus/buttons/page";
import { menuButtonsApi, menusApi, permApi } from "@soulledger/core/api";

jest.mock("@soulledger/core/api", () => ({
  menuButtonsApi: { list: jest.fn(), update: jest.fn(), create: jest.fn(), delete: jest.fn() },
  menusApi: { all: jest.fn() },
  permApi: { list: jest.fn() },
  PAGE_SIZE: 20,
}));

const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "zh-Hans",
    hydrated: true,
  }),
}));

const mockTenant = {
  user: { id: 1, username: "yama", role: "ADMIN", tenant: null, permissions: ["menu.manage"] },
};
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => mockTenant,
}));

const mockList = menuButtonsApi.list as jest.Mock;
const mockUpdate = menuButtonsApi.update as jest.Mock;

const BUTTON = {
  id: 7,
  name: "Seal verdict",
  code: "seal",
  permission: "judgment.execute",
  order: 1,
  is_active: true,
  menu: 3,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MenuButtonsPage />
    </QueryClientProvider>
  );
}

async function openEditAndSubmit() {
  renderPage();
  await screen.findByText("Seal verdict");
  fireEvent.click(screen.getByRole("button", { name: "menus.edit" }));
  expect(screen.getByText("menu_buttons.edit")).toBeInTheDocument();
  // `document`, not the render container: `Modal` portals to `document.body`.
  const form = document.querySelector("form");
  if (!form) throw new Error("edit form not rendered");
  fireEvent.submit(form);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockResolvedValue({ data: { count: 1, next: null, previous: null, results: [BUTTON] } });
  (menusApi.all as jest.Mock).mockResolvedValue({ data: [] });
  (permApi.list as jest.Mock).mockResolvedValue({ data: [] });
});

describe("editing a menu button", () => {
  it("toasts the failure and keeps the modal open when the server refuses the update", async () => {
    mockUpdate.mockRejectedValue({ response: { status: 500 } });

    await openEditAndSubmit();

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("menu_buttons.update_error", "error"));
    expect(mockUpdate).toHaveBeenCalledWith(7, expect.objectContaining({ name: "Seal verdict" }));
    // Still open: closing on a failure would say the save landed.
    expect(screen.getByText("menu_buttons.edit")).toBeInTheDocument();
  });

  it("closes the modal and says nothing red when the update lands", async () => {
    mockUpdate.mockResolvedValue({ data: BUTTON });

    await openEditAndSubmit();

    await waitFor(() => expect(screen.queryByText("menu_buttons.edit")).toBeNull());
    expect(mockShowToast).not.toHaveBeenCalledWith(expect.anything(), "error");
  });
});
