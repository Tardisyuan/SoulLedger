"use client";

import dynamic from "next/dynamic";
import { Landing } from "@/src/components/landing/Landing";

// `ssr: false`: drawn once, in the browser. Server-rendered, the page sat in `app/loading.tsx`'s Suspense boundary
// still dehydrated while its lazy chunk loaded, and the first context change from the root layout's providers
// (ThemeProvider reading the OS theme after mount) made React give up hydrating it: the server's DOM was thrown away
// and the page drawn again, so anything holding a node from the first paint (`#how-built`) held a detached one.
// demoHomeMountsOnce.test.tsx reproduces it.
const DemoHome = process.env.NEXT_PUBLIC_DEMO_MODE === "1" ? dynamic(() => import("@/demo/DemoHome"), { ssr: false }) : null;

export default function HomePage() {
  return DemoHome ? <DemoHome /> : <Landing />;
}
