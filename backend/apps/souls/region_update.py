"""Bulk backfill of `Soul.origin_region` from CSV — preview and apply share `validate_csv`.

Every soul that predates migration 0040 has a blank `origin_region` (不详), which sends Greek cases straight
to Minos. This lets a hall fill the field in for its existing souls. Same two steps, same file reader and same
limits as the importer (`apps/souls/importer.py`): preview writes nothing; apply re-reads the file, locks the
souls it names, validates again under those locks in one transaction, and saves only the rows whose value
changes. Unlike import commit it is not all or nothing (user decision 2026-10-19): a row in error is skipped,
reported back with its status, and every other row is still written — together, in one transaction.
When a file names a soul twice the first row wins; later ones are `duplicate_in_file` with `duplicate_of`.

Columns other than the identifier and `origin_region` are ignored, not refused (also 2026-10-19), so the soul
export — whose first column is headed `Soul ID` — goes back as-is with an `origin_region` column added.

Each change goes through `Soul.save()`, so the audit signal writes the same per-soul UPDATE row
(`origin_region: [old, new]`) an edit on the soul form writes; the view adds one BATCH_UPDATE row for the
file. No SoulEvent: a field edit on the form writes none either.

Identifier — exactly one of two columns, chosen by the header:
  soul_id    the UUID primary key (`Soul ID` is read as the same column). Every soul has one; it is what the
             soul export's first column holds.
  soul_code  the 灵魂编号 officers see. Assigned only when an account is first opened, so most souls have
             none yet and cannot be named this way; normalised like the sign-in screen does.
Both are unique and never change, so either is safe; a file may not carry both (one column per file keeps
"which soul is this row" a single question).

Another hall's soul is `not_found`, exactly like a soul that does not exist: `souls` arrives already scoped to
the caller's hall, so this module cannot tell the two apart and the response cannot leak the difference.
"""
import uuid
from dataclasses import dataclass

from django.db import transaction

from apps.souls.importer import MAX_ROWS, REGION_SPELLINGS, ImportFileError, _read
from apps.souls.models import Soul

ID_COLUMNS = ("soul_id", "soul_code")
#: Header spellings read as one of ID_COLUMNS: the soul export's own heading (lower-cased by the reader).
ALIASES = {"soul id": "soul_id"}

OK = "ok"
UNCHANGED = "unchanged"
#: Row statuses that apply skips.
ERRORS = ("missing_identifier", "not_found", "duplicate_in_file", "invalid_origin_region")


@dataclass
class RegionRow:
    row: int  # line number in the file (the header is line 1)
    values: dict
    identifier: str  # the soul_id / soul_code cell as the file wrote it (trimmed)
    status: str = OK
    old: str | None = None  # "" is 不详
    new: str | None = None
    soul: Soul | None = None  # set only for ok / unchanged rows, i.e. a soul of the caller's own hall
    #: Name of the soul the identifier names, whenever it is one of this hall's (so also for
    #: `invalid_origin_region` / `duplicate_in_file`); None for `not_found` / `missing_identifier`.
    soul_name: str | None = None
    duplicate_of: int | None = None  # for duplicate_in_file: the row of the first occurrence, which wins

    @property
    def clears_value(self) -> bool:
        """A recorded EUROPE / ASIA would become 不详 — Design shows these rows apart."""
        return self.status == OK and self.new == "" and bool(self.old)

    def as_dict(self):
        return {
            "row": self.row, "status": self.status, "values": self.values, "old": self.old, "new": self.new,
            "clears_value": self.clears_value, "duplicate_of": self.duplicate_of, "identifier": self.identifier,
            # Only from `found` (this hall's souls): a `not_found` row can never carry a name.
            "soul_name": self.soul_name,
        }


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

    Raises ImportFileError for file-level problems, with the importer's codes plus `missing_id_column`
    (neither `soul_id` nor `soul_code`) and `mixed_id_columns` (more than one: both, or `soul_id` and
    `Soul ID` together).
    """
    header, raw_rows = _read(data, columns=None, required=("origin_region",))
    header = [ALIASES.get(h, h) for h in header]
    id_columns = [h for h in header if h in ID_COLUMNS]
    if not id_columns:
        raise ImportFileError("missing_id_column", columns=list(ID_COLUMNS))
    if len(id_columns) > 1:  # both, or `soul_id` and `Soul ID` together
        raise ImportFileError("mixed_id_columns", columns=list(ID_COLUMNS))
    id_column = id_columns[0]
    field = "soul_code" if id_column == "soul_code" else "pk"

    rows, keys = [], []
    for line_no, cells in raw_rows:
        values = {id_column: "", "origin_region": ""}
        for col, cell in zip(header, cells, strict=False):
            if col in values:  # every other column is ignored
                values[col] = cell.strip()
        rows.append(RegionRow(row=line_no, values=values, identifier=values[id_column]))
        keys.append(_key(id_column, values[id_column]))

    wanted = {k for k in keys if k is not None}
    found = {getattr(s, field): s for s in souls.filter(**{f"{field}__in": wanted})} if wanted else {}
    first_row = {}  # key -> row number of its first occurrence; that row wins, later ones are duplicates
    for r, key in zip(rows, keys, strict=True):
        region = REGION_SPELLINGS.get(r.values["origin_region"].casefold())
        if key in found:
            r.soul_name = found[key].name
        if not r.values[id_column]:
            r.status = "missing_identifier"
        elif key in first_row:
            r.status, r.duplicate_of = "duplicate_in_file", first_row[key]
        elif key not in found:
            r.status = "not_found"  # no such soul, or not this hall's: deliberately the same answer
        elif region is None:
            r.status = "invalid_origin_region"
            r.old = found[key].origin_region  # shown as 「原值 → 「the cell」」 (Design W-3)
        else:
            r.soul = found[key]
            r.old, r.new = r.soul.origin_region, region
            r.status = UNCHANGED if r.old == r.new else OK
        if key is not None:
            first_row.setdefault(key, r.row)
    return rows


def summarize(rows) -> dict:
    """Preview body. Every row whose status is in ERRORS is one apply will skip."""
    count = {s: sum(1 for r in rows if r.status == s) for s in (OK, UNCHANGED)}
    return {
        "total": len(rows),
        "changed_count": count[OK],
        "unchanged_count": count[UNCHANGED],
        "skipped_count": len(rows) - count[OK] - count[UNCHANGED],
        "clears_count": sum(1 for r in rows if r.clears_value),  # also counted in changed_count
        "max_rows": MAX_ROWS,
        "rows": [r.as_dict() for r in rows],
    }


def apply(data: bytes, souls) -> list[RegionRow]:
    """Validate under row locks and save the changed rows; rows in error are skipped, not fatal.

    The first pass only finds which souls to lock. The second runs after the locks are held, so a concurrent
    edit or apply of the same souls is seen before anything is decided (no-op lock on SQLite).
    """
    with transaction.atomic():
        pks = [r.soul.pk for r in validate_csv(data, souls) if r.soul is not None]
        Soul.lock_many(pks)
        rows = validate_csv(data, souls)
        for r in rows:
            if r.status == OK:
                r.soul.origin_region = r.new
                r.soul.save()
    return rows
