"""账本导出的 CSV 不得把一个公式当成数据交出去。

`csv.writer` 会给含逗号、引号的单元格加引号;它**不关心单元格以什么开头**。
Excel 与 LibreOffice 关心:首字符是 `= + - @`(以及有些版本会先剥掉的
前导 tab / CR)的单元格,打开即按公式求值。

2026-08-29 实测:名为 `=HYPERLINK("http://evil","click")` 的灵魂产出的行,
去掉 CSV 引号后单元格以 `=` 开头。

这一列的名字来自**外部死亡登记推送**,而导出是一个人在自己机器上打开的文件
—— 写值的人和读文件的人不必是同一个租户。
"""
import csv
import io

import pytest
from rest_framework.test import APIClient

from apps.authentication.models import User, UserRole
from apps.souls.models import Soul
from apps.tenants.models import Tenant

DANGEROUS = [
    '=HYPERLINK("http://evil","click")',
    '+1+1',
    '-1+1',
    '@SUM(A1:A9)',
    '\tcmd',
    '\rcmd',
]


@pytest.fixture
def export(db):
    tenant, _ = Tenant.objects.get_or_create(
        code="CN_DIYU", defaults={"display_name": "CN_DIYU"}
    )
    user = User.objects.create_user(
        username="exporter", password="x", role=UserRole.ADMIN, tenant=tenant
    )
    client = APIClient()
    client.force_authenticate(user=user)

    def run():
        response = client.get("/api/v1/ledger/stats/export/")
        assert response.status_code == 200, response.status_code
        body = b"".join(response.streaming_content).decode() if response.streaming else response.content.decode()
        return list(csv.reader(io.StringIO(body)))

    return tenant, run


@pytest.mark.django_db
@pytest.mark.parametrize("payload", DANGEROUS)
def test_a_name_that_looks_like_a_formula_leaves_as_text(export, payload):
    tenant, run = export
    Soul.objects.create(name=payload, tenant=tenant)
    rows = run()
    cells = [c for row in rows[1:] for c in row]
    offending = [c for c in cells if c[:1] in ("=", "+", "-", "@", "\t", "\r")]
    assert offending == [], (
        f"这些单元格打开即求值:{offending!r}"
    )


@pytest.mark.django_db
def test_the_name_is_still_recoverable(export):
    """**断存在,不只是断缺失。** 一个把 name 一律写成空串的实现,会让上面
    那条永远绿 —— 而导出就再也没有名字了。"""
    tenant, run = export
    Soul.objects.create(name='=HYPERLINK("http://evil","click")', tenant=tenant)
    rows = run()
    body = [c for row in rows[1:] for c in row]
    assert any("HYPERLINK" in c for c in body), body


@pytest.mark.django_db
def test_an_ordinary_name_is_not_mangled(export):
    """无辜的值不该被加前缀 —— 否则每个名字都多一个撇号。"""
    tenant, run = export
    Soul.objects.create(name="张三", tenant=tenant)
    rows = run()
    assert any("张三" in row for row in rows[1:]), rows
    assert not any("'张三" in c for row in rows[1:] for c in row), rows
