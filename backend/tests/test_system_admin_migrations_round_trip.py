"""`authentication/0030` and `perm/0038`+`0039` (stage 1A, §7.5) run backward and forward again on historical models.

`test_system_admin_bootstrap.py` calls 0030's `backfill` / `seed_system_admin` with the *live* models and never runs
a reverse. Here the real graph is migrated: forward (backfill + seed), backward (unbackfill + unseed, the column
gone), forward again — asserted on rows, with `tests/migration_roundtrip.py`'s harness (it also asserts the reverse
restores the pre-migration snapshot, and the second forward equals the first).
"""
from django.conf import settings

from tests.migration_roundtrip import snapshot_rows

SYS = settings.SYSTEM_ADMIN_USERNAME
#: username -> (role at 0029, hall code or None, hall code of the user's actor or None)
PEOPLE = {
    "mig-civ-cn": ("ADMIN", None, "CN_DIYU"),        # seeded hall by code -> CHINESE
    "mig-civ-eu": ("ADMIN", None, "MIG_EU_X"),       # declared EUROPEAN -> EUROPEAN
    "mig-no-civ": ("ADMIN", None, "MIG_BLANK"),      # hall of no civilization -> promoted
    "mig-no-actor": ("ADMIN", None, None),           # no actor -> promoted
    "mig-hall-admin": ("ADMIN", "CN_DIYU", None),    # bound to a hall: not touched
    "mig-judge": ("JUDGE", "CN_DIYU", "CN_DIYU"),    # not an administrator: not touched
}


def _seed_users(apps):
    Tenant = apps.get_model("tenants", "Tenant")
    Actor = apps.get_model("actors", "Actor")
    User = apps.get_model("authentication", "User")
    halls = {
        "CN_DIYU": Tenant._base_manager.get_or_create(code="CN_DIYU", defaults={"display_name": "CN"})[0],
        "MIG_EU_X": Tenant._base_manager.create(code="MIG_EU_X", display_name="eu", declared_civilization="EUROPEAN"),
        "MIG_BLANK": Tenant._base_manager.create(code="MIG_BLANK", display_name="blank", declared_civilization=""),
    }
    for username, (role, hall, actor_hall) in PEOPLE.items():
        actor = None
        if actor_hall:
            actor = Actor._base_manager.create(name=f"actor-{username}", role="JUDGE", civilization="CHINESE",
                                               tenant=halls[actor_hall])
        User._base_manager.create(username=username, password="x", role=role,
                                  tenant=halls[hall] if hall else None, actor=actor)


def _users(apps):
    User = apps.get_model("authentication", "User")
    has_civ = any(f.name == "civilization" for f in User._meta.get_fields())
    fields = {"role": "role", "pk": "pk", "active": "is_active"}
    if has_civ:
        fields["civilization"] = "civilization"
    # Live rows only: the reverse soft-deletes the seeded account, which 0029 never had.
    return snapshot_rows(User._base_manager.filter(is_deleted=False, username__in=[*PEOPLE, SYS]),
                         key="username", fields=fields)


def _check_users_forward(apps):
    rows = _users(apps)
    assert rows["mig-civ-cn"] == {**rows["mig-civ-cn"], "role": "ADMIN", "civilization": "CHINESE"}
    assert rows["mig-civ-eu"] == {**rows["mig-civ-eu"], "role": "ADMIN", "civilization": "EUROPEAN"}
    for promoted in ("mig-no-civ", "mig-no-actor"):
        assert rows[promoted]["role"] == "SYSTEM_ADMIN" and rows[promoted]["civilization"] is None, rows[promoted]
    for untouched in ("mig-hall-admin", "mig-judge"):
        assert rows[untouched]["civilization"] is None and rows[untouched]["role"] != "SYSTEM_ADMIN", rows[untouched]
    seeded = apps.get_model("authentication", "User")._base_manager.get(username=SYS)
    assert (seeded.role, seeded.tenant_id, seeded.civilization, seeded.is_active) == ("SYSTEM_ADMIN", None, None, True)
    assert seeded.password.startswith("!")  # unusable: it cannot sign in until bootstrap_system_admin


