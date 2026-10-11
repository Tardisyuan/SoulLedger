"""灵魂端发帖 / 评论的响应带 `screening`(与官员端同一个枚举),不含命中的词。"""
import pytest

from apps.social.models import SensitiveWord, SensitiveWordAction
from tests.soul_social_support import SOCIAL, post, soul

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize(
    "action,expected",
    [
        (SensitiveWordAction.MASK, "masked"),
        (SensitiveWordAction.REVIEW, "pending_review"),
        (SensitiveWordAction.HIDE, "hidden"),
    ],
)
def test_soul_post_and_comment_say_what_happened(cn_tenant, action, expected):
    SensitiveWord.objects.create(tenant=cn_tenant, word="违禁词", action=action)
    account, client = soul(cn_tenant, "作者")
    res = client.post(f"{SOCIAL}/feed/", {"content": "有违禁词", "visibility": "TENANT"}, format="json")
    assert res.status_code == 201
    assert res.json()["screening"] == expected
    assert "违禁词" not in str(res.json()["screening"])
    clean_post = post(account, "干净的")
    c = client.post(f"{SOCIAL}/posts/{clean_post.pk}/comments/", {"content": "违禁词"}, format="json")
    assert c.status_code == 201
    assert c.json()["screening"] == expected


def test_clean_soul_post_is_clean(cn_tenant):
    SensitiveWord.objects.create(tenant=cn_tenant, word="违禁词", action=SensitiveWordAction.HIDE)
    _, client = soul(cn_tenant, "作者")
    res = client.post(f"{SOCIAL}/feed/", {"content": "好好的"}, format="json")
    assert res.json()["screening"] == "clean"
