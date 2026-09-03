"""A declared response body must match what the view actually returns.

WHY THIS FILE EXISTS. `test_schema_has_no_warnings.py` ends by naming its own
limit: "It says every endpoint has a declared body — not that the declaration
is right." This file is that second assertion.

`drf-spectacular` never leaves an `@action` undocumented. When there is no
`@extend_schema`, it falls back to the **viewset's** serializer and describes
the response as a single instance of it. That fallback is silent, it is often
wrong, and it is invisible to every check that existed before this one:

  * the generator emits no warning — it did resolve a serializer;
  * it emits no error — the view was introspectable;
  * `test_committed_schema_matches_the_backend.py` still passes — the
    committed file does match what the generator produced.

So `/api/v1/souls/{id}/karma/` was documented as returning a `Soul` while
returning a ledger summary, `/api/v1/users/export_csv/` was documented as
returning JSON while returning `text/csv`, and `/api/v1/judgment/next/` — the
queue cursor, the single endpoint a judgment client hits most — was documented
as a `Judgment` while returning a nine-key envelope. Twenty-seven operations
were in that state when this file was written.

WHY IT MATTERS NOW AND DID NOT BEFORE. The web client's types are hand-written
and were checked by a person, so a wrong document cost nothing: nobody read it.
`packages/core` now generates types from this schema for the Expo and Tauri
clients, and nobody will re-check those. A wrong declaration becomes a
compile-time green light on a call that fails at runtime — the exact inversion
of the 2026-09-01 decision (`f9aa138`) to keep hand-written types, which was
correct *because* the generated ones were not yet trusted. They are about to
be. This check is what makes trusting them defensible.

HOW THE SUBJECT LIST IS BUILT, AND WHY THAT WAY. The population is taken from
Django's URL resolver and then from the class object the resolver hands back —
not by globbing `apps/*/views*.py`. A file scan is the shape of defect this
repository keeps re-committing: a rule that runs, can go red, and is looking at
an incomplete list (see `4051e51`, where a hand-written `ENUM_FIELDS` missed
one field and the bug shipped green). Here, if a view is routed it is in the
population, because the route is where the population comes from.

WHY AN UNREADABLE RETURN IS A FAILURE, NOT A PASS. The analyser understands
five shapes of `return Response(...)`. Anything else — including a return this
file's author did not anticipate — is reported rather than skipped. A checker
that silently passes what it cannot parse is worse than no checker: it converts
an unknown into a green tick.

Some returns are unreadable in principle, not by omission: `return
Response(LedgerService.get_ledger_summary(soul))` hands back a dict assembled
in another module, and no amount of local analysis will recover its keys. For
those the rule is weaker but still not nothing: **an explicit `@extend_schema`
is required.** A wrong explicit declaration is a person's mistake; the silent
viewset-serializer fallback is nobody's, which is why twenty-seven of them
accumulated unnoticed. Where the shape matters enough to want the strong check
back, have the view return a serializer instead of a bare dict and the analyser
will read it.
"""

import ast
import inspect
import re
import textwrap

import pytest
from django.urls import get_resolver
from drf_spectacular.generators import SchemaGenerator

# Statuses whose body is the success shape a client will be typed against.
# 204 is deliberately absent: it has no body, and an operation that only ever
# returns 204 declares no 200, so it never reaches the comparison.
SUCCESS_STATUSES = {
    None,
    "200",
    "201",
    "status.HTTP_200_OK",
    "status.HTTP_201_CREATED",
}


def _normalise(pattern: str) -> str:
    """Turn a resolver pattern into the path string drf-spectacular publishes."""
    path = re.sub(r"\(\?P<([^>]+)>[^)]+\)", r"{\1}", pattern)
    path = path.replace("^", "").replace("$", "")
    # drf-spectacular renames the router's `pk` capture to `id`.
    return "/" + path.replace("{pk}", "{id}").lstrip("/")


def _routed_actions():
    """Every routed DRF `@action`, as (path, http_method, viewset, action name).

    Read off the resolver, so a newly routed action joins the population with
    no edit to this file.
    """

    def walk(patterns, prefix=""):
        for entry in patterns:
            if hasattr(entry, "url_patterns"):
                yield from walk(entry.url_patterns, prefix + str(entry.pattern))
            else:
                yield prefix + str(entry.pattern), entry.callback

    found = []
    for raw, callback in walk(get_resolver().url_patterns):
        if "format" in raw:  # the `.json` / `.api` suffix routes duplicate every path
            continue
        viewset = getattr(callback, "cls", None)
        actions = getattr(callback, "actions", None) or {}
        if viewset is None or not actions:
            continue
        for http_method, name in actions.items():
            # DRF's `ViewSetMixin.as_view` mirrors `get` into `head` by
            # mutating the route's action map in place, and drf-spectacular
            # documents no HEAD operations at all. Including it would report
            # every GET action twice as "absent from the schema". Note the
            # mirroring is lazy enough that it shows up when the whole suite
            # runs and not when this file runs alone — which is why this is an
            # explicit exclusion rather than something that happened to work.
            if http_method in {"head", "options"}:
                continue
            handler = getattr(viewset, name, None)
            # `mapping` is set by @action; standard list/retrieve/create are
            # excluded because their default declaration is correct by
            # construction — the fallback serializer *is* the response.
            if handler is not None and hasattr(handler, "mapping"):
                found.append((_normalise(raw), http_method, viewset, name))
    return found


