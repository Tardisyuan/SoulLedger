"""Cited grounds — `Statute` and `JudgmentCitation` (apps/judgment).

A verdict that cannot say what it rests on is not explainable, and a verdict
that can cite *anything* is worse than one that cites nothing: it lends the
authority of a rulebook to a reference the rulebook does not contain. So the
properties held here are mostly refusals.

Four of them are load-bearing and each has a distinct failure mode:

1. THE EGYPTIAN CORPUS IS DERIVED, NOT COPIED. The 42 clauses live on
   `Actor.powers_json["negative_confession"]`. `Statute.derived_text` reads
   them; the statute's own `text_*` columns stay empty. If a future change
   "simplifies" this by copying the text across, the copies diverge silently
   the first time one is corrected — so the test edits the actor and asserts
   the statute follows.

2. TENANT ISOLATION IS ENFORCED ON BOTH AXES. The read side is the meta-test's
   business (`tests/test_tenant_scoping_contract.py` proves StatuteViewSet
   routes through `apps.core.tenant`); the WRITE side is not covered by any
   meta-test, and a cross-tenant citation is a write. Both are asserted here,
   and the write test uses a JUDGE rather than an ADMIN — ADMIN bypasses tenant
   scoping by design, so an ADMIN-only test would pass against a completely
   unscoped implementation.

3. A REFUSAL SAYS WHICH REFUSAL IT IS. "No such article", "another tenant's
   article" and "another cosmology's article" are three different mistakes; if
   they collapse into one 404 the operator retypes a valid id forever.

4. GROUNDS AND VERDICT LAND TOGETHER OR NOT AT ALL. `conclude(statute_ids=…)`
   writes citations inside the conclusion transaction, so a bad id must leave
   the judgment pending rather than concluded-with-no-basis.
"""
import uuid

import pytest
from django.core.exceptions import ValidationError

from apps.actors.models import Actor, ActorRole
from apps.judgment.models import (
    CORPUS_CIVILIZATION,
    Judgment,
    JudgmentCitation,
    Statute,
    StatuteCorpus,
    StatutePolarity,
)
from apps.judgment.services import CitationRefusedError, StatuteCitationService
from apps.souls.models import Civilization, Soul, SoulState
from apps.tenants.models import Tenant


def make_statute(tenant, code, **kwargs):
    values = {
        "civilization": Civilization.CHINESE,
        "corpus": StatuteCorpus.HELL_LAW,
        "ordinal": 1,
        "polarity": StatutePolarity.OFFENCE,
        "title_zh": "杀生",
        "title_en": "Killing",
        "text_zh": "故意杀害人/动物。",
        "text_en": "Deliberately killing a person or an animal.",
        "source": "docs/11 §4.1",
    }
    values.update(kwargs)
    return Statute.objects.create(tenant=tenant, code=code, **values)


@pytest.fixture
def eg_tenant(db):
    tenant, _ = Tenant.objects.get_or_create(
        code="EG_DUAT", defaults={"display_name": "Egyptian Duat"}
    )
    return tenant


@pytest.fixture
def cn_soul(cn_tenant):
    return Soul.objects.create(
        name="待判之魂",
        birth_date="1900-01-01",
        current_state=SoulState.JUDGING,
        tenant=cn_tenant,
    )


@pytest.fixture
def cn_judgment(cn_soul, cn_tenant):
    return Judgment.objects.create(
        soul=cn_soul,
        civilization=Civilization.CHINESE,
        court="第一殿",
        tenant=cn_tenant,
    )


@pytest.fixture
def cn_statute(cn_tenant):
    return make_statute(cn_tenant, "CN-HL-O01")


@pytest.fixture
def admin_client(api_client, admin_user):
    api_client.force_authenticate(user=admin_user)
    return api_client


