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
from apps.judgment.views import StatuteViewSet
from apps.souls.models import Civilization, Soul, SoulState
from apps.tenants.models import Tenant


def make_statute(tenant, code, **kwargs):
    """A throwaway article for the mechanism tests below.

    The CN-HL-* codes and the 冥律 flavour are FIXTURE TEXT, not seed data and
    not a claim that any such article exists: the HELL_LAW corpus was withdrawn
    (see the withdrawal note in seed_mythology.py and migration judgment/0012)
    and `TestSeededCorpora` below asserts that seeding produces none of it. The
    EU-DS-01..07 codes used in a couple of tests below are the same kind of
    fixture — the withdrawn European keys, which the seeder no longer writes;
    the real terrace articles are EU-DS-T1..T7. What these rows exercise is the
    citation machinery — polarity, ordering, tenant refusals, PROTECT — which
    is corpus-agnostic and stays.
    """
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

    THREE corpora are seeded. The Egyptian Forty-Two, derived from assessor rows
    whose provenance was checked clause by clause; the seven capital sins, one
    per terrace of Purgatorio (EU-DS-T1..T7); and 《太微仙君功過格》 (1171) under
    GONGGUOGE. The Chinese (HELL_LAW) table that shipped in 6017f04 stays
    withdrawn — not because entries were missing but because the frame was
    fabricated: there is no codified 冥律 with numbered articles to transcribe,
    and the 功過格 arriving under its own corpus value does not make there be
    one.

    The European seven came back a different way, and the difference is what is
    asserted here. They were not "completed" or re-mapped onto corrected
    circles; there is no such mapping, since pride, envy and sloth have no
    circle in the Inferno at all. They were re-anchored to the one structure the
    seven do order, and they arrived under NEW citation keys, so the withdrawn
    EU-DS-01..07 stay retired. tests/test_purgatorio_terraces.py holds the
    substance; what is checked here is the inventory.
    """

    @pytest.fixture(autouse=True)
    def seeded(self, db):
        from django.core.management import call_command

        call_command("seed_mythology", verbosity=0)

    def test_the_hell_law_corpus_still_seeds_nothing_at_all(self):
        """A trip wire, and it is meant to be annoying to route around.

        The tempting repair is to "finish" the withdrawn list — supply the four
        十恶 that looked missing. Nothing was missing: the list was pinned to a
        structure the sources do not have, and completing it yields a more
        convincing forgery, not a corpus. `all_objects`, so a row cannot hide
        behind is_deleted either.

        The Chinese side is no longer empty — GONGGUOGE holds 73 articles — and
        this assertion is unchanged by that, deliberately. 冥律 not being a
        document is a fact about 冥律; refilling HELL_LAW with 功過格 articles
        would file an account book the living keep on themselves as a penal code
        hell administers, which is the exact framing 8308204 withdrew.
        """
        withdrawn = Statute.all_objects.filter(corpus=StatuteCorpus.HELL_LAW)
        assert list(withdrawn.values_list("code", flat=True)) == []

    def test_the_withdrawn_european_citation_keys_are_not_reused(self):
        """EU-DS-01..07 are tombstones and stay tombstones.

        judgment/0012 refused to retire any of them a judgment had actually
        cited, so a live EU-DS-07 with its invented iron cage may exist on a
        deployed database. Re-seeding a corrected article under that code would
        rewrite the recorded grounds of a decided case, silently, because
        `_upsert` matches on `code`.
        """
        reused = sorted(
            Statute.all_objects.filter(
                code__in=[f"EU-DS-{index:02d}" for index in range(1, 8)]
            ).values_list("code", flat=True)
        )
        assert reused == []

    def test_the_six_seeded_corpora_are_the_whole_inventory(self):
        """States the whole seeded inventory, so a seventh corpus appearing
        anywhere — under a new enum value, or smuggled in under an existing
        one — fails here rather than being noticed by nobody.

        GORGIAS and REPUBLIC_ER hold 11 each and are TWO because Gorgias and
        Republic X are two eschatologies: one stamps a soul and stops, the
        other sentences it to a thousand-year circuit and sends it back to be
        born. Neither source enumerates anything, so a Greek article is a rule
        of the court rather than an offence — exactly one of the twenty-two
        carries OFFENCE polarity, Republic X 615b, which names three wrongs
        after "for example" and then declines to continue. See
        tests/test_greek_corpora.py, which holds the substance.

        GONGGUOGE holds 73 and not 75: 救濟門 is titled 十二條 and both
        independent transcriptions segment it into 11, 不軌門 is titled 六條 and
        both give 5. The two missing articles are NOT supplied. See
        tests/test_gongguoge.py, which holds the substance.

        INFERNO holds 26 and not 24: verify-christian-structure.md §6 counts
        the poem's distinct PLACES at 24 by including the Antinferno and by not
        counting a subdivided circle as a place of its own, while this corpus
        counts ARTICLES — nine circles plus three gironi, ten bolge and four
        zones of Cocytus. The Antinferno is not transcribed and the omission is
        recorded on EU-INF-C1. See tests/test_inferno_circles.py, which holds
        the substance.
        """
        by_corpus = {}
        for corpus in Statute.all_objects.values_list("corpus", flat=True):
            by_corpus[corpus] = by_corpus.get(corpus, 0) + 1
        assert by_corpus == {
            StatuteCorpus.GONGGUOGE: 73,
            StatuteCorpus.NEGATIVE_CONFESSION: 42,
            StatuteCorpus.DEADLY_SIN: 7,
            StatuteCorpus.INFERNO: 26,
            StatuteCorpus.GORGIAS: 11,
            StatuteCorpus.REPUBLIC_ER: 11,
        }

    def test_every_seeded_article_carries_its_provenance(self):
        without_source = Statute.objects.filter(source="").values_list("code", flat=True)
        assert list(without_source) == []

    def test_the_egyptian_corpus_is_derived_from_the_assessors(self):
        derived = Statute.objects.filter(corpus=StatuteCorpus.NEGATIVE_CONFESSION)
        assert derived.count() == 42
        for statute in derived:
            assert statute.source_actor_id is not None, statute.code
            assert statute.source_actor_field == "negative_confession", statute.code
            # The clause is NOT copied onto the statute — one source of truth.
            assert statute.text_en == "", statute.code
            assert statute.text_zh == "", statute.code
            assert statute.text_egy == "", statute.code
            assert statute.derived_text, statute.code
            # A denial the deceased makes, never a prohibition. Folding these
            # into OFFENCE would state the Egyptian material as a code of
            # offences it is not.
            assert statute.polarity == StatutePolarity.DENIAL, statute.code

        # Forty-two assessors, forty-two derivations: no two articles read off
        # the same actor, which a partially-run assessor seed would produce.
        assert len({statute.source_actor_id for statute in derived}) == 42
        assert sorted(statute.code for statute in derived) == [
            f"EG-NC-{index:02d}" for index in range(1, 43)
        ]

    def test_correcting_an_assessor_corrects_the_seeded_article(self):
        """The derivation proved on the real seeded rows, not just a fixture.

        This is the property that makes the Egyptian corpus survivable while
        the other two did not: there is exactly one copy of each clause, so a
        reading that turns out to be wrong is corrected in one place and every
        judgment that cited it reads the correction.
        """
        statute = Statute.objects.get(code="EG-NC-07")
        actor = statute.source_actor
        actor.powers_json["negative_confession"] = "a corrected reading"
        actor.save(update_fields=["powers_json"])

        statute.refresh_from_db()
        assert statute.derived_text == "a corrected reading"
        assert statute.get_localized_text("en") == "a corrected reading"
        # And still nowhere else.
        assert statute.text_en == ""

    def test_the_forty_two_read_in_bench_order_not_alphabetically(self):
        ordinals = list(
            Statute.objects.filter(corpus=StatuteCorpus.NEGATIVE_CONFESSION)
            .order_by("ordinal")
            .values_list("ordinal", flat=True)
        )
        assert ordinals == list(range(1, 43))

    def test_each_corpus_stays_inside_its_own_tenant(self):
        by_tenant = {
            code: set(
                Statute.all_objects.filter(tenant__code=code).values_list("corpus", flat=True)
            )
            for code in ("CN_DIYU", "EU_HEAVEN_HELL", "EG_DUAT")
        }
        # The Chinese tenant holds the 功過格 and NOTHING under HELL_LAW: it was
        # the rulebook that was withdrawn, not the cosmology, and what came back
        # is a different kind of document rather than the same one repaired. The
        # European tenant holds TWO corpora — the seven terrace articles of
        # Purgatorio and the 26 circles of the Inferno — because those are two
        # structures ordered by two different things, and merging them is the
        # chart 8308204 withdrew.
        assert by_tenant == {
            "CN_DIYU": {StatuteCorpus.GONGGUOGE},
            "EU_HEAVEN_HELL": {StatuteCorpus.DEADLY_SIN, StatuteCorpus.INFERNO},
            "EG_DUAT": {StatuteCorpus.NEGATIVE_CONFESSION},
        }

    def test_reseeding_changes_nothing(self):
        from django.core.management import call_command

        before = list(Statute.objects.order_by("code").values_list("code", "update_time"))
        call_command("seed_mythology", verbosity=0)
        after = list(Statute.objects.order_by("code").values_list("code", "update_time"))
        assert before == after


# ---------------------------------------------------------------------------
# The transcription path, kept alive without a corpus to run it on
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestTranscriptionMechanism:
    """`_seed_statutes` transcribes a corpus written into the seed file.

    Deleting it along with the withdrawn tables would have been the wrong
    lesson: what failed verification was two bodies of data, not the ability
    to seed a transcribed corpus. It sat with no caller for a while, and both
    corpora that have arrived since — the terraces and 《太微仙君功過格》 — came
    in through it. It is still exercised directly here on a throwaway row, so
    the path is tested apart from whatever happens to be in
    CIVILIZATION_STATUTES today.
    """

    def test_a_transcribed_row_still_seeds_and_is_idempotent(self, cn_tenant):
        import io

        from apps.actors.management.commands.seed_mythology import (
            CIVILIZATION_STATUTES,
            Command,
            Stats,
        )

        # Five corpora are transcribed: 《太微仙君功過格》 under GONGGUOGE, the
        # seven capital sins on the terraces of Purgatorio, the circles of the
        # Inferno, and Plato's two — the judgement in Gorgias and the circuit
        # in Republic X. Written out per civilization rather than as a flat
        # set, because the value is a TUPLE of corpora: two cosmologies here
        # have two apiece, and in both cases for the same reason — the whole
        # finding behind 8308204 is that Europe's two are separate structures,
        # and Greece's two are separate for the identical reason one dialogue
        # ends where the other circles back.
        #
        # If a SIXTH appears here, read the withdrawal note in
        # apps/actors/mythology/__init__.py first: HELL_LAW is empty because
        # the text behind it has no articles, not because nobody has got round
        # to typing them in, and neither the 功過格 nor the Inferno nor Plato
        # changed that. Egypt is absent from this map on purpose — its 42 are
        # DERIVED and seeded by `_seed_derived_statutes`, which is the next
        # test.
        assert {
            label: [entry[0] for entry in entries]
            for label, entries in CIVILIZATION_STATUTES.items()
        } == {
            "chinese": [StatuteCorpus.GONGGUOGE],
            "european": [StatuteCorpus.DEADLY_SIN, StatuteCorpus.INFERNO],
            "greek": [StatuteCorpus.GORGIAS, StatuteCorpus.REPUBLIC_ER],
        }

        row = {
            "code": "ZZ-FIXTURE-01",
            "ordinal": 1,
            "polarity": StatutePolarity.OFFENCE,
            "title_zh": "样例", "title_en": "Fixture",
            "text_zh": "样例条文。", "text_en": "A fixture article.",
            "payload": {"note": "fixture"},
            "notes": ["fixture row — no source is being claimed"],
        }
        command = Command(stdout=io.StringIO())
        stats = Stats("statutes")
        for _ in range(2):
            command._seed_statutes(
                Civilization.CHINESE, cn_tenant, StatuteCorpus.HELL_LAW,
                "fixture — asserts the mechanism, not a corpus", [row], False, stats,
            )

        seeded = Statute.all_objects.get(code="ZZ-FIXTURE-01")
        assert seeded.tenant_id == cn_tenant.id
        assert seeded.source_notes == ["fixture row — no source is being claimed"]
        assert seeded.payload_json == {"note": "fixture"}
        # Created once, recognised as unchanged the second time.
        assert (stats.created, stats.unchanged) == (1, 1)


# ---------------------------------------------------------------------------
# The withdrawal migration (judgment/0012)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestWithdrawalMigration:
    """Retiring the fabricated articles must not rewrite decided cases.

    The migration soft-deletes, because `JudgmentCitation.statute` is PROTECT
    and a cited article is the recorded basis of a verdict. And it refuses to
    touch an article some judgment actually cited: that citation happened, and
    a data migration is the wrong place to decide what a court should have
    said instead.
    """

    @pytest.fixture
    def migration(self):
        from importlib import import_module

        return import_module("apps.judgment.migrations.0012_withdraw_fabricated_statutes")

    @pytest.fixture
    def registry(self):
        from django.apps import apps as django_apps

        return django_apps

    def test_it_retires_the_withdrawn_corpora_and_leaves_the_egyptian_alone(
        self, migration, registry, cn_tenant, eg_tenant
    ):
        chinese = make_statute(cn_tenant, "CN-HL-O01")
        european = make_statute(
            cn_tenant, "EU-DS-01",
            civilization=Civilization.EUROPEAN, corpus=StatuteCorpus.DEADLY_SIN,
        )
        egyptian = make_statute(
            eg_tenant, "EG-NC-01",
            civilization=Civilization.EGYPTIAN,
            corpus=StatuteCorpus.NEGATIVE_CONFESSION,
            polarity=StatutePolarity.DENIAL,
        )

        migration.forward(registry, None)

        for statute in (chinese, european):
            statute.refresh_from_db()
            assert statute.is_deleted is True, statute.code
            assert statute.delete_reason == migration.DELETE_REASON
            assert statute.delete_cascade_id == migration.CASCADE_ID
            assert statute.deleted_at is not None
        egyptian.refresh_from_db()
        assert egyptian.is_deleted is False

        # Soft, not hard: the row is still there to be read.
        assert Statute.all_objects.filter(code="CN-HL-O01").exists()
        # And gone from every live query, which is what takes it out of the
        # picker and out of the API.
        assert not Statute.all_objects.filter(
            corpus__in=(StatuteCorpus.HELL_LAW, StatuteCorpus.DEADLY_SIN), is_deleted=False
        ).exists()

    def test_an_article_a_judgment_actually_cited_is_reported_and_kept(
        self, migration, registry, cn_tenant, cn_judgment, capsys
    ):
        cited = make_statute(cn_tenant, "CN-HL-O01")
        uncited = make_statute(cn_tenant, "CN-HL-O04", ordinal=4, title_zh="妄语")
        StatuteCitationService.cite(cn_judgment, cited.id, "as decided")

        migration.forward(registry, None)

        cited.refresh_from_db()
        uncited.refresh_from_db()
        assert cited.is_deleted is False
        assert uncited.is_deleted is True
        # Reported, not silently skipped — somebody has to look at this case.
        assert "CN-HL-O01" in capsys.readouterr().out
        # The citation itself is untouched.
        assert cn_judgment.citations.count() == 1

    def test_the_withdrawal_reverses(self, migration, registry, cn_tenant):
        statute = make_statute(cn_tenant, "CN-HL-O01")

        migration.forward(registry, None)
        migration.backward(registry, None)

        statute.refresh_from_db()
        assert statute.is_deleted is False
        assert statute.deleted_at is None
        assert statute.delete_reason == ""
        assert statute.delete_cascade_id is None

    def test_reversing_does_not_resurrect_a_row_it_never_deleted(
        self, migration, registry, cn_tenant
    ):
        """The reverse restores exactly what this migration retired. An article
        retired for some other reason — superseded, mis-keyed, withdrawn by
        hand — is not swept back into circulation by rolling this one back."""
        other = make_statute(cn_tenant, "CN-HL-O04", ordinal=4)
        other.soft_delete(reason="retired by hand, nothing to do with 0012")

        migration.forward(registry, None)
        migration.backward(registry, None)

        other.refresh_from_db()
        assert other.is_deleted is True
        assert other.delete_reason == "retired by hand, nothing to do with 0012"

    def test_running_it_twice_is_a_no_op(self, migration, registry, cn_tenant):
        statute = make_statute(cn_tenant, "CN-HL-O01")
        migration.forward(registry, None)
        statute.refresh_from_db()
        first_deleted_at = statute.deleted_at

        migration.forward(registry, None)
        statute.refresh_from_db()
        assert statute.deleted_at == first_deleted_at

    def test_it_is_a_no_op_on_a_database_that_never_held_them(
        self, migration, registry, eg_tenant
    ):
        """The ordinary case from now on: a fresh clone seeds no HELL_LAW rows
        at all, so the migration finds nothing to do.

        Note the shape it would have if it ever ran again on a modern database:
        it retires by `corpus`, and DEADLY_SIN now has seven legitimate rows in
        it. `judgment/0012` is applied once and never re-runs, but anything
        reaching for it as a template should retire by `code`.
        """
        egyptian = make_statute(
            eg_tenant, "EG-NC-01",
            civilization=Civilization.EGYPTIAN,
            corpus=StatuteCorpus.NEGATIVE_CONFESSION,
            polarity=StatutePolarity.DENIAL,
        )
        migration.forward(registry, None)
        egyptian.refresh_from_db()
        assert egyptian.is_deleted is False


# ---------------------------------------------------------------------------
# How often an article has actually been relied on
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestCitationCount:
    """`citation_count` — the corpus browser's one ranking signal.

    WHAT IT IS FOR. 175 seeded articles are a list until you can see which ones
    verdicts actually rest on. That number cannot be read off `Statute`:
    `JudgmentCitation` is a through-model with its own rows, so it is an
    annotation, and an annotation over a reverse relation is the one place in
    this codebase where correct queryset scoping does not carry over.

    HOW LOAD-BEARING THE TENANT FILTER IS — stated precisely, because the
    tempting overstatement is that it closes a live leak, and it does not.
    `citation_service` refuses a cross-tenant citation outright
    (apps/judgment/services.py:50) and stamps the row with `judgment.tenant`
    (:90), so every citation reachable through the API already shares its
    article's tenant. What the filter defends against is the ORM-level write
    that skips the service — a data migration, a management command, a
    `JudgmentCitation.all_objects.create`, or a future endpoint that forgets
    the check the service does. This module's own header records that the tenant
    gaps in this codebase "kept appearing in batches" precisely because each
    call site was an independent chance to drop a guard; an aggregate with no
    filter is one such site, and its failure mode is a single wrong integer per
    row, which is the shape that survives review.

    So: `test_counts_only_this_tenants_citations` builds a state the service
    would refuse. That is the point of it, and it is why the test says so here
    rather than reading as though the API could produce that row.
    """

    @pytest.fixture
    def cited_statute(self, cn_judgment, cn_statute):
        JudgmentCitation.objects.create(
            judgment=cn_judgment, statute=cn_statute, tenant=cn_judgment.tenant
        )
        return cn_statute

    def test_reports_the_number_of_citations_for_the_calling_tenant(
        self, api_client, judge_user, judge_headers, cited_statute
    ):
        response = api_client.get("/api/v1/judgment/statutes/", **judge_headers)

        assert response.status_code == 200
        rows = {row["code"]: row for row in response.data["results"]}
        assert cited_statute.code in rows, (
            "The judge's own tenant's article is missing from the corpus list; "
            "this test cannot say anything about its count."
        )
        assert rows[cited_statute.code]["citation_count"] == 1

    def test_counts_only_this_tenants_citations(
        self, api_client, judge_headers, cited_statute, eg_tenant, cn_soul
    ):
        """A citation row stamped with another tenant must not inflate the count.

        The row is written straight through the ORM because the service refuses
        to write it (see the class docstring). Without the filter on the
        annotation the count reads 2 — the caller is shown a number computed
        partly from rows their own queryset correctly excludes.
        """
        other = Judgment.objects.create(
            soul=cn_soul,
            civilization=Civilization.CHINESE,
            court="別殿",
            tenant=eg_tenant,
        )
        JudgmentCitation.objects.create(
            judgment=other, statute=cited_statute, tenant=eg_tenant
        )

        response = api_client.get("/api/v1/judgment/statutes/", **judge_headers)

        assert response.status_code == 200
        rows = {row["code"]: row for row in response.data["results"]}
        assert rows[cited_statute.code]["citation_count"] == 1, (
            "citation_count included another tenant's citation. A reverse "
            "aggregate resolves against the relation, not the related model's "
            "manager, so scoping the statute queryset does not scope this — "
            "apps/core/tenant.py::tenant_aggregate_filter has to be passed to "
            "Count(filter=...)."
        )

    def test_an_uncited_article_reads_zero_not_absent(
        self, api_client, judge_headers, cn_statute
    ):
        """Zero is a real answer here and must be distinguishable from absent.

        `get_citation_count` returns `None` when the annotation is missing —
        the nested `JudgmentCitationSerializer.statute` path — so the list
        endpoint returning `None` would be a wiring failure that a truthiness
        check would read as "uncited".
        """
        response = api_client.get("/api/v1/judgment/statutes/", **judge_headers)

        rows = {row["code"]: row for row in response.data["results"]}
        assert rows[cn_statute.code]["citation_count"] == 0
        assert rows[cn_statute.code]["citation_count"] is not None

    def test_the_nested_serializer_reports_absent_rather_than_raising(
        self, cited_statute, cn_judgment
    ):
        """Reading a citation must not blow up on the missing annotation.

        `StatuteSerializer` is nested at `JudgmentCitationSerializer.statute`,
        where the row arrives through the FK with no annotation on it. Declared
        as an `IntegerField` this would raise `AttributeError` on every citation
        read; as a method field it reports `None`, which is the true statement.
        """
        from apps.judgment.serializers import JudgmentCitationSerializer

        citation = JudgmentCitation.objects.get(
            judgment=cn_judgment, statute=cited_statute
        )
        data = JudgmentCitationSerializer(citation).data

        assert data["statute"]["citation_count"] is None

    def test_the_annotated_list_is_still_ordered(self, rf, judge_user):
        """Annotating must not cost the corpus its order.

        `annotate()` with an aggregate **discards** `Meta.ordering`: Django
        drops the model default rather than let it enter the GROUP BY, so the
        queryset comes back with `.ordered == False` and no ORDER BY in the
        SQL. DRF then paginates an unordered set — page 2 is a fresh
        LIMIT/OFFSET over rows the database may hand back in a different order,
        so articles repeat on one page and vanish from another. For a browser
        paging through 175 articles that is the feature failing, not a warning.

        Asserted on the viewset's own queryset rather than on two HTTP pages:
        with a handful of fixture rows both pages fit in one response, so a
        request-level test would pass against an unordered queryset and prove
        nothing.
        """
        request = rf.get("/api/v1/judgment/statutes/")
        request.user = judge_user
        request.tenant = judge_user.tenant

        view = StatuteViewSet()
        view.request = request
        view.format_kwarg = None

        qs = view.get_queryset()

        assert qs.ordered is True, (
            "StatuteViewSet.get_queryset() returns an unordered queryset. "
            "annotate() discarded Statute.Meta.ordering and nothing restored "
            "it, so paginating the corpus repeats and drops articles."
        )
        assert "ORDER BY" in str(qs.query)

    def test_the_explicit_order_by_is_still_load_bearing(self):
        """If Django stops discarding Meta.ordering, say so instead of drifting.

        The `order_by` in `get_queryset` exists only because `annotate()`
        currently throws the model default away. Pinning that premise means a
        Django upgrade that changes it fails here — with a message saying the
        line became redundant — rather than leaving a restatement of
        `Meta.ordering` that silently has to be kept in sync forever for no
        reason.
        """
        from django.db.models import Count as _Count

        assert Statute.objects.all().ordered is True
        annotated = Statute.objects.all().annotate(
            _n=_Count("citations", distinct=True)
        )
        assert annotated.ordered is False, (
            "annotate() no longer discards Meta.ordering. The explicit "
            "order_by in StatuteViewSet.get_queryset is now redundant rather "
            "than load-bearing — re-read it before keeping or deleting it."
        )
