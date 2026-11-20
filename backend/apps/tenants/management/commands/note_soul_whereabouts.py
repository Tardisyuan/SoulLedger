"""Note on control where each shard's souls are (apps/tenants/soul_directory.py): SOUL_ROWS_IN for the souls a crossing
row on a shard names while the soul is not its own there (a soul's ACROSS view reads every shard only for such a
soul), SOUL_LIVES_IN for the souls with an account whose primary is on a shard (its own requests ask that master first).

    manage.py note_soul_whereabouts

Idempotent. Run once where the shards already held rows when this was deployed (115), and after a control commit
failed behind a shard's or crossing rows were written without a save signal (soul_directory's module doc).
"""
from django.core.management.base import BaseCommand

from apps.core.shard_sync import shard_aliases
from apps.tenants.soul_directory import note_from_shards


class Command(BaseCommand):
    help = "Note on control which shard each account's soul lives on and which souls have rows on other shards."

    def handle(self, *args, **options):
        for alias, (away, living) in note_from_shards(shard_aliases()).items():
            self.stdout.write(f"{alias}: {away} soul(s) with rows here and their primary elsewhere; "
                              f"{living} account soul(s) living here")
