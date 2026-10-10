// design-sync entry: the slice of the web frontend that ships to claude.ai/design
// (tokens + base components + nav shell). Re-exports only — no component code
// lives here. SoulLedgerProvider is the provider stack from app/layout.tsx minus
// the parts that need a server (query client, websocket, platform ports).
// Outside Next there is no router, so `usePathname()` reads null; `pathname`
// stands in for the current route (nav highlight, breadcrumb trail).
// `civ` stands in for a signed-in tenant of that civilization: the plaque colour,
// seal and plaque fonts all follow it. Omitted = the pre-login neutral skin.
import "./process-shim";
import { useLayoutEffect, type ReactNode } from "react";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "../../frontend/src/contexts/I18nContext";
import { ThemeProvider } from "../../frontend/src/contexts/ThemeContext";
import { TenantProvider, useTenant } from "../../frontend/src/contexts/TenantContext";
import { ToastProvider } from "../../frontend/src/contexts/ToastContext";

type Civ = "cn" | "eu" | "eg" | "gr";
// Tenant codes from packages/core/src/config/civilizations.ts (CIVILIZATION_CODES).
const TENANT: Record<Civ, { code: string; display_name: string }> = {
  cn: { code: "CN_DIYU", display_name: "酆都" },
  eu: { code: "EU_HEAVEN_HELL", display_name: "Inferno" },
  eg: { code: "EG_DUAT", display_name: "Duat" },
  gr: { code: "GR_HADES", display_name: "Hades" },
};

// GlobalSearch calls useRouter() and useQuery(). There is no Next router and no API here:
// navigation is a no-op and queries never retry, so the box renders and a search finds nothing.
const ROUTER = { push() {}, replace() {}, prefetch() {}, back() {}, forward() {}, refresh() {} };
const QUERY = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

function SignedInAs({ civ, mfaRequired }: { civ: Civ; mfaRequired?: boolean }) {
  const { setUser } = useTenant();
  useLayoutEffect(() => {
    setUser({
      id: 0,
      username: "preview",
      display_name: "预览",
      role: "JUDGE",
      tenant: TENANT[civ],
      permissions: [],
      // MfaRequiredBanner shows for a user whose role requires two-step sign-in and who has not set it up.
      mfa_required: !!mfaRequired,
      mfa_enabled: false,
    } as never);
    // setUser also caches the user in localStorage (TenantContext USER_KEY); a
    // preview must not leave a signed-in tenant behind for the next render.
    try {
      localStorage.removeItem("soulledger_user");
    } catch {
      /* storage unavailable */
    }
  }, [civ, mfaRequired, setUser]);
  return null;
}

export function SoulLedgerProvider({
  children,
  pathname = "/dashboard",
  civ,
  mfaRequired,
}: {
  children: ReactNode;
  pathname?: string;
  civ?: Civ;
  /** With `civ`: the signed-in user must set up two-step sign-in (MfaRequiredBanner appears). */
  mfaRequired?: boolean;
}) {
  return (
    <PathnameContext.Provider value={pathname}>
     <AppRouterContext.Provider value={ROUTER as never}>
      <QueryClientProvider client={QUERY}>
      <I18nProvider>
        <ThemeProvider>
          <TenantProvider>
            {civ ? <SignedInAs civ={civ} mfaRequired={mfaRequired} /> : null}
            <ToastProvider>
              {/* TenantProvider writes data-civ on <html> — one value per document.
                  Scoping it here too lets two skins sit side by side. */}
              {civ ? <div data-civ={civ} style={{ display: "contents" }}>{children}</div> : children}
            </ToastProvider>
          </TenantProvider>
        </ThemeProvider>
      </I18nProvider>
      </QueryClientProvider>
     </AppRouterContext.Provider>
    </PathnameContext.Provider>
  );
}

export { Badge, BADGE_TONES } from "../../frontend/src/components/ui/Badge";
export { Button, BUTTON_VARIANTS, BUTTON_SIZES } from "../../frontend/src/components/ui/Button";
export { StatusBadge, VerdictBadge, SoulStateBadge } from "../../frontend/src/components/ui/StatusBadge";
export { Spinner, PageSpinner } from "../../frontend/src/components/ui/Spinner";
export { EmptyState } from "../../frontend/src/components/ui/EmptyState";
export { Field, TextField, SelectField, TextAreaField } from "../../frontend/src/components/ui/Field";
export { SearchSelectField } from "../../frontend/src/components/ui/SearchSelectField";
export { FilterChipSelect, FilterChipToggle } from "../../frontend/src/components/ui/FilterChip";
export { BaseModal, ConfirmDialog } from "../../frontend/src/components/ui/Modal";
export { Drawer } from "../../frontend/src/components/ui/Drawer";
export { Pagination } from "../../frontend/src/components/ui/Pagination";
export { PageShell } from "../../frontend/src/components/ui/PageShell";
export { PageError, StatusCard } from "../../frontend/src/components/ui/PageError";
export { DomainEnum, DomainNumber, DomainText, IdentifierChip, MissingValue } from "../../frontend/src/components/ui/DomainValue";
export { TreeName } from "../../frontend/src/components/ui/TreeRow";
export { showToast, dismissToast, ToastContainer } from "../../frontend/src/components/ui/Toast";
export { Collapse } from "../../frontend/src/components/ui/Collapse";
export { IconPicker } from "../../frontend/src/components/ui/IconPicker";
export { BrandMark } from "../../frontend/src/components/brand/BrandMark";
export { TablePageSkeleton, CardListPageSkeleton } from "../../frontend/components/ui/page-skeletons";
export { DataGrid, FilterBar, ActionsMenu, EnumBadge } from "../../frontend/components/ui/data-grid";
export { GlobalSearch } from "../../frontend/src/components/layout/GlobalSearch";
export { LogoutConfirmDialog } from "../../frontend/src/components/layout/LogoutConfirmDialog";
export { MfaRequiredBanner } from "../../frontend/src/components/layout/MfaRequiredBanner";
export { ConnectionStatus, ConnectionBanner } from "../../frontend/src/components/connection-status";
export { PageSection } from "../../frontend/components/ui/page-section";
export { Skeleton, TableSkeleton, CardSkeleton, ListSkeleton } from "../../frontend/components/ui/skeleton";
export { DataTable } from "../../frontend/components/ui/data-table";
export { GlobalNav, BottomBar } from "../../frontend/src/components/layout/GlobalNav";
export { Breadcrumb } from "../../frontend/src/components/layout/Breadcrumb";
export { ThemeToggle } from "../../frontend/src/components/layout/ThemeToggle";
export { Plaque } from "../../frontend/src/components/plaque/Plaque";
export { Seal } from "../../frontend/src/components/plaque/Seal";
