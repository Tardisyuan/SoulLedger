import { useEffect, useState } from "react";

/** Re-renders every minute, so "N hours left" and the warning state do not go stale on an open screen. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}
