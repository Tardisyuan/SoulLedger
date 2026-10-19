"""Bulk soul import from CSV — parse and validate, shared by preview and commit.

Two endpoints use the one function here (`validate_csv`): preview returns what it
finds and writes nothing; commit refuses unless it finds no error, then creates
every row in one transaction. Commit re-validates the file itself rather than
trusting a preview, so a duplicate created between the two calls is caught.

Everything wrong is reported as a stable `code` (the web translates it), pinned to
the CSV column it concerns. File-level problems (bad encoding, missing columns,
too many rows) raise `ImportFileError` and become a 400 before any row is read.

Natural key for duplicates — Soul has no unique business key (the only unique
column, `soul_code`, is assigned later by account opening), so a duplicate is the
same tenant + same name (case-insensitive, trimmed) + same birth year/month/day.
Two rows with no birth date and the same name therefore collide; that is deliberate,
since nothing else distinguishes them.

Text is stored as typed. The export side prefixes `'` to formula-looking cells
(`apps.core.csv_safe`), but export columns differ from import columns, so an
exported file is not meant to be re-imported and nothing here un-escapes it.
"""
import csv
import io
import re
import uuid
from dataclasses import dataclass, field

from django.db import transaction
from django.db.models.functions import Lower

from apps.souls.dates import check_soul_dates, validate_historical_date
from apps.souls.models import TENANT_CIVILIZATION, Civilization, Soul
from apps.tenants.models import Tenant

#: Most data rows one file may carry. A product limit, not a technical one: a larger
#: register belongs in several files so each preview stays readable on screen.
MAX_ROWS = 1000
#: Largest upload accepted, in bytes (MAX_ROWS rows of ordinary text is well under it).
MAX_BYTES = 2 * 1024 * 1024

REQUIRED_COLUMNS = ("name", "civilization")
OPTIONAL_COLUMNS = ("birth_date", "death_date", "origin_location", "birth_name", "description", "origin_region")
COLUMNS = REQUIRED_COLUMNS + OPTIONAL_COLUMNS
#: Matches Soul.name / origin_location / birth_name (max_length=255). `description`
#: is a TextField with no database limit; this one is ours.
MAX_LENGTH = {"name": 255, "origin_location": 255, "birth_name": 255, "description": 2000}

_DATE_RE = re.compile(r"^(-?\d{1,6})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$")


class ImportFileError(Exception):
    """The file as a whole is unusable; `code` is stable, `detail` is for the client."""

    def __init__(self, code, **detail):
        super().__init__(code)
        self.code = code
        self.detail = detail


class ImportConflictError(Exception):
    """Rows turned into duplicates between validation and the write."""

    def __init__(self, results):
        super().__init__("import_conflict")
        self.results = results


@dataclass
class RowResult:
    row: int  # line number in the file (the header is line 1, the first data row 2)
    values: dict
    errors: list = field(default_factory=list)  # [{"field": str, "code": str}]
    parsed: dict | None = None  # model kwargs when ok

    def add(self, field_name, code):
        self.errors.append({"field": field_name, "code": code})

    def as_dict(self):
        return {
            "row": self.row,
            "status": "error" if self.errors else "ok",
            "values": self.values,
            "errors": self.errors,
        }


def _parse_date(text):
    """'-612' / '-612-03' / '1943-05-02' -> (y, m, d), or raise ValueError. Empty -> all None."""
    if not text:
        return None, None, None
    m = _DATE_RE.match(text)
    if not m:
        raise ValueError(text)
    y, mo, d = m.group(1), m.group(2), m.group(3)
    triple = (int(y), int(mo) if mo else None, int(d) if d else None)
    validate_historical_date(*triple)
    return triple


def _read(data: bytes, columns=COLUMNS, required=REQUIRED_COLUMNS):
    """-> (header, [(line_no, cells)]). Shared with `apps/souls/region_update.py`, which passes `columns=None`:
    any other column is allowed there (and ignored), so an exported file can go back with one column edited."""
    if len(data) > MAX_BYTES:
        raise ImportFileError("file_too_large", max_bytes=MAX_BYTES)
    try:
        text = data.decode("utf-8-sig")  # tolerates a BOM, rejects anything not UTF-8
    except UnicodeDecodeError as exc:
        # Excel on Chinese Windows saves "CSV" as GBK. Not decoded here (GB18030 accepts almost any
        # bytes, so a wrong guess would store mojibake); only named, so the client can say "save as UTF-8".
        try:
            data.decode("gb18030")
        except UnicodeDecodeError:
            raise ImportFileError("bad_encoding") from exc
        raise ImportFileError("bad_encoding_gbk") from exc
    reader = csv.reader(io.StringIO(text, newline=""))
    try:
        header = next(reader, None)
        if header is None:
            raise ImportFileError("empty_file")
        header = [h.strip().lower() for h in header]
        if len(set(header)) != len(header):
            raise ImportFileError("duplicate_columns")
        unknown = [h for h in header if h not in columns] if columns is not None else []
        if unknown:
            raise ImportFileError("unknown_columns", columns=unknown)
        missing = [c for c in required if c not in header]
        if missing:
            raise ImportFileError("missing_columns", columns=missing)
        rows = []
        while True:
            # A quoted field may hold newlines, so a record spans lines: report the line it starts on.
            line_no = reader.line_num + 1
            cells = next(reader, None)
            if cells is None:
                break
            if not any(c.strip() for c in cells):
                continue  # blank line
            if len(rows) >= MAX_ROWS:
                raise ImportFileError("too_many_rows", max_rows=MAX_ROWS)
            rows.append((line_no, cells))
    except csv.Error as exc:
        raise ImportFileError("malformed_csv") from exc
    if not rows:
        raise ImportFileError("no_rows")
    return header, rows