@pytest.fixture
def judge_headers(judge_user):
    """A real JUDGE caller — see tests/test_judgment_queue.py's fixture of the
    same name for why grants and a `tenant_code` claim are both required."""
    from rest_framework_simplejwt.tokens import RefreshToken

    from apps.perm.models import Permission, Role, RolePermission

    role, _ = Role.objects.get_or_create(name="JUDGE", defaults={"display_name": "Judge"})
    for codename in ("judgment.read", "judgment.create", "judgment.execute"):
        permission, _ = Permission.objects.get_or_create(
            codename=codename, defaults={"name": codename, "category": "judgment"}
        )
        RolePermission.objects.get_or_create(role=role, permission=permission)

    token = RefreshToken.for_user(judge_user)
    token["tenant_code"] = judge_user.tenant.code
    return {"HTTP_AUTHORIZATION": f"Bearer {token.access_token}"}


# ---------------------------------------------------------------------------
# The model
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestStatuteModel:
    def test_a_corpus_belongs_to_exactly_one_cosmology(self, cn_tenant):
        """冥律 is Chinese, the Forty-Two are Egyptian, the seven sins are
        European. Filing an article under another civilization's corpus states
        a rule that tradition does not have — the same collapse
        apps/ledger/readings.py refuses to make with karmic balance."""
        statute = Statute(
            tenant=cn_tenant,
            code="X-1",
            civilization=Civilization.EGYPTIAN,
            corpus=StatuteCorpus.HELL_LAW,
        )
        with pytest.raises(ValidationError) as exc:
            statute.clean()
        assert "corpus" in exc.value.message_dict

    def test_every_corpus_is_mapped(self):
        """A corpus with no civilization would pass `clean()` unchecked."""
        assert set(CORPUS_CIVILIZATION) == set(StatuteCorpus)

    def test_localized_title_falls_back_rather_than_showing_a_uuid(self, cn_tenant):
        statute = make_statute(cn_tenant, "CN-HL-O01", title_egy="")
        assert statute.get_localized_title("zh-Hans") == "杀生"
        assert statute.get_localized_title("en") == "Killing"
        # No Egyptian rendering of a Chinese article exists, and inventing one
        # is the failure the assessors' blank `name_zh` already documents.
        assert statute.get_localized_title("egy") == "Killing"

    def test_code_is_the_last_resort_never_the_primary_key(self, cn_tenant):
        statute = make_statute(cn_tenant, "CN-HL-O01", title_zh="", title_en="", title_egy="")
        assert statute.get_localized_title("en") == "CN-HL-O01"


@pytest.mark.django_db
class TestDerivedStatutes:
    """The Egyptian corpus points at the assessors; it does not copy them."""

    @pytest.fixture
    def assessor(self, eg_tenant):
        return Actor.objects.create(
            name="Am-khaibetu",
            civilization=Civilization.EGYPTIAN,
            role=ActorRole.JUDGE,
            tenant=eg_tenant,
            powers_json={
                "assessor_index": 4,
                "negative_confession": "theft",
                "home_place": "the place where the Nile riseth",
            },
        )

    @pytest.fixture
    def derived(self, eg_tenant, assessor):
        return Statute.objects.create(
            tenant=eg_tenant,
            code="EG-NC-04",
            civilization=Civilization.EGYPTIAN,
            corpus=StatuteCorpus.NEGATIVE_CONFESSION,
            ordinal=4,
            polarity=StatutePolarity.DENIAL,
            title_en=assessor.name,
            source_actor=assessor,
            source_actor_field="negative_confession",
            payload_json={"assessor_index": 4},
        )

    def test_the_body_is_read_from_the_actor_and_stored_nowhere_else(self, derived):
        assert derived.text_en == ""
        assert derived.text_zh == ""
        assert derived.derived_text == "theft"
        assert derived.get_localized_text("en") == "theft"

    def test_correcting_the_assessor_corrects_every_citation_of_it(self, derived, assessor):
        """The whole reason there is no second copy. If this ever fails
        because the text was denormalised onto the statute, the two copies
        have already begun to disagree."""
        assessor.powers_json["negative_confession"] = "theft (corrected reading)"
        assessor.save(update_fields=["powers_json"])
        derived.refresh_from_db()
        assert derived.derived_text == "theft (corrected reading)"

    def test_a_transcribed_article_has_no_derivation(self, cn_statute):
        assert cn_statute.source_actor_id is None
        assert cn_statute.derived_text == ""

    def test_a_derivation_with_no_field_named_reads_nothing(self, eg_tenant, assessor):
        """`source_actor_field` blank means "not derived", not "guess the key".
        Guessing is how a second corpus would silently inherit the Egyptian
        one's payload shape."""
        statute = Statute.objects.create(
            tenant=eg_tenant,
            code="EG-NC-99",
            civilization=Civilization.EGYPTIAN,
            corpus=StatuteCorpus.NEGATIVE_CONFESSION,
            source_actor=assessor,
            source_actor_field="",
        )
        assert statute.derived_text == ""