def _check_users_reverse(apps):
    User = apps.get_model("authentication", "User")
    assert not any(f.name == "civilization" for f in User._meta.get_fields())
    assert not User._base_manager.filter(role="SYSTEM_ADMIN", is_deleted=False).exclude(username=SYS).exists()
    assert User._base_manager.get(username="mig-no-civ").role == "ADMIN"
    seeded = User._base_manager.get(username=SYS)
    assert seeded.is_deleted and not seeded.is_active  # soft-deleted, kept for the next forward to restore


def test_authentication_0030_round_trip(migration_round_trip):
    """The snapshot carries the seeded account's pk, so "the second forward equals the first" also says the seed
    restored the soft-deleted row rather than making another account."""
    migration_round_trip(
        before=("authentication", "0029_officer_device_login"),
        after=("authentication", "0030_system_admin"),
        seed=_seed_users,
        snapshot=_users,
        check_forward=_check_users_forward,
        check_reverse=_check_users_reverse,
    )


def _grants(apps):
    Role = apps.get_model("perm", "Role")
    RolePermission = apps.get_model("perm", "RolePermission")
    Permission = apps.get_model("perm", "Permission")
    out = snapshot_rows(
        Role.all_objects.filter(is_deleted=False, name__in=["ADMIN", "SYSTEM_ADMIN"]), key="name",
        fields={"grants": lambda role: sorted(RolePermission.all_objects.filter(
            role=role, is_deleted=False).values_list("permission__codename", flat=True))})
    out["cross"] = {"rows": list(Permission.all_objects.filter(codename="system.cross_civilization")
                                 .values_list("is_deleted", "name_en"))}
    return out


def _check_grants_forward(apps):
    rows = _grants(apps)
    assert rows["SYSTEM_ADMIN"]["grants"] == sorted([*rows["ADMIN"]["grants"], "system.cross_civilization"])
    assert {"mig.read", "mig.manage"} <= set(rows["SYSTEM_ADMIN"]["grants"])
    assert "mig.gone" not in rows["SYSTEM_ADMIN"]["grants"]  # a revoked ADMIN grant is not copied
    assert "system.cross_civilization" not in rows["ADMIN"]["grants"]
    assert rows["cross"]["rows"] == [(False, "Manage across civilizations")]  # 0039 filled the English name


def _check_grants_reverse(apps):
    rows = _grants(apps)
    assert "SYSTEM_ADMIN" not in rows and rows["cross"]["rows"] == []
    Role = apps.get_model("perm", "Role")
    assert Role.all_objects.filter(name="SYSTEM_ADMIN", is_deleted=True).exists()  # soft-deleted, not destroyed


def _seed_admin_grants(apps):
    """ADMIN with two grants, one of them soft-deleted (0038 copies live grants only). A transactional test starts
    from a flushed database, so the role rows earlier data migrations seeded are not there."""
    Role = apps.get_model("perm", "Role")
    Permission = apps.get_model("perm", "Permission")
    RolePermission = apps.get_model("perm", "RolePermission")
    admin, _ = Role.all_objects.get_or_create(name="ADMIN", is_deleted=False, defaults={"display_name": "Admin"})
    for codename, deleted in (("mig.read", False), ("mig.manage", False), ("mig.gone", True)):
        perm = Permission.all_objects.create(codename=codename, name=codename, category="mig")
        RolePermission.all_objects.create(role=admin, permission=perm, is_deleted=deleted)


def test_perm_0038_0039_round_trip(migration_round_trip):
    migration_round_trip(
        before=("perm", "0037_moderator_display_name"),
        after=("perm", "0039_cross_civilization_english"),
        seed=_seed_admin_grants,
        snapshot=_grants,
        check_forward=_check_grants_forward,
        check_reverse=_check_grants_reverse,
    )
