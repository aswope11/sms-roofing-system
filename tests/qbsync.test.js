import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as QB from '../lib/qbsync.js';

const wortham = { Id: '10', DisplayName: 'Wortham Bros., Inc.', FullyQualifiedName: 'Wortham Bros., Inc.', Job: false };
const mulberry = { Id: '11', DisplayName: '216 W. Mulberry St., Denton - MKOA Studio', FullyQualifiedName: 'Wortham Bros., Inc.:216 W. Mulberry St., Denton - MKOA Studio', Job: true, ParentRef: { value: '10' } };
const strait = { Id: '12', DisplayName: '10914 Strait Lane, Dallas', FullyQualifiedName: 'Wortham Bros., Inc.:10914 Strait Lane, Dallas', Job: true, ParentRef: { value: '10' } };
const standridge = { Id: '20', DisplayName: 'Standridge Companies', FullyQualifiedName: 'Standridge Companies', Job: false };
const windhaven = { Id: '22', DisplayName: '6101 Windhaven Parkway', FullyQualifiedName: 'Standridge Companies:6101 Windhaven Parkway', Job: true, ParentRef: { value: '20' } };
const abrams = { Id: '21', DisplayName: '6751 Abrams - Dallas - Lake Highlands Cafe', FullyQualifiedName: 'Standridge Companies:6751 Abrams - Dallas - Lake Highlands Cafe', Job: true, ParentRef: { value: '20' } };
const corners = { Id: '30', DisplayName: 'Four Corners', FullyQualifiedName: 'Four Corners', Job: false };

function job(over = {}) {
  return {
    id: 39, tag: 'UC', title: 'Counter flashing', address: '10914 Strait Lane', city: 'Dallas', tenant: '',
    customer_id: 4, customer_name: 'Wortham Brothers Roofing', property_id: 8,
    qb_customer_id: '', qb_customer_name: '', qb_subcustomer_id: '', qb_subcustomer_name: '',
    qb_co_invoice_id: '', qb_class_id: '', qb_bucket_customer_id: '', scope: '',
    ...over,
  };
}

function mockQb({ customers = [], classes = [], invoices = [], failInvoice = null } = {}) {
  let invSeq = 800, custSeq = 900;
  const calls = [];
  const qb = async (method, path, payload) => {
    calls.push({ method, path, payload: payload ? structuredClone(payload) : undefined });
    if (String(path).startsWith('query')) {
      const q = decodeURIComponent(String(path).split('query=')[1] || '');
      if (q.includes('FROM Customer')) return { QueryResponse: { Customer: customers.filter(c => c.Active !== false) } };
      if (q.includes('FROM Class')) return { QueryResponse: { Class: classes } };
      if (q.includes('FROM Invoice')) {
        const m = q.match(/DocNumber = '([^']*)'/);
        const hit = invoices.filter(i => String(i.DocNumber) === (m && m[1]));
        return { QueryResponse: { Invoice: hit.map(i => ({ Id: i.Id, DocNumber: i.DocNumber, TotalAmt: i.TotalAmt })) } };
      }
    }
    if (method === 'GET' && String(path).startsWith('customer/')) {
      const c = customers.find(x => x.Id === String(path).split('/')[1]);
      if (!c) throw new Error('QuickBooks said: Object Not Found');
      return { Customer: c };
    }
    if (method === 'GET' && String(path).startsWith('invoice/')) {
      const cur = invoices.find(i => i.Id === String(path).split('/')[1]);
      if (!cur) throw new Error('QuickBooks said: Object Not Found');
      return { Invoice: cur };
    }
    if (method === 'POST' && path === 'customer') {
      const parent = customers.find(c => c.Id === payload?.ParentRef?.value);
      const c = {
        Id: String(++custSeq), DisplayName: payload.DisplayName, Job: true, Active: true, ParentRef: payload.ParentRef,
        FullyQualifiedName: `${parent ? parent.DisplayName : 'Loose'}:${payload.DisplayName}`,
      };
      customers.push(c);
      return { Customer: c };
    }
    if (method === 'POST' && path === 'invoice' && payload && !payload.Id) {
      if (failInvoice) throw new Error(failInvoice);
      const made = {
        Id: String(++invSeq), DocNumber: payload.DocNumber, PrivateNote: payload.PrivateNote || '', CustomerMemo: payload.CustomerMemo,
        CustomerRef: payload.CustomerRef, TxnDate: payload.TxnDate, Line: payload.Line, SyncToken: '0',
        TotalAmt: payload.Line.reduce((a, l) => a + Number(l.Amount), 0),
      };
      invoices.push(made);
      return { Invoice: made };
    }
    if (method === 'POST' && path === 'invoice' && payload?.Id) {
      const cur = invoices.find(i => i.Id === String(payload.Id));
      if (!cur) throw new Error('QuickBooks said: Object Not Found');
      if (payload.sparse) {
        cur.Line = payload.Line;
        cur.SyncToken = String(Number(cur.SyncToken || 0) + 1);
        cur.TotalAmt = payload.Line.reduce((a, l) => a + Number(l.Amount), 0);
      }
      return { Invoice: cur };
    }
    throw new Error('unexpected ' + method + ' ' + path);
  };
  return { qb, calls, customers, invoices };
}

