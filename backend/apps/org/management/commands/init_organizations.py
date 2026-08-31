"""
初始化组织架构数据
用法: python manage.py init_organizations
"""
from django.core.management.base import BaseCommand

from apps.org.models import Organization

# 预定义的组织架构数据
INITIAL_ORGANIZATIONS = [
    # ========== 中国地府 ==========
    {
        "name": "中国地府",
        "code": "DIYU",
        "category": "CHINESE",
        "parent": None,
        "level": 0,
    },
    # 十殿（平行）
    {"name": "第一殿-秦广王", "code": "DIYU_01", "category": "CHINESE", "parent_code": "DIYU"},
    {"name": "第二殿-楚江王", "code": "DIYU_02", "category": "CHINESE", "parent_code": "DIYU"},
    {"name": "第三殿-宋帝王", "code": "DIYU_03", "category": "CHINESE", "parent_code": "DIYU"},
    {"name": "第四殿-五官王", "code": "DIYU_04", "category": "CHINESE", "parent_code": "DIYU"},
    {"name": "第五殿-阎罗王", "code": "DIYU_05", "category": "CHINESE", "parent_code": "DIYU"},
    {"name": "第六殿-卞城王", "code": "DIYU_06", "category": "CHINESE", "parent_code": "DIYU"},
    {"name": "第七殿-泰山王", "code": "DIYU_07", "category": "CHINESE", "parent_code": "DIYU"},
    {"name": "第八殿-都市王", "code": "DIYU_08", "category": "CHINESE", "parent_code": "DIYU"},
    {"name": "第九殿-平等王", "code": "DIYU_09", "category": "CHINESE", "parent_code": "DIYU"},
    {"name": "第十殿-转轮王", "code": "DIYU_10", "category": "CHINESE", "parent_code": "DIYU"},
    # 四大判官
    {"name": "崔珏（崔府君）", "code": "DIYU_PAN_GUAN_01", "category": "CHINESE", "parent_code": "DIYU"},
    {"name": "钟馗", "code": "DIYU_PAN_GUAN_02", "category": "CHINESE", "parent_code": "DIYU"},
    {"name": "魏征", "code": "DIYU_PAN_GUAN_03", "category": "CHINESE", "parent_code": "DIYU"},
    {"name": "陆之道", "code": "DIYU_PAN_GUAN_04", "category": "CHINESE", "parent_code": "DIYU"},
    # 六案功曹
    {"name": "天曹", "code": "DIYU_LIU_AN_01", "category": "CHINESE", "parent_code": "DIYU"},
    {"name": "地曹", "code": "DIYU_LIU_AN_02", "category": "CHINESE", "parent_code": "DIYU"},
    {"name": "神曹", "code": "DIYU_LIU_AN_03", "category": "CHINESE", "parent_code": "DIYU"},
    {"name": "鬼曹", "code": "DIYU_LIU_AN_04", "category": "CHINESE", "parent_code": "DIYU"},
    # 执行层
    {"name": "黑白无常", "code": "DIYU_WUCHANG", "category": "CHINESE", "parent_code": "DIYU"},
    {"name": "牛头马面", "code": "DIYU_NIUTOU", "category": "CHINESE", "parent_code": "DIYU"},
    {"name": "孟婆", "code": "DIYU_MENGPO", "category": "CHINESE", "parent_code": "DIYU"},
    # 地方神祇
    {"name": "城隍体系", "code": "DIYU_CHENGHUANG", "category": "CHINESE", "parent_code": "DIYU"},
    {"name": "土地公", "code": "DIYU_TUDIGONG", "category": "CHINESE", "parent_code": "DIYU"},

    # ========== 欧洲天堂地狱 ==========
    {
        "name": "天堂",
        "code": "HEAVEN",
        "category": "EUROPEAN",
        "parent": None,
        "level": 0,
    },
    {"name": "大天使团", "code": "HEAVEN_ANGEL", "category": "EUROPEAN", "parent_code": "HEAVEN"},
    {"name": "天堂执行层", "code": "HEAVEN_EXEC", "category": "EUROPEAN", "parent_code": "HEAVEN"},

    {"name": "地狱", "code": "HELL", "category": "EUROPEAN", "parent": None, "level": 0},

    # ========== 希腊冥界 ==========
    # These two were `category="EUROPEAN"` until GREEK became its own
    # civilization, and they are the one org subtree that was never Christian or
    # Dantean: 冥界/HADES and its child 希腊冥界/HADES_GREEK exist to hold the
    # Greek cast, and the child said so in its own name while filing itself
    # under the European category. Rows already in a database are moved by
    # org/0007_hades_tree_becomes_greek — this table only decides what a fresh
    # `init_organizations` creates, and it creates with `get_or_create` defaults
    # that never touch an existing row's category.
    {
        "name": "冥界",
        "code": "HADES",
        "category": "GREEK",
        "parent": None,
        "level": 0,
    },
    {"name": "希腊冥界", "code": "HADES_GREEK", "category": "GREEK", "parent_code": "HADES"},
    # 北欧冥界 (HADES_NORSE) used to sit here as a second child of HADES. Norse
    # is out of this system entirely — a pantheon whose destination depends on
    # the manner of death, not on a verdict, has no judgment step to host, and
    # apps/actors' consolidate_eu_pantheon removed the actors on that basis.
    # The org node was the last thing still creating a home for them. It had no
    # children, no users and no ORG-scoped roles pointing at it, so removing it
    # takes nothing with it; a database seeded before this keeps its row until
    # someone deletes it by hand.

    # ========== 埃及冥界 ==========
    {
        "name": "埃及冥界",
        "code": "DUAT",
        "category": "EGYPTIAN",
        "parent": None,
        "level": 0,
    },
    {"name": "真理大厅", "code": "DUAT_HALL", "category": "EGYPTIAN", "parent_code": "DUAT"},
    # 「十二门」 named the Book of Gates' structure without saying so, which is
    # the confusion the realm side was just re-anchored away from: the Book of
    # Gates and the Amduat are two different books about Ra's night voyage, and
    # the dead person's own itinerary is BD 144/147 and 145/146 (see
    # EG_SEVEN_ARRWT and EG_TWENTYONE_SEBKHET in mythology/realms.py, and
    # docs/lore-verification/verify-egyptian.md §9.4, which asks for exactly
    # this rename). The display name now says which book it is; `code` is left
    # alone because init_organizations matches on it and it is a join key.
    {"name": "门之书十二门", "code": "DUAT_GATES", "category": "EGYPTIAN", "parent_code": "DUAT"},
    # Same shape as DUAT_GATES above, found alongside it: Apep is the serpent Ra
    # fights during the night voyage, so this node is Ra's journey too, not the
    # dead person's. verify-egyptian.md §9.4 names only DUAT_GATES, so this one
    # is a reading of the same finding rather than a quotation of it — the name
    # says which book, and `code` is left alone for the same reason.
    {"name": "阴间之书阿佩普领域", "code": "DUAT_APEP", "category": "EGYPTIAN", "parent_code": "DUAT"},
]


