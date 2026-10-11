from django.db import migrations

BATCH = 500

#: What `DispatchService.reject` / `cancel_proposed` used to append to `reason`: a blank line, the English
#: marker, one space, the decision reason. Keyed by the status that wrote it.
MARKERS = {
    "REJECTED": "\n\nRejection reason: ",
    "CANCELLED": "\n\nCancellation reason: ",
}


def _batches(queryset):
    """Keyset pages by pk, so rows rewritten while we go can neither be skipped nor seen twice."""
    last = None
    while True:
        page = queryset if last is None else queryset.filter(pk__gt=last)
        rows = list(page.order_by("pk")[:BATCH])
        if not rows:
            return
        yield rows
        last = rows[-1].pk


def split_forward(apps, schema_editor):
    """Move the tail appended to `reason` into `decision_reason`, restoring `reason` to the proposer's text.

    Only a row whose status is the one that writes the marker AND whose `reason` really contains that marker
    is touched; the LAST marker is the split point (the appended tail is always last, and the proposer's own
    text may mention the words). Anything else is left exactly as it is. A row whose tail is empty gets an
    empty `decision_reason` and its dangling marker removed.
    """
    alias = schema_editor.connection.alias
    manager = apps.get_model("dispatch", "DispatchRecord")._base_manager.using(alias)
    for status, marker in MARKERS.items():
        for rows in _batches(manager.filter(status=status, reason__contains=marker)):
            for row in rows:
                row.reason, _, row.decision_reason = row.reason.rpartition(marker)
            manager.bulk_update(rows, ["reason", "decision_reason"])


def split_reverse(apps, schema_editor):
    """Append each decision reason back to `reason` in the old format. A row with no decision reason is not
    touched: the old code appended the marker even to an empty reason, but a bare marker carries nothing, and
    rows that never had one (system cancellations, rows written by other paths) must not gain one."""
    alias = schema_editor.connection.alias
    manager = apps.get_model("dispatch", "DispatchRecord")._base_manager.using(alias)
    for status, marker in MARKERS.items():
        for rows in _batches(manager.filter(status=status).exclude(decision_reason="")):
            for row in rows:
                row.reason = f"{row.reason}{marker}{row.decision_reason}"
                row.decision_reason = ""
            manager.bulk_update(rows, ["reason", "decision_reason"])


class Migration(migrations.Migration):

    dependencies = [
        ("dispatch", "0009_decision_reason_and_decider"),
    ]

    operations = [
        migrations.RunPython(split_forward, split_reverse),
    ]
