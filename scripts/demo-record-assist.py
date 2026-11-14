#!/usr/bin/env python3
"""Records the demo's 「问一问」 against a real backend with a real model (作品集建议 B1 / B2 / B3, 2026-11-13).

The demo site calls no model (user decision); it replays what this writes into frontend/demo/data/:

- `assist-replies.json` (B1): every question already in the file, asked in both languages through the administrator's
  try endpoint (`/assist-admin/try/`, streamed, as the configured eval officer), with the answer and its trace —
  tools called (names only), retrieval and the entries it brought in, tokens, latency, first token, who answered.
- `assist-security.json` (B3): the injection cases already in the file, asked the same way; their `expect` is ours
  and is not touched. Read the answers before publishing: one that does not refuse is a finding, not a recording.
- `assist-eval-run.json` (B2): one eval run per side over every active case for the one or two candidates in
  DEMO_ASSIST_CANDIDATES, with the case list it was judged against. Needs a Celery worker (or eager tasks) on the backend.

The try endpoint is the only one that reports a trace, and only to an ADMIN: the officer and soul endpoints never do.
It goes through the real `service.ask`, so the tools, scopes and audit are the production ones; asks are `is_eval`
and do not count toward the monthly cap. It is throttled at 60 an hour per administrator: a full run of both files is
about 80 asks, so this waits out a 429 and carries on (about an hour and a half in all).

Environment (nothing else is read; no .env):
  DEMO_ASSIST_API        e.g. http://127.0.0.1:8000/api/v1 (a test environment, never production)
  DEMO_ASSIST_USER       an ADMIN on that backend (admins always have two-step verification:
  DEMO_ASSIST_TOTP_SECRET  its TOTP secret, so the script can answer the second step)
  DEMO_ASSIST_PASSWORD
  DEMO_ASSIST_ONLY       optional, comma-separated subset of: replies,security,eval
  DEMO_ASSIST_CANDIDATES for eval: a JSON list of one or two candidates as the eval page sends them,
                         e.g. [{"platform":"deepseek","model":"deepseek-chat"},{"platform":"anthropic","model":"..."}]
  DEMO_ASSIST_EVAL_SIDES for eval: default "officer,soul" (one run per side; each must fit the 100-ask cap)

Every string written goes through the same private-host rewrite as scripts/demo-record.mjs, and
frontend/src/__tests__/demoDataHasNoInternalHosts.test.ts scans the result.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "frontend" / "demo" / "data"
LANGS = ("zh-Hans", "en")
#: What a trace keeps of a try result: everything but the answer itself and the side.
TRACE_KEYS = ("tools_called", "retrieval", "retrieved_entries", "latency_ms", "first_token_ms", "tokens", "model",
              "provider_role", "fallback_reason")
#: `INTERNAL_HOST` in scripts/demo-record.mjs, the same rewrite.
INTERNAL_HOST = re.compile(
    r"\b(https?://)(?:localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}"
    r"|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|[\w-]+(?:\.[\w-]+)*\.(?:lan|local|internal|home\.arpa))"
    r"(?=[:/?#\"\s]|$)", re.IGNORECASE)
THROTTLE_WAIT = 65
THROTTLE_TRIES = 70


def scrub(value):
    if isinstance(value, str):
        return INTERNAL_HOST.sub(r"\1internal.example", value)
    if isinstance(value, list):
        return [scrub(v) for v in value]
    if isinstance(value, dict):
        return {k: scrub(v) for k, v in value.items()}
    return value


def totp_now(secret: str) -> str:
    """RFC 6238 SHA-1, 6 digits, 30 s — the same as apps/authentication/mfa.py `totp_at`."""
    import base64
    import hashlib
    import hmac
    import struct
    key = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    digest = hmac.new(key, struct.pack(">Q", int(time.time()) // 30), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    return f"{(struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7FFFFFFF) % 10**6:06d}"


class Api:
    def __init__(self, base, user, password):
        self.base = base.rstrip("/")
        self.user, self.password = user, password
        self.login()

    def login(self):
        # The run takes over an hour (the try endpoint is throttled) and an access token lives far less,
        # so call() signs in again on a 401 instead of the recording dying with everything unwritten.
        self.token = None
        user, password = self.user, self.password
        body = self.call("POST", "/auth/login/", {"username": user, "password": password})
        if body.get("mfa_required") and os.environ.get("DEMO_ASSIST_TOTP_SECRET"):
            # Every ADMIN must have two-step verification on (2026-10-29), so the recording admin has it: the code is
            # computed from DEMO_ASSIST_TOTP_SECRET (RFC 6238, as apps/authentication/mfa.py), never printed.
            body = self.call("POST", "/auth/mfa/verify/", {"pending_token": body["pending_token"], "code": totp_now(os.environ["DEMO_ASSIST_TOTP_SECRET"])})
        if "access" not in body:
            sys.exit(f"sign-in did not return a token (set DEMO_ASSIST_TOTP_SECRET for an admin with two-step verification): {sorted(body)}")
        self.token = body["access"]

    def call(self, method, path, body=None, lang="zh-Hans", raw=False):
        headers = {"Content-Type": "application/json", "Accept-Language": lang}
        if getattr(self, "token", None):
            headers["Authorization"] = f"Bearer {self.token}"
        data = None if body is None else json.dumps(body).encode()
        signed_in_again = False
        for _ in range(THROTTLE_TRIES):
            request = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
            try:
                with urllib.request.urlopen(request, timeout=120) as response:
                    text = response.read().decode()
                    return text if raw else json.loads(text or "{}")
            except urllib.error.HTTPError as exc:
                if exc.code == 401 and self.token and not signed_in_again:
                    signed_in_again = True
                    print(f"  401 on {path}; signing in again", flush=True)
                    self.login()
                    headers["Authorization"] = f"Bearer {self.token}"
                    continue
                if exc.code != 429:
                    sys.exit(f"{method} {path} → {exc.code}: {exc.read().decode()[:300]}")
                print(f"  429 on {path}; waiting {THROTTLE_WAIT} s", flush=True)
                time.sleep(THROTTLE_WAIT)
        sys.exit(f"{method} {path}: still throttled after {THROTTLE_TRIES} tries")


def try_officer(api, question, lang):
    """One streamed try as the eval officer → (answer, trace). A stream that ends in `error` stops the recording."""
    raw = api.call("POST", "/assist-admin/try/", {"side": "officer", "question": question, "stream": True}, lang, raw=True)
    events = [json.loads(line[len("data: "):]) for block in raw.strip().split("\n\n") for line in block.split("\n")
              if line.startswith("data: ")]
    done = next((e for e in events if e.get("event") == "done"), None)
    if done is None:
        sys.exit(f"no answer for {question!r} ({lang}): {events[-1] if events else 'empty stream'}")
    return done["answer"], {k: done.get(k) for k in TRACE_KEYS}


def write(name, content):
    path = DATA / name
    path.write_text(json.dumps(scrub(content), ensure_ascii=False, indent=2) + "\n")
    print(f"wrote {path.relative_to(DATA.parent.parent.parent)}")


def ask_all(api, name, items):
    file = json.loads((DATA / name).read_text())
    for i, item in enumerate(file[items]):
        answer, trace = {}, {}
        for lang in LANGS:
            answer[lang], trace[lang] = try_officer(api, item["question"][lang], lang)
        item["answer"], item["trace"] = answer, trace
        print(f"  {name} {i + 1}/{len(file[items])}", flush=True)
    file["recordedAt"] = datetime.now(UTC).isoformat()
    write(name, file)


def eval_runs(api):
    candidates = json.loads(os.environ.get("DEMO_ASSIST_CANDIDATES") or "[]")
    if len(candidates) not in (1, 2):
        sys.exit("DEMO_ASSIST_CANDIDATES must list one or two candidates")
    runs = []
    for side in os.environ.get("DEMO_ASSIST_EVAL_SIDES", "officer,soul").split(","):
        quote = api.call("POST", "/assist-admin/eval/preview/", {"side": side, "candidates": candidates})
        if quote["problems"]:
            sys.exit(f"eval preview for {side} refused: {quote['problems']}")
        print(f"  eval {side}: {quote['asks']} asks, about {quote['estimated_cost']}", flush=True)
        run = api.call("POST", "/assist-admin/eval/runs/", {"confirm_token": quote["confirm_token"]})
        while run["status"] in ("queued", "running"):
            time.sleep(10)
            run = api.call("GET", f"/assist-admin/eval/runs/{run['id']}/")
        if run["status"] != "done":
            sys.exit(f"eval run {run['id']} ended {run['status']}")
        runs.append(api.call("GET", f"/assist-admin/eval/runs/{run['id']}/"))
    write("assist-eval-run.json", {"recordedAt": datetime.now(UTC).isoformat(),
                                   "cases": api.call("GET", "/assist-admin/eval/cases/"), "runs": runs})


def main():
    env = {k: os.environ.get(k) for k in ("DEMO_ASSIST_API", "DEMO_ASSIST_USER", "DEMO_ASSIST_PASSWORD")}
    if not all(env.values()):
        sys.exit(__doc__)
    only = set((os.environ.get("DEMO_ASSIST_ONLY") or "replies,security,eval").split(","))
    api = Api(env["DEMO_ASSIST_API"], env["DEMO_ASSIST_USER"], env["DEMO_ASSIST_PASSWORD"])
    if "replies" in only:
        ask_all(api, "assist-replies.json", "replies")
    if "security" in only:
        ask_all(api, "assist-security.json", "cases")
    if "eval" in only:
        eval_runs(api)


if __name__ == "__main__":
    main()
