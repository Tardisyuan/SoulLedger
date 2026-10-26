"""Synapse is never called per room from inside a web request.

`GET /me/chat/session/`, a mute and a dispatch used to run one Synapse GET per
open conversation before answering (5 s connect + 20 s read per room when
Synapse is slow). They now enqueue a celery task; the task does the walk.
Mutation: put `sync_rooms(...)` back into `chat_session` or the signal -> red.
"""
from unittest.mock import MagicMock

import pytest

from apps.chat import tasks
from apps.chat.models import Conversation, ConversationKind
from apps.social import moderation
from tests.chat_support import FakeMatrix, matrix, mutual  # noqa: F401
from tests.soul_account_support import ready_soul

pytestmark = pytest.mark.django_db

CONVERSATIONS = "/api/v1/me/chat/conversations/"


@pytest.fixture
def many_rooms(cn_tenant, matrix):  # noqa: F811
    a, a_client = ready_soul(cn_tenant, name="甲")
    for i in range(5):
        b, _ = ready_soul(cn_tenant, name=f"乙{i}")
        mutual(a, b)
        assert a_client.post(CONVERSATIONS, {"target_user": b.user_id}, format="json").status_code == 201
    assert Conversation.objects.filter(kind=ConversationKind.DIRECT).count() == 5
    return a, a_client


@pytest.fixture
def queued(monkeypatch):
    spy = MagicMock()
    monkeypatch.setattr(tasks.sync_rooms_task, "delay", spy)
    levels = MagicMock()
    monkeypatch.setattr(FakeMatrix, "set_user_levels", levels)
    return spy, levels


def test_the_session_answers_without_touching_any_room(many_rooms, queued):
    a, client = many_rooms
    spy, levels = queued
    response = client.get("/api/v1/me/chat/session/")
    assert response.status_code == 200 and response.data["token"]
    levels.assert_not_called()  # no per-room Synapse call in the request
    spy.assert_called_once_with(a.soul_id)  # one task for all rooms, not one call per room


def test_a_mute_enqueues_instead_of_calling_synapse(many_rooms, queued, cn_tenant, django_capture_on_commit_callbacks):
    a, _ = many_rooms
    spy, levels = queued
    with django_capture_on_commit_callbacks(execute=True):
        moderation.mute_user(a.user, cn_tenant, 3, actor=None)
    levels.assert_not_called()
    spy.assert_called_once_with(a.soul_id)


def test_the_task_does_the_walk_and_survives_synapse_being_down(many_rooms, monkeypatch):
    a, _ = many_rooms
    levels = MagicMock()
    monkeypatch.setattr(FakeMatrix, "set_user_levels", levels)
    tasks.sync_rooms_task.run(a.soul_id)
    assert levels.call_count == 5

    from apps.chat.matrix import MatrixError

    levels.side_effect = MatrixError("down")
    tasks.sync_rooms_task.run(a.soul_id)  # logged, not raised
    tasks.sync_rooms_task.run(999999999)  # soul gone: nothing to do
