---
id: officer-users
screens: [users]
audience: officer
civilizations: []
codes: []
questions:
  - "how do I create a user"
  - "how do I deactivate an account"
  - "how do I reset an officer's password"
  - "who can manage users"
  - "how do I give an officer several roles"
  - "how do I activate or deactivate several accounts at once"
---
"User Management" (sidebar, under "System Settings") is for administrators only: the user management permission is always administrator-only, and a Realm Lead is refused by the server whatever the matrix says.
The list can be searched by username or email and filtered by role; each row shows username, email, role, tenant (the hall) and status. The role column starts with the primary role; chips with a dashed border after it are additional roles.
- "Create User": username, email, password and role, with an optional name.
- "Edit User": change details and role; leave the password empty to keep it, fill it in to reset it; a forgotten-password help notice brings you here.
- "Set roles": pick the primary role, then tick the additional roles. The officer's permissions are the union of them; an administrator account cannot take additional roles, and neither ADMIN nor Soul is offered as one.
- "Activate" / "Deactivate": a deactivated account cannot sign in; its records stay.
- Tick the boxes at the left of the rows to select several accounts; a bar appears at the bottom with "Activate selected" and "Deactivate selected". Administrator accounts and your own are left out of batches, so change those one at a time; turning the page or changing a filter clears the selection.
- "Delete": asks for confirmation; a deleted user is not listed in the recycle bin.
Officers change their own password in "Profile", not here. Soul accounts are not on this page; they live under "Initial Passwords Awaiting Delivery" and soul management.