# ---------------------------------------------------------------------------
# Citing — the service
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestCitationService:
    def test_cites_an_article(self, cn_judgment, cn_statute):
        citation = StatuteCitationService.cite(cn_judgment, cn_statute.id, "杀二人")
        assert citation.statute_id == cn_statute.id
        assert citation.note == "杀二人"
        assert citation.tenant_id == cn_judgment.tenant_id

    def test_citing_twice_updates_rather_than_duplicating(self, cn_judgment, cn_statute):
        StatuteCitationService.cite(cn_judgment, cn_statute.id, "初稿")
        StatuteCitationService.cite(cn_judgment, cn_statute.id, "改定")
        assert cn_judgment.citations.count() == 1
        assert cn_judgment.citations.first().note == "改定"

    def test_a_verdict_may_rest_on_several_articles(self, cn_judgment, cn_tenant):
        first = make_statute(cn_tenant, "CN-HL-O01", ordinal=1)
        second = make_statute(cn_tenant, "CN-HL-O04", ordinal=4, title_zh="妄语")
        merit = make_statute(
            cn_tenant, "CN-HL-M01", ordinal=11, polarity=StatutePolarity.MERIT,
            title_zh="孝养父母",
        )
        StatuteCitationService.cite_many(cn_judgment, [second.id, merit.id, first.id])

        # Ordered by the corpus's own sequence, not by click order — 功過相抵
        # reads as a list of articles, and the 冥律 numbering is load-bearing.
        assert [c.statute.code for c in cn_judgment.citations.all()] == [
            "CN-HL-O01", "CN-HL-O04", "CN-HL-M01",
        ]

    def test_merit_and_offence_are_distinguishable(self, cn_judgment, cn_tenant):
        """功過相抵 is a rule of 冥律 (docs/11 §4.3). Without polarity a
        judgment citing 孝养父母 would read as an accusation of filial piety."""
        merit = make_statute(
            cn_tenant, "CN-HL-M01", polarity=StatutePolarity.MERIT, title_zh="孝养父母"
        )
        StatuteCitationService.cite(cn_judgment, merit.id)
        assert cn_judgment.citations.first().statute.polarity == StatutePolarity.MERIT

    # -- refusals -----------------------------------------------------------

    def test_refuses_an_article_that_does_not_exist(self, cn_judgment):
        with pytest.raises(CitationRefusedError) as exc:
            StatuteCitationService.cite(cn_judgment, uuid.uuid4())
        assert "No statute" in str(exc.value)

    def test_refuses_another_tenants_article_and_says_so(self, cn_judgment, eg_tenant):
        """Not a 404. A cross-tenant reference is a different mistake from a
        typo, and reporting it as "not found" sends the operator hunting for a
        row that exists and that they simply may not cite."""
        foreign = make_statute(
            eg_tenant, "EG-X-01", civilization=Civilization.CHINESE
        )
        with pytest.raises(CitationRefusedError) as exc:
            StatuteCitationService.cite(cn_judgment, foreign.id)
        assert "another tenant" in str(exc.value)

    def test_refuses_another_cosmologys_article(self, cn_judgment, cn_tenant):
        """The three do not share a rulebook — the same stance
        apps/ledger/readings.py takes about ledger readings. A Chinese court
        citing a bolgia of the Inferno is not a stricter judgment, it is a
        category error."""
        european = make_statute(
            cn_tenant,
            "EU-DS-01",
            civilization=Civilization.EUROPEAN,
            corpus=StatuteCorpus.DEADLY_SIN,
        )
        with pytest.raises(CitationRefusedError) as exc:
            StatuteCitationService.cite(cn_judgment, european.id)
        assert "do not share a rulebook" in str(exc.value)

    def test_refuses_a_retired_article_while_leaving_old_citations_standing(
        self, cn_judgment, cn_statute, cn_soul, cn_tenant
    ):
        StatuteCitationService.cite(cn_judgment, cn_statute.id)
        cn_statute.soft_delete(reason="superseded")

        later = Judgment.objects.create(
            soul=cn_soul, civilization=Civilization.CHINESE, tenant=cn_tenant
        )
        with pytest.raises(CitationRefusedError) as exc:
            StatuteCitationService.cite(later, cn_statute.id)
        assert "retired" in str(exc.value)
        # The already-recorded ground is untouched: it is a record of how a
        # case was decided, not a live reference.
        assert cn_judgment.citations.count() == 1

    def test_a_cited_article_cannot_be_hard_deleted(self, cn_judgment, cn_statute):
        """PROTECT. A dangling statute id on a decided case is a verdict whose
        stated basis has silently disappeared."""
        from django.db.models import ProtectedError

        StatuteCitationService.cite(cn_judgment, cn_statute.id)
        with pytest.raises(ProtectedError):
            Statute.all_objects.filter(pk=cn_statute.pk).delete()

    def test_grounds_freeze_when_the_verdict_lands(self, cn_judgment, cn_statute):
        cn_judgment.conclude("FAILED", "刀山")
        with pytest.raises(CitationRefusedError) as exc:
            StatuteCitationService.cite(cn_judgment, cn_statute.id)
        assert "no longer be changed" in str(exc.value)

    def test_uncite_removes_a_ground_from_an_open_case(self, cn_judgment, cn_statute):
        StatuteCitationService.cite(cn_judgment, cn_statute.id)
        assert StatuteCitationService.uncite(cn_judgment, cn_statute.id) is True
        assert cn_judgment.citations.count() == 0

    def test_uncite_refuses_a_cross_tenant_id_rather_than_reporting_nothing_to_do(
        self, cn_judgment, eg_tenant
    ):
        foreign = make_statute(eg_tenant, "EG-X-01", civilization=Civilization.CHINESE)
        with pytest.raises(CitationRefusedError):
            StatuteCitationService.uncite(cn_judgment, foreign.id)


