"""
Tests for the two actor-cleanup commands: `consolidate_eu_pantheon` and
`fix_actor_civilization`.

Both commands soft-delete rows, so the property that matters most is the one
they refuse to do: neither may delete a row that something still points at.
That guard is the reason these commands are allowed to run against a real
database at all, and it is the kind of guard that rots silently — a typo in a
related_name turns `_reference_count` into a function that always returns 0,
every conflict branch becomes unreachable, and the commands go on reporting
success while deleting referenced rows. So the conflict paths here are tested
by actually creating the reference and asserting the row survives, never by
asserting on the message alone.
"""
import io

import pytest
from django.core.management import call_command

from apps.actors.models import Actor, ActorRole
from apps.tenants.models import Tenant


def _run(command, **kwargs):
    out = io.StringIO()
    call_command(command, stdout=out, stderr=out, **kwargs)
    return out.getvalue()


@pytest.fixture
def eu_tenant_row(db):
    tenant, _ = Tenant.objects.get_or_create(
        code="EU_HEAVEN_HELL", defaults={"display_name": "European Afterlife"}
    )
    return tenant


@pytest.fixture
def eg_tenant_row(db):
    tenant, _ = Tenant.objects.get_or_create(
        code="EG_DUAT", defaults={"display_name": "Egyptian Afterlife"}
    )
    return tenant


def _actor(tenant, name, civilization, role=ActorRole.GUARDIAN):
    return Actor.all_objects.create(
        name=name, civilization=civilization, role=role, tenant=tenant
    )


# --------------------------------------------------------------------------
# consolidate_eu_pantheon — Norse purge
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_purge_norse_soft_deletes_unreferenced_rows(eu_tenant_row, tmp_path):
    """Norse rows with nothing pointing at them are removed on --purge-norse."""
    for name in ("Odin", "Freya", "Hel", "Valkyries"):
        _actor(eu_tenant_row, name, "EUROPEAN")

    _run(
        "consolidate_eu_pantheon",
        execute=True,
        purge_norse=True,
        backup_dir=str(tmp_path),
    )

    survivors = sorted(
        Actor.objects.filter(name__in=["Odin", "Freya", "Hel", "Valkyries"])
        .values_list("name", flat=True)
    )
    assert not survivors, (
        f"--purge-norse left Norse actors live in the database: {survivors}"
    )
    # Soft-deleted, not hard-deleted — the rows must still be recoverable.
    remaining = Actor.all_objects.filter(
        name__in=["Odin", "Freya", "Hel", "Valkyries"], is_deleted=True
    ).count()
    assert remaining == 4, (
        f"Expected 4 soft-deleted Norse rows to remain recoverable, found {remaining}. "
        f"--purge-norse must soft-delete, never hard-delete."
    )


@pytest.mark.django_db
def test_purge_norse_is_opt_in(eu_tenant_row, tmp_path):
    """Without the flag the rows are reported but untouched."""
    _actor(eu_tenant_row, "Odin", "EUROPEAN")

    output = _run("consolidate_eu_pantheon", execute=True, backup_dir=str(tmp_path))

    assert Actor.objects.filter(name="Odin").exists(), (
        "consolidate_eu_pantheon deleted a Norse actor without --purge-norse. "
        "Deleting data must stay opt-in.\n" + output
    )
    assert "Odin" in output, (
        f"The leftover Norse row was neither deleted nor reported — it is invisible.\n{output}"
    )


@pytest.mark.django_db
def test_purge_norse_refuses_to_delete_a_referenced_row(
    eu_tenant_row, django_user_model, tmp_path
):
    """A Norse actor a User is linked to survives the purge.

    This is the guard, exercised against a real FK rather than a mocked count.
    Soft-deleting a referenced actor would leave User.actor pointing at a row
    the default manager filters out.
    """
    odin = _actor(eu_tenant_row, "Odin", "EUROPEAN")
    freya = _actor(eu_tenant_row, "Freya", "EUROPEAN")
    django_user_model.objects.create(
        username="valhalla-clerk", role="ADMIN", tenant=eu_tenant_row, actor=odin
    )

    output = _run(
        "consolidate_eu_pantheon",
        execute=True,
        purge_norse=True,
        backup_dir=str(tmp_path),
    )

    odin.refresh_from_db()
    freya.refresh_from_db()
    assert not odin.is_deleted, (
        "consolidate_eu_pantheon --purge-norse soft-deleted Odin while a User row "
        "still pointed at him. The live-reference check did not fire.\n" + output
    )
    assert "CONFLICT" in output, (
        f"Odin survived but no conflict was reported, so nobody would know the "
        f"purge was incomplete.\n{output}"
    )
    assert freya.is_deleted, (
        "One referenced row stopped the whole purge. Unreferenced Norse rows "
        "should still be removed.\n" + output
    )


# --------------------------------------------------------------------------
# consolidate_eu_pantheon — Pluto/Hades merge
# --------------------------------------------------------------------------


