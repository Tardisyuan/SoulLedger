"""Officer accounts for seeds: shared by `manage.py seed_dev_users` and `scripts/demo-seed.py`.

Not for production data: callers decide the password, and `seed_dev_users` refuses outside DEBUG.
"""
from apps.authentication.models import User


def ensure_officer(username, display, role, tenant, password, *, reset_password=False):
    """Get or create `username`; keep role / display name / tenant in line with the arguments.

    The password is set on creation, and again on every call when `reset_password` is true.
    """
    user, created = User.objects.get_or_create(username=username, defaults=dict(
        role=role, tenant=tenant, display_name=display, email=f"{username}@underworld.example"))
    if created or reset_password:
        user.set_password(password)
        user.must_change_password = False
        user.save()
    if (user.role, user.display_name, user.tenant_id) != (role, display, getattr(tenant, "pk", None)):
        # A database seeded before the 2026-11-07 roles keeps the old name / role otherwise (get_or_create).
        user.role, user.display_name, user.tenant = role, display, tenant
        user.save(update_fields=["role", "display_name", "tenant"])
    return user
