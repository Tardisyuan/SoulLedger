from celery import shared_task

from apps.scheduler.registry import time_limits


@shared_task(name="sharding.sync_shards", **time_limits("sharding.sync_shards"))
def sync_shards():
    """Stage 2 (shadow shards): copy control's rows to every configured civilization shard, i.e.
    `reconcile_shards --all --fix --direction control-to-shard`. Fired by beat and, debounced, after a
    commit that wrote a shard model (`apps.core.shard_sync`). One run covers every civilization -- the
    shards are per civilization, not per hall -- so it is GLOBAL. No shard configured: nothing to do."""
    from apps.core.shard_sync import reconcile, shard_aliases

    shards = shard_aliases()
    if not shards:
        return {"skipped": "no_shard_databases"}
    # A row a commit changes between compare and fix is picked up by the next run.
    report = reconcile(shards, fix=True)
    return {alias: len(diffs) for alias, diffs in report.items()}
