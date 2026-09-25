"""结案时引用条文的快照(apps/judgment/snapshot.py)。

一件已结的案子引用的是**当时**的文字。律条之后会被改 —— `seed_mythology --update`
就地改写,埃及四十二条的正文读自 `Actor.powers_json`,改神祇就改条文 —— 而读已结
案子的人要看到的是裁决所依据的那句话,不是今天那句。

四件事各有各的失败方式:
1. 结案后改律条 / 改神祇,已结案子显示的文字不变,且 `current_differs` 翻成 True。
2. 未结的案子没有快照,读现行文本(快照只在结案时拍)。
3. 迁移 0029 给已结的旧案子补录,标 BACKFILLED,且可逆。
4. 埃及条文拍下的是**渲染后**的正文(神祇的 negative_confession),不是空的 text_en。
"""
import pytest

from apps.actors.models import Actor, ActorRole
from apps.judgment.models import (
    CitationSnapshotKind,
    Judgment,
    JudgmentCitation,
    Statute,
    StatuteCorpus,
    StatutePolarity,
)
from apps.judgment.services import StatuteCitationService
from apps.souls.models import Civilization, Soul, SoulState
from tests.migration_roundtrip import snapshot_rows
from tests.test_judgment_statutes import make_statute


@pytest.fixture
def admin_client(api_client, admin_user):
    api_client.force_authenticate(user=admin_user)
    return api_client


def _open_case(tenant, civ=Civilization.CHINESE):
    soul = Soul.objects.create(
        name="待判之魂", birth_date="1900-01-01", current_state=SoulState.JUDGING, tenant=tenant,
    )
    return Judgment.objects.create(soul=soul, civilization=civ, court="第一殿", tenant=tenant)


def _shown(client, judgment):
    response = client.get(f"/api/v1/judgment/{judgment.id}/")
    assert response.status_code == 200
    return response.data["citations"][0]


@pytest.mark.django_db
class TestConcludedCitationsKeepTheirText:
    def test_editing_the_statute_after_conclusion_does_not_change_the_shown_text(
        self, admin_client, cn_tenant
    ):
        statute = make_statute(cn_tenant, "CN-HL-O01")
        case = _open_case(cn_tenant)
        case.conclude("FAILED", "", statute_ids=[statute.id])

        row = JudgmentCitation.all_objects.get(judgment=case)
        assert row.snapshot_kind == CitationSnapshotKind.CONCLUDED
        assert row.snapshot_at == Judgment.objects.get(pk=case.pk).concluded_at

        before = _shown(admin_client, case)["snapshot"]
        assert before["display_text"] == "Deliberately killing a person or an animal."
        assert before["current_differs"] is False

        statute.text_en = "Rewritten after the verdict."
        statute.title_en = "Rewritten title"
        statute.save()

        after = _shown(admin_client, case)
        assert after["snapshot"]["display_text"] == "Deliberately killing a person or an animal."
        assert after["snapshot"]["display_title"] == "Killing"
        assert after["snapshot"]["current_differs"] is True
        # The live article is still there for the compare view — and it is the new one.
        assert after["statute"]["display_text"] == "Rewritten after the verdict."

    def test_the_snapshot_answers_in_the_callers_language(self, admin_client, cn_tenant):
        statute = make_statute(cn_tenant, "CN-HL-O01")
        case = _open_case(cn_tenant)
        case.conclude("FAILED", "", statute_ids=[statute.id])
        response = admin_client.get(f"/api/v1/judgment/{case.id}/", HTTP_ACCEPT_LANGUAGE="zh-CN")
        assert response.data["citations"][0]["snapshot"]["display_text"] == "故意杀害人/动物。"

    def test_an_open_case_has_no_snapshot_and_reads_live_text(self, admin_client, cn_tenant):
        statute = make_statute(cn_tenant, "CN-HL-O01")
        case = _open_case(cn_tenant)
        StatuteCitationService.cite(case, statute.id)

        statute.text_en = "Corrected while the case is open."
        statute.save()

        shown = _shown(admin_client, case)
        assert shown["snapshot"] is None
        assert shown["statute"]["display_text"] == "Corrected while the case is open."
        row = JudgmentCitation.all_objects.get(judgment=case)
        assert row.snapshot_at is None and row.snapshot_hash == ""


