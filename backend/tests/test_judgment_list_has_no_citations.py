"""`GET /judgment/` carries no `citations`; the detail still does (perf-audit A3, 2026-10-30).

Mutation: `get_serializer_class` back to `JudgmentSerializer` for `list` → the key is back and the list's
query count grows with the cited articles → red. The detail half fails if the retrieve prefetch or
`JudgmentDetailSerializer`'s grounds go missing.
"""
import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.judgment.models import Judgment, JudgmentCitation, Statute, StatuteCorpus
from apps.souls.models import Civilization, Soul, SoulState
from tests.conftest import sign_in

pytestmark = pytest.mark.django_db
URL = "/api/v1/judgment/"


def _case(tenant, n_cites, tag):
    soul = Soul.objects.create(name=f"列表之魂{tag}", tenant=tenant, current_state=SoulState.JUDGING)
    case = Judgment.objects.create(soul=soul, civilization=Civilization.EUROPEAN, tenant=tenant)
    for i in range(n_cites):
        statute = Statute.objects.create(tenant=tenant, code=f"EU-LIST-{tag}-{i}", civilization=Civilization.EUROPEAN,
                                         corpus=StatuteCorpus.DEADLY_SIN, title_en=f"Article {tag}-{i}")
        JudgmentCitation.objects.create(judgment=case, statute=statute, tenant=tenant)
    return case


def _list(client):
    client.get(URL)  # warm-up: TenantMiddleware's per-worker hall copy
    with CaptureQueriesContext(connection) as ctx:
        response = client.get(URL)
    assert response.status_code == 200
    return [q["sql"] for q in ctx.captured_queries], response


def test_the_list_has_no_citations_and_does_not_read_them(api_client, eu_admin_user, eu_tenant):
    client = sign_in(api_client, eu_admin_user)
    case = _case(eu_tenant, 3, "a")
    sql, response = _list(client)
    [row] = [r for r in response.data["results"] if r["id"] == str(case.pk)]
    assert "citations" not in row
    assert row["case_number"] == case.case_number  # the rest of the row is still there
    citation_table = JudgmentCitation._meta.db_table
    assert not [q for q in sql if citation_table in q], "the list still reads the cited articles"


def test_the_detail_still_carries_its_grounds(api_client, eu_admin_user, eu_tenant):
    client = sign_in(api_client, eu_admin_user)
    case = _case(eu_tenant, 2, "d")
    response = client.get(f"{URL}{case.pk}/")
    assert response.status_code == 200
    assert sorted(c["statute"]["code"] for c in response.data["citations"]) == ["EU-LIST-d-0", "EU-LIST-d-1"]
