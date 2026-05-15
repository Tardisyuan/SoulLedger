"use client";

import { useEffect, useState } from 'react';
import { useIsFetching } from '@tanstack/react-query';
import NProgress from 'nprogress';
import 'nprogress/nprogress.css';

NProgress.configure({
  showSpinner: false,
  speed: 300,
  trickle: true,
  trickleSpeed: 200,
  minimum: 0.1,
});

export function ProgressBar() {
  const [isClient, setIsClient] = useState(false);
  const isFetching = useIsFetching();

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!isClient) return;
    return () => { NProgress.done(); };
  }, [isClient]);

  useEffect(() => {
    if (!isClient) return;
    if (isFetching > 0) {
      NProgress.start();
    } else {
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
