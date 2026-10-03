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
---
"Permissions & Roles" is for administrators only. Three sections: Matrix, Roles, Permissions.
- Matrix: one row per permission code, one column per role; ticking grants. Filter by code or name, or show only rows that differ. Changes are collected first; before "Save changes" you see each role's before and after and how many users hold it; saving replaces that role's whole set of grants. If a change would leave a step of some approval workflow with nobody able to approve it, a conflict is shown. If another administrator changed the same role meanwhile, the save is refused and the role must be reloaded first.
- Roles: the five built-in roles keep their names, their display names can be changed; new roles can be created.
- Permissions: the list of permission codes, names and categories; creating, editing and deleting one needs the system settings permission. Deleting a permission removes it from every role that held it.
The "always" rules the matrix cannot change are in officer-roles: a realm lead never approves or advances a workflow step and never manages users, recycle-bin restore and permanent delete stay with administrators, and nothing can be taken from an administrator.
