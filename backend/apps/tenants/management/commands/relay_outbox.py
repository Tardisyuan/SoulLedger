"""Deliver every pending cross-civilization saga message until none is left (sharding stage 4 part C,
apps/tenants/shard_saga.py) -- after a broker outage, or to finish sagas by hand.

    manage.py relay_outbox

The messages are rows on the masters, not broker messages: nothing here waits on Celery. A message the target
refuses is closed REFUSED; one whose delivery keeps failing stays PENDING and is reported (exit 1).
"""
from django.core.management.base import BaseCommand, CommandError

from apps.tenants import shard_saga


class Command(BaseCommand):
    help = "Deliver the pending cross-civilization saga messages on every master."

    def handle(self, *args, **options):
        closed = 0
        for _ in range(10):  # a step may send the next message
            n = shard_saga.relay()
            closed += n
            if not n:
                break
        left = sum(len(shard_saga.pending(alias, ids)) for alias, ids in shard_saga.masters())
        self.stdout.write(f"{closed} message(s) closed, {left} pending")
        if left:
            raise CommandError(f"{left} saga message(s) still pending; see the log for why")
