"""Test-only second database for the sharding guards (G3, G7 in
docs/ARCHITECTURE-tenant-sharding.md 4.1). Production routing is untouched:
nothing outside `config/settings_multidb.py` imports this module.

`ShadowTenantRouter` sends writes of a tenant-scoped instance whose `tenant_id`
is in `SHADOW_TENANTS` to `SHADOW_ALIAS`, and refuses a relation between rows
that live in different databases -- the check a real split needs and today's
single database never makes.
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
        db1, db2 = obj1._state.db, obj2._state.db
        if db1 and db2 and db1 != db2:
            return False
        return None

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        # Both aliases carry the full schema. Data migrations (RunPython / RunSQL: no model_name)
        # are skipped on the shadow: 75 of the 76 RunPython migrations query through the router
        # rather than `schema_editor.connection.alias`, so they would read `default`, already
        # fully migrated, and die on a column a later migration dropped (souls 0020, measured).
        # A real split must make them alias-aware first.
        return db != SHADOW_ALIAS or model_name is not None
