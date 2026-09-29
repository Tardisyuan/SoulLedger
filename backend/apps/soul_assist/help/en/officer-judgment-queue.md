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
---
Judgment queue (sidebar: "Judgment Queue"). The "Pending" tab splits open cases into four groups:
- "Mine": claimed by you.
- "Unclaimed": nobody has taken it; "Claim" takes it.
- "Claimed by others": read-only for you; an officer with the reassign permission can move it with "Reassign…".
- "Deferred": set aside with "Defer", which requires a reason.
Filters: court, civilization, sort (waiting longest / newest), search. Batch actions apply to every selected case or to none. When nobody can take a case, the "Ask an administrator to reassign" button inside the "Reassign…" dialog (which only officers with the reassign permission can open) sends the administrators a notice.
A case page holds the verdict actions (they need the judgment execute permission). The "Corpus" page is for looking up statutes and copying a citation into a verdict.
For how many cases are in each group right now, use the judgment_queue_counts tool; the answer names no souls, so open the queue to see them.
