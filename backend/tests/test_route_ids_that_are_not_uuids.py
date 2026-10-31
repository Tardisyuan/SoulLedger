"""路由段收任意 `[^/.]+`,而后面的查询是 UUIDField:不是 UUID 的值在查询处抛 Django 的 ValidationError,
DRF 不接,于是一个打错的网址是 500(fix/backend-audit 2026-10-31,审查 C26 d)。现在每一处与「没有这个 id」
同一个回答,什么都不写:

* `DELETE /judgment/{id}/citations/{statute_id}/` → 400(`StatuteCitationService.resolve`,与未知 id 同一句);
* `PUT /judgment/{id}/evidence/{record_id}/` → 400(`EvidenceAdmissionService.rule`,同上);
* `POST /sentence-plans/{id}/requests/{request_id}/decide|withdraw/` → 404 `not_found`,见
  `tests/test_sentence_plan_phase3.py::test_a_request_id_that_is_not_a_uuid_is_no_such_request`。

`souls/{id}/records/{record_id}/` 那三条早就接住了 ValidationError(`apps/souls/views.py`),不在这里。
"""
import pytest

from apps.judgment.models import EvidenceAdmission, JudgmentCitation
from tests import sentence_plan_support as plan
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize("junk", ["not-a-uuid", "12345"])
def test_a_citation_or_evidence_id_that_is_not_a_uuid_is_refused_like_an_unknown_one(junk):
    cn = plan.tenant("CN_DIYU")
    _soul, case = plan.open_case(cn)
    client = officer_client(plan.officer("route_judge", "JUDGE", cn))
    base = f"/api/v1/judgment/{case.pk}"

    uncited = client.delete(f"{base}/citations/{junk}/")
    assert uncited.status_code == 400 and "No statute" in uncited.data["error"], uncited.data
    ruled = client.put(f"{base}/evidence/{junk}/", {"admitted": True}, format="json")
    assert ruled.status_code == 400 and "not evidence in this case" in ruled.data["error"], ruled.data
    assert not JudgmentCitation.all_objects.filter(judgment=case).exists()
    assert not EvidenceAdmission.all_objects.filter(judgment=case).exists()
