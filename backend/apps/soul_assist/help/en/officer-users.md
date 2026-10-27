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
  - "how do I invite an officer"
  - "how do I import users in bulk"
  - "do I hand over cases before deactivating an officer"
  - "how do I reset an officer's two-step verification"
  - "how do I view the console as another user"
---
"User Management" (sidebar, under "System Settings") is for administrators only: the user management permission is always administrator-only, and a Realm Lead is refused by the server whatever the matrix says.
The list can be searched by username or email and filtered by role; each row shows username, email, role, tenant (the hall) and status. The role column starts with the primary role; chips with a dashed border after it are additional roles.
- "Create User": username, email, password and role, with an optional name.
- "Edit User": change details and role; leave the password empty to keep it, fill it in to reset it; a forgotten-password help notice brings you here.
- "Set roles": pick the primary role, then tick the additional roles. The officer's permissions are the union of them; an administrator account cannot take additional roles, and neither ADMIN nor Soul is offered as one.
- "Activate" / "Deactivate": a deactivated account cannot sign in; its records stay.
- Tick the boxes at the left of the rows to select several accounts; a bar appears at the bottom with "Activate selected" and "Deactivate selected". Administrator accounts and your own are left out of batches, so change those one at a time; turning the page or changing a filter clears the selection.
- "Delete": asks for confirmation; a deleted user is not listed in the recycle bin.
- "Invite an officer" (user management permission): enter an email, pick the role and hall; username and display name are optional, and with no username the part of the email before the @ is used, with a number added if taken. They get an email with a link to set their own password; the link lasts seven days and works once. Only officer roles can be invited, not Soul or a global administrator; an email that belongs to another account is refused. An invite not yet accepted is marked "Invite pending" beside the status, and "Resend invite" sends it again if the email did not arrive.
- "Import CSV": three steps, choose the file, preview, result. username is required. A row with an email and no password gets an invite email and the person sets their own password within seven days; a row with a password uses it as the initial password, to be changed at first sign-in; a row with neither is not imported; for rows that get an invite, role cannot be ADMIN. The preview marks problem rows and why; while any row has a problem the import button stays disabled and you fix the file and choose it again. The result says how many were invited and how many must change their password at first sign-in.
- "Export CSV" (user management permission): exports all users, ignoring the list's search and filters; exports are written to the audit log.
- "Hand over open work" (needs the judgment reassign permission; for active, non-Soul accounts): moves everything one officer still has open to another active officer of the same hall: claimed judgments, appeals in review, City God assignments and open letters. Preview first, then hand over; if you change the people, preview again. If someone concludes or reassigns a case after the preview, the real count can be lower. The new officer needs case permissions if there are judgments or appeals to hand over, and the reply permission if there are letters, otherwise the hand-over is blocked. If the new officer gave the original verdict of an appeal, that appeal goes back to awaiting review for someone else to claim. The new officer gets an in-app notice.
- Handing over while deactivating: "Deactivate" on an officer who still has open work first asks whether to hand it over; pick the new officer and use "Hand over and deactivate". The batch "Deactivate selected" never deactivates an officer with open work; it lists them, and you deactivate and hand over one at a time.
- "Reset two-step verification": appears only when that person has two-step verification on (user management permission). You write a reason, which goes to the audit log. Afterwards the authenticator and recovery codes stop working, their next sign-in needs only the password, every "don't ask again" device record is cleared, and they are signed out everywhere. The list has a "Two-step verification" column and a filter for accounts that are required but not set up.
- "View as this user": system administrators only; rows for another administrator, yourself, deactivated accounts and Soul accounts do not show it. You write a reason. Viewing is read-only, lasts up to half an hour, and you cannot act or export during it. The person is notified with your name and the reason, and that notice cannot be turned off. The start and the end are each written to the audit log. A banner says you are viewing as that person, and "Stop viewing" ends it.
Officers change their own password in "Profile", not here. Soul accounts are not on this page; they live under "Initial Passwords Awaiting Delivery" and soul management.
