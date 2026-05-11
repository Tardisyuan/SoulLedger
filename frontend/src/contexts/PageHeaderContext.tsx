"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

interface PageHeaderContextValue {
  title: ReactNode;
  setPageHeader: (title: ReactNode) => void;
  clearPageHeader: () => void;
}

const PageHeaderContext = createContext<PageHeaderContextValue>({
  title: null,
  setPageHeader: () => {},
  clearPageHeader: () => {},
});

export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<ReactNode>(null);

  const setPageHeader = (header: ReactNode) => {
    setTitle(header);
  };

  const clearPageHeader = () => {
    setTitle(null);
  };

  return (
    <PageHeaderContext.Provider value={{ title, setPageHeader, clearPageHeader }}>
      {children}
    </PageHeaderContext.Provider>
  );
}

export const usePageHeader = () => useContext(PageHeaderContext);
