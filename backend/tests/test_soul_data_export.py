"""「导出我的资料」(Design 第二十八批 S3):申请要认出本人、一次只一份、包里有什么 / 没有什么、
只给自己、签名文件会过期、好了有通知、过期有清理。

**核心断言是包里的东西**:每一节都在,而官员之间的评议、审判备注、证据采纳理由、别人的书信、别人的帖子、
官员在收件箱里的草稿一个字都不在。只断言「在」会在有人把 `sections()` 换成「导出所有」时仍然是绿的。
"""
import io
import json
import zipfile
from datetime import timedelta

import pytest
from django.core.files.base import ContentFile
from django.utils import timezone
from PIL import Image

from apps.authentication.models import LoginLog, User
from apps.chat.models import ChatIdentity, ChatImage, Conversation, InboxOfficerState
from apps.judgment.models import EvidenceAdmission, Judgment, JudgmentComment
from apps.scheduler import registry
from apps.social.models import Comment, Post, PostMedia
from apps.soul_accounts import data_export
from apps.soul_accounts.models import DataExportStatus, SoulDataExport
from apps.soul_push.models import PushDelivery
from apps.souls.record_models import SoulRecord
from tests.chat_support import FakeMatrix, matrix, mutual  # noqa: F401
from tests.soul_account_support import officer_client, ready_soul, soul_client
from tests.soul_push_support import enqueued  # noqa: F401

pytestmark = pytest.mark.django_db

EXPORT = "/api/v1/me/export/"
PASSWORD = "export-pw-9981"
CONVERSATIONS = "/api/v1/me/chat/conversations/"


@pytest.fixture(autouse=True)
def media_root(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path / "media")
    return tmp_path / "media"


@pytest.fixture
def queued(monkeypatch):
    """替掉入队:记下被入队的导出 id,测试自己同步调 `build`(没有 broker,也不该有)。"""
    calls = []
    monkeypatch.setattr(data_export, "enqueue", lambda export_id: calls.append(str(export_id)))
    return calls


def _with_password(account):
    account.user.set_password(PASSWORD)
    account.user.save()
    return account


def _png():
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (10, 120, 200)).save(buf, "PNG")
    return buf.getvalue()


def _apply(callbacks):
    for callback in callbacks:
        callback()


def _write_to_hall(client, body):
    opened = client.post(CONVERSATIONS, {"kind": "OFFICER_INBOX"}, format="json")
    assert opened.status_code in (200, 201), opened.data
    sent = client.post(f"{CONVERSATIONS}{opened.data['id']}/messages/", {"body": body}, format="json")
    assert sent.status_code == 201, sent.data
    return opened.data["id"]


