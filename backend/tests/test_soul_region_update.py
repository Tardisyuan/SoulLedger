"""`POST /api/v1/souls/region-update/preview/` and `…/region-update/commit/` — bulk `origin_region` backfill.

The caller is a custom role holding only `soul.update`, not ADMIN, for the same reason as the import tests:
ADMIN is tenant-exempt elsewhere, so an ADMIN test could not tell a working hall check from a missing one.
"""
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.audit.models import AuditAction, AuditLog
from apps.authentication.models import User
from apps.perm.cache import invalidate_all_permissions
from apps.perm.models import Permission, Role, RolePermission
from apps.souls import importer
from apps.souls.models import Soul
from apps.tenants.models import Tenant

PREVIEW = "/api/v1/souls/region-update/preview/"
COMMIT = "/api/v1/souls/region-update/commit/"


def _client_for(user, tenant):
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


def _role(name, *codenames):
    role = Role.objects.create(name=name, display_name=name)
    for codename in codenames:
        perm, _ = Permission.objects.get_or_create(
            codename=codename, defaults={"name": codename, "category": codename.split(".")[0]}
        )
        RolePermission.objects.get_or_create(role=role, permission=perm)
    return role


@pytest.fixture
def world(db):
    invalidate_all_permissions()
    gr, _ = Tenant.objects.get_or_create(code="GR_HADES", defaults={"display_name": "Hades"})
    eg, _ = Tenant.objects.get_or_create(code="EG_DUAT", defaults={"display_name": "Duat"})
    _role("REGION_EDITOR", "soul.update")
    _role("REGION_READER", "soul.read", "soul.create")
    editor = User.objects.create_user(username="reg_editor", password="x", role="REGION_EDITOR", tenant=gr)
    reader = User.objects.create_user(username="reg_reader", password="x", role="REGION_READER", tenant=gr)
    yield {
        "gr": gr,
        "eg": eg,
        "client": _client_for(editor, gr),
        "reader": _client_for(reader, gr),
        "user": editor,
        "a": Soul.objects.create(name="Achilles", tenant=gr),
        "b": Soul.objects.create(name="Memnon", tenant=gr, origin_region="ASIA"),
        "c": Soul.objects.create(name="Odysseus", tenant=gr, origin_region="EUROPE"),
        "foreign": Soul.objects.create(name="Sinuhe", tenant=eg),
    }
    invalidate_all_permissions()


def _post(client, url, content, name="regions.csv"):
    raw = content.encode("utf-8") if isinstance(content, str) else content
    return client.post(url, {"file": SimpleUploadedFile(name, raw, content_type="text/csv")}, format="multipart")


def _csv(*rows, header="soul_id,origin_region"):
    return header + "\n" + "".join(f"{ident},{region}\n" for ident, region in rows)


def _statuses(r):
    assert r.status_code == 200, r.content
    return [row["status"] for row in r.data["rows"]]


# ── preview ───────────────────────────────────────────────────────────────

def test_preview_shows_each_status_and_writes_nothing(world):
    w = world
    body = _csv(
        (w["a"].pk, "europe"),            # ok, case-insensitive
        (w["b"].pk, "ASIA"),              # unchanged
        ("00000000-0000-0000-0000-000000000000", "ASIA"),  # not found
        ("", "ASIA"),                     # no identifier
        (w["c"].pk, "AFRICA"),            # bad value
        (w["a"].pk, "ASIA"),              # same soul again: the first row (2) wins
    )
    before = AuditLog.objects.count()
    r = _post(w["client"], PREVIEW, body)
    assert _statuses(r) == [
        "ok", "unchanged", "not_found", "missing_identifier", "invalid_origin_region", "duplicate_in_file",
    ]
    first, dup = r.data["rows"][0], r.data["rows"][5]
    assert (first["row"], first["old"], first["new"], first["clears_value"]) == (2, "", "EUROPE", False)
    assert first["duplicate_of"] is None
    assert (dup["row"], dup["duplicate_of"], dup["old"], dup["new"]) == (7, 2, None, None)
    bad = r.data["rows"][4]
    assert (bad["old"], bad["new"], bad["values"]["origin_region"]) == ("EUROPE", None, "AFRICA")
    # identifier echoes the cell; the name wherever the identifier names a soul of this hall — the bad
    # value and the duplicate included (it is the hall's own soul), never not_found / missing_identifier
    assert [(x["identifier"], x["soul_name"]) for x in r.data["rows"]] == [
        (str(w["a"].pk), "Achilles"),
        (str(w["b"].pk), "Memnon"),
        ("00000000-0000-0000-0000-000000000000", None),
        ("", None),
        (str(w["c"].pk), "Odysseus"),
        (str(w["a"].pk), "Achilles"),
    ]
    counts = [r.data[k] for k in ("total", "changed_count", "unchanged_count", "skipped_count", "clears_count")]
    assert counts == [6, 1, 1, 4, 0]
    assert r.data["max_rows"] == importer.MAX_ROWS
    w["a"].refresh_from_db()
    assert w["a"].origin_region == ""
    assert AuditLog.objects.count() == before


