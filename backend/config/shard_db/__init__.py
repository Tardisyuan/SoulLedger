"""Database engine for a civilization shard alias (`civ_*`; stage 1B, D3 in
docs/audit/2026-11-15-sharding/PLAN.md). ENGINE "config.shard_db.postgresql".

On a shard `allow_migrate` leaves the control tables out (authentication_user, perm_*, menus_*...), but
the historical migrations created the shard tables' foreign keys to them as real constraints years
before 1B made them bare. Replaying those migrations on an empty shard would fail at the first
`REFERENCES "authentication_user"`. This schema editor creates such a key without its constraint,
whatever the historical field says: a key to a table that is not migrated on this alias is bare here.
On every other alias the router migrates everything and the editor changes nothing.
"""
import copy
from contextlib import contextmanager

from django.db import router

#: Stage 2: `SHARD_DATABASE_URL_<CIV>` (CHINESE / EUROPEAN / EGYPTIAN / GREEK) adds the alias `civ_<civ>`.
ENV_PREFIX = "SHARD_DATABASE_URL_"


def databases_from_env(env, *, disable_server_side_cursors=False, conn_max_age=600):
    """{alias: DATABASES entry} for every `SHARD_DATABASE_URL_<CIV>` set in `env`; {} when none is, which
    leaves production with `default` alone. PostgreSQL only. A name that is no civilization
    (SHARD_DATABASE_URL_CHINA) is refused at startup by `apps.core.sharding.check_shard_settings`."""
    import dj_database_url

    out = {}
    for key, url in env.items():
        if not key.startswith(ENV_PREFIX) or not url.strip():
            continue
        db = dj_database_url.parse(url.strip(), conn_max_age=conn_max_age, conn_health_checks=True)
        if "postgresql" not in db["ENGINE"]:
            raise ValueError(f"{key} must be a PostgreSQL URL (a civilization shard is PostgreSQL), got {db['ENGINE']}")
        db["ENGINE"] = "config.shard_db.postgresql"
        db["DISABLE_SERVER_SIDE_CURSORS"] = disable_server_side_cursors
        out[f"civ_{key[len(ENV_PREFIX):].lower()}"] = db
    return dict(sorted(out.items()))


def ask_data_shard_databases(databases):
    """{`ask_data_<shard alias>`: entry} for every `civ_*` alias, when `ask_data` is configured (docs/ARCHITECTURE-ask-data.md
    §4, ADR 0007): the `ask_data` entry -- its role, password, OPTIONS -- pointed at the shard's HOST / PORT / NAME.
    So one ASK_DATA_DATABASE_URL serves control and every shard: the role's password lives in that URL only, never
    in a SHARD_DATABASE_URL_<CIV>, and `ask_data_setup` creates the same role with the same password on each.
    {} when `ask_data` is not configured or nothing is sharded. In tests each mirrors its shard."""
    base = databases.get("ask_data")
    if base is None:
        return {}
    return {f"ask_data_{alias}": {**copy.deepcopy(base), "NAME": db["NAME"], "HOST": db["HOST"], "PORT": db["PORT"],
                                  "TEST": {"MIRROR": alias}}
            for alias, db in sorted(databases.items()) if alias.startswith("civ_")}


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
