"""Bulk backfill of `Soul.origin_region` from CSV — preview and apply share `validate_csv`.

Every soul that predates migration 0040 has a blank `origin_region` (不详), which sends Greek cases straight
to Minos. This lets a hall fill the field in for its existing souls. Same two steps, same file reader and same
limits as the importer (`apps/souls/importer.py`): preview writes nothing; apply re-reads the file, locks the
souls it names, validates again under those locks in one transaction, and saves only the rows whose value
changes. Apply is all or nothing like import commit: any row in error and nothing is written.

Each change goes through `Soul.save()`, so the audit signal writes the same per-soul UPDATE row
(`origin_region: [old, new]`) an edit on the soul form writes; the view adds one BATCH_UPDATE row for the
file. No SoulEvent: a field edit on the form writes none either.

Identifier — exactly one of two columns, chosen by the header:
  soul_id    the UUID primary key. Every soul has one; it is what the soul export's first column holds.
  soul_code  the 灵魂编号 officers see. Assigned only when an account is first opened, so most souls have
             none yet and cannot be named this way; normalised like the sign-in screen does.
Both are unique and never change, so either is safe; a file may not mix them (one column per file keeps
"which soul is this row" a single question).

Another hall's soul is `not_found`, exactly like a soul that does not exist: `souls` arrives already scoped to
the caller's hall, so this module cannot tell the two apart and the response cannot leak the difference.
"""
import uuid
from dataclasses import dataclass

from django.db import transaction

from apps.souls.importer import MAX_ROWS, ImportFileError, _read
from apps.souls.models import Soul

ID_COLUMNS = ("soul_id", "soul_code")
COLUMNS = (*ID_COLUMNS, "origin_region")

OK = "ok"
UNCHANGED = "unchanged"
#: Row statuses that block apply.
ERRORS = ("missing_identifier", "not_found", "duplicate_in_file", "invalid_origin_region")


@dataclass
class RegionRow:
    row: int  # line number in the file (the header is line 1)
    values: dict
    status: str = OK
    old: str | None = None  # "" is 不详
    new: str | None = None
    soul: Soul | None = None

    def as_dict(self):
        return {"row": self.row, "status": self.status, "values": self.values, "old": self.old, "new": self.new}


def _key(id_column, text):
    """The identifier as the database holds it, or None when it cannot name any soul."""
    if id_column == "soul_code":
        from apps.soul_accounts.services import normalize_soul_code
        return normalize_soul_code(text) or None
    try:
        return uuid.UUID(text)
    except ValueError:
        return None


def validate_csv(data: bytes, souls) -> list[RegionRow]:
    """One RegionRow per data row, judged against `souls` (the caller's scoped queryset).

    Raises ImportFileError for file-level problems, with the importer's codes plus `identifier_column`
    (the header has neither or both of `soul_id` / `soul_code`).
    """
    header, raw_rows = _read(data, columns=COLUMNS, required=("origin_region",))
    id_columns = [c for c in ID_COLUMNS if c in header]
    if len(id_columns) != 1:
        raise ImportFileError("identifier_column", columns=list(ID_COLUMNS))
    id_column = id_columns[0]
    field = "soul_code" if id_column == "soul_code" else "pk"

    rows, keys = [], []
    for line_no, cells in raw_rows:
        values = {id_column: "", "origin_region": ""}
        for col, cell in zip(header, cells, strict=False):
            values[col] = cell.strip()
        rows.append(RegionRow(row=line_no, values=values))
        keys.append(_key(id_column, values[id_column]))

    wanted = {k for k in keys if k is not None}
    found = {getattr(s, field): s for s in souls.filter(**{f"{field}__in": wanted})} if wanted else {}
    seen = set()
    for r, key in zip(rows, keys, strict=True):
        region = r.values["origin_region"].upper()
        if not r.values[id_column]:
            r.status = "missing_identifier"
        elif key in seen:
            r.status = "duplicate_in_file"
        elif key not in found:
            r.status = "not_found"  # no such soul, or not this hall's: deliberately the same answer
        elif region and region not in Soul.OriginRegion.values:
            r.status = "invalid_origin_region"
        else:
            r.soul = found[key]
            r.old, r.new = r.soul.origin_region, region
            r.status = UNCHANGED if r.old == r.new else OK
        if key is not None:
            seen.add(key)
    return rows


def has_errors(rows) -> bool:
    return any(r.status in ERRORS for r in rows)


def summarize(rows) -> dict:
    count = {s: sum(1 for r in rows if r.status == s) for s in (OK, UNCHANGED)}
    return {
        "total": len(rows),
        "changed_count": count[OK],
        "unchanged_count": count[UNCHANGED],
        "error_count": len(rows) - count[OK] - count[UNCHANGED],
        "max_rows": MAX_ROWS,
        "rows": [r.as_dict() for r in rows],
    }


def apply(data: bytes, souls) -> list[RegionRow]:
    """Validate under row locks and save the changed rows; nothing when any row is in error.

    The first pass only finds which souls to lock. The second runs after the locks are held, so a concurrent
    edit or apply of the same souls is seen before anything is decided (no-op lock on SQLite).
    """
    with transaction.atomic():
        pks = [r.soul.pk for r in validate_csv(data, souls) if r.soul is not None]
        list(Soul.objects.select_for_update().filter(pk__in=pks).values_list("pk", flat=True))
        rows = validate_csv(data, souls)
        if has_errors(rows):
            return rows
        for r in rows:
            if r.status == OK:
                r.soul.origin_region = r.new
                r.soul.save()
    return rows
