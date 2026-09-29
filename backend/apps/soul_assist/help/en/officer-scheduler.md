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
Scheduled jobs (sidebar, administrators): tabs Jobs and Run history. Filters: all, disabled only, overdue, failing repeatedly. Jobs are grouped as global or per hall; officers who are not administrators see only their own hall's jobs.
- Run now, Edit schedule (cron and time zone) and enable / disable need scheduler manage. Run now is refused while another run of the same job holds its lock.
- Rebuild schedule needs an administrator holding scheduler manage.
- A job's run records are read-only.
Death Sync lists incoming death registrations by status (awaiting verification, processing, processed, failed, duplicate, partly processed). Its data is for administrators only.
