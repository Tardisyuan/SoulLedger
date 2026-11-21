"""问数评测(docs/ARCHITECTURE-ask-data.md §7):`evalsets/ask_data.json` 逐题跑 `evals.evaluate`,真闸门、真执行器。

    manage.py ask_data_eval --offline [--tenant CN_DIYU]   桩模型:每题的 naive_sql。证明闸门、执行器、RLS、比对与分类,
                                                         不证明任何模型的准确率
    manage.py ask_data_eval --live [--tenant CN_DIYU]      走 features.complete(生效配置,要配模型):执行准确率

期望结果由 gold_sql 在同一殿、同一库上跑出;用例集记下的离线分数只在评测种子(tests/ask_data_eval_seed.py)上成立,
别的库上数字会不同。要先跑过 `ask_data_setup` 并设了 `ASK_DATA_DATABASE_URL`。
"""
from datetime import date
from types import SimpleNamespace

from django.core.management.base import BaseCommand, CommandError

from apps.soul_assist import config, features
from apps.soul_assist.ask_data import evals, service


class Command(BaseCommand):
    help = "Run the ask_data evalset through the real gate and read-only executor (--offline or --live)"

    def add_arguments(self, parser):
        mode = parser.add_mutually_exclusive_group(required=True)
        mode.add_argument("--offline", action="store_true", help="the stub model: each case's naive_sql")
        mode.add_argument("--live", action="store_true", help="the configured model, through features.complete")
        parser.add_argument("--tenant", help="the hall's code (default: the evalset's)")

    def handle(self, *args, **options):
        from apps.tenants.models import Tenant

        data = features.evalset("ask_data")
        code = options["tenant"] or data["tenant"]
        tenant = Tenant.objects.filter(code=code).first()
        if tenant is None:
            raise CommandError(f"no hall with code {code!r}")
        if not service.configured(tenant.pk):
            raise CommandError("ask_data_not_configured: run ask_data_setup, then set ASK_DATA_DATABASE_URL")
        check, execute = service.eval_hooks(tenant.pk)
        try:
            results = evals.evaluate(data["cases"], generate=self._generator(options["live"], tenant, data),
                                     check=check, execute=execute)
        except ValueError as exc:  # gold 自己跑不通:用例集或库的问题
            raise CommandError(str(exc)) from exc
        for r in results:
            self.stdout.write(f"{r['id']:<28} {r['category']:<18} {r['code'] or ''}")
        summary = evals.summarize(results)
        label = "live" if options["live"] else "offline (stub model: not a model's accuracy)"
        self.stdout.write(f"{label}: accuracy {summary['accuracy']}, adversarial rejected {summary['rejected']}")
        self.stdout.write(" ".join(f"{k}={v}" for k, v in summary["counts"].items()))

    @staticmethod
    def _generator(live, tenant, data):
        if not live:
            return lambda case: case["naive_sql"]
        request, conn = SimpleNamespace(tenant=tenant, user=None), config.effective().connection
        today = date.fromisoformat(data["today"])

        def generate(case):
            try:
                return service.generate(request, case["question"], today=today, conn=conn)
            except features.FeatureUnavailableError:
                return None  # 落 no_sql
        return generate
