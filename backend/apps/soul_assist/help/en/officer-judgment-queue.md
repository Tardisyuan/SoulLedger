---
id: officer-judgment-queue
screens: [judgment, corpus, dashboard]
audience: officer
civilizations: []
codes: []
questions:
  - "how does the judgment queue work"
  - "how do I claim a case"
  - "what does deferred mean"
  - "how many cases are in my queue"
  - "what if nobody can take a case"
---
Judgment queue (sidebar: "Judgment Queue"). The "Pending" tab splits open cases into four groups:
- "Mine": claimed by you.
- "Unclaimed": nobody has taken it; "Claim" takes it.
- "Claimed by others": read-only for you; an officer with the reassign permission can move it with "Reassign…".
- "Deferred": set aside with "Defer", which requires a reason.
Filters: court, civilization, sort (waiting longest / newest), search. Batch actions apply to every selected case or to none. When nobody can take a case: if the "Reassign…" layer lists nobody but you, it shows "Ask an administrator to reassign", which notifies the administrators of the case's hall. Opening the reassign layer needs the reassign permission; the request itself is checked by the server against the judgment execute permission only, not the reassign permission. The same case can be asked about only once in a short while.
A case page holds the verdict actions (they need the judgment execute permission). The "Corpus" page is for looking up statutes and copying a citation into a verdict.
For how many cases are in each group right now, use the judgment_queue_counts tool; the answer names no souls, so open the queue to see them.