@pytest.fixture
def world(cn_tenant, eu_tenant, matrix, media_root, django_capture_on_commit_callbacks):  # noqa: F811
    """我、一个朋友、一个陌生灵魂(别的殿);各有信、帖子;官员留下的评议与备注都装着 SECRET。"""
    class World:
        pass

    w = World()
    w.me, w.client = ready_soul(cn_tenant, name="甲")
    w.friend, w.friend_client = ready_soul(cn_tenant, name="乙")
    w.stranger, w.stranger_client = ready_soul(eu_tenant, name="Beatrice")
    _with_password(w.me)
    mutual(w.me, w.friend)

    # 书信:我写给殿司、官员回复;我和朋友私聊;朋友写给殿司(别人的信);朋友的草稿 / 经办人(官员侧)。
    w.hall_id = _write_to_hall(w.client, "我想申诉")
    w.officer = User.objects.create_user(username="cn_mod", password="x", role="MODERATOR", tenant=cn_tenant,
                                         first_name="判官崔珏")
    reply = officer_client(w.officer).post(f"/api/v1/chat/inbox/{w.hall_id}/reply/", {"body": "已收到"}, format="json")
    assert reply.status_code == 201, reply.data
    direct = w.client.post(CONVERSATIONS, {"target_user": w.friend.user_id}, format="json")
    assert direct.status_code in (200, 201), direct.data
    w.direct_id = direct.data["id"]
    FakeMatrix.says(Conversation.objects.get(pk=w.direct_id).room_id, ChatIdentity.objects.get(account=w.friend).matrix_user_id,
                    "乙说:周末见")
    w.friend_hall_id = _write_to_hall(w.friend_client, "别人的信-不该出现")
    InboxOfficerState.objects.create(conversation_id=w.friend_hall_id, user=w.officer, draft="官员草稿-不该出现")
    Conversation.objects.filter(pk=w.hall_id).update(assignee=w.officer)

    # 功过 / 审判:备注、评议、证据采纳理由都是官员侧的。
    SoulRecord.objects.create(soul=w.me.soul, record_type="MERIT", description="扶老人过桥", weight=3)
    judgment = Judgment.objects.create(soul=w.me.soul, civilization="CHINESE", tenant=cn_tenant, court="第一殿",
                                       verdict="PASSED", is_final=True, notes="判官内部备注-不该出现",
                                       confession="供词原文-不该出现", evidence_json={"raw": "证据原件-不该出现"})
    JudgmentComment.objects.create(judgment=judgment, author=w.officer, body="评议-不该出现", tenant=cn_tenant)
    record = SoulRecord.objects.create(soul=w.me.soul, record_type="DEMERIT", description="口角", weight=1)
    EvidenceAdmission.objects.create(judgment=judgment, record=record, admitted=False,
                                     reason="采纳理由-不该出现", tenant=cn_tenant)

    # 朋友圈:我的帖子带一张图 + 一条评论;朋友的帖子。
    w.post = Post.objects.create(author=w.me.user, content="今天天气好", tenant=cn_tenant,
                                 moderation_reason="审核理由-不该出现")
    media = PostMedia(post=w.post, uploader=w.me.user, width=8, height=8, byte_size=len(_png()), content_type="image/png")
    media.file.save("m.png", ContentFile(_png()), save=False)
    media.save()
    w.media = media
    Comment.objects.create(post=w.post, author=w.me.user, content="我自己的评论", tenant=cn_tenant)
    Post.objects.create(author=w.friend.user, content="别人的帖子-不该出现", tenant=cn_tenant)

    # 登录记录:最近 3 天一条成功,100 天前一条(不该出现)。
    LoginLog.objects.create(user=w.me.user, username=f"soul:{w.me.soul.soul_code}", status="SUCCESS",
                            ip_address="1.2.3.4", user_agent="SoulLedger/1 (iPhone)")
    old = LoginLog.objects.create(user=w.me.user, username=f"soul:{w.me.soul.soul_code}", status="SUCCESS",
                                  ip_address="1.2.3.4", user_agent="OldPhone-不该出现")
    LoginLog.objects.filter(pk=old.pk).update(timestamp=timezone.now() - timedelta(days=100))
    w.capture = django_capture_on_commit_callbacks
    return w


def _request(client, **body):
    return client.post(EXPORT, body or {"password": PASSWORD}, format="json")


def _ready(world, queued):
    """申请 → 同步生成。返回 (export, {包内路径: 字节})。"""
    with world.capture(execute=True):
        response = _request(world.client)
    assert response.status_code == 201, response.data
    assert queued == [str(response.data["id"])]
    with world.capture(execute=True):
        export = data_export.build(response.data["id"])
    assert export.status == DataExportStatus.READY, export.error
    from django.core.files.storage import default_storage

    with default_storage.open(export.file_path, "rb") as handle, zipfile.ZipFile(io.BytesIO(handle.read())) as archive:
        return export, {name: archive.read(name) for name in archive.namelist()}


def _text(files):
    """整包里所有 JSON / 文本内容拼在一起,给「不在场」断言用。"""
    return "\n".join(v.decode("utf-8") for k, v in files.items() if k.endswith(".json"))


# ── 申请:认出本人、一次一份 ────────────────────────────────────────────────


def test_a_request_needs_the_password_and_a_wrong_one_makes_nothing(world, queued):
    response = _request(world.client, password="不对的密码")
    assert response.status_code == 400 and response.data["code"] == "wrong_password"
    assert _request(world.client, password="").status_code == 400
    assert not SoulDataExport.objects.exists() and queued == []


