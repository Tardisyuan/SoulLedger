"""What the English recordings still say in Chinese, most frequent first: path-shaped field name → count, sample.
Each line is either something for demo-translations.json, or text the backend only has in Chinese."""
import collections
import glob
import json
import re
import sys

CJK = re.compile(r"[㐀-鿿]")
seen = collections.Counter()
sample = {}


def walk(v, field):
    if isinstance(v, dict):
        for k, x in v.items():
            walk(x, k)
    elif isinstance(v, list):
        for x in v:
            walk(x, field)
    elif isinstance(v, str) and CJK.search(v):
        seen[field] += 1
        sample.setdefault(field, v[:70])


# Single files (soul_*, and roles not yet re-recorded) and the role buckets (frontend/demo/data/<role>.en/*.json).
for path in glob.glob(sys.argv[1]) if len(sys.argv) > 1 else glob.glob("frontend/demo/data/*.en.json") + glob.glob("frontend/demo/data/*.en/*.json"):
    data = json.load(open(path, encoding="utf-8"))
    walk(data["lists"], "?")
    walk(data["docs"], "?")
for field, n in seen.most_common(90):
    print(f"{n:6d}  {field:32s} {sample[field]}")
