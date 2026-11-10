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
