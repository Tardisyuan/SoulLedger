"use client";

import dynamic from "next/dynamic";
import { Landing } from "@/src/components/landing/Landing";

const DemoHome = process.env.NEXT_PUBLIC_DEMO_MODE === "1" ? dynamic(() => import("@/demo/DemoHome")) : null;

export default function HomePage() {
  return DemoHome ? <DemoHome /> : <Landing />;
}