function harness(qbOpts, slots, extra = {}) {
  const api = mockQb(qbOpts);
  const store = QB.makeMemoryStore();
  let n = 6000;
  const nextNumber = async () => String(++n);
  const run = (over = {}) => QB.syncSlots({ qb: api.qb, store, slots, nextNumber, budgetMs: 60000, ...extra, ...over });
  return { ...api, store, run };
}

const labor = [{ how: 'Charlie 3.6 hrs × $50', amount: 180 }];

test('Wortham Brothers Roofing matches Wortham Bros., Inc., and a property matches parent:sub', () => {
  const customers = [wortham, mulberry, strait, standridge, windhaven, abrams];
  const parent = QB.matchParent('Wortham Brothers Roofing', customers);
  assert.equal(parent.customer.Id, '10');
  const sub = QB.matchSub(job(), parent.customer, customers);
  assert.equal(sub.customer.Id, '12');
  assert.equal(QB.matchParent('Standridge', customers).customer.Id, '20');
  assert.equal(QB.matchSub(job({ address: '6101 Windhaven', city: 'Plano', customer_name: 'Standridge' }), standridge, customers).customer.Id, '22');
  assert.equal(QB.matchSub(job({ address: '6751 Abrams', city: 'Dallas' }), standridge, customers).customer.Id, '21');
  assert.equal(QB.matchParent('Four Corners Property Company', [corners]).customer.Id, '30');
});

test('change order label drops "the" and reads Change order …', () => {
  assert.equal(QB.changeOrderLabel('Gravel stop and reflash the posts'), 'Change order gravel stop and reflash posts');
  assert.equal(QB.changeOrderLabel('Change order gravel stop and reflash posts'), 'Change order gravel stop and reflash posts');
});

test('no parent match does not create a customer', async () => {
  const { calls, run } = harness({ customers: [standridge, windhaven] }, [{
    job: job(), work_date: '2026-10-06', labor, material_cost: 0, amount: 180,
  }]);
  const out = await run();
  assert.equal(out.results.length, 0);
  assert.match(out.errors[0], /No QuickBooks customer matches "Wortham Brothers Roofing"/);
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
});

test('a missing property sub-customer is created under the parent, once', async () => {
  const customers = [wortham, mulberry];
  const { calls, run } = harness({ customers }, [
    { job: job({ id: 70, tag: 'UC', title: 'Counter flashing' }), work_date: '2026-10-06', labor, material_cost: 0, amount: 400 },
    { job: job({ id: 71, tag: 'R', title: 'Pipe boot', property_id: 8 }), work_date: '2026-10-06', labor, material_cost: 0, amount: 250 },
  ]);
  const out = await run();
  assert.equal(out.errors.length, 0);
  const created = calls.filter(c => c.method === 'POST' && c.path === 'customer');
  assert.equal(created.length, 1);
  assert.equal(created[0].payload.ParentRef.value, '10');
  assert.equal(created[0].payload.Job, true);
  assert.match(created[0].payload.DisplayName, /10914 Strait Lane/);
  assert.equal(calls.filter(c => c.method === 'POST' && c.path === 'invoice').length, 2);
  assert.ok(calls.filter(c => c.path === 'invoice' && c.payload && !c.payload.Id).every(c => c.payload.CustomerRef.value !== '10'));
});

test('an existing sub-customer is used by id and not created again', async () => {
  const slot = { job: job(), work_date: '2026-10-06', labor, material_cost: 0, amount: 400 };
  const h = harness({ customers: [wortham, strait] }, [slot]);
  await h.run();
  const posts = h.calls.filter(c => c.method === 'POST' && c.path === 'customer');
  assert.equal(posts.length, 0);
  const inv = h.calls.find(c => c.method === 'POST' && c.path === 'invoice');
  assert.equal(inv.payload.CustomerRef.value, '12');
  h.calls.length = 0;
  slot.job.qb_bucket_customer_id = 'self';
  await h.run();
  assert.equal(h.calls.filter(c => String(c.path).startsWith('query') && decodeURIComponent(c.path).includes('FROM Customer')).length, 0);
  assert.equal(h.calls.filter(c => c.method === 'POST' && c.path === 'invoice').length, 0);
});