def validate_csv(data: bytes, tenant) -> list[RowResult]:
    """One RowResult per data row. Raises ImportFileError for file-level problems."""
    header, raw_rows = _read(data)
    expected = TENANT_CIVILIZATION.get(tenant.code)
    results = []
    for line_no, cells in raw_rows:
        values = {c: "" for c in COLUMNS}
        for col, cell in zip(header, cells, strict=False):
            values[col] = cell.strip()
        res = RowResult(row=line_no, values=values)
        if len(cells) > len(header):
            res.add("_row", "too_many_cells")

        for col in REQUIRED_COLUMNS:
            if not values[col]:
                res.add(col, "required")
        for col, cell in values.items():
            if "\x00" in cell:  # PostgreSQL text cannot hold NUL: it passed preview and crashed commit
                res.add(col, "invalid_characters")
        for col, limit in MAX_LENGTH.items():
            if len(values[col]) > limit:
                res.add(col, "too_long")

        civ = values["civilization"].upper()
        if civ:
            if civ not in Civilization.values:
                res.add("civilization", "invalid_civilization")
            elif expected is not None and civ != expected:
                # no cross-tenant writes: the file may only name the importer's own. A hall with no
                # civilization mapping has no "own" to compare with (Soul.civilization is derived from the
                # hall, never stored from the file), so every row would fail with no way to fix the file.
                res.add("civilization", "civilization_mismatch")

        region = values["origin_region"].upper()
        if region and region not in Soul.OriginRegion.values:
            res.add("origin_region", "invalid_origin_region")

        dates = {}
        date_bad = False
        for col in ("birth_date", "death_date"):
            try:
                dates[col] = _parse_date(values[col])
            except ValueError:
                dates[col] = (None, None, None)
                date_bad = True
                res.add(col, "invalid_date")
        if not date_bad:
            for problem in check_soul_dates(dates["birth_date"], dates["death_date"]):
                res.add("death_date", problem.code)  # death_before_birth / implausible_lifespan

        if not res.errors:
            by, bm, bd = dates["birth_date"]
            dy, dm, dd = dates["death_date"]
            res.parsed = {
                "name": values["name"],
                "origin_location": values["origin_location"],
                "origin_region": region,
                "birth_name": values["birth_name"],
                "description": values["description"],
                "birth_year": by, "birth_month": bm, "birth_day": bd,
                "death_year": dy, "death_month": dm, "death_day": dd,
            }
        results.append(res)

    _flag_duplicates(results, tenant)
    return results


def _flag_duplicates(results, tenant):
    named = [r for r in results if r.parsed]
    if not named:
        return
    existing = set(
        Soul.all_objects.filter(tenant=tenant, is_deleted=False)
        .annotate(_lname=Lower("name"))
        .filter(_lname__in={r.parsed["name"].lower() for r in named})
        .values_list("_lname", "birth_year", "birth_month", "birth_day")
    )
    seen = set()
    for r in named:
        p = r.parsed
        key = (p["name"].lower(), p["birth_year"], p["birth_month"], p["birth_day"])
        if key in seen:
            r.add("name", "duplicate_in_file")
        elif key in existing:
            r.add("name", "duplicate_existing")
        seen.add(key)
        if r.errors:
            r.parsed = None


def summarize(results) -> dict:
    bad = sum(1 for r in results if r.errors)
    return {
        "total": len(results),
        "ok_count": len(results) - bad,
        "error_count": bad,
        "max_rows": MAX_ROWS,
        "rows": [r.as_dict() for r in results],
    }


def create_souls(results, tenant) -> uuid.UUID:
    """Create every row, all or nothing. The caller guarantees no row has errors.

    Raises ImportConflictError when a concurrent commit of the same file got there first: validation ran
    before this transaction, so the duplicate check is repeated here under a lock on the hall row.
    """
    batch = uuid.uuid4()
    with transaction.atomic():
        # Serialises imports per hall (no-op on SQLite); the re-check then sees the other commit's souls.
        Tenant.objects.select_for_update().get(pk=tenant.pk)
        _flag_duplicates(results, tenant)
        if any(r.errors for r in results):
            raise ImportConflictError(results)
        for r in results:
            Soul.objects.create(tenant=tenant, import_batch=batch, **r.parsed)
    return batch