def test_the_face_credential_stands_in_for_the_password_but_only_this_accounts_live_one(world, queued):
    from apps.soul_accounts import device_login

    mine = device_login.issue(world.me)
    theirs = device_login.issue(world.friend)
    assert _request(world.client, credential=theirs).status_code == 400
    assert _request(world.client, credential="随便写的").status_code == 400
    assert not SoulDataExport.objects.exists()
    assert _request(world.client, credential=mine).status_code == 201
    # 吊销之后不再算数(另一份申请要等这一份做完,所以先让它失败释放名额)。
    SoulDataExport.objects.update(status=DataExportStatus.FAILED)
    device_login.revoke_all(world.me, "turned_off")
    assert _request(world.client, credential=mine).status_code == 400


def test_wrong_passwords_spend_the_same_budget_as_login_and_then_429(world, queued):
    codes = [_request(world.client, password="x").status_code for _ in range(6)]
    assert codes[:5] == [400] * 5 and codes[5] == 429
    # 满了之后连对的密码也不收。
    assert _request(world.client).status_code == 429
    assert not SoulDataExport.objects.exists()


def test_only_one_export_in_progress_at_a_time_and_it_is_per_account(world, queued):
    with world.capture(execute=True):
        first = _request(world.client)
    assert first.status_code == 201
    second = _request(world.client)
    assert second.status_code == 409 and second.data["code"] == "export_in_progress"
    assert SoulDataExport.objects.filter(account=world.me).count() == 1
    # 别人的名额不受影响。
    _with_password(world.friend)
    assert _request(world.friend_client).status_code == 201
    # 做完(或失败)之后可以再申请。
    SoulDataExport.objects.filter(account=world.me).update(status=DataExportStatus.FAILED)
    assert _request(world.client).status_code == 201


def test_the_database_itself_refuses_a_second_in_progress_row(world):
    from django.db import IntegrityError, transaction

    SoulDataExport.objects.create(account=world.me, soul=world.me.soul)
    with pytest.raises(IntegrityError), transaction.atomic():
        SoulDataExport.objects.create(account=world.me, soul=world.me.soul)


def test_status_before_during_and_after(world, queued):
    assert soul_client(world.me).get(EXPORT).data == {"export": None}
    with world.capture(execute=True):
        _request(world.client)
    state = world.client.get(EXPORT).data["export"]
    assert state["status"] == "QUEUED" and state["download_url"] is None and state["file_name"] == ""
    with world.capture(execute=True):
        data_export.build(state["id"])
    state = world.client.get(EXPORT).data["export"]
    assert state["status"] == "READY" and state["download_url"].startswith("/api/v1/me/export/file/?t=")
    assert state["file_name"] == f"soulledger-{world.me.soul.soul_code}-{timezone.now():%Y%m%d}.zip"
    assert state["byte_size"] > 0
    assert state["expires_at"] is not None and state["finished_at"] is not None


# ── 包里有什么 ───────────────────────────────────────────────────────────────


def test_every_listed_section_is_in_the_archive(world, queued):
    _, files = _ready(world, queued)
    assert {"profile.json", "life.json", "sign_ins.json", "manifest.json", "circle/posts.json",
            "circle/comments.json"} <= set(files)
    profile = json.loads(files["profile.json"])
    assert profile["soul_code"] == world.me.soul.soul_code and profile["name"] == "甲"
    life = json.loads(files["life.json"])
    assert [r["description"] for r in life["records"]] == ["扶老人过桥", "口角"]
    assert life["judgments"][0]["verdict"] == "PASSED"
    posts = json.loads(files["circle/posts.json"])
    assert [p["content"] for p in posts] == ["今天天气好"]
    image_path = posts[0]["images"][0]["file"]
    assert files[image_path] == _png()  # 自己上传的图原样在包里
    assert [c["content"] for c in json.loads(files["circle/comments.json"])] == ["我自己的评论"]
    sign_ins = json.loads(files["sign_ins.json"])
    assert len(sign_ins) == 1 and sign_ins[0]["ok"] is True
    letters = {k: json.loads(v) for k, v in files.items() if k.startswith("letters/") and k.endswith(".json")}
    assert len(letters) == 2
    hall = next(v for v in letters.values() if v["kind"] == "OFFICER_INBOX")
    assert [(m["from"], m["body"]) for m in hall["messages"]] == [("me", "我想申诉"), ("hall", "已收到")]
    assert hall["messages"][1]["sender"] == "判官崔珏"
    direct = next(v for v in letters.values() if v["kind"] == "DIRECT")
    assert [(m["from"], m["body"]) for m in direct["messages"]] == [("them", "乙说:周末见")]
    assert json.loads(files["manifest.json"])["letters"] == {"available": True}