@pytest.mark.django_db
class TestEgyptianDerivationIsSnapshotted:
    def test_the_rendered_confession_is_frozen_and_editing_the_actor_does_not_move_it(
        self, admin_client, cn_tenant
    ):
        from apps.tenants.models import Tenant

        eg, _ = Tenant.objects.get_or_create(code="EG_DUAT", defaults={"display_name": "Egyptian Duat"})
        assessor = Actor.objects.create(
            name="Am-khaibetu", civilization=Civilization.EGYPTIAN, role=ActorRole.JUDGE,
            tenant=eg, powers_json={"negative_confession": "theft"},
        )
        statute = Statute.objects.create(
            tenant=eg, code="EG-NC-04", civilization=Civilization.EGYPTIAN,
            corpus=StatuteCorpus.NEGATIVE_CONFESSION, ordinal=4, polarity=StatutePolarity.DENIAL,
            title_en=assessor.name, source_actor=assessor, source_actor_field="negative_confession",
        )
        case = _open_case(eg, Civilization.EGYPTIAN)
        StatuteCitationService.cite(case, statute.id)
        # The conclusion path's own call, without the Egyptian disposition routing.
        Judgment.objects.filter(pk=case.pk).update(verdict="FAILED", is_final=True)
        case.refresh_from_db()
        StatuteCitationService.snapshot(case, at=case.created_at)

        row = JudgmentCitation.all_objects.get(judgment=case)
        # Rendered, not the empty text_en column.
        assert row.snapshot_text == {"zh": "theft", "en": "theft", "egy": "theft"}

        assessor.powers_json = {"negative_confession": "theft (corrected reading)"}
        assessor.save(update_fields=["powers_json"])

        shown = _shown(admin_client, case)
        assert shown["snapshot"]["display_text"] == "theft"
        assert shown["snapshot"]["current_differs"] is True
        assert shown["statute"]["display_text"] == "theft (corrected reading)"


def test_judgment_0029_backfills_concluded_citations_and_reverses(migration_round_trip):
    def seed(state):
        tenant = state.get_model("tenants", "Tenant")._base_manager.create(code="CN_X", display_name="x")
        statute = state.get_model("judgment", "Statute")
        judgment = state.get_model("judgment", "Judgment")
        citation = state.get_model("judgment", "JudgmentCitation")
        soul = state.get_model("souls", "Soul")._base_manager.create(name="s")
        art = statute._base_manager.create(
            code="CN-HL-O01", corpus="HELL_LAW", civilization="CHINESE", ordinal=1,
            polarity="OFFENCE", title_zh="杀生", text_zh="故意杀害。", tenant=tenant,
        )
        done = judgment._base_manager.create(
            soul=soul, civilization="CHINESE", tenant=tenant, verdict="FAILED", is_final=True,
        )
        still_open = judgment._base_manager.create(soul=soul, civilization="CHINESE", tenant=tenant)
        citation._base_manager.create(judgment=done, statute=art, tenant=tenant, note="done")
        citation._base_manager.create(judgment=still_open, statute=art, tenant=tenant, note="open")

    def snapshot(state):
        citation = state.get_model("judgment", "JudgmentCitation")
        fields = {"judgment_final": lambda c: c.judgment.is_final}
        if any(f.name == "snapshot_kind" for f in citation._meta.get_fields()):
            fields.update(kind="snapshot_kind", text="snapshot_text", hash="snapshot_hash")
        return snapshot_rows(citation._base_manager.all(), key="note", fields=fields)

    def check_forward(state):
        rows = snapshot(state)
        assert rows["done"]["kind"] == "BACKFILLED"
        assert rows["done"]["text"]["zh"] == "故意杀害。"
        assert len(rows["done"]["hash"]) == 64
        # An open case keeps reading live text.
        assert rows["open"]["kind"] == ""

    migration_round_trip(
        before=("judgment", "0028_citation_statute_snapshot"),
        after=("judgment", "0029_backfill_citation_snapshots"),
        seed=seed,
        snapshot=snapshot,
        check_forward=check_forward,
    )
