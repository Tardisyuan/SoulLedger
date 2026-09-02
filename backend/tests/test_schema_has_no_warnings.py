"""The OpenAPI schema must be generated without warnings.

WHY THIS FILE EXISTS. `drf-spectacular` does not fail on a field it cannot
understand — it warns and substitutes `string`. So the failure mode is a schema
that generates fine, serves fine, renders fine in Swagger, and is **wrong**:

    unable to resolve type hint for function "get_karmic_balance".
    Consider using a type hint or @extend_schema_field. Defaulting to string.

Before this file there were 40 such warnings. Nineteen `SerializerMethodField`s
across seven modules were documented as `string` when they return integers,
booleans, nullable integers, objects, and — in the menu tree's case — a
recursive array of menus. Six more were the `HistoricalDateField`, whose entire
reason for existing is that a historical date is NOT a string.

That was tolerable only while the frontend types were hand-written. The moment
anything generates a client from this document, every one of those becomes a
wrong type in the client, and the hand-written type it replaces was more
accurate than the generated one. This check is the thing that has to hold for
generation to be safe at all.

WHY IT ALSO CHECKS THE ERRORS. Warnings and errors are different channels in
drf-spectacular, and `grep -i warning` on the command output does not see the
errors at all. A view the generator cannot introspect is reported as
`Error [...]: unable to guess serializer ... Ignoring view for now.` "Ignoring
view for now" means **the endpoint is in the document with no request or
response body**. A generated client gets nothing for it.

There were 27 such views, and this file used to carry their names so that a
28th could not be added unnoticed. All 27 were given explicit request/response
serializers, so the list is gone and the assertion is now the stronger one:
**not one**. A name list would have to stay in sync with a set that is
supposed to be empty, and an empty list compared by equality is the same
assertion written in a way that invites the next person to add a line to it
instead of a serializer.

Note what "zero" does and does not buy. It says every endpoint has a declared
body — not that the declaration is right. The shapes are doc-only serializers
describing dicts built by hand elsewhere, and nothing here re-derives them from
the views; see apps/core/schema.py's module docstring.
"""
import pytest
from drf_spectacular.drainage import GENERATOR_STATS, reset_generator_stats
from drf_spectacular.generators import SchemaGenerator


@pytest.fixture(scope="module")
def generated():
    """Generate once; three assertions read the same run."""
    reset_generator_stats()
    schema = SchemaGenerator().get_schema(request=None, public=True)
    return (
        schema,
        list(GENERATOR_STATS._warn_cache),
        list(GENERATOR_STATS._error_cache),
    )


def test_the_generator_actually_ran(generated):
    """Without this, an empty schema would satisfy every check below.

    Zero warnings is the passing state, and a run that produced nothing at all
    produces zero warnings too. 146 paths at the time of writing; the floor is
    set well under it so ordinary additions and removals do not touch it.
    """
    schema, _, _ = generated
    assert len(schema["paths"]) > 100, (
        f"only {len(schema['paths'])} paths in the generated schema — the "
        f"generator did not see the URL conf, so every other assertion in this "
        f"file is vacuous."
    )


def test_schema_generates_without_warnings(generated):
    """Zero. Not "few" — every warning is a field silently typed `string`."""
    _, warnings, _ = generated
    assert warnings == [], (
        "drf-spectacular could not resolve "
        f"{len(warnings)} thing(s), and defaulted each to `string` in the "
        "OpenAPI document. A client generated from it will have those fields "
        "typed as strings whatever they really are.\n\n"
        + "\n".join(f"  - {w}" for w in warnings)
        + "\n\nFix with a return type hint on the method, "
        "`@extend_schema_field(...)` for structured returns, an "
        "`OpenApiSerializerFieldExtension` for a custom field, or "
        "`@extend_schema(parameters=[...])` for a path parameter."
    )


def test_no_view_is_published_without_a_body(generated):
    """Not one. Every view must be introspectable.

    The remedy for a name appearing here is one of:
      * a function view -> `@extend_schema(request=..., responses=...)`;
      * an `APIView` -> `serializer_class`, or `@extend_schema` when the
        request and response differ, when there is no request body, or when
        the response is not JSON.
    Read the shape off the view, not off a client that consumes it.
    """
    import re

    _, _, errors = generated
    seen = sorted({m.group(1) for e in errors if (m := re.search(r"Error \[([^\]]+)\]", e))})
    assert seen == [], (
        f"{len(seen)} view(s) drf-spectacular cannot introspect: {seen}\n"
        "Each is published with no request or response body — the path is in "
        "the document and a generated client gets nothing for it. This is the "
        "error channel, which a warnings check does not see."
    )
