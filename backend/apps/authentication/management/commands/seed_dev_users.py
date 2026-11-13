"""Six local sign-ins, one per role, for a development database. Refuses unless DEBUG.

    manage.py seed_dev_users [--tenant CN_DIYU]

Every run gives each account a fresh random password and prints it once; nothing is written to disk.
Re-running updates the same six accounts, it never adds more. Needs the tenants (`seed_mythology`).
"""
import secrets

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.authentication.models import UserRole
from apps.authentication.seeding import ensure_officer
from apps.soul_accounts import services as accounts
from apps.soul_accounts.models import AccountOrigin
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant

OFFICERS = [
    ("dev_admin", "管理员", UserRole.ADMIN),
    ("dev_judge", "判官", UserRole.JUDGE),
    ("dev_guardian", "牛头马面", UserRole.GUARDIAN),
    ("dev_moderator", "审核员", UserRole.MODERATOR),
    ("dev_viewer", "访客", UserRole.VIEWER),
]
SOUL_NAME = "开发用灵魂"


class Command(BaseCommand):
    help = "DEBUG only: create or refresh six dev accounts (one per role) and print fresh random passwords."

    def add_arguments(self, parser):
        parser.add_argument("--tenant", help="tenant code (default: the first tenant by code)")

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("seed_dev_users only runs with DEBUG=True: it creates accounts with printed passwords.")
        code = options.get("tenant")
        tenant = Tenant.objects.filter(code=code).first() if code else Tenant.objects.order_by("code").first()
        if tenant is None:
            raise CommandError(f"no tenant {code!r}" if code else "no tenants yet: run seed_mythology first.")

        rows = []
        with transaction.atomic():
            for username, display, role in OFFICERS:
                password = secrets.token_urlsafe(12)
                ensure_officer(username, display, role, tenant, password, reset_password=True)
                rows.append((role, username, password))

            soul = Soul.all_objects.filter(tenant=tenant, name=SOUL_NAME, is_deleted=False).first() \
                or Soul.objects.create(name=SOUL_NAME, tenant=tenant, current_state=SoulState.JUDGING)
            account = accounts.current_account_of(soul) or accounts.provision_account(soul, AccountOrigin.OFFICER)[0]
            password = secrets.token_urlsafe(12)
            account.user.set_password(password)
            account.user.save(update_fields=["password"])
            account.must_change_password = False
            account.initial_password_expires_at = None
            account.save(update_fields=["must_change_password", "initial_password_expires_at"])
            soul.refresh_from_db(fields=["soul_code"])
            rows.append((UserRole.SOUL, soul.soul_code, password))

        self.stdout.write(f"tenant {tenant.code}. Passwords are shown this once; re-run to get new ones.")
        self.stdout.write("officers sign in on the web / officer app; the soul signs in on the soul app with its soul code.")
        for role, login, password in rows:
            self.stdout.write(f"  {role:<10} {login:<16} {password}")