def _decorator_names(func):
    """Names of the decorators on `func`, read from its own source.

    `@extend_schema` leaves no attribute on a viewset method that survives
    `@action`'s wrapping, so asking the object is unreliable; the source is
    what it is.
    """
    tree = ast.parse(textwrap.dedent(inspect.getsource(func)))
    names = []
    for node in tree.body:
        if not isinstance(node, ast.FunctionDef):
            continue
        for decorator in node.decorator_list:
            target = decorator.func if isinstance(decorator, ast.Call) else decorator
            if isinstance(target, ast.Attribute):
                names.append(target.attr)
            elif isinstance(target, ast.Name):
                names.append(target.id)
    return names


def _has_explicit_schema(func):
    return any(name.startswith("extend_schema") for name in _decorator_names(func))


def _paginates(func):
    """Whether the action hands its page to `self.get_paginated_response`.

    The conventional DRF spelling keeps a bare-array fallback for the case
    where `paginate_queryset` returns None, which only happens when pagination
    is switched off. drf-spectacular documents such an action as the paginated
    envelope, so the fallback's `Serializer(many=True)` is not a contradiction
    of that declaration — it is the branch the declaration deliberately does
    not describe. Without this, every correctly paginated action reads as a
    mismatch, and a check that cries wolf on the right pattern gets silenced.
    """
    return "get_paginated_response" in inspect.getsource(func)


def _returned_shapes(func):
    """Classify every `return` in `func`, resolving local assignments.

    Assignment resolution is not a nicety. The common spelling is

        serializer = ThingSerializer(qs, many=True)
        return Response(serializer.data)

    and an analyser that only reads the `return` line sees an opaque attribute
    access and concludes nothing is wrong. That blind spot alone hid 16 of the
    27 mismatches this file was written to catch.
    """
    tree = ast.parse(textwrap.dedent(inspect.getsource(func)))
    assigned = {
        node.targets[0].id: node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Assign)
        and len(node.targets) == 1
        and isinstance(node.targets[0], ast.Name)
    }

    def resolve(node, depth=0):
        while isinstance(node, ast.Name) and node.id in assigned and depth < 4:
            node, depth = assigned[node.id], depth + 1
        return node

    shapes = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Return) or node.value is None:
            continue
        call = resolve(node.value)
        if not isinstance(call, ast.Call):
            continue
        func_node = call.func
        name = (
            func_node.attr
            if isinstance(func_node, ast.Attribute)
            else getattr(func_node, "id", "")
        )
        if name not in {
            "Response",
            "HttpResponse",
            "FileResponse",
            "StreamingHttpResponse",
        }:
            continue

        status = None
        for keyword in call.keywords:
            if keyword.arg == "status":
                status = ast.unparse(keyword.value)

        if name != "Response":
            shapes.append(("non-json", name, None))
            continue

        body = resolve(call.args[0]) if call.args else None
        if body is None:
            shapes.append(("empty", None, status))
        elif isinstance(body, ast.Dict):
            keys = frozenset(
                k.value for k in body.keys if isinstance(k, ast.Constant)
            )
            shapes.append(("dict", keys, status))
        elif isinstance(body, ast.Attribute) and body.attr == "data":
            inner = resolve(body.value)
            if isinstance(inner, ast.Call):
                inner_func = inner.func
                serializer = (
                    inner_func.attr
                    if isinstance(inner_func, ast.Attribute)
                    else getattr(inner_func, "id", "?")
                )
                many = any(
                    kw.arg == "many" and getattr(kw.value, "value", False)
                    for kw in inner.keywords
                )
                shapes.append(("serializer", (serializer, many), status))
            else:
                shapes.append(("unreadable", ast.unparse(body)[:70], status))
        else:
            shapes.append(("opaque", ast.unparse(body)[:70], status))
    return shapes


@pytest.fixture(scope="module")
def schema():
    return SchemaGenerator().get_schema(request=None, public=True)


@pytest.fixture(scope="module")
def actions():
    return _routed_actions()


def test_there_are_actions_to_check(actions):
    """Without this, deleting every route would make the file below vacuous.

    57 routed actions at the time of writing; the floor sits well under it so
    ordinary additions and removals do not touch it.
    """
    assert len(actions) > 40, (
        f"only {len(actions)} routed @action(s) found — the resolver walk is "
        f"not seeing the URL conf, so the comparison below checks nothing."
    )


