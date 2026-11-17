"""Deliver every pending cross-civilization saga message until none is left (sharding stage 4 part C,
apps/tenants/shard_saga.py) -- after a broker outage, or to finish sagas by hand.

    manage.py relay_outbox                  # deliver
    manage.py relay_outbox --retry-failed   # dead letters (FAILED) back to PENDING first, once their cause is fixed

The messages are rows on the masters, not broker messages: nothing here waits on Celery. A message the target
refuses is closed REFUSED; one whose delivery keeps failing stays PENDING, then FAILED after
`shard_saga.MAX_ATTEMPTS`; either is reported (exit 1) with its last error.
"""
from django.core.management.base import BaseCommand, CommandError

from apps.tenants import shard_saga


class Command(BaseCommand):
    help = "Deliver the pending cross-civilization saga messages on every master."

    def add_arguments(self, parser):
        parser.add_argument("--retry-failed", action="store_true", help="Put dead letters (FAILED) back to PENDING")

    def handle(self, *args, **options):
        if options["retry_failed"]:
            self.stdout.write(f"{shard_saga.retry_failed()} failed message(s) put back to pending")
        closed = 0
        for _ in range(10):  # a step may send the next message
            n = shard_saga.relay()
            closed += n
            if not n:
                break
        left = sum(len(shard_saga.pending(alias, ids)) for alias, ids in shard_saga.masters())
        dead = shard_saga.failed()
        for alias, msg in dead:
            self.stdout.write(f"FAILED {alias} {msg.kind} {msg.subject or msg.message_id} after {msg.attempts} "
                              f"attempts: {msg.last_error}")
        self.stdout.write(f"{closed} message(s) closed, {left} pending, {len(dead)} failed")
        if left or dead:
            raise CommandError(f"{left} saga message(s) still pending, {len(dead)} failed; see above and the log")
