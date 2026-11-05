"""English for the seeded menus: what the sidebar already showed, from the language packs and the display table.

By path for a page and by name for a group, the same keys `frontend/src/lib/menuI18n.ts` uses, so a page an
administrator renamed still gets its English. Only blank columns are filled. Reverse: `0034` drops the column.
"""
from django.db import migrations

BY_PATH = {
    "/welcome": "Welcome",
    "/social": "Feed",
    "/disposition": "Dispositions",
    "/dashboard": "Dashboard",
    "/souls": "Soul Management",
    "/workflow": "Approval Workflow",
    "/realms": "Realm Management",
    "/users": "User Management",
    "/halls": "Halls at a glance",
    "/events": "Soul events",
    "/judgment/capture-due": "Awaiting a capture warrant",
    "/profile": "Profile",
    "/city-god-cases": "City God review",
    "/social/follows": "Follows",
    "/admin/stats": "Karma Statistics",
    "/judgment": "Judgment Queue",
    "/dispatch": "Dispatch Management",
    "/actors": "Deity Roster",
    "/permissions": "Permissions & Roles",
    "/notifications": "Notification Centre",
    "/rebirths": "Rebirth register",
    "/corpus": "Corpus",
    "/city-gods": "City Gods",
    "/death-sync/tudi-gods": "Earth Gods",
    "/death-sync": "Death Sync",
    "/cross-judgments": "Cross-Realm Judgment",
    "/menus": "Menu Management",
    "/judgment/appeals": "Appeal reviews",
    "/sentence-plans": "Sentence Plans",
    "/sentence-requests": "Sentence Requests",
    "/rebirth-applications": "Rebirth Applications",
    "/ledger": "Merit Ledger",
    "/audit": "Audit Log",
    "/audit/sessions": "Online sessions",
    "/scheduler": "Scheduled Tasks",
    "/admin/assistant": "Assistant Admin",
    "/tenants": "Tenant Management",
    "/organizations": "Organization Structure",
    "/soul-credentials": "Initial Passwords Awaiting Delivery",
    "/moderation": "Circle Moderation",
    "/recycle-bin": "Recycle Bin",
    "/soul-inbox": "Hall Inbox",
}

BY_GROUP_NAME = {
    "概览": "Overview",
    "灵魂业务": "Soul Affairs",
    "轮回": "Reincarnation",
    "流程协作": "Process & Collaboration",
    "组织与领域": "Organizations & Realms",
    "社交": "Social",
    "系统设置": "System Settings",
    "全局": "Global",
}


def forwards(apps, schema_editor):
    db = schema_editor.connection.alias
    Menu = apps.get_model("menus", "Menu")
    for path, english in BY_PATH.items():
        Menu._base_manager.using(db).filter(path=path, name_en="").update(name_en=english)
    for name, english in BY_GROUP_NAME.items():
        Menu._base_manager.using(db).filter(path="", name=name, name_en="").update(name_en=english)


class Migration(migrations.Migration):
    dependencies = [("menus", "0034_english_columns")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
