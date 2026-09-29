/**
 * The app-wide React Query defaults. `staleTime: 30_000` means a page remounted
 * within 30 s reuses its cache instead of refetching; real-time queries opt back
 * to 0 at their own call site (listed in QueryProvider.tsx).
 */
import { render } from "@testing-library/react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import { QueryProvider } from "@/src/components/providers/QueryProvider";

function captureClient(): QueryClient {
  let client: QueryClient | null = null;
  function Probe() {
    client = useQueryClient();
    return null;
  }
  render(
    <QueryProvider>
      <Probe />
    </QueryProvider>
  );
  expect(client).not.toBeNull();
  return client!;
}

describe("QueryProvider defaults", () => {
  it("queries are fresh for 30 s", () => {
    expect(captureClient().getDefaultOptions().queries?.staleTime).toBe(30_000);
  });

  it("keeps the existing retry and focus defaults", () => {
    const q = captureClient().getDefaultOptions().queries;
    expect(q?.retry).toBe(1);
    expect(q?.refetchOnWindowFocus).toBe(false);
  });

  it("a query that sets staleTime: 0 still overrides the default", () => {
    const client = captureClient();
    const merged = client.defaultQueryOptions({ queryKey: ["x"], staleTime: 0 });
    expect(merged.staleTime).toBe(0);
    expect(client.defaultQueryOptions({ queryKey: ["y"] }).staleTime).toBe(30_000);
  });
});
