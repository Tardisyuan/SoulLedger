"""An e2e fixture must not carry a field its serializer does not send.

A fixture wider than the contract does not merely fail to catch a bug -- it
manufactures the behaviour the test then certifies. Three did, and each one
propped up an assertion that production cannot satisfy:

  * `WORKFLOW_INSTANCE.soul` held a Chinese personal name. On
    `ApprovalWorkflowListSerializer`, `soul` is the primary key -- a UUID.
    `workflow.spec.ts` asserted the row displays `WORKFLOW_INSTANCE.soul` and
    passed; the real page showed the UUID.
  * `PROPOSED_DISPATCH` carried `reason`, `dispatched_by`, `decided_at`,
    `create_time`, `update_time` -- none of which the *list* serializer emits.
    `critical-paths.spec.ts` asserted the pending card shows the proposal's
    reason and passed; the real card has no reason on it.
  * `OPENED_JUDGMENT` had `create_time` where `JudgmentSerializer` sends
    `created_at`, so `formatDate(judgment.created_at)` got undefined and threw
    `RangeError: Invalid time value`. **Every existing e2e that opened
    `/judgment/{id}` was looking at the error boundary, not at a judgment.**

Same shape as the mocked-away subject this repository already has on record:
the test exercises something the fixture invented.

Only *extra* keys are an error. A fixture may omit fields the page does not
read -- that is what makes it a fixture rather than a copy of the API.

WHAT IS CHECKED, SINCE 2026-09-14 (audit FT-09). Until then this file held a
hand-written list of three `(fixture, serializer)` pairs. The shape it guards
was sitting one screen below them: `EXECUTED_DISPATCH` spreads
`PROPOSED_DISPATCH` and adds `reason` and `decided_at` back -- the very fields
the first bullet removed -- and it is served from the same *list* endpoint.
`SOUL_DETAIL`, `SOULS`, `LEDGER_STATS`, `ROLES`, `MENUS`, `RECYCLE_BIN_ENTRY`
and the inline users / tenants / realms / actors bodies were never looked at.

So the subject list is no longer written by hand. Every
`this.on(METHOD, PATH, BODY)` in `ApiMock.registerDefaults()` is read, BODY is
resolved through the exported constants it names (spreads, `paginated(...)`,
`NAME.map(...)`, `body:` inside handler functions), and each object it serves
is compared against the response component the committed OpenAPI document
gives for that method and path. That document is pinned to the live
serializers by `test_committed_schema_matches_the_backend.py`, so "the schema
says" is "the serializer sends".

Comparison is one level deep, as before: the top-level keys of each served
object (for a list or a page, of each item) against the component's
properties. A list served where the contract is an object, or the reverse, is
also an error -- a page that reads `data.results` from an object endpoint is
the same invented behaviour one level up.
"""
import re
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[2]
FIXTURES = REPO / "frontend" / "e2e" / "fixtures.ts"
SCHEMA = REPO / "packages" / "core" / "openapi" / "schema.yml"


# ── a very small reader for the object literals in fixtures.ts ─────────────


def _strip_comments(src):
    out, i, n = [], 0, len(src)
    while i < n:
        c = src[i]
        if c in "\"'`":
            j = i + 1
            while j < n and src[j] != c:
                j += 2 if src[j] == "\\" else 1
            out.append(src[i : j + 1])
            i = j + 1
        elif src.startswith("//", i):
            i = src.find("\n", i) if src.find("\n", i) != -1 else n
        elif src.startswith("/*", i):
            i = src.find("*/", i) + 2
        else:
            out.append(c)
            i += 1
    return "".join(out)


_CLOSE = {"{": "}", "[": "]", "(": ")"}


def _balanced_end(src, i):
    """Index just past the bracket that closes src[i]."""
    stack, j = [], i
    while j < len(src):
        c = src[j]
        if c in "\"'`":
            k = j + 1
            while k < len(src) and src[k] != c:
                k += 2 if src[k] == "\\" else 1
            j = k + 1
            continue
        if c in _CLOSE:
            stack.append(_CLOSE[c])
        elif stack and c == stack[-1]:
            stack.pop()
            if not stack:
                return j + 1
        j += 1
    raise ValueError(f"unbalanced bracket at {i}")


def _split_top(inner):
    """Split on commas that are not inside brackets or strings."""
    parts, depth, start, j = [], 0, 0, 0
    while j < len(inner):
        c = inner[j]
        if c in "\"'`":
            k = j + 1
            while k < len(inner) and inner[k] != c:
                k += 2 if inner[k] == "\\" else 1
            j = k + 1
            continue
        if c in "{[(":
            depth += 1
        elif c in "}])":
            depth -= 1
        elif c == "," and depth == 0:
            parts.append(inner[start:j])
            start = j + 1
        j += 1
    parts.append(inner[start:])
    return [p.strip() for p in parts if p.strip()]


