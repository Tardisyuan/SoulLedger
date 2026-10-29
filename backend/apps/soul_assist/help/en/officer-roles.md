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
  - "What is a data scope"
---
The console has five built-in officer roles, and new roles can be created. What each holds by default:
- ADMIN (Administrator): everything. An administrator who belongs to no hall is global and can read and change every hall; an administrator bound to a hall reads and changes only that hall, like everyone else there. Configuration every hall shares (the halls themselves, roles and the permission matrix, data scopes, menus, the assistant's provider) can be changed only by an administrator who belongs to no hall. Permissions only ADMIN may hold: recycle-bin restore and permanent delete, correcting a settled soul, menu management and scheduler management; nothing can be taken away from ADMIN.
- MODERATOR (realm lead): runs its own hall. Designs workflows and may escalate them; rules on judgments and may reassign them; manages City Gods, Earth Gods, the City of Wrongful Death and capture; full dispatch; sentence-plan cancellation; audit log; soul accounts, the hall-office inbox and circle moderation. A realm lead may never hold the user management permission; the server refuses it whatever the matrix says.
- JUDGE (Judge): reads souls, declares death, moves souls between states, manages reincarnation, opens and rules on judgments (cannot reassign), works cases for City Gods, Earth Gods, the City of Wrongful Death and capture, approves and advances workflow steps, reviews rebirth applications, creates cross-realm judgments. No dispatch.
- GUARDIAN (Guardian): edits souls and moves them between states, manages reincarnation, adds and edits merit and demerit records, and proposes dispatches (cannot approve, reject or execute them).
- VIEWER (Viewer): read-only.
Whoever designs a workflow does not approve it: a role that holds the workflow create or update permission cannot also hold the workflow approve and advance permissions. This goes by permission, not by role name, so a copy of the realm lead or a new role is treated the same; the matrix, batch grants from the members tab, copying and import all refuse that combination. The realm lead designs workflows by default, so the realm lead role cannot approve or advance a workflow step. Its dispatch approval, escalation and judgment execution are not workflow steps and are not affected.
The user management permission can be granted to roles other than the realm lead: a holder who is not an administrator manages only their own hall's people and never sees or changes an administrator account.
One officer can hold several roles at once: a primary role plus any number of additional roles, set in "User Management" or on a role's "Members" tab. Their permissions are the union of those roles: if any one of them grants it, they have it. Each role's hard rules apply to that role's own share only: a Realm Lead who is also a Judge can approve and advance workflows as Judge, while someone who holds Realm Lead alone is still refused. An administrator cannot take additional roles and no other role can take ADMIN as an additional one; whether someone is an administrator depends on the primary role alone. When a person's roles or a role's permissions change, pages that person already has open receive a permission refresh.
Data scope: each role can also be given which data it sees: all, this unit and below, this unit only, own records only, or chosen units (including the units under them), and a business area can be set on its own. With nothing set it is all, still within the hall. Under any scope, data you created or were assigned stays visible; with several roles the scopes are combined. ADMIN's scope is fixed at all. Only an administrator who belongs to no hall can change data scopes, in the role's "Details".
The my_permissions tool reports both your primary and additional roles and answers from the union; it reports only the workflow approve, advance and escalate permissions, the user management permission, and the dispatch approve, reject, execute and manage permissions; it cannot check any other permission.
