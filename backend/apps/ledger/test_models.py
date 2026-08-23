"""Where SoulRecord lives, and why it is not moving.

`apps/ledger/models.py` carried this for four milestones:

    TODO (M8-2): Move SoulRecord physically to this file and create a proper
                 app_label migration.

It is now a decision instead, and this module is what holds the decision to
account. The pattern is the one `apps/perm/migrations/0008_apply_data_scope_filter.py`
and `tests/test_migration_reverse_scope.py` established here: when the answer
to a standing TODO is "no", the answer gets written down where the TODO was and
pinned by a test, because a TODO that is silently never done and a decision that
was never made look identical six months later.

WHAT IT WOULD COST, counted rather than estimated (2026-08-23):

  * 191 references to `SoulRecord` across 41 files, 35 of them outside
    `migrations/`.
  * 22 of the 27 migrations in `apps/souls` name `soulrecord`, and five
    migrations across four other apps (death_sync, dispatch, events,
    reincarnation) depend on those by migration name. Those five are dependency
    edges, not foreign keys — nothing outside `apps.souls` has an FK to this
    model, which is exactly what makes the move look cheaper than it is.
  * `db_table` is derived, not declared: `souls_soulrecord`. Changing
    `app_label` renames the table, so a real move is a table rename on the
    ledger's largest table plus a `SeparateDatabaseAndState` state edit against
    22 historical migrations. Pinning `db_table = "souls_soulrecord"` instead
    avoids the rename and lands a `ledger` model sitting on a `souls_` table —
    the same split the TODO wanted to end, relocated into `Meta`.
  * `django.contrib.contenttypes` and `django.contrib.auth` are both installed
    and `default_permissions` is the stock four, so the move also moves one
    ContentType row and four `auth_permission` rows whose codenames are keyed
    on the app label. Those need a data migration or they orphan.
  * `scripts/backups/pre_migrate_20260805T055951Z.json` serialises rows as
    `"model": "souls.soulrecord"`. An app_label change makes that dump
    un-loaddata-able against the new schema.

WHAT IT WOULD BUY: nothing a user can see, and nothing a caller can see either.
`from apps.ledger.models import SoulRecord` already works — that is what the
re-export is for, and the tests below pin that it keeps working. The remaining
gain is that `apps/ledger/models.py` would contain a class instead of an import,
which is an aesthetic property of one file weighed against a table rename and a
content-type migration on live data.

So: not doing it. If a later change makes it worth doing anyway — an actual FK
from another ledger model, say, or the souls app being split for a different
reason — the tests below are the thing to delete, deliberately, along with this
docstring. They are not here to forbid the move. They are here so that it stops
being something the repository has been meaning to get around to.
"""
import apps.ledger.models as ledger_models
from apps.souls.record_models import RecordCategory, RecordType, SoulRecord


class TestSoulRecordStaysInTheSoulsApp:

    def test_the_app_label_and_table_are_the_ones_the_data_is_already_in(self):
        meta = SoulRecord._meta
        assert meta.app_label == "souls"
        # Derived from the app label, not declared. This assertion is the whole
        # cost of the move in one line: change the label above and this table
        # name changes with it, on the largest table in the ledger.
        assert meta.db_table == "souls_soulrecord"
        # `_meta.original_attrs`, not `SoulRecord.Meta`. `ModelBase.__new__`
        # pops `Meta` out of the class body, so `SoulRecord.Meta` resolves up
        # the MRO to `AuditUserFields.Meta` and a check against its `__dict__`
        # is green no matter what SoulRecord declares — this assertion was
        # written that way first and stayed green when db_table was added to
        # the model, which is how it was caught. `original_attrs` is the set
        # the class body actually declared.
        declared = SoulRecord._meta.original_attrs
        assert "db_table" not in declared, (
            "Pinning db_table would let the app_label move without a table "
            "rename — and would leave a ledger model on a souls_ table, which "
            "is the original split moved into Meta rather than resolved. If "
            "that is genuinely wanted, argue it in the module docstring first."
        )
        assert "app_label" not in declared, (
            "app_label is derived from the package this model is defined in. "
            "Declaring it is how the move gets made without the migrations, "
            "the ContentType row or the permission codenames following."
        )

    def test_the_move_would_take_the_permission_rows_with_it(self):
        # Not a preference, a coupling. Stock default_permissions plus
        # contenttypes installed means four auth_permission codenames and one
        # ContentType row are keyed on the app label; they do not follow a
        # model to a new app by themselves.
        from django.conf import settings

        assert SoulRecord._meta.default_permissions == (
            "add", "change", "delete", "view",
        )
        assert "django.contrib.contenttypes" in settings.INSTALLED_APPS
        assert "django.contrib.auth" in settings.INSTALLED_APPS

    def test_the_re_export_already_gives_the_ledger_what_the_move_was_for(self):
        """The benefit side, asserted rather than assumed.

        The TODO's stated goal was a ledger-domain home for the ledger's model.
        Importing it from `apps.ledger.models` is that, and it is the same
        class object rather than a parallel definition — so there is no second
        model, no second table, and no way for the two names to drift.
        """
        assert ledger_models.SoulRecord is SoulRecord
        assert ledger_models.LedgerRecord is SoulRecord
        assert ledger_models.RecordType is RecordType
        assert ledger_models.RecordCategory is RecordCategory
        assert set(ledger_models.__all__) == {
            "SoulRecord", "LedgerRecord", "RecordType", "RecordCategory",
        }
