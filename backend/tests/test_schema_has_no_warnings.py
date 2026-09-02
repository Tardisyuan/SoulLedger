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

WHY IT ALSO PINS THE ERRORS. Warnings and errors are different channels in
drf-spectacular, and `grep -i warning` on the command output does not see the
errors at all. There are 27 views it cannot introspect, each reported as
`Error [...]: unable to guess serializer ... Ignoring view for now.` "Ignoring
view for now" means **the endpoint is in the document with no request or
response body**. A generated client gets nothing for it.

Those 27 are pre-existing — measured identical before and after the pass that
took warnings to zero — and fixing them means giving ~27 function-based views
explicit `@extend_schema` request/response serializers, which is a separate
piece of work. Pinned by name rather than counted, for the reason
`suiteShape.test.ts` gives about its own list: a change that fixes one and adds
another nets to zero and passes. Fix one, delete its line. Add a view that
cannot be introspected, and this goes red with the name in the message.
"""
import pytest
from drf_spectacular.drainage import GENERATOR_STATS, reset_generator_stats
from drf_spectacular.generators import SchemaGenerator

# Views drf-spectacular cannot introspect, and therefore documents with no
# body. Every one is either an `@api_view` function or an `APIView` without a
# `serializer_class`. Deleting a line here is how a fix gets recorded.
KNOWN_UNINTROSPECTABLE = {
    # apps/authentication/views.py
    "change_password", "logout_view", "profile_view", "register_view",
    "reset_password_request", "set_new_password",
    # apps/death_sync/views.py
    "DeathSyncHealthView",
    # apps/ledger/views.py
    "LedgerBalanceView", "LedgerRecalculateView", "LedgerEffectiveView",
    "LedgerInheritanceView", "LedgerExportStatsView", "LedgerOverviewStatsView",
    # apps/perm/views.py
    "export_permissions", "import_permissions", "list_permissions",
    "update_delete_permission", "create_permission", "get_role_permissions",
    "assign_role_permissions", "init_role_permissions", "list_roles",
    "get_permissions_for_role", "update_delete_role", "create_role",
    "init_roles",
    # apps/core/recycle_bin_views.py
    "RecycleBinViewSet",
}


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


def test_the_set_of_undocumented_views_has_not_grown(generated):
    """The 27 views that carry no request/response body, pinned by name."""
    import re

    _, _, errors = generated
    seen = {m.group(1) for e in errors if (m := re.search(r"Error \[([^\]]+)\]", e))}
    assert seen == KNOWN_UNINTROSPECTABLE, (
        "the set of views drf-spectacular cannot introspect changed.\n"
        f"  newly unintrospectable: {sorted(seen - KNOWN_UNINTROSPECTABLE)}\n"
        f"  fixed (delete from KNOWN_UNINTROSPECTABLE): "
        f"{sorted(KNOWN_UNINTROSPECTABLE - seen)}\n"
        "A view in this set is published with no request or response body, so "
        "a generated client gets nothing for it."
    )
