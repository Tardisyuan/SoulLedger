---
id: officer-assistant-admin
screens: [admin]
audience: officer
civilizations: []
codes: []
questions:
  - "what is the assistant admin page"
  - "how do I switch the assistant on or off"
  - "how do I change the assistant's model"
  - "where do I see the assistant's usage"
---
"Assistant Admin" (sidebar, under "System Settings") is for administrators only. It manages "Ask" on both sides: the soul app and the officer console. Sections:
- Switches: the master switch, and one switch per hall (each takes effect when pressed; hall switches do nothing while the master switch is off).
- Provider: the primary and backup models chosen by platform, their API keys and prices; after changing the address or the model, the connectivity test must pass before saving.
- Limits: questions per account per hour for the soul side and the officer side, the monthly spend cap (reaching it turns the master switch off; you are notified before that), and the spend cap per eval run.
- Read-only settings, eval identities (a system-created eval soul and eval officer that cannot sign in), eval (run the eval cases and read tool accuracy, key-point hit rate, retrieval hit rate, latency and cost), and "Try a question".
- The help corpus (read-only, shipped with the code) and the embedding model (address, model, entries retrieved, similarity floor, "Rebuild vectors").
"Usage" is the second tab of the same page: this month's spend against the cap, by day, by side and by hall, plus how often retrieval fell back and the backup was used.
The help entries cannot be edited in the console; to change one, ask whoever maintains the code.
