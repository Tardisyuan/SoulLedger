"""对话走的 openai / anthropic SDK 也在连接时查对端、不跟重定向(审查 2026-10-31 A9 补)。

保存时解析不出的模型地址会被放过(admin_serializers),之后它若指向内网，此前对话请求照样连过去。
现在两个 SDK 都拿 `outbound.public_only_http_client`。对本机起的服务器发请求,DNS 用 mock。
变异:providers 里去掉 `http_client=_http_client()` → 拒绝那几条红;`follow_redirects=False` 改 True
→ 重定向那条红;`_Backend` 不认放行主机 → 放行那条红;`_pool._network_backend` 那行删掉 → 拒绝那几条红。
"""
import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest.mock import patch

import anthropic
import openai
import pytest
from django.test import override_settings

from apps.soul_assist import config
from apps.soul_assist.providers import AnthropicProvider, OpenAICompatibleProvider

_real_getaddrinfo = socket.getaddrinfo
METADATA = "http://169.254.169.254/latest/meta-data/"
MODELS = {"object": "list", "has_more": False, "first_id": "m1", "last_id": "m1",
          "data": [{"id": "m1", "object": "model", "created": 0, "owned_by": "x", "type": "model",
                    "display_name": "m1", "created_at": "2026-01-01T00:00:00Z"}]}


class _Handler(BaseHTTPRequestHandler):
    hits = []

    def do_GET(self):  # noqa: N802
        _Handler.hits.append(self.path)
        if self.path.startswith("/redirect"):
            self.send_response(302)
            self.send_header("Location", METADATA)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        body = json.dumps(MODELS).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


@pytest.fixture
def port():
    _Handler.hits = []
    server = HTTPServer(("127.0.0.1", 0), _Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield server.server_address[1]
    server.shutdown()


def _dns(name):
    def fake(host, *args, **kwargs):
        if host == name:
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", args[0] if args else 0))]
        return _real_getaddrinfo(host, *args, **kwargs)
    return fake


def _client(sdk, base_url):
    if sdk == "openai":
        conn = config.Connection(provider=config.provider_path("openai_compatible"), base_url=base_url,
                                 api_key="k", model="m", effort="", fallbacks="")
        return OpenAICompatibleProvider(conn=conn).client.with_options(timeout=3)
    conn = config.Connection(provider=config.provider_path("anthropic"), base_url=base_url, api_key="k",
                             model="m", effort="", fallbacks="")
    return AnthropicProvider(conn=conn).client.with_options(timeout=3)


CONNECTION_ERROR = {"openai": openai.APIConnectionError, "anthropic": anthropic.APIConnectionError}
STATUS_ERROR = {"openai": openai.APIStatusError, "anthropic": anthropic.APIStatusError}
SDKS = ["openai", "anthropic"]
NOTHING_ALLOWED = dict(ASSISTANT_PRIVATE_HOSTS_ALLOWED=[], ASSISTANT_BASE_URL="", ASSISTANT_EMBEDDING_URL="")


@pytest.mark.parametrize("sdk", SDKS)
@override_settings(**NOTHING_ALLOWED)
def test_a_private_model_address_is_refused(sdk, port):
    with pytest.raises(CONNECTION_ERROR[sdk]):
        _client(sdk, f"http://127.0.0.1:{port}").models.list()
    assert _Handler.hits == []  # 连上就断，一个字节也没发


@pytest.mark.parametrize("sdk", SDKS)
@override_settings(**NOTHING_ALLOWED)
def test_a_name_that_resolves_private_only_at_connect_time_is_refused(sdk, port):
    """保存时解析不出(这里:构造客户端时还没装假 DNS),对话时才指向本机。"""
    client = _client(sdk, f"http://llm.example:{port}")
    with patch("socket.getaddrinfo", side_effect=_dns("llm.example")), pytest.raises(CONNECTION_ERROR[sdk]):
        client.models.list()
    assert _Handler.hits == []


@pytest.mark.parametrize("sdk", SDKS)
@override_settings(ASSISTANT_PRIVATE_HOSTS_ALLOWED=["ollama.lan"], ASSISTANT_BASE_URL="", ASSISTANT_EMBEDDING_URL="")
def test_a_redirect_to_the_metadata_address_is_not_followed(sdk, port):
    with patch("socket.getaddrinfo", side_effect=_dns("ollama.lan")), pytest.raises(STATUS_ERROR[sdk]) as err:
        _client(sdk, f"http://ollama.lan:{port}/redirect").models.list()
    assert err.value.status_code == 302
    assert len(_Handler.hits) == 1


@pytest.mark.parametrize("sdk", SDKS)
@override_settings(ASSISTANT_PRIVATE_HOSTS_ALLOWED=["ollama.lan"], ASSISTANT_BASE_URL="", ASSISTANT_EMBEDDING_URL="")
def test_an_allowed_private_host_still_works(sdk, port):
    with patch("socket.getaddrinfo", side_effect=_dns("ollama.lan")):
        page = _client(sdk, f"http://ollama.lan:{port}").models.list()
    assert [m.id for m in page.data] == ["m1"]
