"""One rule for "this cell must not be read as a formula", shared by every export.

`csv.writer` quotes a cell that contains commas or quotes; it does not care what
the cell *starts* with. Excel and LibreOffice do: a cell whose first character is
one of ``= + - @`` (or a leading tab/CR, which some versions strip before
deciding) is parsed as a formula on open. Measured 2026-08-29 on the ledger
export: a soul named ``=HYPERLINK("http://evil","click")`` produced a row that
evaluates when the file is opened.

A leading apostrophe is the fix spreadsheets themselves use: it makes the cell
literal text and is not displayed. Applied to the rendered string, so ints and
ISO timestamps pass through untouched.

This lived as `_csv_safe` inside `apps/ledger/views.py` and the user export in
`apps/authentication/views.py` — written later, by someone who had not read the
ledger one — had no such guard at all (DB-02). Its cells are the worse pair:
`username` is chosen by whoever registers (`/auth/register/` is AllowAny) and
`email` by whoever edits their own profile, while the file is opened by an
administrator on their own machine. A rule that has to be rediscovered per
export is a rule that will be missed by the next export; this module is so the
third one has a function to call.
"""

#: Characters that make a spreadsheet treat the cell as a formula.
FORMULA_LEADS = ("=", "+", "-", "@", "\t", "\r")


def csv_safe(value):
    """Return `value` as a CSV cell that no spreadsheet will evaluate."""
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in FORMULA_LEADS else text
