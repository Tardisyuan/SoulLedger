"""Migrate every configured civilization shard (sharding stage 2, the sharding plan (not in this repo)).

    manage.py migrate_shards [--check]

`manage.py migrate --database <alias>` for each alias in `apps.core.sharding.shard_aliases()`, i.e. each
SHARD_DATABASE_URL_<CIV> that is set. `ShardRouter.allow_migrate` and the shard engine keep the control
tables off a shard. Runs after `manage.py migrate` (default, the control database) in docker-compose.
No shard configured -- production today -- says so and exits 0. `--check`: exit 1 if any shard has an
unapplied migration (migrate --check), applying nothing.
"""
from django.core.management import call_command
from django.core.management.base import BaseCommand

from apps.core.sharding import shard_aliases


class Command(BaseCommand):
    help = "Run migrate on every configured civilization shard alias (civ_*)."

    def add_arguments(self, parser):
        parser.add_argument("--check", action="store_true",
                            help="Exit non-zero if a shard has unapplied migrations; apply nothing.")

    def handle(self, *args, check=False, verbosity=1, **options):
        aliases = shard_aliases()
        if not aliases:
            self.stdout.write("no civilization shard configured (SHARD_DATABASE_URL_<CIV>): nothing to migrate")
            return
        for alias in aliases:
            self.stdout.write(f"migrate --database {alias}")
            call_command("migrate", database=alias, interactive=False, check_unapplied=check,
                         verbosity=verbosity, stdout=self.stdout, stderr=self.stderr)
