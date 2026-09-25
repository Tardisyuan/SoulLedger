"""清掉传了却没挂到任何帖子上的朋友圈图片(行与文件)。

    manage.py cleanup_orphan_post_media                 # 上传超过 24 小时仍未发出的
    manage.py cleanup_orphan_post_media --hours 6
    manage.py cleanup_orphan_post_media --dry-run

**什么时候跑:每天一次,由部署机的 cron(或等价的外部调度)调用。** celery beat
还没有部署(见 apps/disposition/management/commands/expire_dispositions.py 同样的说明),
所以这不是一个 celery 任务、也不在 apps/scheduler/registry.py 里 —— 登记进去只会得到
一条永远不触发的 PeriodicTask。建议的 crontab 行:

    17 3 * * *  docker compose exec -T backend python manage.py cleanup_orphan_post_media

不跑的后果只是磁盘:孤儿图片对任何人都不可见(`media.may_view` 只放行上传者本人),
每人未发出的图片又有上限(`media.MAX_PENDING`),所以堆积有界。

还顺带扫一遍 `private/post_media/` 下**没有任何行指向**的文件(存盘成功、建行失败的
残留),同样只清超过时限的。幂等:第二次运行什么也不删。
"""
from datetime import timedelta

from django.core.files.storage import default_storage
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.social import media as post_media
from apps.social.models import PRIVATE_MEDIA_PREFIX, PostMedia

MEDIA_DIR = f"{PRIVATE_MEDIA_PREFIX}post_media"


def _walk(storage, path):
    if not storage.exists(path):
        return
    dirs, files = storage.listdir(path)
    for name in files:
        yield f"{path}/{name}"
    for name in dirs:
        yield from _walk(storage, f"{path}/{name}")


class Command(BaseCommand):
    help = "Delete 朋友圈 post images that were uploaded but never attached to a post (rows and files)"

    def add_arguments(self, parser):
        parser.add_argument(
            "--hours", type=int, default=int(post_media.ORPHAN_AFTER.total_seconds() // 3600),
            help="Only images uploaded more than this many hours ago (default 24)",
        )
        parser.add_argument("--dry-run", action="store_true", help="Report, delete nothing")

    def handle(self, *args, **options):
        hours = options["hours"]
        if hours < 1:
            raise CommandError("--hours must be at least 1")
        cutoff = timedelta(hours=hours)
        rows = post_media.orphans(cutoff)
        count = rows.count()
        if not options["dry_run"]:
            rows.delete()  # 真 DELETE;文件由 PostMedia 的 post_delete 在提交后删
        stray = self._stray_files(timezone.now() - cutoff)
        if not options["dry_run"]:
            for name in stray:
                default_storage.delete(name)
        verb = "would delete" if options["dry_run"] else "deleted"
        self.stdout.write(f"{verb} {count} orphan image(s) and {len(stray)} unreferenced file(s)")

    def _stray_files(self, before):
        known = set(PostMedia.all_objects.values_list("file", flat=True))
        stray = []
        for name in _walk(default_storage, MEDIA_DIR):
            if name in known:
                continue
            if default_storage.get_modified_time(name) < before:
                stray.append(name)
        return stray