@pytest.mark.django_db
class TestConclusionRecordsGrounds:
    def test_conclude_files_the_grounds_with_the_verdict(
        self, cn_judgment, cn_tenant, cn_statute
    ):
        second = make_statute(cn_tenant, "CN-HL-O04", ordinal=4, title_zh="妄语")
        cn_judgment.conclude("FAILED", "", statute_ids=[cn_statute.id, second.id])

        cn_judgment.refresh_from_db()
        assert cn_judgment.is_final is True
        assert [c.statute.code for c in cn_judgment.citations.all()] == [
            "CN-HL-O01", "CN-HL-O04",
        ]

    def test_a_bad_ground_aborts_the_whole_conclusion(self, cn_judgment, cn_statute):
        """One transaction. A verdict that landed while its stated basis
        silently failed to is worse than no verdict — it is a decided case
        that lies about why."""
        with pytest.raises(CitationRefusedError):
            cn_judgment.conclude("FAILED", "", statute_ids=[cn_statute.id, uuid.uuid4()])

        cn_judgment.refresh_from_db()
        assert cn_judgment.verdict is None
        assert cn_judgment.is_final is False
        assert JudgmentCitation.all_objects.filter(judgment=cn_judgment).count() == 0
        # And the soul never moved either.
        cn_judgment.soul.refresh_from_db()
        assert cn_judgment.soul.current_state == SoulState.JUDGING