test('two QuickBooks customers at one address are not guessed and nothing is created', async () => {
  const extra = { ...strait, Id: '13', DisplayName: '10914 Strait Lane, Dallas - other', FullyQualifiedName: 'Wortham Bros., Inc.:10914 Strait Lane, Dallas - other' };
  const { calls, run } = harness({ customers: [wortham, strait, extra] }, [{
    job: job(), work_date: '2026-10-06', labor, material_cost: 0, amount: 100,
  }]);
  const out = await run();
  assert.match(out.errors[0], /10914 Strait Lane/);
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
});

test('a QuickBooks failure is saved word for word and the owed list is only that failure', async () => {
  const h = harness({ customers: [wortham, strait], failInvoice: 'QuickBooks said: Required param CustomerRef is missing' }, [{
    job: job({ id: 38, tag: 'UC', title: 'Counter flashing' }), work_date: '2026-10-06', labor, material_cost: 0, amount: 675,
  }]);
  const out = await h.run();
  assert.equal(h.store.state.attempts.length, 1);
  assert.equal(h.store.state.attempts[0].ok, false);
  assert.equal(h.store.state.attempts[0].qb_error, 'QuickBooks said: Required param CustomerRef is missing');
  assert.match(out.errors[0], /QuickBooks said: Required param CustomerRef is missing/);
  const owed = QB.owedRows({ attempts: h.store.state.attempts, claims: [...h.store.state.claims.values()], invoices: h.store.state.invoices });
  assert.equal(owed.length, 1);
  assert.equal(owed[0].qb_error, 'QuickBooks said: Required param CustomerRef is missing');
  const untouched = QB.owedRows({ attempts: [], claims: [], invoices: [] });
  assert.deepEqual(untouched, []);
  h.calls.length = 0;
  const again = await h.run();
  assert.equal(again.results.length, 0);
  assert.equal(h.calls.filter(c => c.method === 'POST' && c.path === 'invoice').length, 0);
});

test('a second green run does not create a second invoice for the same job and day', async () => {
  const slot = { job: job({ id: 38, tag: 'UC' }), work_date: '2026-10-06', labor, material_cost: 0, amount: 675 };
  const h = harness({ customers: [wortham, strait] }, [slot]);
  const [a, b] = await Promise.all([h.run(), h.run()]);
  const posts = h.calls.filter(c => c.method === 'POST' && c.path === 'invoice' && !c.payload.Id);
  assert.equal(posts.length, 1);
  assert.equal(h.invoices.length, 1);
  assert.equal(a.results.length + b.results.length, 1);
});

test('a slow run stops before the next job and a retry finishes it without a duplicate', async () => {
  let t = 0;
  const api = mockQb({ customers: [wortham, strait, standridge, windhaven] });
  const qb = async (method, path, payload) => { t += 10000; return api.qb(method, path, payload); };
  const store = QB.makeMemoryStore();
  let n = 6100;
  const slots = [
    { job: job({ id: 38, tag: 'UC', title: 'Strait' }), work_date: '2026-10-06', labor, material_cost: 0, amount: 675 },
    { job: job({ id: 41, tag: 'R', title: 'Midbury', address: '6101 Windhaven', city: 'Plano', customer_id: 5, customer_name: 'Standridge', property_id: 9 }), work_date: '2026-10-06', labor, material_cost: 0, amount: 330 },
  ];
  const first = await QB.syncSlots({ qb, store, slots, budgetMs: 15000, now: () => t, nextNumber: async () => String(++n) });
  assert.equal(first.pending, true);
  assert.equal(first.results.length, 1);
  assert.equal(api.invoices.length, 1);
  const second = await QB.syncSlots({ qb, store, slots, budgetMs: 100000, now: () => t, nextNumber: async () => String(++n) });
  assert.equal(second.pending, false);
  assert.equal(api.invoices.length, 2);
  assert.equal(api.calls.filter(c => c.method === 'POST' && c.path === 'invoice' && !c.payload.Id).length, 2);
});

