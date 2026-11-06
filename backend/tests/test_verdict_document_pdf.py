"""判决文书的真 PDF:`GET /judgment/{id}/verdict-document.pdf/`(apps/judgment/verdict_pdf.py)。

门禁容器里没有 Gotenberg,所以除最后一条外,渲染调用(`verdict_pdf._post`)都换成假的:假的那一个做
Gotenberg 的 Chromium 会做的事 —— 拿 `url` 里的一次性键去取打印页的数据 —— 再交回一份 PDF。
最后一条是集成测试,只在设了渲染服务地址时跑(见它自己的说明)。
"""
import os
from urllib.parse import parse_qs, urlsplit

import pytest
import requests
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.judgment import verdict_pdf
from apps.judgment.models import Judgment, Verdict
from apps.souls.models import Soul
from tests.conftest import sign_in

pytestmark = pytest.mark.django_db

CONFIGURED = override_settings(
    VERDICT_PDF_RENDERER_URL="http://gotenberg:3000", VERDICT_PDF_FRONTEND_URL="http://frontend:3000",
)


def _judgment(tenant, *, verdict=Verdict.FAILED, is_final=True, civ="CHINESE"):
    soul = Soul.objects.create(name="李青竹", tenant=tenant, birth_year=1931, death_year=2001)
    return Judgment.objects.create(
        soul=soul, tenant=tenant, civilization=civ, court="第一殿", verdict=verdict, is_final=is_final,
        concluded_at=timezone.now() if is_final else None,
    )


def _url(judgment, locale="en"):
    return f"/api/v1/judgment/{judgment.pk}/verdict-document.pdf/?locale={locale}"


class _Answer:
    def __init__(self, status_code=200, content=b"%PDF-1.7 fake"):
        self.status_code, self.content = status_code, content


@pytest.fixture
def renderer(monkeypatch):
    """假的 Gotenberg:记下表单,按 `url` 里的键取打印页数据(与前端服务端同一个未登录请求)。"""
    calls = []

    def fake(url, fields):
        key = parse_qs(urlsplit(fields["url"]).query)["key"][0]
        page = APIClient().get(f"/api/v1/judgment/verdict-print/{key}/")
        calls.append({"url": url, "fields": fields, "page": page})
        return _Answer()

    monkeypatch.setattr(verdict_pdf, "_post", fake)
    return calls


@CONFIGURED
def test_a_reader_of_the_case_downloads_a_pdf_named_after_the_case(api_client, judge_user, cn_tenant, renderer):
    judgment = _judgment(cn_tenant)
    response = sign_in(api_client, judge_user).get(_url(judgment))
    assert response.status_code == 200, response.content
    assert response["Content-Type"] == "application/pdf"
    assert response.content.startswith(b"%PDF")
    assert f'filename="{judgment.case_number}.pdf"' in response["Content-Disposition"]
    assert response["Content-Disposition"].startswith("attachment")

    (call,) = renderer
    assert call["url"] == "http://gotenberg:3000/forms/chromium/convert/url"
    assert call["fields"]["url"].startswith("http://frontend:3000/verdict-print?key=")
    assert call["fields"]["preferCssPageSize"] == "true"
    # 纸张底色要印(用户 2026-11-07):不发这一项,Chromium 出的 PDF 是白纸。
    assert call["fields"]["printBackground"] == "true"
    assert call["fields"]["waitForExpression"] == verdict_pdf.READY_EXPRESSION
    assert '"value": "en"' in call["fields"]["cookies"] and '"domain": "frontend"' in call["fields"]["cookies"]
    # 打印页拿到的是详情那份数据(同一个序列化器),外加生卒。
    assert call["page"].status_code == 200
    data = call["page"].json()
    assert data["judgment"]["case_number"] == judgment.case_number
    assert data["judgment"]["verdict"] == "FAILED"
    assert data["soul"]["birth_date"]["year"] == 1931


@CONFIGURED
def test_the_print_key_is_gone_once_the_pdf_is_out(api_client, judge_user, cn_tenant, renderer):
    sign_in(api_client, judge_user).get(_url(_judgment(cn_tenant)))
    key = parse_qs(urlsplit(renderer[0]["fields"]["url"]).query)["key"][0]
    again = APIClient().get(f"/api/v1/judgment/verdict-print/{key}/")
    assert again.status_code == 404
    assert again.json()["code"] == "unknown_print_key"