def _read_expr(src, i):
    """One expression starting at src[i], up to a top-level `,` / `)` / `}` / `;`."""
    j = i
    while j < len(src):
        c = src[j]
        if c in "{[(":
            j = _balanced_end(src, j)
            continue
        if c in "\"'`":
            k = j + 1
            while k < len(src) and src[k] != c:
                k += 2 if src[k] == "\\" else 1
            j = k + 1
            continue
        if c in ",)};":
            break
        j += 1
    return src[i:j].strip()


SOURCE = _strip_comments(FIXTURES.read_text(encoding="utf-8"))
CONSTS = {}
for _m in re.finditer(r"export const (\w+)(?:\s*:[^=]+)?\s*=\s*", SOURCE):
    CONSTS[_m.group(1)] = _read_expr(SOURCE, _m.end())


def _shapes(expr):
    """What an expression serves: a list of ("object", {key: value_src}) and
    ("list", [shapes]) entries. Anything unresolvable contributes nothing."""
    expr = expr.strip()
    if expr.endswith("as const"):
        expr = expr[: -len("as const")].strip()
    if expr.startswith("{"):
        keys = {}
        for part in _split_top(expr[1:-1]):
            if part.startswith("..."):
                for kind, value in _shapes(part[3:]):
                    if kind == "object":
                        keys.update(value)
                continue
            m = re.match(r'^(?:(\w+)|"([^"]+)")\s*:\s*(.*)$', part, re.S)
            if m:
                keys[m.group(1) or m.group(2)] = m.group(3)
            elif re.fullmatch(r"\w+", part):
                keys[part] = part
        return [("object", keys)]
    if expr.startswith("["):
        return [("list", [s for part in _split_top(expr[1:-1]) for s in _shapes(part)])]
    m = re.match(r"^paginated\((.*)\)$", expr, re.S)
    if m:
        items = [s for kind, v in _shapes(m.group(1)) if kind == "list" for s in v]
        return [("page", items)]
    m = re.match(r"^\(?[\w\s,]*\)?\s*=>\s*(.*)$", expr, re.S)
    if m:  # handler function: every 2xx `{ status?, body }` it can answer with
        fn = m.group(1)
        found = []
        for i, c in enumerate(fn):
            if c != "{":
                continue
            [(_, reply)] = _shapes(fn[i : _balanced_end(fn, i)])
            if "body" not in reply:
                continue
            status = reply.get("status", "200").strip()
            if status.isdigit() and not status.startswith("2"):
                continue  # an error body answers to a different contract
            found.extend(_shapes(reply["body"]))
        return found
    m = re.match(r"^(\w+)(\[\d+\])?(?:\.map\(.*\))?$", expr, re.S)
    if m and m.group(1) in CONSTS:
        resolved = _shapes(CONSTS[m.group(1)])
        if m.group(2):
            return [s for kind, v in resolved if kind == "list" for s in v[:1]]
        return resolved
    return []


def _handlers():
    """(method, path, body_src) for every default handler."""
    start = SOURCE.index("registerDefaults()")
    body = SOURCE[start : _balanced_end(SOURCE, SOURCE.index("{", start))]
    out = []
    for m in re.finditer(r'this\.on\(\s*"(\w+)"\s*,\s*"([^"]+)"\s*,\s*', body):
        out.append((m.group(1), m.group(2), _read_expr(body, m.end())))
    return out


# ── the contract side ──────────────────────────────────────────────────────

DOC = yaml.safe_load(SCHEMA.read_text(encoding="utf-8"))


def _deref(schema):
    while "$ref" in schema:
        schema = DOC["components"]["schemas"][schema["$ref"].rsplit("/", 1)[1]]
    return schema


def _contract(method, path):
    """(kind, item_schema, label) for the 2xx JSON response, or None."""
    # Segment-exact: `:id` pairs with `{id}` and a literal only with itself, so
    # `/dispatch/records/:id/` cannot pick up `/dispatch/records/proposed/`.
    wanted = "/api/v1" + re.sub(r":\w+", "{}", path)
    for doc_path, ops in DOC["paths"].items():
        if re.sub(r"\{[^}]+\}", "{}", doc_path) != wanted:
            continue
        op = ops.get(method.lower())
        if not op:
            continue
        for code, resp in sorted(op["responses"].items()):
            schema = resp.get("content", {}).get("application/json", {}).get("schema")
            if not str(code).startswith("2") or not schema:
                continue
            label = schema.get("$ref", "").rsplit("/", 1)[-1] or "inline"
            schema = _deref(schema)
            if schema.get("type") == "array":
                return "list", _deref(schema["items"]), label
            props = schema.get("properties", {})
            if set(props) >= {"count", "results"} and props["results"].get("type") == "array":
                return "list", _deref(props["results"]["items"]), label
            return "object", schema, label
    return None


