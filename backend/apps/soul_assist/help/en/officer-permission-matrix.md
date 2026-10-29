---
id: officer-permission-matrix
screens: [permissions]
audience: officer
civilizations: []
codes: []
questions:
  - "how do I change the permission matrix"
  - "how do I grant a role a permission"
  - "can I create a role"
  - "why does saving permissions report a conflict"
  - "How do I grant a role to several people"
---
"Permissions & Roles" opens for holders of the system settings permission; only an administrator who belongs to no hall can save changes here, and a hall-bound administrator or any other holder can only read. Three sections: Matrix, Roles, Permissions.
- Matrix: one row per permission code, one column per role; ticking grants. Filter by code or name, or show only rows that differ; each role has "Select all" and "Select none" per category, which change only the cells you can see and no rule blocks. Changes are collected first; before "Save changes" you see each role's before and after and how many users hold it; saving replaces that role's whole set of grants. If a change would leave a step of some approval workflow with nobody able to approve it, a conflict is shown. If another administrator changed the same role meanwhile, the save is refused and the role must be reloaded first. Cells that cannot be granted are marked: permissions only ADMIN may hold, the realm lead's user management permission, and approve and advance on a role that already holds the workflow create or update permission (and the other way round).
- Roles: the five built-in roles keep their names, their display names can be changed; new roles can be created and roles copied. A role opens with two tabs, "Details" and "Members". "Details" holds the data scope, see officer-roles. "Members" lists who holds the role, primary holders first and then additional ones; you can remove an additional role, or grant the role to several people at once under the same rules as "Set roles", and if any one of them is refused, nothing in the batch changes. A role that someone still holds as an additional role cannot be deleted until they are removed.
- Permissions: the list of permission codes, names and categories; creating, editing and deleting one needs the system settings permission and an administrator who belongs to no hall. A code from the built-in catalogue can be added back, with its default grants, but never deleted or renamed. Deleting a permission you created removes it from every role that held it.
After a save, pages already open for the holders of those roles receive a permission refresh. The "always" rules the matrix cannot change are in officer-roles.
