---
id: officer-roles
screens: [users, permissions, profile, welcome, dashboard, other]
audience: officer
civilizations: []
codes: []
questions:
  - "what can my role do"
  - "what is the difference between a judge and a realm lead"
  - "can one person have more than one role"
  - "how are the permissions of additional roles worked out"
  - "which role is the judge"
---
The console has five officer roles. What each holds by default:
- ADMIN (Administrator): everything, in every hall. The only role that sees across halls. Always ADMIN-only: managing users, editing the permission matrix, the scheduler rebuild, and restoring or permanently deleting from the recycle bin; nothing can be taken away from ADMIN. By default ADMIN-only (the matrix can change it): managing menus.
- MODERATOR (realm lead): runs its own hall. Designs workflows and may escalate them, but may never approve or advance a workflow step and may never manage users; these three are always refused by the server, whatever the matrix says. Rules on judgments and may reassign them; full dispatch; sentence-plan cancellation; audit log; soul accounts, the hall-office inbox and circle moderation.
- JUDGE (Judge): reads souls, declares death, moves souls between states, manages reincarnation, opens and rules on judgments (cannot reassign), approves and advances workflow steps, reviews rebirth applications, creates cross-realm judgments. No dispatch.
- GUARDIAN (Guardian): edits souls and moves them between states, manages reincarnation, and proposes dispatches (cannot approve, reject or execute them).
- VIEWER (Viewer): read-only.
One officer can hold several roles at once: a primary role plus any number of additional roles, set by an administrator in "User Management". Their permissions are the union of those roles: if any one of them grants it, they have it. Each role's hard rules apply to that role's own share only: the Realm Lead's three refusals remove nothing a second role grants, so a Realm Lead who is also a Judge can approve and advance workflows as Judge. Someone who holds Realm Lead alone is still refused them. Administrator-only actions such as recycle-bin restore, permanent delete and user management stay with ADMIN; an administrator cannot take additional roles and no other role can take ADMIN as an additional one. Whether someone is an administrator depends on the primary role alone.
An administrator can change the defaults in "Permissions & Roles", except the always-rules above: the realm lead's three refusals, the recycle-bin restore and permanent-delete permissions staying with ADMIN, and nothing being removable from ADMIN. The my_permissions tool reports both your primary and additional roles and answers from the union; it reports only the workflow approve, advance and escalate permissions, the user management permission, and the dispatch approve, reject, execute and manage permissions; it cannot check any other permission.