def test_every_routed_action_appears_in_the_schema(schema, actions):
    """The path normalisation must land on real schema paths.

    If `_normalise` drifts from what drf-spectacular publishes, every lookup
    misses, and a comparison that finds nothing to compare passes. That failure
    is silent, so it gets its own assertion.
    """
    missing = sorted(
        {
            f"{method.upper()} {path}"
            for path, method, _, _ in actions
            if method not in schema["paths"].get(path, {})
        }
    )
    assert missing == [], (
        f"{len(missing)} routed action(s) could not be found in the generated "
        f"schema by path. Either the route is genuinely absent from the "
        f"document, or `_normalise` no longer matches how drf-spectacular "
        f"renders paths — in which case the shape check below is silently "
        f"skipping them.\n" + "\n".join(f"  - {m}" for m in missing)
    )


def test_declared_response_shapes_match_the_views(schema, actions):
    """Not one mismatch.

    Deliberately not a list of known-bad names. An allowlist of endpoints whose
    document lies about them is an invitation to append a line instead of a
    decorator, and it has to be kept in sync with a set that is supposed to be
    empty. `e64cb1a` removed exactly such a list from the sibling check for the
    same reason.
    """
    components = schema["components"]["schemas"]
    problems = []

    for path, method, viewset, name in actions:
        operation = schema["paths"][path][method]
        response = (operation.get("responses") or {}).get("200") or (
            operation.get("responses") or {}
        ).get("201")
        if not response:
            continue
        declared = (
            (response.get("content") or {}).get("application/json") or {}
        ).get("schema")
        if not declared:
            continue

        if "$ref" in declared:
            component, declared_many = declared["$ref"].split("/")[-1], False
        elif declared.get("type") == "array":
            component = (declared.get("items") or {}).get("$ref", "").split("/")[-1]
            declared_many = True
        else:
            continue  # an inline shape was written on purpose; trust it

        spec = components.get(component, {})
        properties = set(spec.get("properties", {}))
        required = set(spec.get("required", []))
        handler = getattr(viewset, name)
        # A paginated action's declared envelope covers its `many=True` return.
        # drf-spectacular names the envelope `Paginated<Inner>List`; compare
        # against `<Inner>`, or every correctly paginated action reads as a
        # serializer mismatch against a component name it can never equal.
        if component.startswith("Paginated") and _paginates(handler):
            declared_many = True
            component = re.sub(r"^Paginated(.*?)List$", r"\1", component)

        for kind, detail, status in _returned_shapes(getattr(viewset, name)):
            if status not in SUCCESS_STATUSES:
                continue
            where = f"{method.upper()} {path} ({viewset.__name__}.{name})"

            if kind == "non-json":
                problems.append(
                    f"{where}: declared `{component}` as application/json, "
                    f"returns {detail}"
                )
            elif kind == "empty":
                problems.append(
                    f"{where}: declared `{component}`, returns an empty body"
                )
            elif kind in {"opaque", "unreadable"}:
                # Unreadable in principle (a dict assembled in another module),
                # so the strong check is unavailable. Require the weaker one:
                # a person must have declared the shape on purpose.
                if not _has_explicit_schema(getattr(viewset, name)):
                    problems.append(
                        f"{where}: returns `{detail}`, which this check cannot "
                        f"read — and the response is documented as "
                        f"`{component}` only because drf-spectacular fell back "
                        f"to the viewset serializer. Declare it explicitly, or "
                        f"return a serializer so the shape can be verified"
                    )
            elif kind == "dict":
                if not (detail <= properties and required <= detail):
                    absent = sorted(required - detail)
                    problems.append(
                        f"{where}: declared `{component}`, returns a dict with "
                        f"keys {sorted(detail)}"
                        + (
                            f" — missing required {absent}"
                            if absent
                            else f" — not fields of {component}"
                        )
                    )
            elif kind == "serializer":
                serializer, many = detail
                stem = (
                    serializer.replace("Serializer", "")
                    .replace("List", "")
                    .replace("Detail", "")
                    .lower()
                )
                if many and not declared_many:
                    problems.append(
                        f"{where}: declared a single `{component}`, returns "
                        f"`{serializer}(many=True)` — an array"
                    )
                elif not (
                    stem.startswith(component.lower()[:7])
                    or component.lower().startswith(stem[:7])
                ):
                    problems.append(
                        f"{where}: declared `{component}`, returns "
                        f"`{serializer}`"
                    )

    assert problems == [], (
        f"{len(problems)} operation(s) declare a response body that is not "
        f"what the view returns. A client generated from this document will "
        f"compile against the declaration and fail against the response.\n\n"
        + "\n".join(f"  - {p}" for p in sorted(problems))
        + "\n\nFix with `@extend_schema(responses=...)` on the action: "
        "`Thing(many=True)` for a list, a doc-only serializer in "
        "`apps/core/schema.py` for a hand-built dict, or "
        "`OpenApiResponse(response=bytes)` for a non-JSON body. "
        "Read the shape off the view's `return`, not off a client that "
        "consumes it."
    )
