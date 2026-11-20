"""问数的演示命令(docs/ARCHITECTURE-ask-data.md §2):与接口同一条路径(`ask_data/service.py`)。

    manage.py ask_data "今年第一殿结了多少案" --tenant CN_DIYU
    manage.py ask_data --tenant CN_DIYU --sql "SELECT count(*) FROM judgment_judgment"

`--sql` 跳过召回与模型,把给定的 SQL 直接送进闸门和执行器:没配模型也能演示闸门与 RLS。
要先跑过 `ask_data_setup` 并设了 `ASK_DATA_DATABASE_URL`(ADR 0007)。输出 SQL、结果表,或错误码。
"""
from types import SimpleNamespace

from django.core.management.base import BaseCommand, CommandError

from apps.soul_assist import features
from apps.soul_assist.ask_data import service


class Command(BaseCommand):
    help = "Ask one question of a hall's data (or run --sql through the gate and the read-only executor)"

    def add_arguments(self, parser):
        parser.add_argument("question", nargs="?", default="")
        parser.add_argument("--tenant", required=True, help="the hall's code, e.g. CN_DIYU")
        parser.add_argument("--sql", help="skip the model: send this SQL to the gate and the executor")

    def handle(self, *args, **options):
        from apps.tenants.models import Tenant

        tenant = Tenant.objects.filter(code=options["tenant"]).first()
        if tenant is None:
            raise CommandError(f"no hall with code {options['tenant']!r}")
        if not service.configured():
            raise CommandError("ask_data_not_configured: run ask_data_setup, then set ASK_DATA_DATABASE_URL")
        sql = options["sql"]
        if sql is None:
            if not options["question"]:
                raise CommandError("give a question, or --sql")
            try:
                sql = service.generate(SimpleNamespace(tenant=tenant, user=None), options["question"]) or ""
            except features.FeatureUnavailableError as exc:
                raise CommandError(exc.code) from exc
        self.stdout.write(f"sql: {sql}")
        try:
            result = service.run_sql(sql, tenant.pk)
        except service.AskDataError as exc:
            raise CommandError(exc.code) from exc
        self.stdout.write("\t".join(result["columns"]))
        for row in result["rows"]:
            self.stdout.write("\t".join("NULL" if v is None else str(v) for v in row))
        self.stdout.write(f"({len(result['rows'])} rows{', truncated' if result['truncated'] else ''}, "
                          f"{result['elapsed_ms']} ms)")