@pytest.mark.parametrize("key", ["", "short", "x" * 43 + "/", "../" * 15, "a" * 43])
def test_the_print_data_answers_nothing_for_a_key_it_did_not_issue(key):
    assert verdict_pdf.print_data(key) is None


def test_the_print_data_route_is_404_for_an_unknown_key():
    response = APIClient().get(f"/api/v1/judgment/verdict-print/{'a' * 43}/")
    assert response.status_code == 404
    assert response.json()["code"] == "unknown_print_key"


@CONFIGURED
def test_an_open_case_is_409_and_a_retrial_has_no_document(api_client, judge_user, cn_tenant, renderer):
    client = sign_in(api_client, judge_user)
    open_case = client.get(_url(_judgment(cn_tenant, verdict=None, is_final=False)))
    assert open_case.status_code == 409
    assert open_case.json()["code"] == "judgment_not_concluded"
    retry = client.get(_url(_judgment(cn_tenant, verdict=Verdict.RETRY)))
    assert retry.status_code == 404
    assert retry.json()["code"] == "no_verdict_document"
    assert renderer == []


@CONFIGURED
def test_another_halls_case_is_not_found_and_never_rendered(api_client, eu_admin_user, cn_tenant, renderer):
    response = sign_in(api_client, eu_admin_user).get(_url(_judgment(cn_tenant)))
    assert response.status_code == 404
    assert renderer == []


def test_unauthenticated_is_refused(api_client, cn_tenant):
    assert api_client.get(_url(_judgment(cn_tenant))).status_code in (401, 403)


def test_no_renderer_configured_is_503_with_its_code(api_client, judge_user, cn_tenant):
    with override_settings(VERDICT_PDF_RENDERER_URL="", VERDICT_PDF_FRONTEND_URL=""):
        response = sign_in(api_client, judge_user).get(_url(_judgment(cn_tenant)))
    assert response.status_code == 503
    assert response.json()["code"] == "verdict_pdf_not_configured"


@CONFIGURED
@pytest.mark.parametrize("answer", [
    requests.ConnectionError("gotenberg is down"),
    requests.Timeout("too slow"),
    _Answer(status_code=409, content=b'{"message":"page returned 404"}'),
    _Answer(status_code=200, content=b"<html>not a pdf</html>"),
], ids=["down", "timeout", "renderer-refused", "not-a-pdf"])
def test_a_renderer_that_is_down_or_answers_wrong_is_503(api_client, judge_user, cn_tenant, monkeypatch, answer):
    def fake(url, fields):
        if isinstance(answer, Exception):
            raise answer
        return answer

    monkeypatch.setattr(verdict_pdf, "_post", fake)
    response = sign_in(api_client, judge_user).get(_url(_judgment(cn_tenant)))
    assert response.status_code == 503
    assert response.json()["code"] == "verdict_pdf_unavailable"


_LIVE = os.environ.get("VERDICT_PDF_RENDERER_URL") and os.environ.get("VERDICT_PDF_FRONTEND_URL")


@pytest.mark.django_db(transaction=True)
@pytest.mark.skipif(
    not _LIVE,
    reason=(
        "integration: needs a running Gotenberg and frontend — set VERDICT_PDF_RENDERER_URL and "
        "VERDICT_PDF_FRONTEND_URL, start the frontend with VERDICT_PRINT_API_URL=<this run's --liveserver>/api/v1, "
        "and run pytest with --liveserver <host:port> reachable from that frontend. The gate container has none of these."
    ),
)
def test_gotenberg_renders_the_real_print_page(live_server, judge_user, cn_tenant):
    """真渲染:Gotenberg 的 Chromium 打开真前端的 `/verdict-print`,前端的服务端向这次运行的 live_server 取数据。
    缓存是同一进程的 LocMem,live_server 在同一进程的线程里,所以键对得上。"""
    client = sign_in(APIClient(), judge_user)
    response = client.get(live_server.url + _url(_judgment(cn_tenant), locale="zh-Hans"))
    assert response.status_code == 200, response.content[:500]
    assert response.content.startswith(b"%PDF")