def test_blank_resets_to_unknown_and_is_flagged_as_clearing(world):
    w = world
    r = _post(w["client"], PREVIEW, _csv((w["c"].pk, ""), (w["b"].pk, "不详"), (w["a"].pk, "")))
    rows = r.data["rows"]
    assert [(x["status"], x["old"], x["new"], x["clears_value"]) for x in rows] == [
        ("ok", "EUROPE", "", True),
        ("ok", "ASIA", "", True),
        ("unchanged", "", "", False),  # already unknown: nothing to clear
    ]
    assert (r.data["changed_count"], r.data["clears_count"]) == (2, 2)


@pytest.mark.parametrize("cell, stored", [
    ("EUROPE", "EUROPE"), (" Europe ", "EUROPE"), ("europe", "EUROPE"), ("欧洲", "EUROPE"),
    ("ASIA", "ASIA"), ("Asia", "ASIA"), (" 亚洲", "ASIA"),
    ("UNKNOWN", ""), ("Unknown", ""), ("不详", ""), ("", ""),
])
def test_codes_english_and_chinese_spellings_are_accepted(world, cell, stored):
    r = _post(world["client"], PREVIEW, _csv((world["b"].pk, cell)))
    row = r.data["rows"][0]
    assert row["new"] == stored
    assert row["status"] == ("unchanged" if stored == "ASIA" else "ok")


@pytest.mark.parametrize("cell", ["AFRICA", "Eur", "欧", "亚洲人", "EU", "N/A"])
def test_any_other_spelling_is_invalid(world, cell):
    assert _statuses(_post(world["client"], PREVIEW, _csv((world["a"].pk, cell)))) == ["invalid_origin_region"]


def test_soul_code_identifies_a_soul_and_is_normalised(world):
    Soul.all_objects.filter(pk=world["a"].pk).update(soul_code="ABC2345678")
    r = _post(world["client"], PREVIEW, _csv((" abc2345678 ", "亚洲"), header="soul_code,origin_region"))
    assert _statuses(r) == ["ok"]
    assert (r.data["rows"][0]["identifier"], r.data["rows"][0]["soul_name"]) == ("abc2345678", "Achilles")


@pytest.mark.parametrize("header, code", [
    ("origin_region", "missing_id_column"),
    ("name,origin_region", "missing_id_column"),
    ("soul_id,soul_code,origin_region", "mixed_id_columns"),
    ("Soul ID,soul_id,origin_region", "mixed_id_columns"),
])
def test_header_must_name_exactly_one_identifier_column(world, header, code):
    r = _post(world["client"], PREVIEW, header + "\n" + "x," * header.count(",") + "ASIA\n")
    assert r.status_code == 400
    assert (r.data["code"], r.data["columns"]) == (code, ["soul_id", "soul_code"])


def test_missing_origin_region_column_is_refused(world):
    r = _post(world["client"], PREVIEW, f"soul_id\n{world['a'].pk}\n")
    assert (r.status_code, r.data["code"], r.data["columns"]) == (400, "missing_columns", ["origin_region"])


def test_an_export_shaped_file_with_extra_columns_works(world, django_capture_on_commit_callbacks):
    """The soul export's header, with only an origin_region column added: extra columns are ignored."""
    w = world
    header = "Soul ID,Name,Civilization,State,Merit Score,Demerit Score,Karmic Balance,Death Date,Created At,origin_region"
    body = header + "\n" + "".join(
        f"{w[k].pk},{w[k].name},GREEK,ALIVE,0,0,0,,2026-01-01T00:00:00,{region}\n"
        for k, region in (("a", "Europe"), ("b", "Asia"))
    )
    preview = _post(w["client"], PREVIEW, body)
    assert _statuses(preview) == ["ok", "unchanged"]
    assert set(preview.data["rows"][0]["values"]) == {"soul_id", "origin_region"}  # nothing else echoed
    with django_capture_on_commit_callbacks(execute=True):
        r = _post(w["client"], COMMIT, body)
    assert (r.data["updated"], r.data["unchanged"], r.data["skipped"]) == (1, 1, 0)
    w["a"].refresh_from_db()
    assert (w["a"].origin_region, w["a"].name) == ("EUROPE", "Achilles")


