"""A socket opened without `?token=` gets `AUTH_DEADLINE_SECONDS` to send its auth frame (audit 2026-11-11 A2-05).

Before: accepted and left open with no deadline — it joined no group, but held a connection indefinitely.
The deadline is shortened here; the authenticated socket outliving it proves the timer is cancelled, not just late.
"""
import asyncio

import pytest
from channels.testing import WebsocketCommunicator

from apps.notifications import consumers
from tests.test_ws_first_frame_auth_gates_like_query_token import _make_token, _make_users

DEADLINE = 0.2


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_an_anonymous_socket_is_closed_at_the_deadline(monkeypatch):
    from config.asgi import application

    monkeypatch.setattr(consumers, "AUTH_DEADLINE_SECONDS", DEADLINE)
    comm = WebsocketCommunicator(application, "/ws/notifications/")
    connected, _ = await comm.connect()
    assert connected
    closed = await comm.receive_output(timeout=5)
    assert closed == {"type": "websocket.close", "code": 4001}, closed
    await comm.disconnect()


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_a_socket_that_authenticates_in_time_stays_open(monkeypatch):
    from config.asgi import application

    monkeypatch.setattr(consumers, "AUTH_DEADLINE_SECONDS", DEADLINE)
    judge, _, tenant = await _make_users()
    comm = WebsocketCommunicator(application, "/ws/notifications/")
    connected, _ = await comm.connect()
    assert connected
    await comm.send_json_to({"type": "auth", "token": await _make_token(judge, tenant.code)})
    assert (await comm.receive_json_from(timeout=10))["type"] == "connected"
    await asyncio.sleep(DEADLINE * 3)
    await comm.send_json_to({"type": "heartbeat"})
    assert await comm.receive_json_from(timeout=5) == {"type": "pong"}
    await comm.disconnect()