def test_the_archive_carries_none_of_what_the_officers_wrote_or_other_people_own(world, queued):
    _, files = _ready(world, queued)
    text = _text(files)
    for absent in ("不该出现", "评议", "判官内部备注", "供词原文", "证据原件", "采纳理由", "审核理由", "官员草稿",
                   "别人的信", "别人的帖子", "OldPhone"):
        assert absent not in text, absent
    # 键也不在:不是「值碰巧没写」。
    life = json.loads(files["life.json"])
    assert not {"notes", "confession", "evidence_json", "comments"} & set(life["judgments"][0])
    assert "assignee" not in text and "draft" not in text and "moderation" not in text
    # 别的会话的图 / 别人的文件名也不在包里。
    assert all(not name.startswith("letters/images/") for name in files)


def test_own_letter_images_are_in_the_archive_and_others_are_only_referenced(world, queued):
    room = Conversation.objects.get(pk=world.hall_id)
    mine = ChatImage(conversation=room, uploader=world.me, width=8, height=8, byte_size=len(_png()),
                     content_type="image/png", sent_at=timezone.now())
    mine.file.save("c.png", ContentFile(_png()), save=False)
    mine.save()
    FakeMatrix.says(room.room_id, ChatIdentity.objects.get(account=world.me).matrix_user_id, "[图片]",
                    extra={"io.soulledger.image": {"id": str(mine.pk), "width": 8, "height": 8}})
    theirs = ChatImage(conversation=Conversation.objects.get(pk=world.direct_id), uploader=world.friend, width=8,
                       height=8, byte_size=len(_png()), content_type="image/png", sent_at=timezone.now())
    theirs.file.save("d.png", ContentFile(b"theirs-bytes"), save=False)
    theirs.save()
    FakeMatrix.says(Conversation.objects.get(pk=world.direct_id).room_id,
                    ChatIdentity.objects.get(account=world.friend).matrix_user_id, "[图片]",
                    extra={"io.soulledger.image": {"id": str(theirs.pk), "width": 8, "height": 8}})
    _, files = _ready(world, queued)
    assert files[f"letters/images/{mine.pk}.png"] == _png()
    assert not any(str(theirs.pk) in name for name in files)
    assert b"theirs-bytes" not in b"".join(files.values())
    direct = next(json.loads(v) for k, v in files.items() if k.endswith("direct.json"))
    assert direct["messages"][-1]["image"] == {"id": str(theirs.pk), "file": None}


def test_without_chat_the_letters_are_listed_but_not_read_and_the_manifest_says_so(world, queued, settings):
    settings.MATRIX_ENABLED = False
    _, files = _ready(world, queued)
    assert json.loads(files["manifest.json"])["letters"] == {"available": False}
    assert all(json.loads(v)["messages"] == [] for k, v in files.items() if k.startswith("letters/"))


def test_an_unreadable_synapse_fails_the_export_rather_than_shipping_a_gap(world, queued, monkeypatch):
    from apps.chat.matrix import MatrixError

    def broken(self, room_id, **kwargs):
        raise MatrixError("Synapse 无法访问")

    monkeypatch.setattr(FakeMatrix, "history", broken)
    with world.capture(execute=True):
        response = _request(world.client)
    export = data_export.build(response.data["id"])
    assert export.status == DataExportStatus.FAILED and export.file_path == ""
    assert world.client.get(EXPORT).data["export"]["status"] == "FAILED"
    # 失败释放名额:可以重新申请。
    assert _request(world.client).status_code == 201


