"""Doc-only serializers: the response shapes that are built as plain dicts.

WHY THIS FILE EXISTS. `drf-spectacular` cannot guess a serializer for an
`@api_view` function or for an `APIView` without `serializer_class`. It does
not fail on that — it emits `Error [name]: unable to guess serializer ...
Ignoring view for now.` and publishes the endpoint **with no request and no
response body**. Twenty-seven views were in that state, which is why the whole
of `ledger` and `perm` had no generatable client types at all.

Nothing here is instantiated at runtime. The views still build their own
`Response({...})`; these classes only tell the generator what is in it. Two
consequences worth knowing:

  * A shape here can drift from the dict it describes without anything going
    red. Where a shape is asserted rather than transcribed, the assertion is
    in the docstring beside it.
  * They must stay resolvable, because `test_schema_has_no_warnings.py` fails
    on any field the generator has to default to `string`. Plain typed fields
    only; no bare `SerializerMethodField`.
"""
from rest_framework import serializers


class DetailResponseSerializer(serializers.Serializer):
    """`{"detail": "..."}` — the success/notice body DRF's own convention uses."""

    detail = serializers.CharField()


class ErrorResponseSerializer(serializers.Serializer):
    """`{"error": "..."}` — this codebase's other, non-DRF, one-line body.

    Kept distinct from `DetailResponseSerializer` rather than unified: the two
    keys are what the views actually emit, and a client that reads `detail`
    where the server writes `error` gets `undefined`, not a type error.
    """

    error = serializers.CharField()


# ---------------------------------------------------------------------------
# Engine-independence of the generated document
# ---------------------------------------------------------------------------

#: Integer bounds Django derives from the database backend, not from the model.
#:
#: `ModelSerializer` attaches a `MinValueValidator`/`MaxValueValidator` to every
#: integer field, taking the pair from
#: `connection.ops.integer_field_range(internal_type)`. drf-spectacular renders
#: those as `minimum`/`maximum`, so **the generated document records which
#: database generated it**. Measured on this project:
#:
#:     internal type              sqlite                postgresql
#:     IntegerField               (-2**63, 2**63-1)     (-2**31, 2**31-1)
#:     PositiveIntegerField       (0, 2**63-1)          (0, 2**31-1)
#:     SmallIntegerField          (-2**63, 2**63-1)     (-32768, 32767)
#:
#: SQLite has no fixed-width integers, so it reports the 64-bit range for every
#: type. The committed schema was generated on SQLite; CI runs pytest against
#: PostgreSQL (`.github/workflows/ci.yml`), so
#: `test_committed_schema_matches_the_backend` fails there — 32 components, 278
#: lines. Nobody has seen it because that workflow is `workflow_dispatch` only.
#:
#: Zero is deliberately absent from the lower bounds: `PositiveIntegerField`
#: reports 0 on both engines, so it causes no drift, and it is a real fact about
#: the field that a client can use.
ENGINE_INTEGER_UPPER_BOUNDS = frozenset({32767, 2147483647, 9223372036854775807})
ENGINE_INTEGER_LOWER_BOUNDS = frozenset({-32768, -2147483648, -9223372036854775808})


def _walk_schemas(node):
    """Every dict in the document that could be a schema object.

    Deliberately structure-blind. Bounds appear under `components/schemas`, but
    also inline in parameters and nested `items`/`properties`/`allOf`, and a
    walker that knew the document's shape would miss whichever place the next
    version of the generator puts them.
    """
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from _walk_schemas(value)
    elif isinstance(node, list):
        for value in node:
            yield from _walk_schemas(value)


def drop_engine_dependent_integer_bounds(result, generator, request, public):
    """Strip `minimum`/`maximum` that came from the database backend.

    WHY STRIP RATHER THAN PIN THE ENGINE. Pinning the generator to PostgreSQL
    would make the document right for one engine and wrong for anyone who
    regenerates on the other, and would make `manage.py spectacular` require a
    PostgreSQL URL to produce a committed-schema-equal file. Stripping makes the
    document **engine-independent**: both engines emit the same bytes, so the
    gate keeps comparing the whole file instead of an allowlisted subset of it.

    WHY THIS LOSES NOTHING A CLIENT WANTED. The bound removed from `order` is
    2147483647 — the width of an `int4` column, not a business rule. Nobody
    checks an id against 2**31 before sending it. Bounds that *are* business
    rules survive: `SoulRecord.weight` carries `MaxValueValidator(100)` from the
    model and stays `maximum: 100, minimum: 1`, because 100 is not a backend
    width. A field whose real limit genuinely equalled a backend width would
    lose its documented bound; that is the price, and it is recorded here rather
    than discovered later.
    """
    for schema in _walk_schemas(result):
        if schema.get("type") != "integer":
            continue
        if schema.get("maximum") in ENGINE_INTEGER_UPPER_BOUNDS:
            schema.pop("maximum", None)
            # `format: int64` is drf-spectacular's companion to the 64-bit
            # bound and is exactly as engine-derived.
            if schema.get("format") == "int64":
                schema.pop("format", None)
        if schema.get("minimum") in ENGINE_INTEGER_LOWER_BOUNDS:
            schema.pop("minimum", None)
    return result
