"use client";

import { useEffect, useState } from 'react';
import { useIsFetching } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import NProgress from 'nprogress';
import 'nprogress/nprogress.css';

NProgress.configure({
  showSpinner: false,
  speed: 300,
  trickle: false,
  minimum: 0.02,
});

export function ProgressBar() {
  const [isClient, setIsClient] = useState(false);
  const [prevPathname, setPrevPathname] = useState<string>('');
  const pathname = usePathname();
  const isFetching = useIsFetching();

  useEffect(() => {
    setIsClient(true);
  }, []);

  // Start NProgress immediately on pathname change (navigation detected)
  useEffect(() => {
    if (!isClient) return;
    if (pathname !== prevPathname) {
      setPrevPathname(pathname);
      NProgress.start();
    }
  }, [pathname, prevPathname, isClient]);

  // End NProgress when all queries complete
  useEffect(() => {
    if (!isClient) return;
    if (isFetching === 0) {
      NProgress.done();
    }
  }, [isFetching, isClient]);

  if (!isClient) return null;

  return null; // NProgress modifies the DOM directly
}

// Hook to control loading state globally
export function useGlobalLoading() {
  const start = () => {
    document.body.setAttribute('data-global-loading', 'true');
    NProgress.start();
  };

  const done = () => {
    document.body.setAttribute('data-global-loading', 'false');
    NProgress.done();
  };

  return { start, done };
}