def test_the_past_lives_come_too_after_a_rebirth(world, queued):
    account = world.me
    type(account).objects.filter(pk=account.pk).update(retired_at=timezone.now())
    successor = type(account).objects.create(
        user=User.objects.create_user(username="soul:next", password="x", role="SOUL", tenant=account.soul.tenant),
        soul=account.soul, cycle=1, origin="OFFICER", must_change_password=False)
    _with_password(successor)
    from tests.soul_account_support import soul_client as client_for

    client = client_for(successor)
    with world.capture(execute=True):
        response = _request(client)
    assert response.status_code == 201, response.data
    data_export.build(response.data["id"])
    export = SoulDataExport.objects.get(pk=response.data["id"])
    from django.core.files.storage import default_storage

    with default_storage.open(export.file_path, "rb") as handle, zipfile.ZipFile(io.BytesIO(handle.read())) as archive:
        names = set(archive.namelist())
        circle = json.loads(archive.read("circle/posts.json"))
    assert "past_lives.json" in names
    assert circle == []  # 本世账号从零开始:前世的帖子归前世那个账号


# ── 只给自己、签名、过期 ─────────────────────────────────────────────────────


def _download(client, state):
    return client.get(state["download_url"])


def test_the_owner_downloads_the_zip_and_it_is_a_private_attachment(world, queued):
    _ready(world, queued)
    state = world.client.get(EXPORT).data["export"]
    response = _download(world.client, state)
    assert response.status_code == 200 and response["Content-Type"] == "application/zip"
    assert state["file_name"] in response["Content-Disposition"] and "attachment" in response["Content-Disposition"]
    assert response["Cache-Control"].startswith("private")
    body = b"".join(response.streaming_content)
    assert zipfile.ZipFile(io.BytesIO(body)).testzip() is None


def test_another_soul_gets_404_with_the_owners_link_and_sees_no_export_of_their_own(world, queued):
    _ready(world, queued)
    state = world.client.get(EXPORT).data["export"]
    assert _download(world.friend_client, state).status_code == 404
    assert _download(world.stranger_client, state).status_code == 404
    assert world.friend_client.get(EXPORT).data == {"export": None}
    # 没有令牌的人(匿名)、官员令牌:同样进不来。
    from rest_framework.test import APIClient

    assert _download(APIClient(), state).status_code in (401, 403)
    assert _download(officer_client(world.officer), state).status_code in (401, 403)


def test_a_bad_or_missing_signature_is_404(world, queued):
    _ready(world, queued)
    assert world.client.get("/api/v1/me/export/file/").status_code == 404
    assert world.client.get("/api/v1/me/export/file/?t=garbage").status_code == 404


def test_the_link_dies_after_seven_days_and_so_does_the_file(world, queued, monkeypatch):
    export, _ = _ready(world, queued)
    state = world.client.get(EXPORT).data["export"]
    assert export.expires_at - export.finished_at == timedelta(days=7)
    later = timezone.now() + timedelta(days=7, minutes=1)
    monkeypatch.setattr(timezone, "now", lambda: later)
    # 签名的 max_age 与库里的有效期都过了:读作 EXPIRED,下载按钮没了,旧链接 404。
    assert world.client.get(EXPORT).data["export"]["status"] == "EXPIRED"
    assert world.client.get(EXPORT).data["export"]["download_url"] is None
    assert _download(world.client, state).status_code == 404


def test_prune_deletes_expired_files_marks_the_row_and_leaves_fresh_ones(world, queued, media_root):
    old, _ = _ready(world, queued)
    SoulDataExport.objects.filter(pk=old.pk).update(status=DataExportStatus.READY)
    other = _with_password(world.friend)
    with world.capture(execute=True):
        fresh = _request(world.friend_client)
    data_export.build(fresh.data["id"])
    assert len(list((media_root / "private" / "exports").glob("*.zip"))) == 2
    SoulDataExport.objects.filter(pk=old.pk).update(expires_at=timezone.now() - timedelta(minutes=1))

    result = data_export.prune_expired()

    assert result["expired"] == 1
    old.refresh_from_db()
    assert old.status == DataExportStatus.EXPIRED and old.file_path == ""
    left = list((media_root / "private" / "exports").glob("*.zip"))
    assert [p.stem for p in left] == [str(fresh.data["id"])]
    assert SoulDataExport.objects.get(pk=fresh.data["id"]).status == DataExportStatus.READY
    assert other  # (账号对象仅用于设置密码)
    # 过期之后可以再申请。
    assert _request(world.client).status_code == 201


