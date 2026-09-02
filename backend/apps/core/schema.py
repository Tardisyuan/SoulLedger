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
