"""Test-only second database for the sharding guards (G3, G7 in
docs/ARCHITECTURE-tenant-sharding.md 4.1). Production routing is untouched:
nothing outside `config/settings_multidb.py` imports this module.

`ShadowTenantRouter` sends writes of a tenant-scoped instance whose `tenant_id`
is in `SHADOW_TENANTS` to `SHADOW_ALIAS`. Relations between rows of different
databases are decided by the production `ShardRouter` behind it (since stage 1B):
two SHARD rows are refused, a bare id to a CONTROL row is not.
"""

SHADOW_ALIAS = "tenant_shadow"
#: Tenant pks whose rows go to the shadow alias. A test fills and clears it.
SHADOW_TENANTS: set = set()


class ShadowTenantRouter:
    def _alias(self, hints):
        instance = hints.get("instance")
        if instance is not None and getattr(instance, "tenant_id", None) in SHADOW_TENANTS:
            return SHADOW_ALIAS
        return None

    # Reads that carry an instance hint (related managers, refresh_from_db) follow it;
    # a bare queryset has no tenant to look at and stays on default unless `.using()`.
    def db_for_read(self, model, **hints):
        return self._alias(hints)

    def db_for_write(self, model, **hints):
        return self._alias(hints)

    def allow_relation(self, obj1, obj2, **hints):
        # No opinion since stage 1B: the production ShardRouter behind it refuses two SHARD rows in
        # different databases and allows a pair with a CONTROL / REFERENCE side (a bare id). Refusing
        # every cross-database pair here would hide that rule from this group.
        return None

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        # Both aliases carry the full schema, and data migrations (RunPython / RunSQL: no
        # model_name) run on both. They used to be skipped on the shadow, because they queried
        # through the router rather than `schema_editor.connection.alias` and so read `default`,
        # already fully migrated, and died on a column a later migration had dropped (souls 0020,
        # measured). tests/test_migrations_use_the_migrated_alias.py now keeps them alias-aware.
        # None, not True: this router has no opinion on where a model migrates, so the production
        # ShardRouter behind it is asked (True here would hide it). With every router silent Django
        # migrates everything everywhere, which is what both aliases need today.
        return None
