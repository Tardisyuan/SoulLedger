"""Give the seeded system administrator (authentication/0030) a password. Runs after `migrate` in docker-compose.

Source, in order: the file named by `SYSTEM_ADMIN_PASSWORD_FILE` (a mounted secret — preferred), then
`SYSTEM_ADMIN_PASSWORD` (works, with a warning: an environment variable shows up in `docker inspect` and
process listings). Either goes through `validate_password`; a weak one is a non-zero exit and changes nothing.

With neither, and the account has no usable password yet: a random one (`secrets.token_urlsafe(18)`) is
printed **once** and `must_change_password` is set, so the first sign-in has to replace it.

An account that already has a usable password is never rotated — every container start runs this — unless
`--reset` is given. Then the same sources apply, and with neither a new random one is printed.
"""
import os
import secrets

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError

from apps.authentication.models import UserRole
from apps.authentication.passwords import set_officer_password


def _supplied_password(stderr):
    path = os.environ.get("SYSTEM_ADMIN_PASSWORD_FILE", "").strip()
    if path:
        try:
            with open(path, encoding="utf-8") as fh:
                return fh.read().rstrip("\r\n")
        except OSError as exc:
            raise CommandError(f"SYSTEM_ADMIN_PASSWORD_FILE: cannot read {path}: {exc.strerror}") from None
    value = os.environ.get("SYSTEM_ADMIN_PASSWORD", "")
    if value:
        stderr.write("warning: SYSTEM_ADMIN_PASSWORD is set in the environment; prefer SYSTEM_ADMIN_PASSWORD_FILE.")
        return value
    return None


class Command(BaseCommand):
    help = "Set the system administrator's password from SYSTEM_ADMIN_PASSWORD_FILE / SYSTEM_ADMIN_PASSWORD."

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true",
                            help="Replace the password even if one is already set.")

    def handle(self, *args, reset=False, **options):
        username = settings.SYSTEM_ADMIN_USERNAME
        user = get_user_model().objects.filter(username=username, role=UserRole.SYSTEM_ADMIN).first()
        if user is None:
            raise CommandError(f"No system administrator {username!r}: run `manage.py migrate` first.")
        if user.has_usable_password() and not reset:
            self.stdout.write(f"{username}: password already set; nothing changed (use --reset to replace it).")
            return

        password = _supplied_password(self.stderr)
        if password is not None:
            try:
                validate_password(password, user)
            except ValidationError as exc:
                raise CommandError(f"{username}: password rejected: {' '.join(exc.messages)}") from None
            set_officer_password(user, password, must_change=False)
            self.stdout.write(f"{username}: password set.")
            return

        generated = secrets.token_urlsafe(18)
        set_officer_password(user, generated, must_change=True)
        self.stdout.write(f"{username}: generated password (shown once, must be changed at first sign-in): {generated}")
