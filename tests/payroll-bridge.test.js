import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../lib/money.js';
import {verifyGoogleCaller, payrollBridgePlan, postPayrollPlaceholder, PAYROLL_SOURCE_ID, placeholderDate, payrollMarker, mdyy} from '../lib/payroll-bridge.js';

const request = {source_spreadsheet: PAYROLL_SOURCE_ID, work_date: '2026-11-09', job_id: 121, expected_cost: 200};
const puma = {job_id: 121, work_date: '2026-11-09', cost: 200, kind: 'sub', shows_as: 'Puma'};
const make = extra => payrollBridgePlan({request, job: {id: 121, tag: 'R'}, approved: true, shares: [puma],
  billLabor: M.billLabor, menAtHours: M.menAtHours, canPlaceholder: M.canPlaceholder, ...extra});
const CUST = '1768';
// A tiny fake QuickBooks: keeps invoices, counts writes, applies sparse updates like QuickBooks does.
function fakeQB({invoices = [], seat = null} = {}) {
  const db = new Map(invoices.map(i => [String(i.Id), structuredClone(i)]));
  const s = {writes: 0, records: [], db,
    customer: async () => ({id: CUST}),
    existing: async () => seat,
    readInvoice: async id => structuredClone(db.get(String(id)) || null),
    findInvoiceByMarker: async (cid, marker) => [...db.values()].find(i => String(i.CustomerRef.value) === cid && String(i.PrivateNote || '').split('\n').includes(marker)) || null,
    writeInvoice: async (payload) => {
      s.writes++;
      const id = payload.Id || String(9000 + s.writes);
      const old = db.get(String(id)) || {Id: id, DocNumber: String(5000 + s.writes), SyncToken: '0'};
      const next = {...old, ...payload, Id: id, SyncToken: String(Number(old.SyncToken) + 1)};
      next.TotalAmt = next.Line.reduce((n, l) => n + l.Amount, 0);
      db.set(String(id), next);
      return structuredClone(next);
    },
    record: async r => { s.records.push(r); }};
  return s;
}

