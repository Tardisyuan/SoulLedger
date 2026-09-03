"""The committed schema must not record which database engine generated it.

WHY THIS FILE EXISTS. `test_committed_schema_matches_the_backend.py` compares
the committed document against what *this* backend generates — and "this
backend" turned out to include the database it was pointed at.

Django's `ModelSerializer` attaches a `MinValueValidator`/`MaxValueValidator` to
every integer field, taking the pair from
`connection.ops.integer_field_range(internal_type)`. SQLite has no fixed-width
integers and reports the 64-bit range for every type; PostgreSQL reports the
column's real width. drf-spectacular renders those validators, so the same code
generated two different documents:

    field kind             sqlite                postgresql
    IntegerField           (-2**63, 2**63-1)     (-2**31, 2**31-1)
    PositiveIntegerField   (0, 2**63-1)          (0, 2**31-1)
    SmallIntegerField      (-2**63, 2**63-1)     (-32768, 32767)

Measured before the fix: **32 components, 278 lines** different between the two.
The committed file was generated on SQLite.

WHY IT WAS INVISIBLE, AND WHY THAT IS THE ACTUAL FINDING. The gate runs
wherever pytest runs, and pytest locally runs on SQLite — so the gate compared
a SQLite-generated file against a SQLite-generated file and agreed with itself.
`.github/workflows/ci.yml` sets `DATABASE_URL: postgres://…` and starts a
`postgres:16-alpine` service, so the gate has always been destined to fail
there; it never has, because that workflow is `workflow_dispatch` only (the
repository is out of Actions minutes). A check with a dimension nobody has ever
exercised is not a check along that dimension.

The remedy is `apps/core/schema.py::drop_engine_dependent_integer_bounds`,
which removes the backend-derived bounds so that both engines emit identical
bytes. The gate next door then keeps comparing the *whole file*, which is what
makes it worth having — the alternative, excluding these fields from the
comparison, would have weakened it into an allowlist.
"""

import pytest
from django.db import connection
from drf_spectacular.generators import SchemaGenerator

from apps.core.schema import (
    ENGINE_INTEGER_LOWER_BOUNDS,
    ENGINE_INTEGER_UPPER_BOUNDS,
    _walk_schemas,
    drop_engine_dependent_integer_bounds,
)

#: Every integer range Django can report, across the backends it ships.
#: Taken from `django.db.backends.base.operations.BaseDatabaseOperations
#: .integer_field_ranges` plus SQLite's override, and pinned here so that a
#: Django upgrade that widens a type cannot silently leave a stale bound in the
#: document. `test_the_bound_lists_still_match_django` is what notices.
DJANGO_INTEGER_TYPES = (
    "SmallIntegerField",
    "IntegerField",
    "BigIntegerField",
    "PositiveSmallIntegerField",
    "PositiveIntegerField",
    "PositiveBigIntegerField",
    "SmallAutoField",
    "AutoField",
    "BigAutoField",
)


@pytest.fixture(scope="module")
def generated():
    return SchemaGenerator().get_schema(request=None, public=True)


def test_the_generator_actually_ran(generated):
    """Without this, an empty document satisfies every assertion below."""
    assert len(generated["paths"]) > 100, (
        f"only {len(generated['paths'])} paths generated — the assertions "
        f"below would be vacuous."
    )


def test_no_engine_derived_integer_bound_survives(generated):
    """Not one, anywhere in the document.

    Walks every dict rather than only `components/schemas`: bounds also appear
    inline on parameters and inside nested `items`/`properties`, and a check
    that knew the document's shape would miss whichever place the generator
    puts them next.
    """
    offenders = [
        (schema.get("title") or schema.get("description") or "?", key, schema[key])
        for schema in _walk_schemas(generated)
        if schema.get("type") == "integer"
        for key, bounds in (
            ("maximum", ENGINE_INTEGER_UPPER_BOUNDS),
            ("minimum", ENGINE_INTEGER_LOWER_BOUNDS),
        )
        if schema.get(key) in bounds
    ]
    assert offenders == [], (
        f"{len(offenders)} integer bound(s) in the schema equal a database "
        f"backend's column width, so the document records which engine "
        f"generated it and the committed-schema gate will disagree with "
        f"itself across engines:\n"
        + "\n".join(f"  - {w}: {k}={v}" for w, k, v in offenders[:10])
    )