@pytest.mark.parametrize("reason_column", ["跳过原因", "reason", "Medu Sni"])
def test_the_skipped_rows_file_goes_back_as_downloaded(world, reason_column):
    """The dialog's 「下载跳过的行」 file heads its third column in the reader's language (batch 47); re-uploaded
    as-is, that column is ignored like any other extra one."""
    body = f"soul_id,origin_region,{reason_column}\n{world['a'].pk},EUROPE,不存在\n"
    preview = _post(world["client"], PREVIEW, body)
    assert preview.status_code == 200, preview.data
    assert _statuses(preview) == ["ok"]


# ── another hall ──────────────────────────────────────────────────────────

def test_another_halls_soul_is_not_found_and_not_leaked(world):
    foreign = world["foreign"]
    unknown = "11111111-1111-1111-1111-111111111111"
    r = _post(world["client"], PREVIEW, _csv((foreign.pk, "ASIA"), (unknown, "ASIA")))
    a, b = r.data["rows"]
    # Indistinguishable from a soul that does not exist: same status, nothing read from the soul.
    assert a["status"] == b["status"] == "not_found"
    assert (a["old"], a["new"]) == (b["old"], b["new"]) == (None, None)
    assert foreign.name not in r.content.decode()
    assert (a["identifier"], a["soul_name"]) == (str(foreign.pk), None)
    assert (b["identifier"], b["soul_name"]) == (unknown, None)
    r = _post(world["client"], COMMIT, _csv((foreign.pk, "ASIA")))
    assert (r.status_code, r.data["updated"], r.data["skipped"]) == (200, 0, 1)
    assert r.data["rows"][0]["status"] == "not_found"
    assert foreign.name not in r.content.decode()
    foreign.refresh_from_db()
    assert foreign.origin_region == ""


def test_another_halls_soul_code_is_not_found(world):
    Soul.all_objects.filter(pk=world["foreign"].pk).update(soul_code="ZZZ2345678")
    r = _post(world["client"], PREVIEW, _csv(("ZZZ2345678", "ASIA"), header="soul_code,origin_region"))
    assert _statuses(r) == ["not_found"]


def test_an_archived_or_deleted_soul_is_not_found(world):
    Soul.all_objects.filter(pk=world["a"].pk).update(is_archived=True)
    Soul.all_objects.filter(pk=world["b"].pk).update(is_deleted=True)
    r = _post(world["client"], PREVIEW, _csv((world["a"].pk, "ASIA"), (world["b"].pk, "EUROPE")))
    assert _statuses(r) == ["not_found", "not_found"]


# ── apply ─────────────────────────────────────────────────────────────────

def test_apply_writes_only_changed_rows_audits_and_is_idempotent(world, django_capture_on_commit_callbacks):
    w = world
    body = _csv((w["a"].pk, "EUROPE"), (w["b"].pk, "asia"), (w["c"].pk, ""))
    versions = {k: w[k].version for k in ("a", "b", "c")}
    with django_capture_on_commit_callbacks(execute=True):
        r = _post(w["client"], COMMIT, body)
    assert r.status_code == 200, r.content
    assert r.data == {"updated": 2, "unchanged": 1, "skipped": 0, "rows": []}
    for key, region in (("a", "EUROPE"), ("b", "ASIA"), ("c", "")):
        w[key].refresh_from_db()
        assert w[key].origin_region == region
    assert w["b"].version == versions["b"]  # the unchanged row was not saved

    batch = AuditLog.objects.get(action=AuditAction.BATCH_UPDATE, resource="soul")
    assert batch.user_id == w["user"].pk and batch.tenant_id == w["gr"].pk
    assert [batch.changes[k] for k in ("field", "updated", "unchanged", "skipped")] == ["origin_region", 2, 1, 0]
    per_soul = AuditLog.objects.filter(action=AuditAction.UPDATE, resource="soul", changes__has_key="origin_region")
    assert sorted(log.changes["origin_region"][1] or "" for log in per_soul) == ["", "EUROPE"]

    audit_before = AuditLog.objects.count()
    with django_capture_on_commit_callbacks(execute=True):
        again = _post(w["client"], COMMIT, body)
    assert again.data == {"updated": 0, "unchanged": 3, "skipped": 0, "rows": []}
    assert AuditLog.objects.count() == audit_before