# ---------------------------------------------------------------------------
# The API
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestCitationAPI:
    def test_post_records_a_ground(self, admin_client, cn_judgment, cn_statute):
        response = admin_client.post(
            f"/api/v1/judgment/{cn_judgment.id}/citations/",
            {"statute": str(cn_statute.id), "note": "杀二人"},
            format="json",
        )
        assert response.status_code == 201
        assert response.data["statute"]["code"] == "CN-HL-O01"
        assert response.data["note"] == "杀二人"

    def test_get_returns_the_grounds_with_the_articles_inlined(
        self, admin_client, cn_judgment, cn_statute
    ):
        StatuteCitationService.cite(cn_judgment, cn_statute.id, "杀二人")
        response = admin_client.get(f"/api/v1/judgment/{cn_judgment.id}/citations/")
        assert response.status_code == 200
        assert len(response.data) == 1
        # A list of UUIDs is not a reason; the article travels with the ground.
        assert response.data[0]["statute"]["display_title"]
        assert response.data[0]["statute"]["display_text"]

    def test_the_judgment_payload_carries_its_grounds(
        self, admin_client, cn_judgment, cn_statute
    ):
        StatuteCitationService.cite(cn_judgment, cn_statute.id)
        response = admin_client.get(f"/api/v1/judgment/{cn_judgment.id}/")
        assert response.status_code == 200
        assert [c["statute"]["code"] for c in response.data["citations"]] == ["CN-HL-O01"]

    def test_unknown_article_is_a_400_with_a_reason(self, admin_client, cn_judgment):
        response = admin_client.post(
            f"/api/v1/judgment/{cn_judgment.id}/citations/",
            {"statute": str(uuid.uuid4())},
            format="json",
        )
        assert response.status_code == 400
        assert "No statute" in response.data["error"]

    def test_cross_tenant_article_is_refused_by_reason_not_by_absence(
        self, admin_client, cn_judgment, eg_tenant
    ):
        """ADMIN can *see* every tenant's rows by design, which is exactly why
        the write side needs its own check: without it, the one role that
        bypasses tenant scoping would be the one role able to found a Chinese
        verdict on an Egyptian tenant's article."""
        foreign = make_statute(eg_tenant, "EG-X-01", civilization=Civilization.CHINESE)
        response = admin_client.post(
            f"/api/v1/judgment/{cn_judgment.id}/citations/",
            {"statute": str(foreign.id)},
            format="json",
        )
        assert response.status_code == 400
        assert "another tenant" in response.data["error"]

    def test_citing_a_concluded_judgment_is_a_409(
        self, admin_client, cn_judgment, cn_statute
    ):
        cn_judgment.conclude("FAILED", "")
        response = admin_client.post(
            f"/api/v1/judgment/{cn_judgment.id}/citations/",
            {"statute": str(cn_statute.id)},
            format="json",
        )
        assert response.status_code == 409

    def test_delete_withdraws_a_ground(self, admin_client, cn_judgment, cn_statute):
        StatuteCitationService.cite(cn_judgment, cn_statute.id)
        response = admin_client.delete(
            f"/api/v1/judgment/{cn_judgment.id}/citations/{cn_statute.id}/"
        )
        assert response.status_code == 204
        assert cn_judgment.citations.count() == 0

    def test_delete_of_an_uncited_article_is_a_404(
        self, admin_client, cn_judgment, cn_statute
    ):
        response = admin_client.delete(
            f"/api/v1/judgment/{cn_judgment.id}/citations/{cn_statute.id}/"
        )
        assert response.status_code == 404

    def test_conclude_accepts_the_grounds_with_the_verdict(
        self, admin_client, cn_judgment, cn_statute
    ):
        response = admin_client.post(
            f"/api/v1/judgment/{cn_judgment.id}/conclude/",
            {"verdict": "FAILED", "notes": "刀山", "statute_ids": [str(cn_statute.id)]},
            format="json",
        )
        assert response.status_code == 200
        assert [c["statute"]["code"] for c in response.data["citations"]] == ["CN-HL-O01"]

    def test_conclude_with_a_bad_ground_leaves_the_case_pending(
        self, admin_client, cn_judgment
    ):
        response = admin_client.post(
            f"/api/v1/judgment/{cn_judgment.id}/conclude/",
            {"verdict": "FAILED", "statute_ids": [str(uuid.uuid4())]},
            format="json",
        )
        assert response.status_code == 400
        cn_judgment.refresh_from_db()
        assert cn_judgment.verdict is None