test('a change order is one labeled invoice, and the next day adds a line', async () => {
  const co = job({ id: 39, tag: 'CO', title: 'Gravel stop and reflash the posts' });
  const h = harness({ customers: [wortham, strait], classes: [{ Id: '7', Name: 'CO' }] }, []);
  const day = (work_date, amount) => ({ job: co, work_date, labor, material_cost: 0, amount });
  const first = await h.run({ slots: [day('2026-10-06', 330)] });
  assert.equal(first.errors.length, 0, first.errors.join(' | '));
  assert.equal(h.invoices.length, 1);
  assert.equal(h.invoices[0].PrivateNote, 'Change order gravel stop and reflash posts');
  assert.equal(h.invoices[0].CustomerMemo.value, 'Change order gravel stop and reflash posts');
  assert.equal(h.invoices[0].CustomerRef.value, '12');
  assert.equal(h.invoices[0].Line[0].SalesItemLineDetail.ClassRef.value, '7');
  assert.match(h.invoices[0].Line[0].Description, /Date: 10\/6\/26/);
  const second = await h.run({ slots: [day('2026-10-07', 200)] });
  assert.equal(second.errors.length, 0, second.errors.join(' | '));
  assert.equal(h.invoices.length, 1);
  assert.equal(h.invoices[0].Line.length, 2);
  assert.match(h.invoices[0].Line[1].Description, /Date: 10\/7\/26/);
  assert.equal(h.invoices[0].TotalAmt, 530);
  const third = await h.run({ slots: [day('2026-10-07', 200)] });
  assert.equal(h.invoices[0].Line.length, 2);
  assert.equal(third.results.length, 0);
});

test('an existing QuickBooks invoice is not updated, voided, deleted, or re-pushed', async () => {
  const old = { Id: '14817', DocNumber: '4817', PrivateNote: 'CO-9/30/26', SyncToken: '4', TotalAmt: 400, Line: [{ DetailType: 'SalesItemLineDetail', Amount: 400, Description: 'Date: 9/30/26', Id: '1', SalesItemLineDetail: { ItemRef: { value: '1' } } }] };
  const co = job({ id: 39, tag: 'CO', title: 'Gravel stop and reflash the posts', qb_co_invoice_id: '14817' });
  const h = harness({ customers: [wortham, strait], invoices: [old] }, [{ job: co, work_date: '2026-10-06', labor, material_cost: 0, amount: 330 }]);
  const out = await h.run();
  assert.match(out.errors[0], /left as it is/);
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 0);
  assert.equal(old.TotalAmt, 400);
  assert.equal(old.Line.length, 1);
  const src = readFileSync('lib/qbsync.js', 'utf8');
  assert.equal(src.includes('operation=delete'), false);
  assert.equal(/\bvoid\b/i.test(src), false);
});

test('a doc number that already belongs to someone else is not reused', async () => {
  const foreign = { Id: '999', DocNumber: '6001', PrivateNote: 'Adam typed this', SyncToken: '0', TotalAmt: 50, Line: [] };
  const h = harness({ customers: [wortham, strait], invoices: [foreign] }, [{
    job: job({ id: 38, tag: 'UC' }), work_date: '2026-10-08', labor, material_cost: 0, amount: 100,
  }]);
  await h.run();
  const posts = h.calls.filter(c => c.method === 'POST');
  assert.ok(posts.every(c => c.payload?.Id !== '999'));
  assert.equal(foreign.TotalAmt, 50);
  assert.equal(h.invoices.filter(i => i.Id !== '999').length, 1);
  assert.notEqual(h.invoices.find(i => i.Id !== '999').DocNumber, '6001');
});

test('a started day keeps the job it never reached; a day that never started does not', () => {
  const claims = [{ job_id: 38, work_date: '2026-10-06', state: 'done', qb_id: '1', updated_at: new Date().toISOString() }];
  const unseated = [{ job_id: 39, work_date: '2026-10-06' }, { job_id: 40, work_date: '2026-10-05' }];
  const gaps = QB.gapsOnStartedDay(unseated, claims, []);
  assert.deepEqual(gaps.map(g => g.job_id), [39]);
});

test('a run that stopped shows on the owed list; a day that was never attempted does not', () => {
  const claims = [{ job_id: 39, work_date: '2026-10-06', state: 'working', qb_id: '', invoice_id: null, updated_at: new Date(Date.now() - 120000).toISOString() }];
  const rows = QB.owedRows({ attempts: [], claims, invoices: [], now: Date.now(), staleMs: 90000 });
  assert.equal(rows.length, 1);
  assert.match(rows[0].qb_error, /stopped before it finished/);
  assert.deepEqual(QB.owedRows({ attempts: [], claims: [], invoices: [], now: Date.now() }), []);
});

test('the customer map reads QuickBooks before saving an id and does not touch invoices', () => {
  const src = readFileSync('netlify/functions/work.mts', 'utf8');
  const map = src.slice(src.indexOf('QUICKBOOKS CUSTOMER MAP'), src.indexOf('INVOICING PAGE'));
  assert.ok(map.includes('customer/${encodeURIComponent(qid)}'), 'a typed id is read from QuickBooks before it is saved');
  assert.equal(map.includes('invoice'), false);
  assert.ok(map.includes("qb_bucket_customer_id = ''"));
  assert.equal(map.includes('qb_co_invoice_id'), false);
  assert.ok(map.includes('ParentRef'));
});