# THE TWO PLUTO/HADES MERGE TESTS THAT USED TO BE HERE ARE GONE.
#
# They pinned `consolidate_eu_pantheon`'s Step 1 -- that Hades survives a tie
# regardless of insertion order, and that the command refuses when both rows
# are referenced. The step itself was retired on 2026-08-31: Dante's Pluto is
# a distinct figure from the Greek Πλούτων and is now seeded as the fourth
# circle's warden, so there is no pair to merge. See the note in
# `apps/actors/mythology/actors_european.py` and the retired-step paragraph in
# the command.
#
# Deleting them rather than rewriting them is the point. A test that pins a
# removed behaviour has to be either deleted or inverted, and inverting these
# would produce "the command does not merge Pluto into Hades" -- a sentence
# true of every command in the repository, and therefore worth nothing. What
# replaces them is `tests/test_dantes_pluto_is_his_own_row.py`, which asserts
# the two rows coexist and that neither resolver nor cleanup collapses them.


def test_maat_is_renamed_to_the_canonical_spelling_when_alone(eg_tenant_row, tmp_path):
    """A lone "Maat" row becomes "Ma'at" — a rename, so references travel with it.

    Deleting it instead would drop whatever pointed at the goddess; there is no
    other row to re-point at.
    """
    maat = _actor(eg_tenant_row, "Maat", "EGYPTIAN", ActorRole.JUDGE)

    _run("fix_actor_civilization", execute=True, backup_dir=str(tmp_path))

    maat.refresh_from_db()
    assert maat.name == "Ma'at", (
        f"The lone 'Maat' row was not renamed to the canonical spelling; "
        f"name is still {maat.name!r}."
    )
    assert not maat.is_deleted, (
        "'Maat' was soft-deleted instead of renamed. With no 'Ma'at' row to "
        "merge into, deleting it loses the goddess entirely."
    )


@pytest.mark.django_db
def test_maat_duplicate_is_merged_into_maat_with_apostrophe(eg_tenant_row, tmp_path):
    canonical = _actor(eg_tenant_row, "Ma'at", "EGYPTIAN", ActorRole.JUDGE)
    duplicate = _actor(eg_tenant_row, "Maat", "EGYPTIAN", ActorRole.JUDGE)

    _run("fix_actor_civilization", execute=True, backup_dir=str(tmp_path))

    canonical.refresh_from_db()
    duplicate.refresh_from_db()
    assert not canonical.is_deleted, (
        "The apostrophe spelling is canonical, but it is the row that got deleted."
    )
    assert duplicate.is_deleted, (
        "Both Ma'at spellings are still live — the spelling merge did not run. "
        "Step 2's dedupe matches on exact name and cannot see this pair."
    )


@pytest.mark.django_db
def test_rename_refuses_when_a_soft_deleted_row_holds_the_canonical_name(
    eg_tenant_row, tmp_path
):
    """A buried "Ma'at" blocks the rename instead of crashing the command.

    `Actor.objects` hides soft-deleted rows but unique_actor_tenant_civ_name
    does not, so renaming into a name a deleted row still occupies raises
    IntegrityError — halfway through a run that has already written other
    changes.
    """
    buried = _actor(eg_tenant_row, "Ma'at", "EGYPTIAN", ActorRole.JUDGE)
    buried.soft_delete(reason="earlier cleanup")
    duplicate = _actor(eg_tenant_row, "Maat", "EGYPTIAN", ActorRole.JUDGE)

    output = _run("fix_actor_civilization", execute=True, backup_dir=str(tmp_path))

    duplicate.refresh_from_db()
    assert duplicate.name == "Maat", (
        "The rename went ahead despite a soft-deleted row holding the canonical "
        "name. That row still occupies the unique constraint.\n" + output
    )
    assert "CONFLICT" in output, (
        f"The rename was skipped silently — nobody would know the pair is still "
        f"unmerged.\n{output}"
    )


@pytest.mark.django_db
def test_referenced_maat_duplicate_is_not_deleted(
    eg_tenant_row, django_user_model, tmp_path
):
    canonical = _actor(eg_tenant_row, "Ma'at", "EGYPTIAN", ActorRole.JUDGE)
    duplicate = _actor(eg_tenant_row, "Maat", "EGYPTIAN", ActorRole.JUDGE)
    django_user_model.objects.create(
        username="hall-scribe", role="ADMIN", tenant=eg_tenant_row, actor=duplicate
    )

    output = _run("fix_actor_civilization", execute=True, backup_dir=str(tmp_path))

    canonical.refresh_from_db()
    duplicate.refresh_from_db()
    assert not duplicate.is_deleted, (
        "The 'Maat' row was soft-deleted while a User still pointed at it.\n" + output
    )
    assert "CONFLICT" in output, (
        f"The referenced duplicate survived but nothing was reported, so the "
        f"unmerged pair stays invisible.\n{output}"
    )
