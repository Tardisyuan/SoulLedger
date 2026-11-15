"""Database engine for a civilization shard alias (`civ_*`; stage 1B, D3 in
docs/audit/2026-11-15-sharding/PLAN.md). ENGINE "config.shard_db.postgresql".

On a shard `allow_migrate` leaves the control tables out (authentication_user, perm_*, menus_*...), but
the historical migrations created the shard tables' foreign keys to them as real constraints years
before 1B made them bare. Replaying those migrations on an empty shard would fail at the first
`REFERENCES "authentication_user"`. This schema editor creates such a key without its constraint,
whatever the historical field says: a key to a table that is not migrated on this alias is bare here.
On every other alias the router migrates everything and the editor changes nothing.
"""
from contextlib import contextmanager

from django.db import router


class BareKeysToAbsentTables:
    @contextmanager
    def _bare_here(self, fields):
        alias = self.connection.alias
        flipped = [f for f in fields
                   if f.remote_field is not None and getattr(f, "db_constraint", False)
                   and not router.allow_migrate_model(alias, f.remote_field.model)]
        for f in flipped:
            f.db_constraint = False
        try:
            yield
        finally:
            for f in flipped:
                f.db_constraint = True

    def create_model(self, model):  # its auto-created M2M tables come back through here
        with self._bare_here(model._meta.local_fields):
            super().create_model(model)

    def add_field(self, model, field):
        with self._bare_here([field]):
            super().add_field(model, field)

    def alter_field(self, model, old_field, new_field, strict=False):
        with self._bare_here([old_field, new_field]):
            super().alter_field(model, old_field, new_field, strict=strict)