def test_prune_requeues_a_lost_job_and_frees_a_dead_worker(world, queued):
    with world.capture(execute=True):
        lost = _request(world.client).data["id"]
    queued.clear()
    SoulDataExport.objects.filter(pk=lost).update(requested_at=timezone.now() - timedelta(minutes=11))
    assert data_export.prune_expired()["requeued"] == 1 and queued == [str(lost)]
    SoulDataExport.objects.filter(pk=lost).update(status=DataExportStatus.RUNNING,
                                                  requested_at=timezone.now() - timedelta(hours=3))
    assert data_export.prune_expired()["failed"] == 1
    assert SoulDataExport.objects.get(pk=lost).status == DataExportStatus.FAILED


def test_a_job_requeued_hours_late_is_not_failed_by_the_same_prune(world, queued, monkeypatch):
    """「卡住」按 `requested_at` 算,重新入队的也正是 `requested_at` 早的行。worker 一拿到就是 RUNNING;
    同一次清理不能接着把它当卡住的标失败(2026-10-31:此前先入队、后标卡住)。"""
    with world.capture(execute=True):
        late = _request(world.client).data["id"]
    SoulDataExport.objects.filter(pk=late).update(requested_at=timezone.now() - timedelta(hours=3))
    # A worker that claims the job the moment it is enqueued (the claim `build` makes before it starts writing).
    monkeypatch.setattr(data_export, "enqueue", lambda export_id: SoulDataExport.objects.filter(
        pk=export_id).update(status=DataExportStatus.RUNNING))
    assert data_export.prune_expired() == {"expired": 0, "requeued": 1, "failed": 0}
    row = SoulDataExport.objects.get(pk=late)
    assert row.status == DataExportStatus.RUNNING and row.error == ""


def test_building_twice_makes_one_file(world, queued, media_root):
    with world.capture(execute=True):
        export_id = _request(world.client).data["id"]
    assert data_export.build(export_id).status == DataExportStatus.READY
    assert data_export.build(export_id) is None
    assert len(list((media_root / "private" / "exports").glob("*.zip"))) == 1


# ── 通知、登记 ──────────────────────────────────────────────────────────────


def test_ready_writes_one_notification_row_for_the_owner_only(world, queued, enqueued):  # noqa: F811
    export, _ = _ready(world, queued)
    rows = PushDelivery.objects.filter(kind="export_ready")
    assert [(r.account_id, r.dedupe_key, r.data["screen"]) for r in rows] == [
        (world.me.pk, f"export:{export.pk}", "DataExport")]
    assert "7" in rows[0].body and world.me.soul.soul_code not in rows[0].body  # 锁屏上不带编号
    # 没有设备:只记历史,不入队。
    assert rows[0].status == "NO_DEVICE" and enqueued == []


def test_the_notification_is_always_on_even_when_the_soul_turned_pushes_off(world, queued, enqueued):  # noqa: F811
    from apps.soul_push.models import PushPreference

    PushPreference.objects.create(account=world.me, soul=world.me.soul, rebirth=False, judgment=False,
                                  residence=False, chat=False)
    _ready(world, queued)
    assert PushDelivery.objects.filter(kind="export_ready", account=world.me).count() == 1


def test_a_failed_export_sends_no_ready_notification(world, queued, monkeypatch, enqueued):  # noqa: F811
    monkeypatch.setattr(data_export, "_store_archive", lambda export: (_ for _ in ()).throw(RuntimeError("boom")))
    with world.capture(execute=True):
        export_id = _request(world.client).data["id"]
    assert data_export.build(export_id).status == DataExportStatus.FAILED
    assert not PushDelivery.objects.filter(kind="export_ready").exists()


def test_the_daily_prune_is_registered_as_a_global_job_and_the_task_is_the_celery_name():
    spec = registry.get("soul_accounts.prune_data_exports")
    assert spec is not None and spec.scope == registry.GLOBAL
    from apps.soul_accounts.tasks import build_data_export, prune_data_exports

    assert prune_data_exports.name == spec.key and build_data_export.name == "soul_accounts.build_data_export"
    assert registry.get("soul_accounts.build_data_export") is None  # 一次性任务,不进定时表
