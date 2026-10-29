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
- A permission you do not hold. The my_permissions tool reports only the workflow "approve", "advance" and "escalate" permissions, the user management permission, and the dispatch "approve", "reject", "execute" and "manage" permissions; it cannot check any other permission and does not infer one from a role name. A realm lead may never hold the user management permission; a role that holds the workflow create or update permission (the realm lead does by default) cannot approve or advance a workflow step.
- A rule the server checks on top of the permission, which the page may not show in advance:
  - "Submit Decision" on a workflow step: only the approver that step names (a specific deity, or a role; on a countersign step, the named signers). Holding the workflow approve permission is not enough, and an administrator gets no exception; a stuck step is moved on with "Escalate past this node", which needs a written reason.
  - "Approve" greyed with a line above it saying it is waiting for a named added signer: you added a co-signer to this step and they have not approved yet. You can approve once they have; if they reject, the step is rejected. "Reject" and "Add signer" are not affected.
  - Dispatch "Approve", "Reject" and "Execute": only the target hall, or an administrator who belongs to no hall. "End residence": the soul's home hall (or an administrator).
  - A judgment someone else has claimed: only the claimant may edit or delete it or write its draft and evidence; a holder of the reassign permission may override the claim, which is recorded, and the same goes for concluding over a claim. A concluded judgment takes nothing but notes.
  - "Restore" and "Delete permanently" in the recycle bin: administrators only; an administrator bound to a hall only for that hall's records.
  - Actions on another administrator's account: only an administrator who belongs to no hall, after entering their own two-step code.
  - While viewing as someone else, every write is unavailable.
  - Death sync: its data is for administrators only.
If you should hold a permission you lack, ask an administrator ("管理员" / Administrator); only an administrator who belongs to no hall can change the permission matrix.
