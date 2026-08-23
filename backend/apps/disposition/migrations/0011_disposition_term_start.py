"""Give a Disposition an explicit start date for the term it imposes.

Three nullable columns — ``term_start_year`` / ``term_start_month`` /
``term_start_day`` — in the signed-year, optional-month/day shape
``apps/souls/dates.py`` documents. Not a ``DateField``: ``datetime.date`` has
``MINYEAR = 1`` and a term that began in 399 BCE is exactly the case this
column exists for.

WHY NOT ``executed_at``
-----------------------
``executed_at`` records when this office carried the disposition out — an
operator's action, the server's clock, always CE. ``term_start`` records when
the soul's term began running, which is a fact about its afterlife on the same
historical calendar as its birth and death. The two coincide only for a soul
that died recently and was processed promptly. See the column comment in
``apps/disposition/models.py`` for the full argument; it is the owner's
decision, not an accident of modelling.

BACKFILL: NONE, AND THAT IS THE DECISION
----------------------------------------
Every row that exists when this migration runs gets NULL, and NULL means "no
term start recorded" — the same convention ``sentence_years`` uses one field
up, and the same refusal ``apps/ledger/readings.py::_greek_reading`` already
makes when it declines to derive a start from ``death_year``. There is nothing
in an existing row to derive a real start from:

  * ``executed_at`` is the wrong fact, per the section above, and is itself
    NULL on every unexecuted row.
  * ``created_at`` is when the row was inserted.
  * the soul's ``death_year`` is the derivation ``_greek_reading``'s docstring
    rules out by name — "inventing a start date for a term this system has
    never actually begun counting".

So this migration writes no data at all. There is no ``RunPython``, no
``_base_manager`` query, and no empty-database guard, because there is nothing
for any of the three to guard: the whole of the forward operation is three
``AddField``s that the database fills with NULL, and the whole of the reverse
is dropping them again.

That the backfill is nothing rather than something is still asserted, not
merely asserted *about*:
``tests/test_migration_roundtrip.py::test_disposition_0011_round_trip`` seeds
dispositions at 0010, reads the column through the round trip, and requires it
to be absent before, NULL on every seeded row after, and absent again on the
reverse. A future edit that quietly backfills a value reddens it.

REVERSIBILITY
-------------
``AddField`` reverses to ``RemoveField``, which drops the three columns and the
data in them. That is destructive in the ordinary way every column addition is
— rolling back past the migration that introduced a fact discards the fact —
and it is not the failure ``tests/migration_roundtrip.py`` was written for
(a reverse that runs and silently fails to restore rows it claimed to). The
round-trip test above asserts the shape it does restore: the pre-0011 world,
exactly.
"""

import django.core.validators
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("disposition", "0010_sentence_years_help_text"),
    ]

    operations = [
        migrations.AddField(
            model_name="disposition",
            name="term_start_day",
            field=models.SmallIntegerField(
                blank=True,
                null=True,
                validators=[
                    django.core.validators.MinValueValidator(1),
                    django.core.validators.MaxValueValidator(31),
                ],
            ),
        ),
        migrations.AddField(
            model_name="disposition",
            name="term_start_month",
            field=models.SmallIntegerField(
                blank=True,
                null=True,
                validators=[
                    django.core.validators.MinValueValidator(1),
                    django.core.validators.MaxValueValidator(12),
                ],
            ),
        ),
        migrations.AddField(
            model_name="disposition",
            name="term_start_year",
            field=models.IntegerField(blank=True, null=True),
        ),
    ]
