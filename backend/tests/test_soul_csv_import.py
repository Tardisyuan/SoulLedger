"""`POST /api/v1/souls/import/preview/` and `…/import/commit/` — bulk soul import.

The importing caller is a custom role holding only `soul.create`, not ADMIN: ADMIN is
tenant-exempt, so an ADMIN test could not tell a working tenant check from a missing one.
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

PREVIEW = "/api/v1/souls/import/preview/"
COMMIT = "/api/v1/souls/import/commit/"
HEADER = "name,civilization,birth_date,death_date,origin_location,birth_name,description\n"


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
    cn, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})
    eg, _ = Tenant.objects.get_or_create(code="EG_DUAT", defaults={"display_name": "Duat"})
    _role("IMPORTER", "soul.create")
    _role("READER", "soul.read")
    importer_user = User.objects.create_user(username="imp_user", password="x", role="IMPORTER", tenant=cn)
    reader = User.objects.create_user(username="imp_reader", password="x", role="READER", tenant=cn)
    yield {
        "cn": cn,
        "eg": eg,
        "client": _client_for(importer_user, cn),
        "reader": _client_for(reader, cn),
        "user": importer_user,
    }
    invalidate_all_permissions()


def _upload(content, name="souls.csv"):
    raw = content.encode("utf-8") if isinstance(content, str) else content
    return {"file": SimpleUploadedFile(name, raw, content_type="text/csv")}


def _post(client, url, content, **kw):
    return client.post(url, _upload(content, **kw), format="multipart")


def _errors(response):
    assert response.status_code == 200, response.content
    return [{(e["field"], e["code"]) for e in row["errors"]} for row in response.data["rows"]]


def _row(**cells):
    base = {"name": "甲魂", "civilization": "CHINESE", "birth_date": "", "death_date": "",
            "origin_location": "", "birth_name": "", "description": ""}
    base.update(cells)
    return ",".join(f'"{v}"' for v in base.values()) + "\n"


# ── preview writes nothing ────────────────────────────────────────────────

def test_preview_never_writes(world):
    before_souls, before_audit = Soul.all_objects.count(), AuditLog.objects.count()
    r = _post(world["client"], PREVIEW, HEADER + _row() + _row(name="乙魂"))
    assert r.status_code == 200
    assert (r.data["total"], r.data["ok_count"], r.data["error_count"]) == (2, 2, 0)
    assert r.data["max_rows"] == importer.MAX_ROWS == 1000
    assert Soul.all_objects.count() == before_souls
    assert AuditLog.objects.count() == before_audit


def test_preview_reports_every_bad_row_not_just_the_first(world):
    r = _post(world["client"], PREVIEW, HEADER + _row(name="") + _row(name="乙魂") + _row(civilization="MARS"))
    assert _errors(r) == [{("name", "required")}, set(), {("civilization", "invalid_civilization")}]
    assert [row["status"] for row in r.data["rows"]] == ["error", "ok", "error"]
    assert [row["row"] for row in r.data["rows"]] == [2, 3, 4]


# ── file-level boundary ───────────────────────────────────────────────────

def test_utf8_bom_is_accepted(world):
    r = _post(world["client"], PREVIEW, b"\xef\xbb\xbf" + (HEADER + _row()).encode("utf-8"))
    assert r.status_code == 200 and r.data["ok_count"] == 1


def test_non_utf8_is_refused(world):
    r = _post(world["client"], PREVIEW, HEADER.encode() + b"caf\xe9,CHINESE,,,,,\n")
    assert r.status_code == 400 and r.data["code"] == "bad_encoding"


def test_missing_required_column_is_refused(world):
    r = _post(world["client"], PREVIEW, "name,birth_date\nx,1900\n")
    assert r.status_code == 400
    assert (r.data["code"], r.data["columns"]) == ("missing_columns", ["civilization"])


def test_unknown_column_is_refused_rather_than_silently_dropped(world):
    r = _post(world["client"], PREVIEW, "name,civilization,birth_data\nx,CHINESE,1900\n")
    assert r.status_code == 400
    assert (r.data["code"], r.data["columns"]) == ("unknown_columns", ["birth_data"])


def test_header_only_and_empty_files_are_refused(world):
    assert _post(world["client"], PREVIEW, HEADER).data["code"] == "no_rows"
    assert _post(world["client"], PREVIEW, "").data["code"] == "empty_file"


def test_no_file_is_a_400(world):
    r = world["client"].post(PREVIEW, {}, format="multipart")
    assert r.status_code == 400 and "file" in r.data


def test_row_limit(world):
    at_limit = HEADER + "".join(_row(name=f"魂{i}") for i in range(importer.MAX_ROWS))
    assert _post(world["client"], PREVIEW, at_limit).data["total"] == importer.MAX_ROWS
    r = _post(world["client"], PREVIEW, at_limit + _row(name="多一个"))
    assert r.status_code == 400
    assert (r.data["code"], r.data["max_rows"]) == ("too_many_rows", importer.MAX_ROWS)


def test_oversized_file_is_refused(world, monkeypatch):
    monkeypatch.setattr(importer, "MAX_BYTES", 50)
    r = _post(world["client"], PREVIEW, HEADER + _row())
    assert r.status_code == 400 and r.data["code"] == "file_too_large"


# ── per-row rules ─────────────────────────────────────────────────────────

def test_too_long_text_is_refused(world):
    r = _post(world["client"], PREVIEW, HEADER + _row(name="x" * 256) + _row(name="y", description="d" * 2001))
    assert _errors(r) == [{("name", "too_long")}, {("description", "too_long")}]


def test_dates_follow_the_existing_rules(world):
    rows = [
        _row(name="a", birth_date="-612", death_date="-560-03-15"),  # BCE, year precision then full
        _row(name="b", birth_date="1900-02-29"),  # not a leap year
        _row(name="c", birth_date="0"),  # no year 0
        _row(name="d", birth_date="1900/01/01"),
        _row(name="e", birth_date="1950", death_date="1900"),  # check_soul_dates: death_before_birth
        _row(name="f", birth_date="1000", death_date="1300"),  # implausible_lifespan
        _row(name="g", birth_date="1900-05"),
    ]
    r = _post(world["client"], PREVIEW, HEADER + "".join(rows))
    assert _errors(r) == [
        set(),
        {("birth_date", "invalid_date")},
        {("birth_date", "invalid_date")},
        {("birth_date", "invalid_date")},
        {("death_date", "death_before_birth")},
        {("death_date", "implausible_lifespan")},
        set(),
    ]


def test_civilization_must_be_the_importers_own(world):
    # EGYPTIAN is a real civilization, just not this caller's tenant's.
    r = _post(world["client"], PREVIEW, HEADER + _row(civilization="EGYPTIAN") + _row(name="乙魂", civilization="chinese"))
    assert _errors(r) == [{("civilization", "civilization_mismatch")}, set()]


def test_cross_tenant_commit_is_refused_and_writes_nothing(world):
    r = _post(world["client"], COMMIT, HEADER + _row(name="Sennedjem", civilization="EGYPTIAN"))
    assert r.status_code == 422
    assert r.data["rows"][0]["errors"] == [{"field": "civilization", "code": "civilization_mismatch"}]
    assert not Soul.all_objects.filter(name="Sennedjem").exists()


def test_duplicates_within_the_file(world):
    r = _post(world["client"], PREVIEW, HEADER + _row() + _row(name=" 甲魂 ") + _row(name="甲魂", birth_date="1900"))
    assert _errors(r) == [set(), {("name", "duplicate_in_file")}, set()]


def test_duplicate_of_an_existing_soul_is_case_insensitive_and_tenant_scoped(world):
    Soul.objects.create(name="Li Bai", tenant=world["cn"], birth_year=701)
    Soul.objects.create(name="Other", tenant=world["eg"])
    rows = [
        _row(name="li bai", birth_date="701"),  # same key, different case
        _row(name="Li Bai", birth_date="702"),  # different birth year: not the same soul
        _row(name="Other"),  # exists, but in another tenant
    ]
    assert _errors(_post(world["client"], PREVIEW, HEADER + "".join(rows))) == [
        {("name", "duplicate_existing")}, set(), set(),
    ]


def test_a_soft_deleted_soul_does_not_block_its_name(world):
    gone = Soul.objects.create(name="旧魂", tenant=world["cn"])
    Soul.all_objects.filter(pk=gone.pk).update(is_deleted=True)
    assert _errors(_post(world["client"], PREVIEW, HEADER + _row(name="旧魂"))) == [set()]


# ── commit ────────────────────────────────────────────────────────────────

def test_commit_creates_souls_in_the_callers_tenant_and_audits_the_batch(world, django_capture_on_commit_callbacks):
    body = HEADER + _row(name="甲魂", birth_date="-612", description="d") + _row(name="乙魂", death_date="1900-01-02")
    # The per-soul CREATE rows are written by the audit signal on commit; run those callbacks.
    with django_capture_on_commit_callbacks(execute=True):
        r = _post(world["client"], COMMIT, body)
    assert r.status_code == 201, r.content
    assert r.data["created"] == 2
    souls = Soul.objects.filter(import_batch=r.data["batch_id"])
    assert sorted(s.name for s in souls) == ["乙魂", "甲魂"]
    assert {s.tenant_id for s in souls} == {world["cn"].pk}
    a = souls.get(name="甲魂")
    assert (a.birth_year, a.birth_month, a.description) == (-612, None, "d")
    log = AuditLog.objects.get(action=AuditAction.IMPORT)
    assert (log.resource, log.resource_id, log.user_id) == ("soul", str(r.data["batch_id"]), world["user"].pk)
    assert log.changes["created"] == 2
    # each soul also carries its ordinary CREATE audit row
    assert AuditLog.objects.filter(action=AuditAction.CREATE, resource="soul").count() >= 2


def test_commit_refuses_the_whole_file_when_one_row_is_bad(world):
    r = _post(world["client"], COMMIT, HEADER + _row(name="好魂") + _row(name="", civilization="CHINESE"))
    assert r.status_code == 422
    assert (r.data["ok_count"], r.data["error_count"]) == (1, 1)
    assert not Soul.all_objects.filter(name="好魂").exists()
    assert not AuditLog.objects.filter(action=AuditAction.IMPORT).exists()


def test_commit_is_atomic_when_a_write_fails_midway(world, monkeypatch):
    real = Soul.objects.create
    calls = {"n": 0}

    def flaky(**kw):
        calls["n"] += 1
        if calls["n"] == 3:
            raise RuntimeError("disk on fire")
        return real(**kw)

    monkeypatch.setattr(importer.Soul.objects, "create", flaky)
    with pytest.raises(RuntimeError):
        _post(world["client"], COMMIT, HEADER + "".join(_row(name=f"魂{i}") for i in range(5)))
    assert not Soul.all_objects.filter(name__startswith="魂").exists()
    assert not AuditLog.objects.filter(action=AuditAction.IMPORT).exists()


def test_commit_revalidates_instead_of_trusting_an_earlier_preview(world):
    body = HEADER + _row(name="抢先")
    assert _post(world["client"], PREVIEW, body).data["ok_count"] == 1
    Soul.objects.create(name="抢先", tenant=world["cn"])  # someone else gets there first
    r = _post(world["client"], COMMIT, body)
    assert r.status_code == 422
    assert r.data["rows"][0]["errors"] == [{"field": "name", "code": "duplicate_existing"}]
    assert Soul.all_objects.filter(name="抢先").count() == 1


def test_list_can_be_filtered_to_one_import_batch(world):
    Soul.objects.create(name="旁人", tenant=world["cn"])
    batch = _post(world["client"], COMMIT, HEADER + _row(name="新魂")).data["batch_id"]
    admin = User.objects.create_user(username="imp_admin", password="x", role="ADMIN", tenant=world["cn"])
    r = _client_for(admin, world["cn"]).get("/api/v1/souls/", {"import_batch": str(batch)})
    assert r.status_code == 200
    assert [s["name"] for s in r.data["results"]] == ["新魂"]


# ── permission ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("url", [PREVIEW, COMMIT])
def test_soul_create_is_required(world, url):
    assert _post(world["reader"], url, HEADER + _row()).status_code == 403
    assert not Soul.all_objects.filter(name="甲魂").exists()


@pytest.mark.parametrize("url", [PREVIEW, COMMIT])
def test_anonymous_is_refused(world, url):
    assert _post(APIClient(), url, HEADER + _row()).status_code in (401, 403)
