"use client";
import { usePermissions } from "@/src/hooks/usePermissions";

type RouteGuardProps = {
  children: React.ReactNode;
  permission: string;
  fallback?: React.ReactNode;
};

export function RouteGuard({ children, permission, fallback = null }: RouteGuardProps) {
  const { hasPermission } = usePermissions();
  if (!hasPermission(permission)) return <>{fallback}</>;
  return <>{children}</>;
}
