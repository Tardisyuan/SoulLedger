/**
 * The demo home's 「这是怎么做的」 (`#how-built`) is drawn once and keeps its node (2026-11-14:
 * `e2e/demo/portfolio.spec.ts` found the section, then scrolled a detached one).
 *
 * The page is a lazy chunk (`next/dynamic`) under `app/loading.tsx`'s Suspense boundary, below the root layout's
 * providers. Server-rendered, that boundary is still dehydrated while the chunk loads; a context change from above
 * (ThemeProvider reads the OS theme after mount) makes React stop hydrating it and draw it again from scratch, so every
 * node from the server's HTML is replaced. Whether the chunk or the effect came first decided the run, hence a flake.
 *
 * The harness renders the real HTML on a "server" (no `window`), hydrates it under the real ThemeProvider with the OS on
 * light, and records every `#how-built` taken out of the DOM. The control (the page as it was, server-rendered) shows
 * the harness sees the defect; the page itself must lose nothing.
 */
import { act, type ComponentType, type ReactElement } from "react";

// What Next's bundler resolves `next/dynamic` to under app/ (the package root's `next/dynamic` is the pages one).
jest.mock("next/dynamic", () => jest.requireActual("next/dist/shared/lib/app-dynamic"));
// The page's content is not the question; one section that does not suspend stands in for it.
jest.mock("@/demo/DemoHome", () => {
  const { createElement: h } = jest.requireActual("react");
  return { __esModule: true, default: () => h("main", null, h("section", { id: "how-built" }, "how it was built")) };
});

type Kind = "page" | "control";

function tree(kind: Kind): ReactElement {
  const { ThemeProvider } = require("@/src/contexts/ThemeContext");
  const dynamic = require("next/dynamic");
  const Page: ComponentType = kind === "page" ? require("@/app/page").default : dynamic(() => import("@/demo/DemoHome"));
  const { createElement: h, Suspense: S } = require("react");
  // The fallback stands in for app/loading.tsx: the boundary that is left dehydrated.
  return h(ThemeProvider, null, h(S, { fallback: h("p", null, "loading") }, h(Page)));
}

/** renderToString with `typeof window === "undefined"`, as on the server, in a registry of its own. */
async function serverHtml(kind: Kind): Promise<string> {
  let render: (_el: ReactElement) => string = () => "";
  let el: ReactElement | null = null;
  jest.isolateModules(() => {
    render = require("react-dom/server").renderToString;
    el = tree(kind);
  });
  const desc = Object.getOwnPropertyDescriptor(globalThis, "window")!;
  const asServer = () => {
    delete (globalThis as { window?: unknown }).window;
    try {
      expect(typeof window).toBe("undefined");
      return render(el!);
    } finally {
      Object.defineProperty(globalThis, "window", desc);
    }
  };
  const quiet = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    asServer(); // starts the lazy import, as the server's preload does
    await new Promise((r) => setTimeout(r, 0));
    return asServer();
  } finally {
    quiet.mockRestore();
  }
}

async function removedSections(kind: Kind): Promise<{ removed: number; present: boolean }> {
  const html = await serverHtml(kind);
  const container = document.createElement("div");
  document.body.appendChild(container);
  container.innerHTML = html;
  let removed = 0;
  const count = (records: MutationRecord[]) =>
    records.forEach((r) =>
      r.removedNodes.forEach((n) => {
        if (n instanceof Element && (n.id === "how-built" || n.querySelector("#how-built"))) removed += 1;
      }),
    );
  const observer = new MutationObserver(count);
  observer.observe(container, { childList: true, subtree: true });

  const { hydrateRoot } = require("react-dom/client");
  await act(async () => {
    hydrateRoot(container, tree(kind), { onRecoverableError: () => {} });
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  count(observer.takeRecords());
  observer.disconnect();
  return { removed, present: container.querySelector("#how-built") !== null };
}

describe("the demo home's 「这是怎么做的」 mounts once", () => {
  const mm = window.matchMedia;
  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    process.env.NEXT_PUBLIC_DEMO_MODE = "1";
    // The OS is on light; ThemeProvider starts on dark and switches after mount: the context change in question.
    window.matchMedia = ((query: string) => ({
      matches: query.includes("light"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
  });
  afterAll(() => {
    window.matchMedia = mm;
    delete process.env.NEXT_PUBLIC_DEMO_MODE;
    document.body.innerHTML = "";
  });

  it("control: server-rendered, the section is drawn and then replaced (the harness sees the defect)", async () => {
    const { removed, present } = await removedSections("control");
    expect(present).toBe(true);
    expect(removed).toBeGreaterThan(0);
  });

  it("app/page.tsx: the section is there after hydration and was never taken out", async () => {
    const { removed, present } = await removedSections("page");
    expect(present).toBe(true);
    expect(removed).toBe(0);
  });
});
