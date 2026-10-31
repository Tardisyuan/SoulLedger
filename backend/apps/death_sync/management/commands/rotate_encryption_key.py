"""Re-encrypt every encrypted column under the current ENCRYPTION_KEY (docs/DEPLOYMENT.md「密钥轮换」).

Run after moving the old key into ENCRYPTION_KEY_FALLBACKS and the new one into ENCRYPTION_KEY, on every
process. Each value is read with every configured key and written back with the first; afterwards the old key
can be dropped. Idempotent: a second run re-encrypts under the same key.

Plain JSON in an encrypted JSON column (written while DEBUG ran without a key) is encrypted like any other value:
it cannot be mistaken for a token (`encrypted_json.decode_stored`). A value no configured key can read (a ciphertext
under a key you no longer list, or a plain string in an encrypted char column) is left untouched and counted; any such value makes the command exit non-zero, because
dropping the fallback then would make those rows unreadable for good.

Rows are found through `_base_manager` (soft-deleted and every hall's rows too: a key rotation that skipped
them would strand them under the old key) and rewritten one at a time under a row lock, with `.update()` — no
save signals, no audit rows, `update_time` untouched.
"""
from cryptography.fernet import InvalidToken
from django.apps import apps
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.death_sync.encrypted_json import EncryptedJSONTextField
from apps.death_sync.fields import EncryptedCharField, strict_reads


def encrypted_fields():
    """[(model, [field names])] for every installed model with an encrypted column."""
    found = []
    for model in apps.get_models():
        names = [f.name for f in model._meta.concrete_fields if isinstance(f, (EncryptedCharField, EncryptedJSONTextField))]
        if names:
            found.append((model, names))
    return found


def _rotate_model(model, names, dry_run):
    manager = model._base_manager
    rotated = unreadable = 0
    for pk in manager.order_by("pk").values_list("pk", flat=True):
        for name in names:
            with transaction.atomic():
                rows = manager.filter(pk=pk)
                try:
                    value = rows.select_for_update().values_list(name, flat=True).get()
                except InvalidToken:
                    unreadable += 1
                    continue
                if value is None:
                    continue
                if not dry_run:
                    rows.update(**{name: value})
                rotated += 1
    return rotated, unreadable


def rotate(*, dry_run=False):
    """{"app_label.Model.field...": (rotated, unreadable)}"""
    token = strict_reads.set(True)
    try:
        return {
            f"{model._meta.label}.{'/'.join(names)}": _rotate_model(model, names, dry_run)
            for model, names in encrypted_fields()
        }
    finally:
        strict_reads.reset(token)


class Command(BaseCommand):
    help = "Re-encrypt every encrypted column under ENCRYPTION_KEY (after a key rotation)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Count what would be rewritten; write nothing.")

    def handle(self, *args, dry_run=False, **options):
        if not settings.ENCRYPTION_KEY:
            raise CommandError("ENCRYPTION_KEY is not set: there is nothing to rotate to.")
        result = rotate(dry_run=dry_run)
        verb = "would re-encrypt" if dry_run else "re-encrypted"
        for label, (rotated, unreadable) in result.items():
            self.stdout.write(f"{label}: {verb} {rotated}, unreadable {unreadable}")
        stuck = sum(unreadable for _, unreadable in result.values())
        if stuck:
            raise CommandError(
                f"{stuck} value(s) could not be read with any configured key and were left as they are. "
                "Do NOT drop ENCRYPTION_KEY_FALLBACKS until they are accounted for."
            )
