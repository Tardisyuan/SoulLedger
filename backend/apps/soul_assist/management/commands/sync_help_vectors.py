"""Embed the help corpus into `HelpChunk` (docs/ARCHITECTURE-soul-assist.md §7.4).

    manage.py sync_help_vectors [--index-threshold N]

Run after `migrate` on deploy and in CI. Idempotent: only new or changed entries
(content hash + model) are embedded, entries gone from the corpus are deleted, and
on PostgreSQL the HNSW index is created past the row threshold and old-model
indexes dropped. The admin page's rebuild button calls the same function.
Exits non-zero when the embedding service fails; nothing is changed then.
"""
from django.core.management.base import BaseCommand, CommandError

from apps.soul_assist import vectors


class Command(BaseCommand):
    help = "Embed new or changed help entries; delete vectors for entries that no longer exist"

    def add_arguments(self, parser):
        parser.add_argument("--index-threshold", type=int, default=vectors.INDEX_THRESHOLD)

    def handle(self, *args, **options):
        try:
            result = vectors.sync(index_threshold=options["index_threshold"])
        except vectors.EmbeddingError as exc:
            raise CommandError(f"embedding service failed ({exc.kind}); nothing changed") from exc
        except vectors.RebuildRunningError as exc:
            raise CommandError("another rebuild is running") from exc
        self.stdout.write(" ".join(f"{k}={result[k]}" for k in
                                   ("embedded", "unchanged", "deleted", "model", "dims", "index", "dropped")))
