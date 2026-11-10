// PAYROLL → QUICKBOOKS BRIDGE (11/10/26)
// Daily Payroll (the Payroll Robot) calls this once a green day's sub/crew money is on the sheet and the Subs tab.
// It puts that day on the ticket's ONE open placeholder in QuickBooks (rule 1), or opens the placeholder if the ticket
// has none. Never sends, never records a payment, never changes the date of an invoice that already exists.
// Cost (what the men are paid) and charge (what the customer is billed) are different numbers: charge comes from
// money.js billLabor — SMS men at $50/hr (rule 6), subs at cost × 1.5.
// Duplicate guard: every posted day leaves "SMS-PAYROLL:<date>:<ticket>" in the invoice's private memo (never on a
// line the customer sees). A retry finds it and reuses it instead of adding the day again.
import {createHash} from 'node:crypto';

export const PAYROLL_SOURCE_ID = '1yY_j6idmY0UY_InoOib9TGPoKdcFRSuqTpQT5Ci0coQ';
export const PLACEHOLDER_DAYS_OUT = 14;
const cents = n => Math.round(Number(n) * 100);
const close = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
const fmt = n => '$' + Number(n).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});

// Same wording as the rest of the app: "11/9/26" (no leading zeros).
export const mdyy = iso => { const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${Number(m)}/${Number(d)}/${y.slice(2)}`; };
// Placeholder = 2 weeks after the DAY WORKED (rule 5 / 10/8 "it's exactly right") — not 2 weeks after today.
export function placeholderDate(workDate) {
  const d = new Date(String(workDate).slice(0, 10) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + PLACEHOLDER_DAYS_OUT);
  return d.toISOString().slice(0, 10);
}
export const payrollMarker = (workDate, jobId) => `SMS-PAYROLL:${workDate}:${Number(jobId)}`;
const markerCount = (inv, marker) => String(inv?.PrivateNote || '').split(/\r?\n/).filter(l => l.trim() === marker).length;
// A line someone already wrote for this day ("Date: 11/9/26 …") — never add the day a second time.
export const dayOnLines = (inv, workDate) => (inv?.Line || []).some(l => l.DetailType === 'SalesItemLineDetail' &&
  new RegExp('(^|\\n)Date: ' + mdyy(workDate).replace(/\//g, '\\/') + '(\\s|$|\\n)').test(String(l.Description || '')));

// WHO IS CALLING: the Payroll Robot sends its own Google sign-in (ScriptApp.getOAuthToken()). We ask Google who owns
// that token; only the owner's Google account gets through. No shared password to type, store or leak.
export async function verifyGoogleCaller({authorization, allowedEmail, fetchImpl = fetch}) {
  if (!allowedEmail) throw new Error('Payroll QuickBooks bridge is off: no allowed Google account is set');
  const m = String(authorization || '').match(/^Bearer\s+([\w.\-~+/]+=*)$/);
  if (!m) throw new Error('Payroll request is not signed in');
  const res = await fetchImpl('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', {headers: {authorization: 'Bearer ' + m[1]}});
  if (!res.ok) throw new Error('Payroll sign-in was refused by Google');
  const who = String((await res.json())?.user?.emailAddress || '').toLowerCase();
  if (!who || who !== String(allowedEmail).trim().toLowerCase()) throw new Error('Payroll request is from the wrong Google account');
  return who;
}

// QuickBooks lines for one day, worded like every other placeholder day:
// SMS men → one line "Date: 11/9/26 / 2 men @ 8 hours / $800.00", Qty = man-hours, Rate = $50, no names (rule 6).
// Subs → their own line "Date: 11/9/26 / Puma cost $200.00 × 1.5 = $300.00".
export function payrollDayLines(workDate, labor, menAtHours) {
  const date = `Date: ${mdyy(workDate)}`;
  const line = (amount, desc, qty = 1, rate = amount) => ({DetailType: 'SalesItemLineDetail', Amount: amount, Description: desc,
    SalesItemLineDetail: {ItemRef: {value: '1'}, Qty: qty, UnitPrice: rate}});
  const out = [];
  const emp = menAtHours(labor);
  if (emp) out.push(line(emp.amount, [date, emp.words, fmt(emp.amount)].join('\n'), emp.qty, emp.rate));
  for (const l of labor.filter(l => l.kind !== 'employee')) out.push(line(l.amount, [date, `${l.how} = ${fmt(l.amount)}`].join('\n\n')));
  return out;
}

export function payrollBridgePlan({request, job, approved, shares, billLabor, menAtHours, canPlaceholder}) {
  const r = request || {};
  if (r.source_spreadsheet !== PAYROLL_SOURCE_ID || !/^\d{4}-\d{2}-\d{2}$/.test(r.work_date || '')) throw new Error('Verified Daily Payroll source required');
  if (!approved) throw new Error('Payroll date is not approved (not green in the app)');
  if (!job || Number(job.id) !== Number(r.job_id) || !canPlaceholder(job.tag) || job.no_charge || job.tabled_at) throw new Error('Ticket is not eligible for a QuickBooks placeholder (JC, W, no-charge or tabled)');
  const mine = shares.filter(s => Number(s.job_id) === Number(r.job_id) && s.work_date === r.work_date);
  if (!mine.length) throw new Error('No saved work for this ticket and date');
  const cost = mine.reduce((n, s) => n + cents(s.cost), 0);
  if (!Number.isFinite(Number(r.expected_cost)) || cents(r.expected_cost) !== cost) throw new Error(`Payroll cost on the sheet (${fmt(r.expected_cost)}) differs from saved work (${fmt(cost / 100)})`);
  const labor = mine.map(billLabor);
  if (labor.some(l => l.amount == null || !Number.isFinite(l.amount))) throw new Error('Billing price is not defined for this day (' + labor.filter(l => l.amount == null).map(l => l.how).join('; ') + ')');
  const charge = labor.reduce((n, l) => n + cents(l.amount), 0) / 100;
  if (!(charge > 0)) throw new Error('No positive payroll charge');
  const lines = payrollDayLines(r.work_date, labor, menAtHours);
  if (cents(lines.reduce((n, l) => n + l.Amount, 0)) !== cents(charge)) throw new Error('Placeholder lines do not add up to the charge');
  const marker = payrollMarker(r.work_date, r.job_id);
  return {workDate: r.work_date, jobId: Number(r.job_id), cost: cost / 100, charge, marker, labor, lines,
    memo: `${job.tag}-${mdyy(r.work_date)}`, invoiceDate: placeholderDate(r.work_date)};
}
const reqId = s => createHash('sha256').update(s).digest('hex').slice(0, 40);

// service: customer(), existing() → app's open placeholder {qbId, dayAmount}|null, readInvoice(id),
// findInvoiceByMarker(customerId, marker), writeInvoice(payload, requestId), record({invoice, plan, created}).
// dryRun: does every read and check, then reports what it WOULD write. Nothing is written.
export async function postPayrollPlaceholder(plan, service, {dryRun = false} = {}) {
  const customer = await service.customer();
  if (!customer?.id) throw new Error('No confirmed QuickBooks customer');
  const sameCustomer = inv => String(inv?.CustomerRef?.value) === String(customer.id);
  const done = (inv, extra) => ({verified: true, qbId: String(inv.Id), number: inv.DocNumber, total: Number(inv.TotalAmt), charge: plan.charge, cost: plan.cost, ...extra});
  const seat = await service.existing();

  // 1. The app already has this day on its open placeholder (posted earlier, by this bridge or the old app push).
  if (seat?.dayAmount != null) {
    if (!close(seat.dayAmount, plan.charge)) throw new Error(`This day is already on placeholder at ${fmt(seat.dayAmount)}, not ${fmt(plan.charge)}; reconcile first`);
    const inv = await service.readInvoice(seat.qbId);
    if (!inv || !sameCustomer(inv)) throw new Error('The placeholder holding this day is missing or on a different QuickBooks customer');
    if (markerCount(inv, plan.marker) > 1) throw new Error('This day is recorded twice on the placeholder; reconcile first');
    return done(inv, {reused: true, action: 'already-posted'});
  }
  // 2. QuickBooks already has this day (a crash after QuickBooks saved it, before the app did) — reuse, never repeat.
  const found = await service.findInvoiceByMarker(customer.id, plan.marker);
  if (found) {
    const inv = await service.readInvoice(found.Id);
    if (!inv || !sameCustomer(inv) || markerCount(inv, plan.marker) !== 1) throw new Error('Earlier posting of this day could not be verified in QuickBooks; reconcile first');
    if (seat?.qbId && String(seat.qbId) !== String(inv.Id)) throw new Error(`This day is on QuickBooks invoice #${inv.DocNumber}, not the ticket's open placeholder; reconcile first`);
    if (dryRun) return done(inv, {reused: true, action: 'would-record-existing', dryRun: true});
    await service.record({invoice: inv, plan, created: !seat?.qbId || String(seat.qbId) !== String(inv.Id)});
    return done(inv, {reused: true, action: 'recorded-existing'});
  }
  // 3. Add to the ticket's open placeholder, or open one.
  let cur = null;
  if (seat?.qbId) {
    cur = await service.readInvoice(seat.qbId);
    if (!cur) throw new Error('The open placeholder is not in QuickBooks any more; no second placeholder was made');
    if (!sameCustomer(cur)) throw new Error('Open placeholder belongs to a different QuickBooks customer');
    if (dayOnLines(cur, plan.workDate)) throw new Error(`${mdyy(plan.workDate)} is already written on placeholder #${cur.DocNumber}; reconcile first`);
  }
  const total = (cents(cur ? cur.TotalAmt : 0) + cents(plan.charge)) / 100;
  // Existing placeholder: lines + memo only — its date stays exactly as it is.
  const payload = cur
    ? {Id: cur.Id, SyncToken: cur.SyncToken, sparse: true, CustomerRef: cur.CustomerRef,
       PrivateNote: [String(cur.PrivateNote || '').trim(), plan.marker].filter(Boolean).join('\n'),
       Line: [...(cur.Line || []).filter(l => l.DetailType === 'SalesItemLineDetail'), ...plan.lines]}
    : {CustomerRef: {value: String(customer.id)}, TxnDate: plan.invoiceDate, DueDate: plan.invoiceDate,
       PrivateNote: plan.memo + '\n' + plan.marker, Line: plan.lines};
  if (dryRun) return {verified: false, dryRun: true, action: cur ? 'would-add-to-placeholder' : 'would-create-placeholder',
    qbId: cur ? String(cur.Id) : null, number: cur?.DocNumber || null, total, charge: plan.charge, cost: plan.cost,
    customerId: String(customer.id), invoiceDate: cur ? cur.TxnDate : plan.invoiceDate, lines: plan.lines.map(l => ({amount: l.Amount, description: l.Description}))};
  const made = await service.writeInvoice(payload, reqId(plan.marker + ':' + (cur ? cur.Id + ':' + cur.SyncToken : 'new')));
  // Read it back in a separate request before anything is called done.
  const back = await service.readInvoice(made?.Id);
  if (!back || !sameCustomer(back) || !close(back.TotalAmt, total) || markerCount(back, plan.marker) !== 1 || !dayOnLines(back, plan.workDate) ||
      (cur && back.TxnDate !== cur.TxnDate)) throw new Error('QuickBooks payroll readback failed; not marked complete');
  await service.record({invoice: back, plan, created: !cur});
  return done(back, {reused: false, action: cur ? 'added-to-placeholder' : 'created-placeholder'});
}
