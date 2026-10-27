"""Anubis is not a judge (docs/01_埃及冥界整体架构.md §1.2; egypt-docs review 2026-10-27 #12).

`actors/0013` moves seeded rows JUDGE → CONDUIT and only those; what the role decides is the cross-hall seat:
CO_JUDGE / CHAIRMAN take JUDGE actors only (apps/dispatch/services.py SEAT_ACTOR_ROLES).
"""
import importlib

import pytest
from django.apps import apps as django_apps

from apps.actors.models import Actor, ActorRole
from apps.dispatch.models import ParticipantRole
from apps.dispatch.services import SEAT_ACTOR_ROLES
from tests.migration_schema_editor import SCHEMA_EDITOR

migration = importlib.import_module("apps.actors.migrations.0013_anubis_is_a_conduit")


@pytest.mark.django_db
def test_the_migration_moves_only_egyptian_anubis_off_judge():
    anubis = Actor.objects.create(name="Anubis", civilization="EGYPTIAN", role=ActorRole.JUDGE)
    thoth = Actor.objects.create(name="Thoth", civilization="EGYPTIAN", role=ActorRole.JUDGE)
    migration.forward(django_apps, SCHEMA_EDITOR)
    anubis.refresh_from_db()
    thoth.refresh_from_db()
    assert (anubis.role, thoth.role) == (ActorRole.CONDUIT, ActorRole.JUDGE)
    migration.backward(django_apps, SCHEMA_EDITOR)
    anubis.refresh_from_db()
    assert anubis.role == ActorRole.JUDGE


def test_a_conduit_cannot_sit_as_co_judge_or_chairman():
    assert ActorRole.CONDUIT not in SEAT_ACTOR_ROLES[ParticipantRole.CO_JUDGE]
    assert ActorRole.CONDUIT not in SEAT_ACTOR_ROLES[ParticipantRole.CHAIRMAN]
    assert ActorRole.CONDUIT in SEAT_ACTOR_ROLES[ParticipantRole.ADVISOR]
