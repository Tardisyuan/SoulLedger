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

#: Most data rows one file may carry. A product limit, not a technical one: a larger
#: register belongs in several files so each preview stays readable on screen.
MAX_ROWS = 1000
#: Largest upload accepted, in bytes (MAX_ROWS rows of ordinary text is well under it).
MAX_BYTES = 2 * 1024 * 1024

REQUIRED_COLUMNS = ("name", "civilization")
OPTIONAL_COLUMNS = ("birth_date", "death_date", "origin_location", "birth_name", "description")
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


def _read(data: bytes):
    if len(data) > MAX_BYTES:
        raise ImportFileError("file_too_large", max_bytes=MAX_BYTES)
    try:
        text = data.decode("utf-8-sig")  # tolerates a BOM, rejects anything not UTF-8
    except UnicodeDecodeError as exc:
        raise ImportFileError("bad_encoding") from exc
    reader = csv.reader(io.StringIO(text, newline=""))
    try:
        header = next(reader, None)
        if header is None:
            raise ImportFileError("empty_file")
        header = [h.strip().lower() for h in header]
        if len(set(header)) != len(header):
            raise ImportFileError("duplicate_columns")
        unknown = [h for h in header if h not in COLUMNS]
        if unknown:
            raise ImportFileError("unknown_columns", columns=unknown)
        missing = [c for c in REQUIRED_COLUMNS if c not in header]
        if missing:
            raise ImportFileError("missing_columns", columns=missing)
        rows = []
        for line_no, cells in enumerate(reader, start=2):
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
        for col, limit in MAX_LENGTH.items():
            if len(values[col]) > limit:
                res.add(col, "too_long")

        civ = values["civilization"].upper()
        if civ:
            if civ not in Civilization.values:
                res.add("civilization", "invalid_civilization")
            elif civ != expected:  # no cross-tenant writes: the file may only name the importer's own
                res.add("civilization", "civilization_mismatch")

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
    """Create every row, all or nothing. The caller guarantees no row has errors."""
    batch = uuid.uuid4()
    with transaction.atomic():
        for r in results:
            Soul.objects.create(tenant=tenant, import_batch=batch, **r.parsed)
    return batch
