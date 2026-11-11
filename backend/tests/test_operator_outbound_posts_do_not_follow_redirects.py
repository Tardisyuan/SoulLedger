"""The two outbound POSTs to operator-configured addresses do not follow redirects (audit 2026-11-11, consistency
「顺带看到」): the ops-alert webhook (`scheduler.services.ops_alert`) and the PDF renderer
(`judgment.verdict_pdf._post`). Every other outbound call already passed `allow_redirects=False`.

Neither goes through `apps/core/outbound.py`'s public-only guard on purpose: both URLs come from the deployment's
settings, not from a tenant, and the renderer is an internal host by design.
"""
from unittest import mock

import requests

from apps.judgment import verdict_pdf
from apps.scheduler import services as scheduler_services


def _ok():
    response = mock.Mock()
    response.raise_for_status.return_value = None
    return response


def test_the_ops_alert_does_not_follow_a_redirect(settings):
    settings.OPS_ALERT_WEBHOOK_URL = "https://alerts.example.invalid/hook"
    with mock.patch.object(requests, "post", return_value=_ok()) as post:
        assert scheduler_services.ops_alert("x") is True
    assert post.call_args.kwargs["allow_redirects"] is False


def test_the_pdf_renderer_post_does_not_follow_a_redirect(settings):
    settings.VERDICT_PDF_TIMEOUT_SECONDS = 5
    with mock.patch.object(verdict_pdf.requests, "post", return_value=_ok()) as post:
        verdict_pdf._post("http://renderer.internal/forms/chromium/convert/url", {"url": "u"})
    assert post.call_args.kwargs["allow_redirects"] is False