@pytest.mark.django_db(transaction=True)
class TestCitationIsAudited:
    """Citing a ground writes an audit row.

    Not wired up by hand: `apps/audit/apps.py` connects post_save/post_delete
    to every concrete `AuditUserFields` subclass, so JudgmentCitation is
    audited because of what it inherits. That is worth a test precisely
    because it is implicit — a later refactor that drops AuditUserFields to
    "simplify" the model would take the audit trail with it and nothing else
    would notice.

    `transaction=True` because the signal defers through
    `transaction.on_commit`.
    """

    def test_recording_a_ground_lands_in_the_audit_log(self, cn_tenant):
        from apps.audit.models import AuditLog

        soul = Soul.objects.create(
            name="受审之魂", current_state=SoulState.JUDGING, tenant=cn_tenant
        )
        judgment = Judgment.objects.create(
            soul=soul, civilization=Civilization.CHINESE, tenant=cn_tenant
        )
        statute = make_statute(cn_tenant, "CN-HL-O01")
        citation = StatuteCitationService.cite(judgment, statute.id, "杀二人")

        assert AuditLog.objects.filter(resource_id=str(citation.id)).exists()


@pytest.mark.django_db
class TestStatuteReadIsolation:
    """The read side, through a JUDGE.

    An ADMIN test here would be vacuous: `apps.core.tenant.is_tenant_exempt`
    lets ADMIN see every tenant's rows on purpose, so an ADMIN listing would
    pass against a viewset with no scoping at all.
    """

    def test_a_judge_sees_only_its_own_jurisdictions_articles(
        self, api_client, judge_headers, cn_tenant, eg_tenant
    ):
        make_statute(cn_tenant, "CN-HL-O01")
        make_statute(eg_tenant, "EG-NC-04", civilization=Civilization.EGYPTIAN,
                     corpus=StatuteCorpus.NEGATIVE_CONFESSION,
                     polarity=StatutePolarity.DENIAL)

        response = api_client.get("/api/v1/judgment/statutes/", **judge_headers)
        assert response.status_code == 200
        codes = {row["code"] for row in response.data["results"]}
        assert codes == {"CN-HL-O01"}

    def test_a_judge_cannot_retrieve_another_tenants_article_by_id(
        self, api_client, judge_headers, eg_tenant
    ):
        foreign = make_statute(eg_tenant, "EG-NC-04", civilization=Civilization.EGYPTIAN,
                               corpus=StatuteCorpus.NEGATIVE_CONFESSION,
                               polarity=StatutePolarity.DENIAL)
        response = api_client.get(
            f"/api/v1/judgment/statutes/{foreign.id}/", **judge_headers
        )
        assert response.status_code == 404

    def test_a_judge_may_not_write_the_rulebook(
        self, api_client, judge_headers, cn_tenant
    ):
        """Read-only by design: an API that let an operator type a new 冥律
        article would manufacture exactly the statutes this feature was
        specified not to have. Corrections go through seed_mythology."""
        response = api_client.post(
            "/api/v1/judgment/statutes/",
            {"code": "CN-HL-O99", "civilization": "CHINESE", "corpus": "HELL_LAW"},
            format="json",
            **judge_headers,
        )
        assert response.status_code == 405

    def test_statutes_route_is_not_swallowed_by_the_judgment_detail_route(
        self, admin_client
    ):
        """JudgmentViewSet is mounted at the empty prefix, so its detail regex
        `[^/.]+` matches the literal segment `statutes`. If the router order in
        apps/judgment/urls.py is ever flipped, this 200 becomes a 404 that
        reads like missing data."""
        response = admin_client.get("/api/v1/judgment/statutes/")
        assert response.status_code == 200
        assert "results" in response.data


