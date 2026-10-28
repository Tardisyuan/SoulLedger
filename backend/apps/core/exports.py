"""CSV export of "the rows this list shows", for list pages that gained an 导出 button.

The shape every export here shares (see `apps/audit/views.py::export`, which this
follows): the caller passes the queryset the list would return **after** its own
tenant scope and filters, so file and screen cannot drift; more than
`EXPORT_MAX_ROWS` rows is a 400, never a truncated file; free-text cells go
through `csv_safe`; the export itself is written to the audit log.

Cells come from the list **serializer**, not from model fields: whatever the list
hides from this caller (a field permission, a field the list never sends) is
blank in the file too. Enum cells are the raw member, as in the soul export.
"""
import csv

from django.http import HttpResponse
from rest_framework.exceptions import ValidationError

from apps.core.csv_safe import csv_safe

#: Every export's ceiling, the audit export included. Design batch 28 W5 greys the
#: button above 1 万 rows and says so (`common.export_too_many`); the server holds
#: the same line, so pages without a row count cannot export more than the UI promises.
EXPORT_MAX_ROWS = 10_000
_CHUNK = 500


def _cell(value):
    # csv_safe is for text; applied to a negative number it would prefix an apostrophe.
    return csv_safe(value) if isinstance(value, str) else ("" if value is None else value)


def refuse_if_too_many(qs):
    """400 when more than `EXPORT_MAX_ROWS` rows would be written. For the hand-written exports too."""
    if qs.count() > EXPORT_MAX_ROWS:
        raise ValidationError({"detail": f"More than {EXPORT_MAX_ROWS} rows match; narrow the filters."})


def export_csv(request, *, qs, serializer_class, columns, filename, resource):
    """`columns` is [(header, serializer_key), ...]. Returns the CSV response."""
    refuse_if_too_many(qs)

    response = HttpResponse(content_type="text/csv")
    response["Content-Disposition"] = f"attachment; filename={filename}"
    writer = csv.writer(response)
    writer.writerow([header for header, _ in columns])

    written, chunk = 0, []

    def flush():
        nonlocal written
        data = serializer_class(chunk, many=True, context={"request": request}).data
        for row in data:
            writer.writerow([_cell(row.get(key)) for _, key in columns])
        written += len(chunk)
        chunk.clear()

    for obj in qs.iterator(chunk_size=_CHUNK):
        chunk.append(obj)
        if len(chunk) >= _CHUNK:
            flush()
    if chunk:
        flush()

    record_export(request, resource=resource, rows=written)
    return response


def record_export(request, *, resource, rows):
    """The audit row every CSV export leaves: who, which filters (`query`), how many rows.

    Called by `export_csv` and by the older exports that stream their own columns (souls,
    audit log, ledger stats and journal), so all of them write the same row. Tenant is the
    request's, else the caller's own (`force_authenticate` skips the middleware).
    """
    from apps.audit.models import AuditAction, AuditLog
    from apps.authentication.impersonation import is_impersonation, refuse
    from apps.core.client_ip import get_client_ip

    # 代看(只读)期间不导出:导出会以被看者的名义写审计行,也把数据带出系统。认证层按路径已拦,这里是所有 CSV 导出共用的第二道。
    if is_impersonation(getattr(request, "auth", None)):
        raise refuse("impersonation_read_only", "查看中，不能导出。")
    user =request.user if request.user.is_authenticated else None
    AuditLog.objects.create(
        tenant=getattr(request, "tenant", None) or getattr(user, "tenant", None),
        user=user,
        action=AuditAction.EXPORT,
        resource=resource,
        changes={"query": request.query_params.dict(), "rows": rows},
        description=f"Exported {rows} {resource} rows"[:500],
        ip_address=get_client_ip(request),
        user_agent=request.META.get("HTTP_USER_AGENT", "")[:500],
    )
