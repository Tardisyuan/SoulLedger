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

function SignedInAs({ civ }: { civ: Civ }) {
  const { setUser } = useTenant();
  useLayoutEffect(() => {
    setUser({
      id: 0,
      username: "preview",
      display_name: "预览",
      role: "JUDGE",
      tenant: TENANT[civ],
      permissions: [],
    } as never);
    // setUser also caches the user in localStorage (TenantContext USER_KEY); a
    // preview must not leave a signed-in tenant behind for the next render.
    try {
      localStorage.removeItem("soulledger_user");
    } catch {
      /* storage unavailable */
    }
  }, [civ, setUser]);
  return null;
}

export function SoulLedgerProvider({
  children,
  pathname = "/dashboard",
  civ,
}: {
  children: ReactNode;
  pathname?: string;
  civ?: Civ;
}) {
  return (
    <PathnameContext.Provider value={pathname}>
      <I18nProvider>
        <ThemeProvider>
          <TenantProvider>
            {civ ? <SignedInAs civ={civ} /> : null}
            <ToastProvider>
              {/* TenantProvider writes data-civ on <html> — one value per document.
                  Scoping it here too lets two skins sit side by side. */}
              {civ ? <div data-civ={civ} style={{ display: "contents" }}>{children}</div> : children}
            </ToastProvider>
          </TenantProvider>
        </ThemeProvider>
      </I18nProvider>
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
export { showToast, dismissToast } from "../../frontend/src/components/ui/Toast";
export { PageSection } from "../../frontend/components/ui/page-section";
export { Skeleton, TableSkeleton, CardSkeleton, ListSkeleton } from "../../frontend/components/ui/skeleton";
export { DataTable } from "../../frontend/components/ui/data-table";
export { GlobalNav, BottomBar } from "../../frontend/src/components/layout/GlobalNav";
export { Breadcrumb } from "../../frontend/src/components/layout/Breadcrumb";
export { ThemeToggle } from "../../frontend/src/components/layout/ThemeToggle";
export { Plaque } from "../../frontend/src/components/plaque/Plaque";
export { Seal } from "../../frontend/src/components/plaque/Seal";
export { SectionTitle } from "../../frontend/src/components/plaque/SectionTitle";
