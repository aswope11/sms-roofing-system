# SMS Roofing — working Schedule and payroll process

Owner walkthrough: November 9, 2026. This is a partial SOP, not a completed payroll policy.

## Confirmed by Adam

- Schedule is the daily working page. Adding, removing and returning a worker must happen here, without visiting Crew.
- Removing a worker takes him off the selected week's board. It does not fire him, deactivate his saved record, or delete prior work/pay. Add restores him from Schedule.
- Morning assignments are plans. Actual work can change during the day. Daily Payroll mirrors the latest app entries; appearing on the sheet is not approval or proof the work happened.
- Select an active work ticket, workers and scope pills, then Log. Add a scope pill when missing.
- Separate tickets at the same property remain separate, including contracts, added work, and change orders. Never merge by address.
- A worker can be charged to a job without scope pills. Half-day pay is supported. Sharing a site does not mean sharing scopes.
- Assigned cards must show that worker's logged scopes for that ticket and date. Tapping opens the daily assignment; opening the job file remains a separate link.
- Active buttons are filters, not completion or approval. Tickets assigned on ANY selected date are excluded from the lists below. Multiple dates can be active. With no dates active the lists include assigned open tickets again.
- Phone instructions must be usable away from the office without preparing a Chrome session every day. Direct authenticated integrations and remote-access setup remain follow-up work; browser continuity has not been verified.

## Pending business decisions

- Exact intended employee group/color layout on Daily Payroll has not been confirmed. Do not redesign it based only on visual row alignment.
- The walkthrough's morning assignments are a demonstration, not final actual payroll. Do not approve or apply that day on Adam's behalf.
- The role of the green / good-to-bill confirmation has been inferred from existing code, not yet confirmed by Adam in this walkthrough.

## Payroll Robot defect observed

The November 9 6:05 PM App Sync log reported that Gravel Stop and a job-only label did not fit the employee box and Puma's crew did not fit the sub box. It nevertheless recorded the day as written. The script was inspected: employee box capacity grows for additional men, but not additional scope lines; oversized crews are skipped. A matching stored stamp prevents automatic retry.

Required repair: size boxes for all crew and scope rows, preserve employee formula rows and group colors, clear only app-owned cells, verify all writes, and only checkpoint a complete day. Failed writes must be retryable. Do not mask the defect by truncating the source feed or silently omitting scopes. The live Apps Script is outside this repository and is NOT changed by deploying this app.

## This release

- Weekly Schedule hide/restore using board_add on_board=false, without crew deactivation or payroll changes.
- Daily scope text and ticket title on assigned cards and scope text in hover.
- Tap assigned card to view/edit its saved day entry; separate Open job file link.
- Active filtering applies to waiting lists as well as Ready to work.
- Focused UI behavior tests plus the existing regression suite.

Live browser UI testing remains unavailable in this conversation. Deployment must be checked against the live JavaScript and week API. Payroll Robot repair remains open until its source is editable and its complete output is verified.

## Confirmed correction — compact payroll, November 9 walkthrough

This supersedes the earlier assumptions about scopes and green on Daily Payroll:

- Payroll day boxes show only concise ticket/job names; scope pills remain in the app and must not clutter this sheet.
- The employee box includes only workers with entries for that day. Charlie $250, Tony $230 and half-day Hugo $150 total $630 for the demonstrated November 9 plan.
- Matching color AND boldness link job labels to people within one SMS section or individual subcontractor crew section. Styling is not a cross-section join. A job with a different bold setting does not match just because its color matches.
- Repeated job names are intentional when different worker groups did different work at the same site. Ticket IDs and saved scopes define those groups internally; only job names are displayed.
- Sub summary shows full daily pay. Job breakdown boxes below show each worker's saved job share. Moscar: Eastlake $150, Fate 20k $150; Puma: Fate 20k $400.
- Green on the summary means placed in the job breakdown below, NOT applied to the Actual Job Cost Sheet or approved for payment. Each job label greens after its breakdown is verified. A person's daily entry greens only after ALL his job shares are present and verified. An interrupted step leaves incomplete entries white and retryable.
- Breakdown boxes have outer borders and vertical separators around the names column; no unnecessary total row or blank employee roster rows inside a box.

The compact renderer in lib/payroll-layout.js regenerates this stage from the app's ticket IDs, saved work and money rules. It never reads or copies Adam's reference cells. It checks per-person allocation conservation. Sheet writes are verified before separate green requests.

The November 9 sheet was regenerated through the connected Sheets API using this renderer. The manual example was shifted down four cells within the Monday block solely to reserve breakdown space; its values/formatting and Saturday's entries were preserved. No job costs, payments, approvals or Subs ledger entries were posted.

The /w/payroll-layout read-only endpoint exposes the same model and sheet-write plan. The existing /w/payroll-feed remains unchanged because the legacy job-cost script depends on its scopes. scripts/PayrollCompactSync.gs is a staged adapter, NOT installed. The running Google script is inaccessible from the present browser/Drive connection. Its old timer is still active and can overwrite a correction after app data changes. Installing and validating the replacement is required before automatic syncing can be called fixed. The staged adapter conservatively refuses a missing week, roster remap or manual-content collision; those checks must be addressed and tested before installation.

## November 10 posting repair — prepared, NOT installed

The installed compact writer copied approved November 9 at 10:14 AM but never called applyDay. The old first-worker-only duplicate check was also unsafe. A proposed repair in PayrollRobotAppSync.gs runs a separate posting scan from SYNC_FROM, regardless of the mirror stamp, and persists completion per date/ticket. It uses saved job shares, checks every person/scope in an existing block, and refuses changed previously posted input rather than duplicating it.

Exact routes are ticket 19 -> Fate 20k Actual Labor and ticket 1 -> Eastlake Actual Labor. Ticket 18 (Fate 9k) must not share ticket 19's destination by street-number inference. Unmapped tickets, non-JC QuickBooks routing, missing destination ledgers, and changed previously posted input remain explicit incomplete states. Eastlake currently contains bid tabs only; its Labor tab is a bid, not an actual-cost ledger. Its Actual Labor destination needs to be established. The Google Apps Script must be installed and run through its first verified posting before this repair is live. Existing unverified/partial historical rows and summary formulas require reconciliation before adoption. The old compact mirror's sub green remains a distinct breakdown-placement signal.

Validation: 139 passing tests, including saved unequal shares, same-address ticket separation, historical retry isolation, and refusal to duplicate changed posted input. These are code checks; no live posting was performed.
