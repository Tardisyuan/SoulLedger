"use client";
import { useAuth } from "@/src/hooks/useAuth";
import type { Operation } from "@/src/hooks/useAuth";

type RouteGuardProps = {
  children: React.ReactNode;
  operation: Operation;
  fallback?: React.ReactNode;
};

export function RouteGuard({ children, operation, fallback = null }: RouteGuardProps) {
  const { hasPermission } = useAuth();
  if (!hasPermission(operation)) return <>{fallback}</>;
  return <>{children}</>;
}