class Command(BaseCommand):
    help = "初始化组织架构数据"

    def handle(self, *args, **options):
        self.stdout.write("开始初始化组织架构...")

        # 先建立 code -> instance 的映射
        org_map = {org.code: org for org in Organization.objects.all()}

        created_count = 0
        updated_count = 0

        for org_data in INITIAL_ORGANIZATIONS:
            code = org_data["code"]
            parent_code = org_data.get("parent_code")

            # 获取或创建组织
            org, created = Organization.objects.get_or_create(
                code=code,
                defaults={
                    "name": org_data["name"],
                    "category": org_data["category"],
                }
            )

            if created:
                created_count += 1
                self.stdout.write(f"  创建: {code} - {org_data['name']}")
            else:
                updated_count += 1

            # 处理父子关系
            if parent_code and parent_code in org_map:
                parent = org_map[parent_code]
                if org.parent != parent:
                    org.parent = parent
                    # `level` as well as `parent`. `Organization.save()`
                    # recomputes `level` from the parent — and then
                    # `update_fields=["parent"]` left it out of the UPDATE
                    # statement, so the computed value was discarded every
                    # time. Measured on the shared box 2026-08-29:
                    # `select level, count(*) from organizations group by 1`
                    # returned `0 | 35` — the *whole table*, DIYU_01..10
                    # included, at depth zero. `help_text` says the column is
                    # "层级深度（用于权限计算）".
                    #
                    # org/tests.py:47 asserts `level == 1` through
                    # `objects.create(parent=...)` — the one path that did
                    # work — so the defect had a passing test sitting next to
                    # it. `_fix_levels` below covers the rest: a child seen
                    # before its parent computes from a stale parent level,
                    # and this loop's order is the order of a literal list.
                    org.save(update_fields=["parent", "level"])
                    self.stdout.write(f"    更新父组织: {code} -> {parent_code}")

            # 更新 org_map
            org_map[code] = org

        fixed = self._fix_levels()
        if fixed:
            self.stdout.write(f"  修正层级深度: {fixed} 行")

        self.stdout.write(
            self.style.SUCCESS(
                f"\n完成！创建: {created_count}, 更新: {updated_count}, 总计: {len(INITIAL_ORGANIZATIONS)}"
            )
        )

        # 打印树形结构
        self.print_tree()

    def _fix_levels(self):
        """Recompute every row's depth top-down, and report how many moved.

        Not `for org in ...: org.save()` — that computes each row from
        whatever its parent's *stored* level happens to be, which is the bug
        one level up. Walking roots outward means a parent's depth is always
        settled before its children are asked.

        Covers rows this command did not touch as well: `HADES_NORSE` was
        reparented by a migration, and nothing recomputes depth on that path
        either.
        """
        rows = list(Organization.objects.all())
        children: dict = {}
        for org in rows:
            children.setdefault(org.parent_id, []).append(org)

        fixed = 0
        frontier = [(org, 0) for org in children.get(None, [])]
        while frontier:
            org, depth = frontier.pop()
            if org.level != depth:
                Organization.objects.filter(pk=org.pk).update(level=depth)
                fixed += 1
            frontier.extend((child, depth + 1) for child in children.get(org.pk, []))
        return fixed

    def print_tree(self):
        self.stdout.write("\n=== 组织架构树 ===")

        def print_org(org, indent=0):
            prefix = "  " * indent
            self.stdout.write(f"{prefix}{org.code} - {org.name}")
            for child in org.children.all().order_by("sort", "code"):
                print_org(child, indent + 1)

        # 打印根组织
        for root in Organization.objects.filter(parent__isnull=True).order_by("category", "code"):
            print_org(root)
