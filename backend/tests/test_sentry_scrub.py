"""全项目的 Sentry 打码(config/sentry_scrub.py)。不发网络:直接调 `scrub_event`,另有一条走真的 SDK 客户端
(只换掉传输层)。每条断言秘密不在、同一处的非秘密字段还在。
变异:`recursive=True` 改成 False → 嵌套那几条红;键表去掉 PROJECT_DENYLIST → 键名那几条红;
`_query` 原样返回 → 查询串红;`_strings` 原样返回 → JWT 红。"""

import copy
import json

import pytest
import sentry_sdk
from sentry_sdk.transport import Transport

from config.sentry_scrub import SCRUBBER, scrub_event

SECRET = "s3cr3t-value-9f2"
JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlLXZhbHVl"
KEYS = ["old_password", "new_password", "credential", "mfa_code", "code", "recovery_code",
        "recovery_codes", "signing_secret", "raw", "password", "token", "refresh", "access"]


def _dump(event):
    return json.dumps(event, default=str, ensure_ascii=False)


def _event(payload):
    """每处一份独立的拷贝:同一个 dict 挂在四处时,顶层那处被打码会顺带改掉嵌套的三处,递归与否就测不出来。"""
    def p():
        return copy.deepcopy(payload)
    return {
        "request": {"url": "https://x/api/v1/auth/password/", "data": p(),
                    "headers": {"X-Custom-Auth": f"Bearer {JWT}", "Accept": "application/json"},
                    "query_string": f"t={SECRET}&token={SECRET}&page=2"},
        "breadcrumbs": {"values": [{"category": "httplib", "data": {
            "url": "https://up/x", "http.query": f"signing_secret={SECRET}&q=ok", "nested": {"payload": p()}}}]},
        "exception": {"values": [{"stacktrace": {"frames": [{"function": "save", "module": "apps.users.views", "vars": {
            "validated_data": {"inner": p(), "name": "kept-name"},
            "attrs": [p()],
            "self": "<Serializer>"}}]}}]},
    }


@pytest.mark.parametrize("key", KEYS)
def test_each_sensitive_key_is_removed_everywhere_even_nested(key):
    event = scrub_event(_event({key: SECRET, "username": "kept-user"}), {})
    dumped = _dump(event)
    assert SECRET not in dumped
    assert JWT not in dumped
    assert dumped.count("kept-user") == 4  # request、面包屑、两处栈帧
    assert "kept-name" in dumped and "<Serializer>" in dumped


def test_query_strings_keep_their_harmless_parameters():
    event = scrub_event(_event({"username": "u"}), {})
    assert "page=2" in event["request"]["query_string"]
    assert "q=ok" in event["breadcrumbs"]["values"][0]["data"]["http.query"]
    assert SECRET not in event["request"]["query_string"]


def test_a_jwt_under_an_unlisted_header_is_cut_but_the_header_stays():
    event = scrub_event(_event({}), {})
    headers = event["request"]["headers"]
    assert JWT not in headers["X-Custom-Auth"] and headers["X-Custom-Auth"].startswith("Bearer ")
    assert headers["Accept"] == "application/json"


def test_the_assistant_scrub_still_runs_after_it():
    event = {"request": {"url": "https://x/api/v1/me/assist/", "data": {"question": "原文"}}}
    assert "data" not in scrub_event(event, {})["request"]


class _Capture(Transport):
    def __init__(self, options=None):
        super().__init__(options)
        self.events = []

    def capture_envelope(self, envelope):
        event = envelope.get_event()
        if event:
            self.events.append(event)


def test_a_real_sdk_client_sends_frame_locals_scrubbed():
    """序列化前的 `event_scrubber` 与序列化后的 `before_send` 同一份配置,走 SDK 自己的流水线。"""
    client = sentry_sdk.Client(dsn="https://k@example.invalid/1", transport=_Capture, default_integrations=False,
                               send_default_pii=False, event_scrubber=SCRUBBER, before_send=scrub_event)

    def save(validated_data):
        attrs = {"device": {"credential": SECRET, "label": "kept-label"}}  # noqa: F841
        raise ValueError("boom")

    with sentry_sdk.new_scope() as scope:
        scope.set_client(client)
        try:
            save({"new_password": SECRET, "old_password": SECRET, "username": "kept-user"})
        except ValueError:
            sentry_sdk.capture_exception()
    events = client.transport.events
    assert len(events) == 1
    dumped = _dump(events[0])
    assert "kept-user" in dumped and "kept-label" in dumped
    assert SECRET not in dumped, dumped
