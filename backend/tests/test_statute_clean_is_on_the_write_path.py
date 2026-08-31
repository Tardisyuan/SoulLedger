"""`Statute.clean()` 必须在**写入路径上**被调用,而不只是存在。

Django 的 `Model.save()` **不调用** `full_clean()`;DRF 的 `is_valid()` 跑的是
*序列化器*校验,也不调用模型的 `clean()`;`update_or_create` 直接走 `save()`。
所以在加上 `Statute.save()` 之前,那条 corpus/civilization 交叉检查只有 ModelForm
会触发 —— 而本项目唯一的表单在 admin 里。**真正写 statute 的每一条路径
(`seed_mythology`、迁移里的数据步骤、shell)全都绕过了它。**

下面每条都从一个**具体的写入方式**进去,而不是直接调 `clean()`。直接调 `clean()`
的测试即使在缺陷存在时也会绿 —— 它测的是那个方法,不是那条路径。
"""
import pytest
from django.core.exceptions import ValidationError

from apps.judgment.models import Civilization, Statute, StatuteCorpus, StatutePolarity

MISFILED = dict(
    code="ZZ-TEST-01",
    corpus=StatuteCorpus.GONGGUOGE,   # 中国的功过格……
    civilization=Civilization.GREEK,  # ……被归到希腊名下
    ordinal=1,
    polarity=StatutePolarity.PROCEDURE,
    title_en="misfiled",
    source="test",
)


@pytest.mark.django_db
def test_objects_create_rejects_a_misfiled_corpus():
    with pytest.raises(ValidationError):
        Statute.objects.create(**MISFILED)


@pytest.mark.django_db
def test_update_or_create_rejects_a_misfiled_corpus():
    """`seed_mythology` 走的就是这条 —— 它是最重要的一条。"""
    with pytest.raises(ValidationError):
        Statute.all_objects.update_or_create(code=MISFILED["code"], defaults=MISFILED)


@pytest.mark.django_db
def test_editing_a_good_row_into_a_bad_one_is_rejected():
    """改一行,不是建一行。`save()` 的两种用法都要覆盖。"""
    row = Statute.objects.create(
        code="ZZ-TEST-02",
        corpus=StatuteCorpus.GONGGUOGE,
        civilization=Civilization.CHINESE,
        ordinal=2,
        polarity=StatutePolarity.PROCEDURE,
        title_en="ok",
        source="test",
    )
    row.civilization = Civilization.EGYPTIAN
    with pytest.raises(ValidationError):
        row.save()


@pytest.mark.django_db
def test_a_correctly_filed_row_still_saves():
    """**断缺失,也断存在。** 只断「坏的被拒」的测试,在 `save()` 无条件抛异常时
    也会全绿 —— 那时候整张表都写不进去,而这组测试一条都不会红。"""
    row = Statute.objects.create(
        code="ZZ-TEST-03",
        corpus=StatuteCorpus.GONGGUOGE,
        civilization=Civilization.CHINESE,
        ordinal=3,
        polarity=StatutePolarity.PROCEDURE,
        title_en="ok",
        source="test",
    )
    assert Statute.all_objects.filter(pk=row.pk).exists()
