---
id: officer-souls-and-records
screens: [souls, ledger, audit, admin, dashboard]
audience: officer
civilizations: []
codes: []
questions:
  - "how do I create a soul"
  - "how do I start a judgment for a soul"
  - "where is the audit log"
---
Souls (sidebar: "Soul Management"): "Create soul" needs the soul create permission; "Export", "Move to recycle bin" (the soul delete permission) and "Transfer" (the dispatch manage permission, one soul at a time) are in the batch bar. On a soul's page the actions follow its state: an alive soul can be marked dead and sent to judgment (the soul die permission), a soul under judgment gets "Start judgment" (the judgment create permission), a disposed soul can be reborn (the reincarnation reborn permission); "Edit" needs the soul update permission.
Importing souls from a file: on the Souls page, "Import" (the soul create permission) opens a dialog. Download the template, fill in one soul per row (name and civilization are required; birth and death dates, place of origin, birth name and description are optional), then choose the file. Every row is checked first and nothing is saved at this stage: errors are marked in the cell they belong to, and "Show only errors" narrows the table. The import button stays disabled while any row has an error, because the import is all or nothing. The civilization must be your own, a name with the same birth date as an existing soul counts as a duplicate, and a file has a maximum number of rows. After a successful import, "View this batch" opens the list narrowed to the souls just created.
Merit ledger: the journal by month with category filter, search and "Export"; needs the ledger read permission.
Besides its entry and weight, a merit/demerit record can carry the article it is filed under (the article's text is frozen with the record when cited, so a later revision does not change it), how many occasions it covers, the stage of life (childhood / youth / adulthood / old age) and the evidence source (registry / witness / self-account / other, with an optional note); anything not recorded shows as unrecorded on the ledger and the judgment desk rather than a default. The weight is the row's total; it is not multiplied by the count.
Audit log: search with action, resource and date filters; needs the audit read permission (administrators and realm leads by default).
Dashboard: overview and to-do cells (approvals waiting on dispatch, the judgment queue, and for administrators a "Death sync anomalies" cell); "Deed Statistics" and "Export Stats" are for administrators.
