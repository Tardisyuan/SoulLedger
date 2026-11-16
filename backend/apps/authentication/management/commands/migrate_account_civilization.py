"""Move an account to another civilization: the command form of `POST /users/{id}/migrate-civilization/`.

    manage.py migrate_account_civilization <username> --civilization GREEK --hall GR_HADES --reason "..." --by sysadmin

`--by` names the SYSTEM_ADMIN on whose authority it runs (kept in the audit row); every refusal of the API applies
(apps/authentication/civilization_move.py) and is a non-zero exit naming the condition. Nothing changes on refusal.
"""
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from apps.authentication.civilization_move import MoveRefusedError, migrate


class Command(BaseCommand):
    help = "Move an account to another civilization (SYSTEM_ADMIN only; hall, organization and civilization at once)."

    def add_arguments(self, parser):
        parser.add_argument("username")
        parser.add_argument("--civilization", required=True)
        parser.add_argument("--hall", default=None, help="Hall code of the new civilization (hall-bound accounts).")
        parser.add_argument("--organization", type=int, default=None, help="Organization id in the new hall.")
        parser.add_argument("--reason", required=True)
        parser.add_argument("--by", required=True, help="Username of the SYSTEM_ADMIN doing it.")

    def handle(self, *args, **opts):
        from apps.org.models import Organization
        from apps.tenants.models import Tenant

        users = get_user_model().objects
        user = users.filter(username=opts["username"]).select_related("tenant").first()
        actor = users.filter(username=opts["by"]).first()
        if user is None:
            raise CommandError(f"not_found: no account {opts['username']!r}")
        hall = None
        if opts["hall"]:
            hall = Tenant.objects.filter(code=opts["hall"]).first()
            if hall is None:
                raise CommandError(f"hall_not_found: no hall {opts['hall']!r}")
        org = None
        if opts["organization"] is not None:
            org = Organization.objects.filter(pk=opts["organization"]).first()
            if org is None:
                raise CommandError(f"organization_not_found: no organization {opts['organization']}")
        try:
            row = migrate(user, civilization=opts["civilization"], hall=hall, organization=org,
                          reason=opts["reason"], actor=actor)
        except MoveRefusedError as e:
            extra = f" {e.extra}" if e.extra else ""
            raise CommandError(f"{e.code}: {e.detail}{extra}") from None
        self.stdout.write(f"moved {user.username}: {row.changes}")
