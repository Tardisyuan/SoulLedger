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

    {
        "name": "冥界",
        "code": "HADES",
        "category": "EUROPEAN",
        "parent": None,
        "level": 0,
    },
    {"name": "希腊冥界", "code": "HADES_GREEK", "category": "EUROPEAN", "parent_code": "HADES"},
    {"name": "北欧冥界", "code": "HADES_NORSE", "category": "EUROPEAN", "parent_code": "HADES"},
    {"name": "地狱", "code": "HELL", "category": "EUROPEAN", "parent": None, "level": 0},

    # ========== 埃及冥界 ==========
    {
        "name": "埃及冥界",
        "code": "DUAT",
        "category": "EGYPTIAN",
        "parent": None,
        "level": 0,
    },
    {"name": "真理大厅", "code": "DUAT_HALL", "category": "EGYPTIAN", "parent_code": "DUAT"},
    {"name": "十二门", "code": "DUAT_GATES", "category": "EGYPTIAN", "parent_code": "DUAT"},
    {"name": "阿佩普领域", "code": "DUAT_APEP", "category": "EGYPTIAN", "parent_code": "DUAT"},
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
                    org.save(update_fields=["parent"])
                    self.stdout.write(f"    更新父组织: {code} -> {parent_code}")

            # 更新 org_map
            org_map[code] = org

        self.stdout.write(
            self.style.SUCCESS(
                f"\n完成！创建: {created_count}, 更新: {updated_count}, 总计: {len(INITIAL_ORGANIZATIONS)}"
            )
        )

        # 打印树形结构
        self.print_tree()

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
