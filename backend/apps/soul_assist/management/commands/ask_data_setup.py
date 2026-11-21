"""Create or update the 问数 read-only role and its tenant wall (docs/ARCHITECTURE-ask-data.md §4, ADR 0007).

    ASK_DATA_DB_PASSWORD=… manage.py ask_data_setup [--role soulledger_ask_data]

Once per environment, after `migrate` (and `migrate_shards`); idempotent. Runs on `default` and, sharded, on every
civilization shard (`civ_*`), each as its table owner, which needs CREATEROLE: the same role, password, column
grants and policy on each (a role is cluster-wide; on a shard in another cluster it is created there). The password
is read from the environment only, never from the command line. Then point ASK_DATA_DATABASE_URL at control as this
role; the shard aliases are derived from it (config/shard_db `ask_data_shard_databases`).
"""
import os

from django.core.management.base import BaseCommand, CommandError
from django.db import connections

from apps.core.sharding import shard_aliases
from apps.soul_assist.ask_data import setup


class Command(BaseCommand):
    help = "Create or update the read-only ask_data role, its column grants and the tenant RLS policy"

    def add_arguments(self, parser):
        parser.add_argument("--role", default=setup.DEFAULT_ROLE)

    def handle(self, *args, **options):
        aliases = ["default", *shard_aliases()]
        for alias in aliases:
            if connections[alias].vendor != "postgresql":
                raise CommandError("ask_data_setup needs PostgreSQL: row-level security does not exist on "
                                   f"{connections[alias].vendor} ({alias})")
        password = os.environ.get("ASK_DATA_DB_PASSWORD", "")
        if not password:
            raise CommandError("set ASK_DATA_DB_PASSWORD")
        for alias in aliases:
            try:
                setup.apply(connections[alias], options["role"], password)
            except ValueError as exc:
                raise CommandError(str(exc)) from exc
            self.stdout.write(f"{alias}: role={options['role']} tables={','.join(setup.tables())} policy={setup.POLICY}")