test('Nov 9 Puma at 2800 N Hampton: cost $200, customer placeholder $300, dated 2 weeks after the day worked', () => {
  const p = make();
  assert.equal(p.cost, 200); assert.equal(p.charge, 300);
  assert.equal(p.invoiceDate, '2026-11-23'); assert.equal(p.memo, 'R-11/9/26');
  assert.equal(p.lines.length, 1);
  assert.equal(p.lines[0].Amount, 300);
  assert.match(p.lines[0].Description, /^Date: 11\/9\/26\n\nPuma cost \$200\.00 × 1\.5 = \$300\.00$/);
  assert.ok(!p.lines[0].Description.includes('SMS-PAYROLL'), 'marker never shows on a customer line');
});
test('placeholder date counts from the day worked, not today', () => {
  assert.equal(placeholderDate('2026-12-25'), '2027-01-08');
  assert.equal(mdyy('2026-01-05'), '1/5/26');
});
test('SMS men go on one "X men @ Y hours" line at $50, no names (rule 6); subs on their own line', () => {
  const shares = [
    {job_id: 7, work_date: '2026-11-09', cost: 250, kind: 'employee', man: 'Charlie', stops: 1, days: 1, frac: 1, split: false},
    {job_id: 7, work_date: '2026-11-09', cost: 230, kind: 'employee', man: 'Tony', stops: 1, days: 1, frac: 1, split: false},
    {job_id: 7, work_date: '2026-11-09', cost: 200, kind: 'sub', shows_as: 'Puma'}];
  const p = payrollBridgePlan({request: {...request, job_id: 7, expected_cost: 680}, job: {id: 7, tag: 'UC'}, approved: true, shares,
    billLabor: M.billLabor, menAtHours: M.menAtHours, canPlaceholder: M.canPlaceholder});
  assert.equal(p.charge, 1100);
  assert.equal(p.lines[0].Description, 'Date: 11/9/26\n2 men @ 8 hours\n$800.00');
  assert.equal(p.lines[0].SalesItemLineDetail.Qty, 16); assert.equal(p.lines[0].SalesItemLineDetail.UnitPrice, 50);
  assert.ok(!/Charlie|Tony/.test(p.lines[0].Description));
  assert.equal(p.lines[1].Amount, 300);
});
test('refuses: not green, JC/W tickets, wrong sheet, cost mismatch', () => {
  assert.throws(() => make({approved: false}), /approved/);
  assert.throws(() => make({job: {id: 121, tag: 'JC'}}), /eligible/);
  assert.throws(() => make({job: {id: 121, tag: 'W'}}), /eligible/);
  assert.throws(() => make({request: {...request, source_spreadsheet: 'other'}}), /source/);
  assert.throws(() => make({request: {...request, expected_cost: 201}}), /differs/);
});
test('no open placeholder → creates one, reads it back, records it', async () => {
  const qb = fakeQB(); const plan = make();
  const out = await postPayrollPlaceholder(plan, qb);
  assert.equal(out.action, 'created-placeholder'); assert.equal(out.total, 300); assert.equal(qb.writes, 1);
  const inv = [...qb.db.values()][0];
  assert.equal(inv.TxnDate, '2026-11-23'); assert.equal(inv.PrivateNote, 'R-11/9/26\n' + payrollMarker('2026-11-09', 121));
  assert.equal(qb.records.length, 1); assert.equal(qb.records[0].created, true);
});
test('running it twice never adds the day twice (QuickBooks saved, app record lost)', async () => {
  const qb = fakeQB(); const plan = make();
  await postPayrollPlaceholder(plan, qb);
  const again = await postPayrollPlaceholder(plan, qb);
  assert.equal(again.action, 'recorded-existing'); assert.equal(qb.writes, 1); assert.equal(again.total, 300);
});
test('day already on the app placeholder → reuse, no write', async () => {
  const inv = {Id: '9', DocNumber: '4950', TotalAmt: 300, TxnDate: '2026-11-23', CustomerRef: {value: CUST}, Line: []};
  const qb = fakeQB({invoices: [inv], seat: {qbId: '9', dayAmount: 300}});
  const out = await postPayrollPlaceholder(make(), qb);
  assert.equal(out.action, 'already-posted'); assert.equal(qb.writes, 0);
  qb.existing = async () => ({qbId: '9', dayAmount: 301});
  await assert.rejects(() => postPayrollPlaceholder(make(), qb), /reconcile/);
});
test('adds a day to the open placeholder without changing its date', async () => {
  const line = {DetailType: 'SalesItemLineDetail', Amount: 225, Description: 'Date: 11/2/26\n\nPuma cost $150.00 × 1.5 = $225.00', SalesItemLineDetail: {ItemRef: {value: '1'}, Qty: 1, UnitPrice: 225}};
  const inv = {Id: '9', DocNumber: '4950', SyncToken: '3', TotalAmt: 225, TxnDate: '2026-11-16', DueDate: '2026-11-16', PrivateNote: 'R-11/2/26', CustomerRef: {value: CUST}, Line: [line]};
  const qb = fakeQB({invoices: [inv], seat: {qbId: '9', dayAmount: null}});
  const out = await postPayrollPlaceholder(make(), qb);
  assert.equal(out.action, 'added-to-placeholder'); assert.equal(out.total, 525);
  const back = qb.db.get('9');
  assert.equal(back.TxnDate, '2026-11-16'); assert.equal(back.Line.length, 2);
  assert.equal(back.PrivateNote, 'R-11/2/26\n' + payrollMarker('2026-11-09', 121));
});
test('a day already typed on the placeholder by hand is not added again', async () => {
  const line = {DetailType: 'SalesItemLineDetail', Amount: 300, Description: 'Date: 11/9/26\n\nPuma cost $200.00 × 1.5 = $300.00'};
  const inv = {Id: '9', DocNumber: '4950', SyncToken: '1', TotalAmt: 300, TxnDate: '2026-11-23', CustomerRef: {value: CUST}, Line: [line]};
  const qb = fakeQB({invoices: [inv], seat: {qbId: '9', dayAmount: null}});
  await assert.rejects(() => postPayrollPlaceholder(make(), qb), /already written/); assert.equal(qb.writes, 0);
});
test('dry run reads everything and writes nothing', async () => {
  const qb = fakeQB();
  const out = await postPayrollPlaceholder(make(), qb, {dryRun: true});
  assert.equal(out.action, 'would-create-placeholder'); assert.equal(out.total, 300); assert.equal(out.invoiceDate, '2026-11-23');
  assert.equal(qb.writes, 0); assert.equal(qb.records.length, 0);
});
test('a bad readback is never recorded as done', async () => {
  const qb = fakeQB();
  const real = qb.readInvoice; let n = 0;
  qb.readInvoice = async id => { const i = await real(id); if (i && ++n) i.TotalAmt = 299; return i; };
  await assert.rejects(() => postPayrollPlaceholder(make(), qb), /readback/); assert.equal(qb.records.length, 0);
});
test('a placeholder on another customer is refused', async () => {
  const inv = {Id: '9', DocNumber: '4950', SyncToken: '1', TotalAmt: 100, CustomerRef: {value: '222'}, Line: []};
  const qb = fakeQB({invoices: [inv], seat: {qbId: '9', dayAmount: null}});
  await assert.rejects(() => postPayrollPlaceholder(make(), qb), /different QuickBooks customer/); assert.equal(qb.writes, 0);
});
test('only the owner\'s Google account gets through', async () => {
  const google = email => async () => ({ok: true, json: async () => ({user: {emailAddress: email}})});
  await assert.rejects(() => verifyGoogleCaller({authorization: 'Bearer abc', allowedEmail: ''}), /off/);
  await assert.rejects(() => verifyGoogleCaller({authorization: '', allowedEmail: 'owner@x.com', fetchImpl: google('owner@x.com')}), /not signed in/);
  await assert.rejects(() => verifyGoogleCaller({authorization: 'Bearer abc', allowedEmail: 'owner@x.com', fetchImpl: google('someone@x.com')}), /wrong Google account/);
  await assert.rejects(() => verifyGoogleCaller({authorization: 'Bearer abc', allowedEmail: 'owner@x.com', fetchImpl: async () => ({ok: false})}), /refused/);
  assert.equal(await verifyGoogleCaller({authorization: 'Bearer abc', allowedEmail: 'Owner@x.com', fetchImpl: google('owner@x.com')}), 'owner@x.com');
});
