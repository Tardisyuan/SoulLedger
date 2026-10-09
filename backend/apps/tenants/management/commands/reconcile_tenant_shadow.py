"""Guard G7 (docs/ARCHITECTURE-tenant-sharding.md 4.1, stage 2 of 4.2): compare one
tenant's rows in `default` with the same tenant's rows in a shadow database.

    manage.py reconcile_tenant_shadow --tenant CN [--alias tenant_shadow]

Per tenant-scoped model (one with a `tenant` FK) it compares the row count and a
content hash over (pk, stamp), where stamp is `update_time` / `updated_at` when the
model has one, else every concrete column. Soft-deleted rows count: the shadow must
carry them too. Prints every mismatch with the model and pk, exits 1 on any.
"""
import hashlib

from django.apps import apps
from django.core.management.base import BaseCommand, CommandError
from django.db import connections, models

STAMPS = ("update_time", "updated_at")


def tenant_scoped_models():
    Tenant = apps.get_model("tenants", "Tenant")
    return sorted(
        (
            m for m in apps.get_models()
            if any(
                isinstance(f, models.ForeignKey) and f.name == "tenant" and f.related_model is Tenant
                for f in m._meta.concrete_fields
            )
        ),
        key=lambda m: m._meta.label,
    )


def fingerprints(model, alias, tenant_id):
    """{pk: stamp-string} for the tenant's rows in one database."""
    names = {f.name for f in model._meta.concrete_fields}
    stamp = [n for n in STAMPS if n in names][:1] or [f.attname for f in model._meta.concrete_fields]
    rows = model._base_manager.using(alias).filter(tenant_id=tenant_id).values_list("pk", *stamp)
    return {str(r[0]): "|".join(map(repr, r[1:])) for r in rows}


def digest(rows):
    h = hashlib.sha256()
    for pk in sorted(rows):
        h.update(f"{pk}={rows[pk]}\n".encode())
    return h.hexdigest()[:12]


def compare(model, alias, tenant_id):
    """List of mismatch lines for one model; empty when the two sides agree."""
    a, b = fingerprints(model, "default", tenant_id), fingerprints(model, alias, tenant_id)
    if a == b:
        return []
    label = model._meta.label
    out = [f"{label}: count default={len(a)} {alias}={len(b)}, hash default={digest(a)} {alias}={digest(b)}"]
    out += [f"  {label} pk={pk} missing in {alias}" for pk in sorted(a.keys() - b.keys())]
    out += [f"  {label} pk={pk} only in {alias}" for pk in sorted(b.keys() - a.keys())]
    out += [f"  {label} pk={pk} differs" for pk in sorted(k for k in a.keys() & b.keys() if a[k] != b[k])]
    return out


class Command(BaseCommand):
    help = "Compare one tenant's rows in `default` with a shadow database; exit 1 on any mismatch."

    def add_arguments(self, parser):
        parser.add_argument("--tenant", required=True, help="Tenant code")
        parser.add_argument("--alias", default="tenant_shadow", help="Shadow database alias")

    def handle(self, *args, tenant, alias, **options):
        if alias not in connections:
            raise CommandError(f"no database alias {alias!r} is configured")
        Tenant = apps.get_model("tenants", "Tenant")
        # The Tenant table is the control record; `default` is the source of truth for it.
        try:
            tenant_id = Tenant.objects.using("default").get(code=tenant).pk
        except Tenant.DoesNotExist:
            raise CommandError(f"no tenant with code {tenant!r}") from None
        bad = []
        for model in tenant_scoped_models():
            lines = compare(model, alias, tenant_id)
            bad += lines
            if not lines:
                self.stdout.write(f"ok  {model._meta.label}")
        for line in bad:
            self.stdout.write(line)
        if bad:
            raise CommandError(f"{sum(not x.startswith(' ') for x in bad)} model(s) differ between default and {alias}")