def test_a_real_business_bound_is_not_stripped(generated):
    """The hook must remove backend widths and nothing else.

    `SoulRecord.weight` carries `MaxValueValidator(100)` from the model. If the
    hook were written as "drop every maximum on an integer" this assertion is
    what would go red, and without it that spelling would look identical to the
    correct one — the schema would simply document less and still pass the test
    above.
    """
    weights = [
        schema
        for schema in _walk_schemas(generated)
        if schema.get("type") == "integer" and schema.get("maximum") == 100
    ]
    assert weights, (
        "`maximum: 100` is gone from the document. That bound is a business "
        "rule (SoulRecord.weight, 1-100), not a column width, and stripping "
        "it means the hook is removing more than the engine's contribution."
    )
    assert all(w.get("minimum") == 1 for w in weights), (
        "the paired `minimum: 1` was stripped — it is `MinValueValidator(1)` "
        "from the model, and 1 is not any backend's lower bound."
    )


def test_zero_lower_bounds_are_left_alone(generated):
    """`PositiveIntegerField` reports 0 on every engine, so 0 must stay.

    It is in neither bound list on purpose. Dropping it would remove a true and
    useful fact — "this number is never negative" — to fix a drift that does
    not exist, since both engines agree on it.
    """
    assert any(
        schema.get("type") == "integer" and schema.get("minimum") == 0
        for schema in _walk_schemas(generated)
    ), (
        "no `minimum: 0` survives. Zero is engine-independent and was meant to "
        "be kept; if it is being stripped, the hook is matching on the wrong "
        "thing."
    )


def test_the_bound_lists_still_match_django():
    """The pinned bounds must still be the ones Django reports.

    This file hardcodes six numbers. If a Django upgrade changes a type's range
    — or this project adds a backend whose widths differ again — the hook would
    silently stop matching and the drift would come back, with every assertion
    above still green because it only ever looks for the numbers it knows.
    """
    reported = {
        connection.ops.integer_field_range(internal_type)
        for internal_type in DJANGO_INTEGER_TYPES
    }
    lows = {low for low, _ in reported if low is not None}
    highs = {high for _, high in reported if high is not None}

    unknown_highs = highs - ENGINE_INTEGER_UPPER_BOUNDS
    unknown_lows = lows - ENGINE_INTEGER_LOWER_BOUNDS - {0}
    assert not unknown_highs and not unknown_lows, (
        f"this backend ({connection.vendor}) reports integer bounds the hook "
        f"does not know about — upper {sorted(unknown_highs)}, lower "
        f"{sorted(unknown_lows)}. Add them to "
        f"apps/core/schema.py::ENGINE_INTEGER_{{UPPER,LOWER}}_BOUNDS, or the "
        f"document starts recording this engine again."
    )


def test_the_hook_would_notice_a_bound_it_was_given():
    """The hook's own guard.

    Every assertion above passes when the hook does nothing *and* the generator
    produces no bounds at all — the two are indistinguishable from the outside.
    This hands it a document that definitely contains one.
    """
    document = {
        "components": {
            "schemas": {
                "Thing": {
                    "properties": {
                        "engine_derived": {
                            "type": "integer",
                            "maximum": 2147483647,
                            "minimum": -2147483648,
                            "format": "int64",
                        },
                        "business_rule": {
                            "type": "integer",
                            "maximum": 100,
                            "minimum": 1,
                        },
                        "not_an_integer": {"type": "string", "maximum": 2147483647},
                    }
                }
            }
        }
    }
    drop_engine_dependent_integer_bounds(document, None, None, True)
    props = document["components"]["schemas"]["Thing"]["properties"]

    assert props["engine_derived"] == {"type": "integer"}, (
        f"the hook left something behind: {props['engine_derived']}"
    )
    assert props["business_rule"] == {"type": "integer", "maximum": 100, "minimum": 1}
    # A `maximum` on a non-integer is not Django's integer validator and is not
    # the hook's business; touching it would mean matching on the value alone.
    assert props["not_an_integer"]["maximum"] == 2147483647