def test_apply_skips_a_bad_row_and_writes_the_others(world, django_capture_on_commit_callbacks):
    w = world
    with django_capture_on_commit_callbacks(execute=True):
        r = _post(w["client"], COMMIT, _csv((w["a"].pk, "EUROPE"), (w["c"].pk, "MARS"), (w["b"].pk, "欧洲")))
    assert r.status_code == 200, r.content
    assert (r.data["updated"], r.data["unchanged"], r.data["skipped"]) == (2, 0, 1)
    # only the skipped row comes back, with its status
    assert [(x["row"], x["status"]) for x in r.data["rows"]] == [(3, "invalid_origin_region")]
    for key, region in (("a", "EUROPE"), ("b", "EUROPE"), ("c", "EUROPE")):  # c kept its old value
        w[key].refresh_from_db()
        assert w[key].origin_region == region
    batch = AuditLog.objects.get(action=AuditAction.BATCH_UPDATE)
    assert (batch.changes["updated"], batch.changes["skipped"]) == (2, 1)


def test_apply_uses_the_first_of_duplicate_rows(world):
    a = world["a"]
    r = _post(world["client"], COMMIT, _csv((a.pk, "EUROPE"), (str(a.pk).upper(), "ASIA")))
    assert (r.data["updated"], r.data["skipped"]) == (1, 1)
    assert [(x["row"], x["status"], x["duplicate_of"]) for x in r.data["rows"]] == [(3, "duplicate_in_file", 2)]
    a.refresh_from_db()
    assert a.origin_region == "EUROPE"


def test_apply_revalidates_instead_of_trusting_an_earlier_preview(world):
    a = world["a"]
    assert _statuses(_post(world["client"], PREVIEW, _csv((a.pk, "EUROPE")))) == ["ok"]
    Soul.all_objects.filter(pk=a.pk).update(origin_region="EUROPE")
    r = _post(world["client"], COMMIT, _csv((a.pk, "EUROPE")))
    assert (r.data["updated"], r.data["unchanged"]) == (0, 1)


def test_apply_writes_the_rows_together_or_not_at_all(world, monkeypatch):
    """Skipping is per row; the writable rows still share one transaction."""
    w = world
    real_save = Soul.save

    def save_then_fail(self, *args, **kwargs):
        if self.pk == w["b"].pk:
            raise RuntimeError("disk full")
        return real_save(self, *args, **kwargs)

    monkeypatch.setattr(Soul, "save", save_then_fail)
    with pytest.raises(RuntimeError):
        _post(w["client"], COMMIT, _csv((w["a"].pk, "EUROPE"), (w["b"].pk, "EUROPE")))
    w["a"].refresh_from_db()
    assert w["a"].origin_region == ""
    assert not AuditLog.objects.filter(action=AuditAction.BATCH_UPDATE).exists()


# ── permission and limits ─────────────────────────────────────────────────

@pytest.mark.parametrize("url", [PREVIEW, COMMIT])
def test_soul_update_is_required(world, url):
    r = _post(world["reader"], url, _csv((world["a"].pk, "EUROPE")))
    assert r.status_code == 403
    world["a"].refresh_from_db()
    assert world["a"].origin_region == ""


@pytest.mark.parametrize("url", [PREVIEW, COMMIT])
def test_anonymous_is_refused(world, url):
    assert _post(APIClient(), url, _csv((world["a"].pk, "EUROPE"))).status_code in (401, 403)


def test_row_limit_is_the_imports(world):
    rows = [(f"00000000-0000-0000-0000-{i:012d}", "ASIA") for i in range(importer.MAX_ROWS)]
    assert _post(world["client"], PREVIEW, _csv(*rows)).data["total"] == importer.MAX_ROWS
    r = _post(world["client"], PREVIEW, _csv(*rows, (world["a"].pk, "ASIA")))
    assert r.status_code == 400
    assert (r.data["code"], r.data["max_rows"]) == ("too_many_rows", importer.MAX_ROWS)


@pytest.mark.parametrize("url", [PREVIEW, COMMIT])
def test_file_size_limit_is_the_imports(world, monkeypatch, url):
    monkeypatch.setattr(importer, "MAX_BYTES", 50)
    r = _post(world["client"], url, _csv((world["a"].pk, "EUROPE"), (world["b"].pk, "EUROPE")))
    assert r.status_code == 400 and r.data["code"] == "file_too_large"
    world["a"].refresh_from_db()
    assert world["a"].origin_region == ""
