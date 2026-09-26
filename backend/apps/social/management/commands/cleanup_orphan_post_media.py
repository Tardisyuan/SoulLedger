"""清掉传了却没挂到任何帖子上的朋友圈图片(行与文件)。

    manage.py cleanup_orphan_post_media                 # 上传超过 24 小时仍未发出的
    manage.py cleanup_orphan_post_media --hours 6
    manage.py cleanup_orphan_post_media --dry-run

**平时由定时任务 `social.cleanup_orphan_post_media` 每天跑**(apps/scheduler/registry.py,
GLOBAL,03:15 UTC,24 小时阈值);这条命令是同一个函数(`media.cleanup_orphans`)的手动入口,
多了 `--hours` 与 `--dry-run`。

不跑的后果只是磁盘:孤儿图片对任何人都不可见(`media.may_view` 只放行上传者本人),
每人未发出的图片又有上限(`media.MAX_PENDING`),所以堆积有界。

还顺带扫一遍 `private/post_media/` 下**没有任何行指向**的文件(存盘成功、建行失败的
残留),同样只清超过时限的。幂等:第二次运行什么也不删。
"""
from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError

from apps.social import media as post_media


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
        result = post_media.cleanup_orphans(timedelta(hours=hours), dry_run=options["dry_run"])
        verb = "would delete" if options["dry_run"] else "deleted"
        self.stdout.write(
            f"{verb} {result['orphans']} orphan image(s) and {result['stray_files']} unreferenced file(s)"
        )
