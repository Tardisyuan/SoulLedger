---
id: officer-workflow
screens: [workflow]
audience: officer
civilizations: []
codes: []
questions:
  - "how do I approve a workflow step"
  - "what is the difference between advance and escalate"
  - "how many approvals are waiting for me"
---
Approval workflows (sidebar: "Approval Workflow"). Tabs: existing templates, the template editor, and running instances. Designing templates needs the workflow create / update / delete permissions; "Publish" needs the update permission.
On a running instance:
- "Submit Decision": decides the current step. Only the approver that step names may do it, and it needs the workflow approve permission.
- "Advance": moves the pointer to the next step without deciding the one it leaves; that step stays pending and can be returned to. Needs the workflow advance permission.
- "Escalate past this node": forces a stuck step past, with a written reason, and writes an audit record. By default administrators and realm leads hold it.
- Add signer: only the current step's designated approver can add one (also possible in the officer app). Candidates are active officers of your own hall who may approve; a colleague with the same role could already decide alone, so adding them, or adding anyone twice, is refused. The person added is notified and has to sign first, or your own approval does not count; if they reject, the step is rejected, and your own reject is never held. The officer desk has no add-signer screen yet.
- Verdict of an approval: when a step declares the verdicts it accepts, only those can be used; the officer app's approve sheet lets you pick when several passing verdicts are accepted and submits directly when there is one.
For how many steps are waiting for your own decision, use the my_pending_approvals tool.
