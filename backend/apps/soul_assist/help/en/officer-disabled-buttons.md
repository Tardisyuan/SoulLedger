---
id: officer-disabled-buttons
screens: [other, workflow, dispatch, users, judgment, recycle-bin, permissions, death-sync]
audience: officer
civilizations: []
codes: []
questions:
  - "why can't I click approve"
  - "why is this button missing"
  - "the button is there but the server refused"
---
A button is hidden or refused for one of two reasons.
- A permission the officer does not hold. Ask the my_permissions tool; never guess from the role name. A realm lead is always refused workflow approve, workflow advance and user management.
- A rule the server checks on top of the permission, which the page may not show in advance:
  - Submit Decision on a workflow step: only the approver that step names (a specific deity, or a role). Holding workflow approve is not enough, and an administrator gets no exception; a stuck step is moved on with Escalate, which needs a written reason.
  - Dispatch Approve and Execute: only the target hall. Reject: either hall involved. End residence: the soul's home hall.
  - Acting on a judgment claimed by someone else needs the reassign permission; concluding it is for the claimant, an administrator or the realm lead.
  - Restore and Delete permanently in the recycle bin: administrators only.
  - Death Sync: its data is for administrators only, even where the sidebar shows the page.
If the officer should hold a permission it lacks, it asks its hall's administrator.
