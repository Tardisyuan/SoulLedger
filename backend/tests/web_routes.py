"""Which web pages exist, and which the frontend has decided are public or shell-free.

One reader for the backend tests that check something per web page
(`test_page_gates_match_the_backend.py`, `test_officer_assist_corpus.py`). Until
2026-11-10 each carried its own walk of `frontend/app` and its own hand copy of the
exceptions, so adding `/goodbye` meant editing both (docs/test-suite-review-2026-11-10.md
§2.1). The decisions live in two frontend files and are read from there:

* `frontend/proxy.ts` `PUBLIC_PATHS` — route -> why it needs no sign-in;
* `frontend/src/components/layout/AppLayoutWrapper.tsx` `AUTH_PATHS` / `DESK_PATHS` (prefix) /
  `PUBLIC_PATHS` (exact) — routes rendered without the AppLayout shell.

The frontend twin is `frontend/src/__tests__/support/appRoutes.ts`.
"""
import re
from pathlib import Path

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
APP = FRONTEND / "app"
PROXY = FRONTEND / "proxy.ts"
APP_LAYOUT_WRAPPER = FRONTEND / "src" / "components" / "layout" / "AppLayoutWrapper.tsx"


def route_of(page: Path) -> str:
    """The URL of a `page.tsx`: route groups such as `(auth)` are not in it; `[id]` stays."""
    parts = [p for p in page.relative_to(APP).parent.parts if not p.startswith("(")]
    return "/" + "/".join(parts) if parts else "/"


def pages() -> dict[Path, str]:
    """Every `page.tsx` under `frontend/app` -> its URL."""
    return {page: route_of(page) for page in sorted(APP.rglob("page.tsx"))}


def routes() -> list[str]:
    return sorted(set(pages().values()))


def public_paths() -> dict[str, str]:
    """`proxy.ts` `PUBLIC_PATHS`: route -> the reason written beside it.

    Parsed, not imported: one `"<path>": "<reason>",` per line inside the object (the
    shape proxy.ts documents). A parse that finds nothing raises rather than returning
    an empty dict — an empty set of public routes would make every public page look
    ungated, which is red anyway, but the message would point at the wrong thing."""
    src = PROXY.read_text(encoding="utf-8")
    m = re.search(r"^export const PUBLIC_PATHS\b[^=]*=\s*\{\n(.*?)^\};", src, re.M | re.S)
    if m is None:
        raise AssertionError(f"PUBLIC_PATHS object not found in {PROXY}")
    found = dict(re.findall(r'^\s*"(/[^"]*)":\s*"((?:[^"\\]|\\.)*)",?\s*$', m.group(1), re.M))
    if not found:
        raise AssertionError(f"no entries parsed from PUBLIC_PATHS in {PROXY}")
    return found


def _string_array(name: str) -> list[str]:
    src = APP_LAYOUT_WRAPPER.read_text(encoding="utf-8")
    m = re.search(rf"const {name}\s*=\s*\[([^\]]*)\]", src)
    if m is None:
        raise AssertionError(f"{name} not found in {APP_LAYOUT_WRAPPER}")
    return re.findall(r'"([^"]+)"', m.group(1))


def is_outside_app_layout(route: str) -> bool:
    """Whether `AppLayoutWrapper` renders this route bare (same test it applies to the pathname)."""
    # DESK_PATHS (prefix, like AUTH_PATHS): signed in, but in `DeskShell` instead of AppLayout — so no 问一问 entry.
    prefixed = _string_array("AUTH_PATHS") + _string_array("DESK_PATHS")
    return any(route == p or route.startswith(p + "/") for p in prefixed) or route in _string_array("PUBLIC_PATHS")


def top_segments() -> dict[str, list[str]]:
    """Top-level route segment -> the routes under it. The root page and route groups
    (`(auth)`) are not segments: they have no segment of their own in the page header."""
    out: dict[str, list[str]] = {}
    for page, route in pages().items():
        first = page.relative_to(APP).parts[0]
        if first == "page.tsx" or first.startswith("("):
            continue
        out.setdefault(first, []).append(route)
    return out
