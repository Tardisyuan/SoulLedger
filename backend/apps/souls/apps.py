"""
Soul app configuration.
"""
from django.apps import AppConfig


class SoulsConfig(AppConfig):
    # `BigAutoField`, not `BigAutoAutoField`. The typo was real: `import_string`
    # on that name raises ImportError. It has never fired because both models in
    # this app declare explicit UUID primary keys, and Django only resolves
    # `default_auto_field` when it has to *generate* an implicit one — so the
    # first model added here without a `primary_key` would have crashed at
    # migration time. A mine, not a fault.
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.souls"
    verbose_name = "Souls"

    def ready(self):
        from apps.core.recycle_bin import register_bin_type

        # Import signal handler to register it
        from . import signals  # noqa: F401
        from .models import Soul

        # Register Soul with the global recycle bin (apps.core.recycle_bin)
        # as a "domain" entity — soft-deletable while it has no concluded
        # judgment, archivable instead once it does. See
        # Soul.has_concluded_judgment and Soul.delete_with_cascade.
        register_bin_type(
            "soul", Soul, "domain", lambda soul: soul.name,
            location=lambda soul: {"kind": "civilization", "value": soul.civilization},
        )

        # Derive the placement table now (every model is loaded before any `ready()`): a tenant-path tie
        # raises here, at startup, instead of on the first request or migration that asks where a model lives
        # (VERIFY-stage0 open item 4). Cached, so the router's later lookups are free.
        from apps.core import bare_ids
        from apps.core.sharding import _by_label, check_shard_settings

        _by_label()
        check_shard_settings()
        # Stage 1B: the foreign keys across the control / shard boundary are bare ids; their delete rules
        # (CASCADE / SET_NULL / PROTECT as before) are applied by apps.core.bare_ids on every alias.
        bare_ids.connect()
        # A constrained SHARD -> SHARD key may not name a row of another civilization (VERIFY-stage2 item 1).
        from apps.core import sharding

        sharding.connect()
        # A commit that wrote a control row a shard copies queues one debounced shard sync (no-op without shards).
        from apps.core import shard_sync

        shard_sync.connect()
        # Sharded: each civilization's reads come from its shard; FANOUT reads merge every leg.
        from apps.core import shard_reads

        shard_reads.install()
        # Sharded: each civilization's writes go to its shard, in its own id range (gap 4a).
        from apps.core import shard_ids

        shard_ids.connect()
        # ... and nothing writes control's mirror of those rows, or a third database inside a transaction.
        shard_reads.connect_write_guards()
        # ... nor a soul whose move between two masters is in flight (part C: its rows are read-only meanwhile).
        from apps.tenants import shard_saga

        shard_saga.connect_transit_guard()
        shard_sync.connect_hall_copies()