#: Handlers whose contract is not what the committed schema says, named with
#: the measured reason. A new entry needs one; the test below keeps the list
#: from outliving its reason.
SCHEMA_IS_WRONG_HERE = {
    ("GET", "/recycle-bin/"): (
        "RecycleBinViewSet.list returns {'results': [...], 'count': n} "
        "(apps/core/recycle_bin_views.py), but extend_schema(responses=RecycleBinListSerializer) "
        "on a ViewSet.list is rendered as an array OF that envelope. The entries are still "
        "compared, against RecycleBinList.results.items."
    ),
}

#: Handlers the committed schema has no 200 body for, so there is nothing to
#: compare against. Named, not skipped silently.
NO_RESPONSE_CONTRACT = {
    ("POST", "/auth/login/"): (
        "CustomTokenObtainPair in the schema is the request (username/password); "
        "LoginView's {access, refresh, user} response is not described"
    ),
}


def _problems():
    problems, compared = [], []
    for method, path, body in _handlers():
        contract = _contract(method, path)
        if contract is None or (method, path) in NO_RESPONSE_CONTRACT:
            continue
        kind, item_schema, label = contract
        misrendered = (method, path) in SCHEMA_IS_WRONG_HERE
        if misrendered:
            item_schema = _deref(item_schema["properties"]["results"]["items"])
        props = set(item_schema.get("properties", {}))
        for shape_kind, value in _shapes(body):
            if shape_kind == "object" and misrendered and "results" in value:
                shape_kind, value = "list", [
                    s for k, v in _shapes(value["results"]) if k == "list" for s in v
                ]
            served_list = shape_kind in ("list", "page")
            if served_list != (kind == "list"):
                problems.append(
                    f"{method} {path}: serves a {'list' if served_list else 'single object'}, "
                    f"but {label} is {'a list' if kind == 'list' else 'one object'}"
                )
                continue
            objects = value if served_list else [("object", value)]
            for obj_kind, keys in objects:
                if obj_kind != "object" or not props:
                    continue
                compared.append((method, path))
                extra = set(keys) - props
                if extra:
                    problems.append(
                        f"{method} {path}: carries {sorted(extra)}, which {label} does not send"
                    )
    return problems, compared


def test_the_fixture_file_and_schema_are_where_we_think_they_are():
    """Without this, a moved file makes every assertion below vacuous."""
    assert FIXTURES.is_file(), FIXTURES
    assert SCHEMA.is_file(), SCHEMA
    assert len(CONSTS) >= 15, f"only {len(CONSTS)} exported constants parsed"


def test_the_reader_resolves_the_fixtures_it_used_to_be_handed():
    """The three the old hand list named, and the two it missed, must each
    resolve to a real set of keys -- `set() - anything` is empty, and empty
    passes the real check silently."""
    for name in ("WORKFLOW_INSTANCE", "PROPOSED_DISPATCH", "OPENED_JUDGMENT", "EXECUTED_DISPATCH", "SOUL_DETAIL"):
        [(kind, keys)] = _shapes(CONSTS[name])
        assert kind == "object" and len(keys) >= 4, (name, kind, keys)
    # The spread must carry the parent's keys and the override's.
    [(_, executed)] = _shapes(CONSTS["EXECUTED_DISPATCH"])
    assert {"source_tenant", "soul_name", "executed_at"} <= set(executed)


def test_the_walk_compares_a_real_number_of_handlers():
    problems, compared = _problems()
    distinct = set(compared)
    assert len(distinct) >= 15, (
        f"only {len(distinct)} handlers compared against a contract -- the walk "
        f"or the path matching has stopped working: {sorted(distinct)}"
    )
    for must in (("GET", "/dispatch/records/"), ("GET", "/souls/:id/"), ("GET", "/workflows/"), ("GET", "/users/")):
        assert must in distinct, f"{must} is not compared"


def test_the_contract_exceptions_are_still_exceptions():
    for method, path in SCHEMA_IS_WRONG_HERE:
        contract = _contract(method, path)
        assert contract is not None and contract[0] == "list" and "results" in contract[1].get("properties", {}), (
            f"{method} {path} no longer renders as a list of envelopes; drop its exception"
        )
    for method, path in NO_RESPONSE_CONTRACT:
        contract = _contract(method, path)
        assert contract is not None and not {"access", "user"} & set(contract[1].get("properties", {})), (
            f"{method} {path} now has a described response; drop its exception so it is compared"
        )


def test_a_fixture_carries_no_field_its_serializer_does_not_send():
    problems, _ = _problems()
    assert problems == [], (
        f"{len(problems)} mock response(s) are wider than, or shaped unlike, "
        f"their contract. A test asserting on those fields passes against a "
        f"response that will never contain them:\n  " + "\n  ".join(problems)
    )
