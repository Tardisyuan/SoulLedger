import { useContext } from "react";

import { useI18n } from "./i18n";
import { SessionContext } from "./session";

/** The hall this soul is in now (`/me/`'s tenant), by its hall name — not the tenant's admin name. */
export function useCurrentHall(): string {
  const session = useContext(SessionContext);
  const { locale } = useI18n();
  if (session?.state.status !== "signedIn") return "";
  const tenant = session.state.profile.tenant;
  return tenant.hall_names?.[locale] || tenant.display_name;
}
