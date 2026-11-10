# Payroll Robot release process

## Ownership and source

Complete source installation and live verification in the same working thread. Adam must not relay installation instructions between chats. A passing test or a GitHub commit is not a live release.

- Repository: aswope11/sms-roofing-system.
- Source: scripts/PayrollRobotAppSync.gs.
- Live project: https://script.google.com/home/projects/1lKOpqfp8IZIpYAthXhN1f7BpXqGO1igMsDshzH-bkSD8hVkpWnvTwvwE/edit.
- Live target: AppSync.gs only. Preserve Code.gs byte-for-byte and every existing trigger. Never run setup or installAppSync during an update.
- Existing handlers: syncFromApp, run, updateInvoices.
- Payroll workbook: 1yY_j6idmY0UY_InoOib9TGPoKdcFRSuqTpQT5Ci0coQ.
- Ticket 1: Eastlake workbook 1opWjiNIMrb41r2c6Ipbob8Mdmw-kV4lQcyVxOIbMQoQ, Actual Labor.
- Ticket 19: Fate 20k workbook 1rEaFLZD79_-mTmXsV2EeSiHPBPUtcjJftBffYJnDTto, Actual Labor. Ticket 18 is different and must never be inferred from an address.

## Repeatable release gate

1. Read the current PR head and changed files; pin the source commit. Inspect repository instructions. Run the focused posting tests and relevant integration tests. Do not claim the entire suite passed unless it was run.
2. Read current live Code.gs, AppSync.gs and trigger inventory. Retain the current source for rollback. Check whether another sync holds the script lock.
3. Read the app's saved model, current Payroll breakdown, Subs formulas, posting rows and scope formulas before a retry. Record row counts, exact ticket IDs, dates, people, amounts and formulas. Preserve paid status and notes.
4. Replace only AppSync.gs. Save, copy the full editor content back and compare exactly with the pinned source. Recheck Code.gs and the trigger inventory.
5. Run syncFromApp. Execution completed is not sufficient: a busy lock and caught business errors can also produce it. Require a new timestamped App Sync result for the run. Do not rerun while another execution owns the lock.
6. Verify Payroll to Subs before job posting. For each exact ticket/date verify the existing job ledger block, the gross SMS/Subs summary reference, each visible D/E scope allocation and F/G summary reference. Verify labor and overhead totals agree. A positive unidentified-scope balance is an unresolved work allocation, not proof that every scope was identified.
7. Run a second idempotency pass; compare ledger rows/formulas and total cost against the baseline. A changed checkpoint is a reconciliation issue, never permission to append another cost.
8. Record source commit/content hash, test results, live run time, preserved files/triggers, business-result log and remaining failures. Only report a fully verified release if the live pipeline, including every requested ticket, passed.

## GitHub event handoff

The enabled ChatGPT automation "Payroll release verification" receives new commit events on PR #15 and performs the above workflow without Adam relaying messages. It ignores changes that do not alter payroll source/tests. It must report an unavailable browser or computer as a pending installation, never a success. Browser availability is a dependency; the event subscription is not an authenticated Apps Script deployment API, and future event delivery has not been end-to-end tested. Extend the subscription explicitly when payroll work moves to another PR; PR #15 coverage is not a repository-wide deployment guarantee.

## Installed status: November 10, 2026

Source commit c78fdf30ed2a41179c2b66199da4d3c2c9add536 is installed in AppSync.gs and compared exactly. Code.gs and the three existing handlers are preserved. Twelve focused posting/balance tests passed. The live App Sync log verifies Monday November 9 on tickets 1 and 19; Subs/job ledgers were read back without new duplicate entries. Both job workbooks balance actual labor against scope totals, and loaded labor against loaded scope totals, using their existing /0.5 formula convention.

This is NOT an overall completion receipt. Ticket 121 (Hampton) has no active payroll-to-QuickBooks route. Historical November 3–6 compact mirrors differ from saved work. Fate retains a visible unidentified-scope balance, including the Monday employee share with no saved scope. Do not invent scopes or zero actual labor to force a match.

## Disabled payroll QuickBooks bridge proposal

The separate fix/payroll-qbo-bridge branch adds a disabled-by-default payroll-only bridge. It is not installed or enabled. Activation requires approval to grant Payroll Robot narrowly scoped QuickBooks invoice-write access, deployment of the reviewed server code, a dedicated PAYROLL_BRIDGE_SECRET in Netlify and matching PAYROLL_QBO_BRIDGE_SECRET in Apps Script properties. Never put secrets in source, logs or chat. Preserve the app's general read-only QuickBooks restriction; the signed route is the only additional invoice-write path.

The proposal verifies the source workbook, approved date, exact ticket, saved costs and confirmed existing customer. It computes the customer placeholder using the existing app billing rule, not an invented markup. It uses a per-ticket lock, deterministic QuickBooks request ID, unique day marker, persistent app receipt and readback. Retries recover an interrupted receipt instead of creating a second invoice. It does not send invoices, initiate payments, mark wages paid, create customers or fold/zero old placeholders. Live activation and real QuickBooks readback remain unverified.
