---
id: officer-scheduler
screens: [scheduler, death-sync]
audience: officer
civilizations: []
codes: []
questions:
  - "how do I run a scheduled job now"
  - "why did a job not run"
  - "what is death sync"
---
"Scheduled Tasks" (sidebar, administrators): tabs "Jobs" and "Run history". Filters: all, disabled only, overdue, failing. Jobs are grouped as global or per hall; anyone bound to a hall, administrators included, sees only their own hall's jobs.
- "Run now", "Edit schedule" (cron and time zone) and enable / disable need the scheduler manage permission, which only administrators may hold. "Run now" is refused while another run of the same job holds its lock.
- "Rebuild schedules" is for an administrator who belongs to no hall.
- A job's run records are read-only.
"Death Sync" lists incoming death registrations by status ("Pending", "Processed", "Failed", "Duplicate"). Its data is for administrators only; an administrator who belongs to no hall sees every hall's registrations.
