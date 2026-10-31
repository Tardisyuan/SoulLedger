"""助手管理页的两个出网点(`platforms._get` 列模型、`vectors._post` 取向量)连上之后查对端、不跟重定向
(审查 2026-10-31 A9)。此前是裸 `requests`:跟随重定向,只在保存时解析一次 DNS。

根 conftest 把这两个函数换成「连不上」;这里在 import 时留住真的那份,只对本机起的服务器发请求。
变异:`_get` / `_post` 换回裸 `requests.get/post` → 私网与假 DNS 那几条红;去掉 `allow_redirects=False`
→ 重定向那两条红(变成去连 169.254.169.254,超时);`session_for` 不认放行主机 → 放行那两条红。
"""
import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest.mock import patch

import pytest
from django.test import override_settings

from apps.soul_assist import config, platforms, vectors

REAL_GET = platforms._get
REAL_POST = vectors._post
_real_getaddrinfo = socket.getaddrinfo
METADATA = "http://169.254.169.254/latest/meta-data/"


class _Handler(BaseHTTPRequestHandler):
    def _answer(self):
        if self.path.startswith("/redirect"):
            self.send_response(302)
            self.send_header("Location", METADATA)
            self.end_headers()
            return
        body = json.dumps({"data": [{"id": "m1"}], "embeddings": [[0.1]]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_GET = do_POST = _answer  # noqa: N815

    def log_message(self, *args):
        pass


@pytest.fixture
def port():
    server = HTTPServer(("127.0.0.1", 0), _Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield server.server_address[1]
    server.shutdown()


def _dns(name):
    """`name` 解析到 127.0.0.1(模拟一个公网样子的名字其实指向本机),别的照常。"""
    def fake(host, *args, **kwargs):
        if host == name:
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", args[0] if args else 0))]
        return _real_getaddrinfo(host, *args, **kwargs)
    return fake


def _conn(base_url):
    return config.Connection(provider=config.provider_path("openai_compatible"), base_url=base_url, api_key="",
                             model="m", effort="", fallbacks="")


NOTHING_ALLOWED = dict(ASSISTANT_PRIVATE_HOSTS_ALLOWED=[], ASSISTANT_BASE_URL="", ASSISTANT_EMBEDDING_URL="")


@override_settings(**NOTHING_ALLOWED)
def test_a_private_target_is_refused_on_both_paths(port):
    with pytest.raises(ValueError, match="127.0.0.1"):
        REAL_GET(f"http://127.0.0.1:{port}/models", {}, 5)
    with pytest.raises(vectors.EmbeddingError) as err:
        REAL_POST(f"http://127.0.0.1:{port}/api/embed", {}, 5)
    assert err.value.kind == "connection" and "private_address" in str(err.value)


@override_settings(**NOTHING_ALLOWED)
def test_a_public_looking_name_that_resolves_private_at_connect_time_is_refused(port, monkeypatch):
    monkeypatch.setattr(platforms, "_get", REAL_GET)
    with patch("socket.getaddrinfo", side_effect=_dns("llm.example")):
        result = platforms.list_models(_conn(f"http://llm.example:{port}"))
    assert result == {"status": "failed", "error_kind": "connection", "models": []}


@override_settings(ASSISTANT_PRIVATE_HOSTS_ALLOWED=["ollama.lan"], ASSISTANT_BASE_URL="", ASSISTANT_EMBEDDING_URL="")
def test_a_redirect_to_the_metadata_address_is_not_followed(port, monkeypatch):
    monkeypatch.setattr(platforms, "_get", REAL_GET)
    with patch("socket.getaddrinfo", side_effect=_dns("ollama.lan")):
        resp = REAL_GET(f"http://ollama.lan:{port}/redirect", {}, 1)
        assert resp.status_code == 302 and resp.headers["Location"] == METADATA
        listed = platforms.list_models(_conn(f"http://ollama.lan:{port}/redirect"))
        assert listed["error_kind"] == "other"
        with pytest.raises(vectors.EmbeddingError) as err:
            REAL_POST(f"http://ollama.lan:{port}/redirect", {}, 1)
    assert err.value.kind == "other" and "302" in str(err.value)


@override_settings(ASSISTANT_PRIVATE_HOSTS_ALLOWED=["ollama.lan", "127.0.0.1"], ASSISTANT_BASE_URL="",
                   ASSISTANT_EMBEDDING_URL="")
def test_allowed_private_hosts_still_work(port, monkeypatch):
    monkeypatch.setattr(platforms, "_get", REAL_GET)
    assert REAL_GET(f"http://127.0.0.1:{port}/models", {}, 5).status_code == 200
    with patch("socket.getaddrinfo", side_effect=_dns("ollama.lan")):
        assert REAL_POST(f"http://ollama.lan:{port}/api/embed", {}, 5) == {"data": [{"id": "m1"}], "embeddings": [[0.1]]}
        listed = platforms.list_models(_conn(f"http://ollama.lan:{port}"))
    assert listed["status"] == "ok" and [m["name"] for m in listed["models"]] == ["m1"]


@override_settings(ASSISTANT_PRIVATE_HOSTS_ALLOWED=[], ASSISTANT_BASE_URL="",
                   ASSISTANT_EMBEDDING_URL="http://127.0.0.1:1/api/embed")
def test_the_env_configured_embedding_host_counts_as_allowed(port):
    """env 里配的地址的主机与保存时同一份放行(config.private_hosts_allowed)。"""
    assert REAL_POST(f"http://127.0.0.1:{port}/api/embed", {}, 5)["embeddings"] == [[0.1]]