# ---------------------------------------------------------------------------
# The seeded corpora
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestSeededCorpora:
    """`manage.py seed_mythology` is the only way articles enter the system.

    These assert what the three corpora ARE, including the two places the
    sources are thin. A test that pinned "十恶 has ten rows" would be pinning a
    number the document does not contain.
    """

    @pytest.fixture(autouse=True)
    def seeded(self, db):
        from django.core.management import call_command

        call_command("seed_mythology", verbosity=0)

    def test_the_chinese_corpus_is_what_docs_11_contains_and_no_more(self):
        offences = Statute.objects.filter(
            corpus=StatuteCorpus.HELL_LAW, polarity=StatutePolarity.OFFENCE
        )
        merits = Statute.objects.filter(
            corpus=StatuteCorpus.HELL_LAW, polarity=StatutePolarity.MERIT
        )
        # docs/11 §4.1 is headed 十恶 and tabulates six; §4.2 is headed 十善 and
        # tabulates seven. The missing rows are NOT supplied from elsewhere.
        assert offences.count() == 6
        assert merits.count() == 7
        assert not Statute.objects.filter(code="CN-HL-O07").exists()
        # And the shortfall is recorded on the rows rather than left for a
        # reader to notice.
        assert any("十恶" in note for note in offences.first().source_notes)

    def test_every_seeded_article_carries_its_provenance(self):
        without_source = Statute.objects.filter(source="").values_list("code", flat=True)
        assert list(without_source) == []

    def test_the_egyptian_corpus_is_derived_from_the_assessors(self):
        derived = Statute.objects.filter(corpus=StatuteCorpus.NEGATIVE_CONFESSION)
        assert derived.count() == 42
        for statute in derived:
            assert statute.source_actor_id is not None, statute.code
            # The clause is NOT copied onto the statute — one source of truth.
            assert statute.text_en == "", statute.code
            assert statute.derived_text, statute.code

    def test_the_forty_two_read_in_bench_order_not_alphabetically(self):
        ordinals = list(
            Statute.objects.filter(corpus=StatuteCorpus.NEGATIVE_CONFESSION)
            .order_by("ordinal")
            .values_list("ordinal", flat=True)
        )
        assert ordinals == list(range(1, 43))

    def test_the_european_corpus_carries_the_documents_own_caveats(self):
        sins = Statute.objects.filter(corpus=StatuteCorpus.DEADLY_SIN)
        assert sins.count() == 7
        # docs/03 says the seven and Dante's circles do not correspond
        # one-to-one; every row says so rather than presenting a clean map.
        assert all(statute.source_notes for statute in sins)
        sloth = sins.get(code="EU-DS-05")
        gluttony = sins.get(code="EU-DS-06")
        assert sloth.payload_json["dante_circle"] == gluttony.payload_json["dante_circle"]
        assert any("gluttony" in note for note in sloth.source_notes)

    def test_each_corpus_stays_inside_its_own_tenant(self):
        by_tenant = {
            code: set(
                Statute.all_objects.filter(tenant__code=code).values_list("corpus", flat=True)
            )
            for code in ("CN_DIYU", "EU_HEAVEN_HELL", "EG_DUAT")
        }
        assert by_tenant == {
            "CN_DIYU": {StatuteCorpus.HELL_LAW},
            "EU_HEAVEN_HELL": {StatuteCorpus.DEADLY_SIN},
            "EG_DUAT": {StatuteCorpus.NEGATIVE_CONFESSION},
        }

    def test_reseeding_changes_nothing(self):
        from django.core.management import call_command

        before = list(Statute.objects.order_by("code").values_list("code", "update_time"))
        call_command("seed_mythology", verbosity=0)
        after = list(Statute.objects.order_by("code").values_list("code", "update_time"))
        assert before == after
