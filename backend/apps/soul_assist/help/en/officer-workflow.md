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
For how many steps are waiting for your own decision, use the my_pending_approvals tool.
