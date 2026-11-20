"""Create or update the 问数 read-only role and its tenant wall (docs/ARCHITECTURE-ask-data.md §4, ADR 0007).

    ASK_DATA_DB_PASSWORD=… manage.py ask_data_setup [--role soulledger_ask_data]

Once per environment, after `migrate`; idempotent. Runs on `default` as the table owner, which needs
CREATEROLE. The password is read from the environment only, never from the command line. Then point
ASK_DATA_DATABASE_URL at the same database as this role.
"""
import os

from django.core.management.base import BaseCommand, CommandError
from django.db import connections

from apps.soul_assist.ask_data import setup


class Command(BaseCommand):
    help = "Create or update the read-only ask_data role, its column grants and the tenant RLS policy"

    def add_arguments(self, parser):
        parser.add_argument("--role", default=setup.DEFAULT_ROLE)

    def handle(self, *args, **options):
        connection = connections["default"]
        if connection.vendor != "postgresql":
            raise CommandError("ask_data_setup needs PostgreSQL: row-level security does not exist on "
                               f"{connection.vendor}")
        password = os.environ.get("ASK_DATA_DB_PASSWORD", "")
        if not password:
            raise CommandError("set ASK_DATA_DB_PASSWORD")
        try:
            setup.apply(connection, options["role"], password)
        except ValueError as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(f"role={options['role']} tables={','.join(setup.tables())} policy={setup.POLICY}")
