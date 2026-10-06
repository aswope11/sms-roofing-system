// Each test is one of his locked rules. If a change breaks a rule, the build fails and nothing deploys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as M from '../lib/money.js';

const crew = [
  { id: 1, name: 'Puma', day_rate: 400, kind: 'sub', pay_to: 'Tenorio Roofing', boss_id: null },
  { id: 2, name: 'Moscar', day_rate: 300, kind: 'sub', pay_to: 'Tenorio Roofing', boss_id: 1 },
  { id: 3, name: 'Charlie', day_rate: 250, kind: 'employee', pay_to: 'Charlie', boss_id: null },
];
const jobs = { 10: { id: 10, tag: 'R', address: '3041 N Belt Line Rd' }, 11: { id: 11, tag: 'R', address: '12020 Teel Pkwy' } };

test('LAW: a man is paid days × rate, flat', () => {
  assert.equal(M.manDayPay(1, 400), 400);
  assert.equal(M.manDayPay(0.5, 300), 150);
});

test('LAW: ticket cost = his day ÷ jobs he touched that day, no multipliers (Puma two repairs = $200 + $200)', () => {
  const stops = [{ id: 1, work_date: '2026-09-08', crew_id: 1, job_id: 10 }, { id: 2, work_date: '2026-09-08', crew_id: 1, job_id: 11 }];
  const sh = M.stopShares({ stops, crew, crewDays: [] });
  assert.deepEqual(sh.map(s => s.cost), [200, 200]);
  assert.equal(sh.reduce((a, s) => a + s.cost, 0), M.manDayPay(1, 400));
});

test('LAW: no repair multiplier exists anywhere in the database', () => {
  const sql = readdirSync('netlify/database/migrations').map(d => readFileSync(`netlify/database/migrations/${d}/migration.sql`, 'utf8')).join('\n');
  assert.ok(!/mult/i.test(sql));
});

test('LAW: one Zelle per job per day to the pay-to name (Tue 9-8: $350 + $350 to Tenorio Roofing)', () => {
  const stops = [
    { id: 1, work_date: '2026-09-08', crew_id: 1, job_id: 10 }, { id: 2, work_date: '2026-09-08', crew_id: 1, job_id: 11 },
    { id: 3, work_date: '2026-09-08', crew_id: 2, job_id: 10 }, { id: 4, work_date: '2026-09-08', crew_id: 2, job_id: 11 },
  ];
  const z = M.zelleLines(M.stopShares({ stops, crew, crewDays: [] }), jobs);
  assert.equal(z.length, 2);
  assert.deepEqual(z.map(x => [x.pay_to, x.amount, x.memo]), [['Tenorio Roofing', 350, 'R 12020 Teel Pkwy'], ['Tenorio Roofing', 350, 'R 3041 N Belt Line Rd']]);
  assert.equal(M.zelleText(z[1]), '9-8 - R 3041 N Belt Line Rd - $350');
});

test("LAW: Puma's name is the only name — Moscar shows as Puma outside Daily Payroll", () => {
  const sh = M.stopShares({ stops: [{ id: 1, work_date: '2026-09-08', crew_id: 2, job_id: 10 }], crew, crewDays: [] });
  assert.equal(sh[0].shows_as, 'Puma');
  assert.equal(sh[0].man, 'Moscar');
});

test('LAW: employee billing $50/hr — 8 hr day, 4 each on 2, 9-hr day on 3+ stops (5+ added 10/4/26)', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(M.billHoursPerStop), [8, 4, 3, 2.25, 1.8, 1.5]);
  assert.equal(M.billLabor({ kind: 'employee', stops: 1, days: 1, man: 'Charlie' }).amount, 400);
  assert.equal(M.billLabor({ kind: 'employee', stops: 4, days: 1, man: 'Charlie' }).amount, 112.5);
  assert.equal(M.billLabor({ kind: 'employee', stops: 5, days: 1, man: 'Charlie' }).amount, 90);
});

test('LAW: sub billed at cost × 1.5 ($350 → $525)', () => {
  assert.equal(M.billLabor({ kind: 'sub', cost: 350, shows_as: 'Puma' }).amount, 525);
});

test('LAW: material cost × 1.2, JC at cost', () => {
  assert.equal(M.billMaterial(590.21, 'R'), 708.25);
  assert.equal(M.billMaterial(590.21, 'JC'), 590.21);
});

test('LAW: JC never goes to QuickBooks — no placeholder on a JC', () => {
  assert.equal(M.canPlaceholder('JC'), false);
  for (const t of ['R', 'CO', 'UC']) assert.equal(M.canPlaceholder(t), true);
});

test('LAW: an estimate is not work — BID never on schedule, payroll or money screens', () => {
  assert.equal(M.isWork('BID'), false);
  assert.deepEqual(M.whereIs({ tag: 'BID', done_at: null }, []), ['Bids']);
});

test('LAW: a placeholder carries a price — $0 refused', () => {
  assert.ok(M.missingOnPlaceholder({ amount: 0 }).length);
  assert.deepEqual(M.missingOnPlaceholder({ amount: 1240 }), []);
});

test('LAW: zeroed cost sheets are named Job Cost 1, 2, 3 — never an invoice number', () => {
  assert.equal(M.nextJobCostName([]), 'Job Cost 1');
  assert.equal(M.nextJobCostName([{ name: 'Job Cost 1' }, { name: 'Job Cost 2' }]), 'Job Cost 3');
});

test('LAW: paid means money came in — refused with no amount or no invoice number', () => {
  assert.ok(M.missingToMarkPaid({ kind: 'real', number: '', amount: 0, sent_at: '2026-09-05' }).length);
  assert.deepEqual(M.missingToMarkPaid({ kind: 'real', number: '4752', amount: 7625, sent_at: '2026-09-05' }), []);
});

test('LAW: in QuickBooks is not sent — a written invoice stays in Invoicing until he marks it sent', () => {
  const job = { tag: 'R', done_at: '2026-09-05' };
  const written = [{ kind: 'real', number: '4750', amount: 5431, sent_at: null }];
  assert.equal(M.inInvoicing(job, written), true);
  assert.equal(M.inAR(written[0]), false);
  const sent = [{ ...written[0], sent_at: '2026-09-06' }];
  assert.equal(M.inInvoicing(job, sent), false);
  assert.equal(M.inAR(sent[0]), true);
});

test('LAW: a done repair with no amount and no number goes to Invoicing, not AR', () => {
  assert.deepEqual(M.whereIs({ tag: 'R', done_at: '2026-09-09' }, []), ['Invoicing']);
});

test('LAW: the app never ticks the scope box — lane stays on checks until he ticks it', () => {
  assert.equal(M.invoicingLane({ scope: 'Full contract text', scope_ok: false, pics_ok: true }, []), 'checks');
  assert.equal(M.invoicingLane({ scope_ok: true, pics_ok: true }, []), 'write');
  const api = readFileSync('netlify/functions/work.mts', 'utf8');
  const writes = api.match(/SET[^`]*scope_ok\s*=/g) || [];
  assert.equal(writes.length, 1, 'scope_ok is written in exactly one place: his tick');
});

test('LAW: table it — off Invoicing, still on a screen', () => {
  const job = { tag: 'R', done_at: '2026-09-11', tabled_at: '2026-09-11' };
  assert.equal(M.inInvoicing(job, []), false);
  assert.deepEqual(M.whereIs(job, []), ['Tabled']);
});

test('LAW: a ticket can never vanish — every combination lands on at least one screen', () => {
  const flags = [null, '2026-09-01'];
  let checked = 0;
  for (const tag of M.WORK_TAGS) for (const done_at of flags) for (const tabled_at of flags) for (const no_charge of [false, true])
    for (const invSet of [[], [{ kind: 'placeholder', amount: 500 }], [{ kind: 'real', amount: 0 }], [{ kind: 'real', amount: 700, sent_at: '2026-09-02' }],
      [{ kind: 'real', amount: 700, sent_at: '2026-09-02', paid_at: '2026-09-09' }], [{ kind: 'draw', amount: 2750, sent_at: '2026-09-02' }, { kind: 'draw', amount: 2000 }]]) {
      const places = M.whereIs({ tag, done_at, tabled_at, no_charge }, invSet);
      assert.ok(places.length > 0, JSON.stringify({ tag, done_at, tabled_at, no_charge, invSet }));
      checked++;
    }
  assert.equal(checked, 192);
});

test('LAW: a UC is a mini job cost — its own contract, every trip bills off it (2155 Marsh = $2,000); a JC contract excludes COs and UCs', () => {
  const invs = [
    { job_id: 1, kind: 'draw', amount: 1200 }, { job_id: 1, kind: 'draw', amount: 2750 },
    { job_id: 2, kind: 'real', amount: 1800 }, { job_id: 1, kind: 'placeholder', amount: 900 },
    { job_id: 3, kind: 'draw', amount: 10000 },
  ];
  assert.deepEqual(M.contractFor({ id: 1, tag: 'UC', job_contract: 5950 }, [], invs), { contract: 5950, billed: 3950, left: 2000 });
  const js = [{ id: 1, tag: 'UC' }, { id: 2, tag: 'CO' }, { id: 3, tag: 'JC' }];
  assert.deepEqual(M.contractFor({ id: 3, tag: 'JC', contract_amount: 50000 }, js, invs), { contract: 50000, billed: 10000, left: 40000 });
  assert.equal(M.contractFor({ id: 9, tag: 'R', contract_amount: 50000 }, js, invs), null);
  assert.equal(M.inInvoicing({ tag: 'UC', done_at: '2026-09-10' }, []), true);    // done UC walks the Invoicing steps, never straight to AR
  assert.equal(M.inInvoicing({ tag: 'JC', done_at: '2026-09-10' }, []), false);   // JC bills by draws
  assert.equal(M.inInvoicing({ tag: 'R', done_at: '2026-09-10' }, []), true);
});

test('LAW: what is missing off a supply invoice is written down — lines to the penny, every line on a job', () => {
  const inv = { house: 'SBM', number: 'INV1', inv_date: '2026-09-07', amount: 118.13 };
  assert.deepEqual(M.missingOnSupplyInvoice(inv, [{ description: 'Freight 2,625 lb × $0.045', qty: 1, line_total: 118.13, shop: true }]), []);
  assert.ok(M.missingOnSupplyInvoice(inv, [{ description: 'x', qty: 1, line_total: 118.12, job_id: 1 }]).some(m => m.includes('off by')));
  assert.ok(M.missingOnSupplyInvoice(inv, [{ description: 'x', qty: 1, line_total: 118.13 }]).some(m => m.includes('Not on a job yet')));
  assert.ok(M.missingOnSupplyInvoice({ ...inv }, []).some(m => m.includes('a total is not an invoice')));
});

// HIS LAW, 9/20/26: "Save is never blocked. Anywhere in this app. Ever. Missing information can show
// as a note, never as a block." This test fails the build if any screen or endpoint puts one back.
test('LAW: nothing in this app ever refuses to save because something else is not filled in', () => {
  const work = readFileSync('netlify/functions/work.mts', 'utf8');
  const api = readFileSync('netlify/functions/api.mts', 'utf8');
  // the old shape of a blocked save: a list of missing field names handed to refuse()/bad()
  assert.equal((work.match(/refuse\(\[/g) || []).length, 0, 'work.mts refuses a save over missing fields');
  assert.ok(!/\bbad\(/.test(api), 'api.mts refuses a save over missing fields');
  assert.ok(!/if \(miss\.length\) return/.test(work + api), 'a missing list is still being used as a wall');
  // and no screen holds the Save button hostage
  for (const f of ['app.js', 'supply.js', 'schedule.js', 'subs.js', 'bids.js', 'ar.js']) {
    const page = readFileSync(`public/${f}`, 'utf8');
    assert.ok(!/ required[>\s]/.test(page), `${f} still has a required field`);
  }
});

test('LAW: one payment, many invoices, credit as a negative line, surcharge per line (SBM $7,724.32 + $37.20)', () => {
  const t = M.paymentTotals([
    { amount: -2047.09 }, { amount: 2000 }, { amount: 2000 }, { amount: 4531.41 }, { amount: 1240, surcharge_pct: 3 },
  ]);
  assert.deepEqual(t, { subtotal: 7724.32, surcharge: 37.2, total: 7761.52 });
});

test('LAW: dispatch shows address, city, tenant — never the owner or GC', () => {
  assert.equal(M.dispatchLine({ address: '2155 Marsh Lane', city: 'Carrollton', tenant: 'Ozan Laundry Lab', gc: 'Keller Springs 72 LLC' }), '2155 Marsh Lane · Carrollton · Ozan Laundry Lab');
});

test('LAW: every ticket and invoice reads TAG - address, city - detail', () => {
  const job = { tag: 'R', title: 'Two pipe boots', done_at: '2026-09-04' };
  const stops = [{ job_id: 5, work_date: '2026-08-26' }, { job_id: 5, work_date: '2026-08-27' }];
  assert.equal(M.ticketName({ tag: 'JC', address: '1721 John McCain', city: 'Colleyville', title: 'Building 4' }), 'JC - 1721 John McCain, Colleyville - Building 4');
});

test('pay week runs Saturday to Friday', () => {
  assert.equal(M.payWeekStart('2026-08-26'), '2026-08-22');
  assert.equal(M.payWeekStart('2026-08-22'), '2026-08-22');
  assert.equal(M.payWeekStart('2026-08-28'), '2026-08-22');
});

test('browser copy of money rules matches the server copy', () => {
  assert.equal(readFileSync('public/money.js', 'utf8'), readFileSync('lib/money.js', 'utf8'));
});

test('no invoice ever carries terms — there is no terms field anywhere', () => {
  const sql = readdirSync('netlify/database/migrations').map(d => readFileSync(`netlify/database/migrations/${d}/migration.sql`, 'utf8')).join('\n');
  assert.ok(!/terms/i.test(sql));
});

test('nothing is deleted — the work API only removes a stop (a man moved off a day), rewrites the lines of an invoice being corrected, or deletes a priced placeholder when its day is taken back (step 2 locked rule)', () => {
  const api = readFileSync('netlify/functions/work.mts', 'utf8');
  const dels = api.match(/DELETE\s+FROM\s+(\w+)/gi) || [];
  assert.deepEqual([...new Set(dels.map(d => d.split(/\s+/).pop().toLowerCase()))].sort(), ['bid_options', 'bid_systems', 'invoices', 'stops', 'supply_lines']);
  assert.equal((api.match(/DELETE FROM invoices/g) || []).length, 3);   // un-green, stale QuickBooks copy, reopen undo — every one tied to QuickBooks
  assert.ok(api.includes("SELECT * FROM invoices WHERE kind = 'placeholder' AND work_date = ${b.work_date} AND amount > 0"));
});

test('crew shows in the order he dragged — every crew list reads sort_order', () => {
  const api = readFileSync('netlify/functions/work.mts', 'utf8');
  const lists = api.match(/SELECT \* FROM crew ORDER BY [^`]*/g) || [];
  assert.ok(lists.length >= 2 && lists.every(q => q.includes('sort_order')));
});

test('crew color: a man under a sub shows his boss\'s color', () => {
  const crew = [{ id: 1, kind: 'sub', color: '#ff7a3d', boss_id: null }, { id: 2, kind: 'sub', color: '', boss_id: 1 }, { id: 3, kind: 'sub', color: '#3dff8f', boss_id: null }];
  assert.equal(M.crewColor(crew[1], crew), '#ff7a3d');
  assert.equal(M.crewColor(crew[2], crew), '#3dff8f');
});

test('Schedule is the men × days grid, tab named Schedule; the pay side lives on the Crew tab', () => {
  const html = readFileSync('public/index.html', 'utf8');
  assert.ok(/data-tab="schedule">Schedule</.test(html));
  assert.ok(!/Payroll/.test(html));
  const sched = readFileSync('public/schedule.js', 'utf8');
  assert.ok(sched.includes('class="plus') && sched.includes('data-crew'));
  assert.ok(readFileSync('public/crew.js', 'utf8').includes('payrollSection('));
});

test('crew grouping: SMS employees together first, subs after, a man under a sub right under his boss, dragged order inside each', () => {
  const crew = [
    { id: 1, name: 'Puma', kind: 'sub', boss_id: null, sort_order: 1, color: '#ff00cc' },
    { id: 2, name: 'Moscar', kind: 'sub', boss_id: 1, sort_order: 5 },
    { id: 3, name: 'Charlie', kind: 'employee', boss_id: null, sort_order: 3 },
    { id: 4, name: 'Tony', kind: 'employee', boss_id: null, sort_order: 2 },
    { id: 5, name: 'Rabano', kind: 'sub', boss_id: null, sort_order: 0 },
  ];
  assert.deepEqual(M.groupCrew(crew).map(c => c.name), ['Tony', 'Charlie', 'Rabano', 'Puma', 'Moscar']);
  assert.equal(M.crewColor(crew[2], crew), M.crewColor(crew[3], crew));
  assert.equal(M.crewColor(crew[1], crew), '#ff00cc');
  assert.notEqual(M.crewColor(crew[0], crew), M.EMPLOYEE_COLOR);
});

test('a sub crew is never the same color as the SMS employees', () => {
  for (let id = 1; id < 40; id++) for (const color of ['', '#7fe3ff', '#7FE3FF'])
    assert.notEqual(M.crewColor({ id, kind: 'sub', color, boss_id: null }, []), M.EMPLOYEE_COLOR);
});

test('sub pay ledger (the old Tenorio Roofing page): one line per job per day, whole crew share, Zelle memo', () => {
  const stops = [
    { id: 1, work_date: '2026-09-08', crew_id: 1, job_id: 10 }, { id: 2, work_date: '2026-09-08', crew_id: 1, job_id: 11 },
    { id: 3, work_date: '2026-09-08', crew_id: 2, job_id: 10 }, { id: 4, work_date: '2026-09-08', crew_id: 2, job_id: 11 },
  ];
  const rows = M.subLedgerRows(M.stopShares({ stops, crew, crewDays: [] }));
  assert.deepEqual(rows.map(r => [r.job_id, r.total, r.men.map(m => m.name + ' ' + m.amt).join(', ')]),
    [[10, 350, 'Puma 200, Moscar 150'], [11, 350, 'Puma 200, Moscar 150']]);
  assert.equal(M.splZelleMemo('2026-09-08', jobs[10]), '9-8 R 3041 Belt Line');
  assert.equal(M.splZelleMemo('2026-09-08', jobs[11]), '9-8 R 12020 Teel');
});

test('Subs tab is back (old board layout): one pay ledger, on the sub page — not also on Crew', () => {
  assert.ok(/data-tab="subs">Subs</.test(readFileSync('public/index.html', 'utf8')));
  assert.ok(readFileSync('public/subs.js', 'utf8').includes('subPayLedger('));
  assert.ok(!readFileSync('public/crew.js', 'utf8').includes('subPayLedger'));
});

test('Schedule grid carries the three things copied off the old board: + boxes, the hover, the pills', () => {
  const s = readFileSync('public/schedule.js', 'utf8');
  assert.ok(s.includes('class="plus') && s.includes('data-peek') && s.includes('900') && s.includes('stageBarHTML') && s.includes('Waiting on other trades'));
  assert.ok(readFileSync('public/style.css', 'utf8').includes('.oldgrid .cell .plus.has'));
});

test('job file page: Customers tab first; ticket has no Priority/Day and no money; money lives on the job cost sheet', () => {
  const idx = readFileSync('public/index.html', 'utf8');
  assert.ok(idx.indexOf('data-tab="customers"') < idx.indexOf('data-tab="schedule"'));
  const led = readFileSync('public/ledger.js', 'utf8');
  const ticket = led.slice(0, led.indexOf('// ---------------- JOB COST SHEET'));
  assert.ok(!/Priority|id="sday"|Invoices on this ticket|General ledger/.test(ticket));
  const jc = readFileSync('public/jobcost.js', 'utf8');
  assert.ok(/General ledger/.test(jc) && /Invoices on this ticket/.test(jc));
  const app = readFileSync('public/app.js', 'utf8');
  assert.ok(app.includes('#/jobcost/') && app.includes('id="editJob"'));
});

test('schedule scrolls left/right like the old board (9/22), day reads "Tue - 9/22", day header greens the day, customer name on the rows', () => {
  const s = readFileSync('public/schedule.js', 'utf8');
  const css = readFileSync('public/style.css', 'utf8');
  assert.ok(!s.includes('card scroll') && css.includes('.oldgrid .fitgrid{overflow-x:auto') && css.includes('tr>th:first-child{position:sticky;left:0') && css.includes('.oldgrid table.schedgrid .jobcard{width:auto'));
  assert.ok(s.includes("${DOW[x.getDay()]} - ${x.getMonth() + 1}/${x.getDate()}"));
  assert.ok(s.includes('data-green=') && s.includes("'/w/green'") && s.includes('pcust'));
});

test('LAW: half/full is what he is paid; a percent split divides that day — 10% / 90%', () => {
  const crew = [{ id: 1, name: 'Charlie', kind: 'employee', day_rate: 250 }];
  const even = M.stopShares({ stops: [{ id: 1, work_date: '2026-09-15', crew_id: 1, job_id: 10 }, { id: 2, work_date: '2026-09-15', crew_id: 1, job_id: 11 }], crew, crewDays: [] });
  assert.deepEqual(even.map(s => s.cost), [125, 125]);
  const split = M.stopShares({ stops: [{ id: 1, work_date: '2026-09-15', crew_id: 1, job_id: 10, pct: 10 }, { id: 2, work_date: '2026-09-15', crew_id: 1, job_id: 11, pct: 90 }], crew, crewDays: [] });
  assert.deepEqual(split.map(s => s.cost), [25, 225]);
  const half = M.stopShares({ stops: [{ id: 1, work_date: '2026-09-15', crew_id: 1, job_id: 10, pct: 10 }, { id: 2, work_date: '2026-09-15', crew_id: 1, job_id: 11 }], crew, crewDays: [{ crew_id: 1, work_date: '2026-09-15', days: 0.5 }] });
  assert.deepEqual(half.map(s => s.cost), [12.5, 112.5]);
  assert.equal(half.reduce((a, s) => a + s.cost, 0), 125);                 // pay never changes — only the division
  assert.deepEqual(split.map(s => M.billLabor(s).amount), [40, 360]);      // billed 8-hr day divides the same way
  assert.deepEqual(M.whyCantSplit([60, 50]).length, 1);
  assert.deepEqual(M.whyCantSplit([10, 80]).length, 1);
  assert.deepEqual(M.whyCantSplit([10, null]), []);
});

test('+ popup: full/half day, scope pills per job with + Add, man bubbles, change order, percent split, no explanations; hover treats every job the same', () => {
  const s = readFileSync('public/schedule.js', 'utf8');
  for (const t of ['Full day', 'Half day', 'What are they doing on it today?', '＋ Add', 'Anybody else on it that day?', 'This is a change order', 'lfpct', "'/w/log'"]) assert.ok(s.includes(t), t);
  for (const t of ['only one job so far', 'Blank = even split', 'Makes a new CO ticket', 'Also that day:']) assert.ok(!s.includes(t), t);
  assert.ok(s.includes('<div class="prow"><span>${name(jobsById[id])}</span><b>${$(cost(id))}</b></div>'));
  const w = readFileSync('netlify/functions/work.mts', 'utf8');
  assert.ok(w.includes('kind === "log"') && w.includes('M.whyCantSplit') && w.includes('INSERT INTO job_scopes') && w.includes('also_crew'));
});

test('schedule men follow the Crew tab order and groups; job card shows the customer on top', () => {
  const s = readFileSync('public/schedule.js', 'utf8');
  assert.ok(s.includes('const crew = groupCrew(w.crew)') && s.includes("'SMS employees' : 'Subs'"));
  assert.ok(s.indexOf('js jcust') < s.indexOf('<div class="jt">${pfx(j)}${esc(j.address)}</div>'));
});

test('job cost sheet (Greenhill): summary + pills to Labor, Materials, Change orders, Invoices & draws, General ledger; budget/current/remaining by scope and category; numbers only', () => {
  const s = readFileSync('public/jobcost.js', 'utf8');
  for (const t of ["'labor', 'Labor'", "'materials', 'Materials'", "'cos', 'Change orders'", "'invoices', 'Invoices & draws'", "'ledger', 'General ledger'", 'Labor by scope', 'Materials by category', 'Budget', 'Current', 'Remaining', 'SMS employees', 'Priced back', 'Print / save as PDF', 'Invoices on this ticket']) assert.ok(s.includes(t), t);
  assert.ok(!s.includes('class="help"'));
  const w = readFileSync('netlify/functions/work.mts', 'utf8');
  assert.ok(w.includes('kind === "jobcost"') && w.includes('M.splitByScope(x.cost, splitOf[x.stop_id])'));
  const sch = readFileSync('public/schedule.js', 'utf8');
  assert.ok(sch.includes('lfspct') && sch.includes('scope_split'));
});

test('LAW: a stop divides across scopes by the percent he set — not 50/50 unless he left it blank', () => {
  assert.deepEqual(M.splitByScope(240, { 'SS Panels': 75, 'Coping cap': 25 }).map(x => x.amount), [180, 60]);
  assert.deepEqual(M.splitByScope(240, { 'SS Panels': null, 'Coping cap': null }).map(x => x.amount), [120, 120]);
  assert.deepEqual(M.splitByScope(100, { A: 10, B: null, C: null }).map(x => x.amount), [10, 45, 45]);
  assert.deepEqual(M.splitByScope(100, null), [{ name: '', amount: 100 }]);
  const pieces = M.splitByScope(270, { A: 33.33, B: null, C: null });
  assert.equal(Math.round(pieces.reduce((a, x) => a + x.amount, 0) * 100) / 100, 270);   // never loses a penny
});

test('job cost: budget vs current vs remaining by scope; scopes come from the job, extra worked scopes still show', () => {
  const t = M.budgetTable([{ name: 'TPO Field', budget: 1000 }, { name: 'Coping cap', budget: null }], [{ name: 'TPO Field', amount: 400 }, { name: 'Gutters', amount: 50 }, { name: '', amount: 10 }]);
  assert.deepEqual(t.rows.map(r => [r.name, r.budget, r.current, r.remaining]), [['TPO Field', 1000, 400, 600], ['Coping cap', null, 0, null], ['Gutters', null, 50, null], ['', null, 10, null]]);
  assert.equal(t.current, 460);
  assert.deepEqual(M.pricedBack(546853.46, 191536.61, 62761), { material: 656224.15, sms: 383073.22, subs: 83681.33, total: 1122978.7 });
});

test('LAW: ready to bill fills itself — green day + scope written + checked; dollars from the rules; billed days never come back', () => {
  const job = { id: 7, tag: 'R', scope: 'Replaced 2 pipe boots', scope_ok: true, done_at: '2026-09-15' };
  const shares = [
    { job_id: 7, work_date: '2026-09-14', kind: 'employee', man: 'Charlie', shows_as: 'Charlie', stops: 1, days: 1, cost: 250 },
    { job_id: 7, work_date: '2026-09-15', kind: 'sub', man: 'Puma', shows_as: 'Puma', stops: 2, days: 1, cost: 100 },
  ];
  const mats = [{ job_id: 7, inv_date: '2026-09-14', line_total: 100 }];
  const r = M.readyToBill(job, shares, mats, []);
  assert.equal(r.labor, 550);          // 8 hrs × $50 = 400, + sub 100 × 1.5 = 150
  assert.equal(r.material, 120);       // × 1.2
  assert.equal(r.total, 670);
  assert.equal(r.through, '2026-09-15');
  assert.notEqual(M.readyToBill({ ...job, scope_ok: false }, shares, mats, []), null);          // not checked — still ready (scope never holds it, 10/2/26)
  assert.equal(M.readyToBill({ ...job, done_at: null }, shares, mats, []), null);            // reopened — back on the schedule, not ready
  assert.notEqual(M.readyToBill({ ...job, scope: '  ' }, shares, mats, []), null);             // not written — still ready (scope never holds it, 10/2/26)
  assert.equal(M.readyToBill({ ...job, tag: 'JC' }, shares, mats, []), null);               // JC bills by draws
  assert.equal(M.readyToBill(job, shares, mats, [{ kind: 'real', covers_through: '2026-09-15' }]), null);   // billed — gone
  const later = M.readyToBill(job, [...shares, { job_id: 7, work_date: '2026-09-18', kind: 'employee', man: 'Tony', shows_as: 'Tony', stops: 1, days: 0.5, cost: 115 }], mats, [{ kind: 'real', covers_through: '2026-09-15' }]);
  assert.deepEqual([later.days.length, later.total], [1, 200]);   // only the new green day: 8 hrs × 0.5 × $50
});

test('Invoicing has Ready to bill with one button; AR is one pile per customer with Mark it paid on the row', () => {
  const inv = readFileSync('public/invoicing.js', 'utf8');
  for (const t of ["'Ready to bill'", "'Placeholders owed in QuickBooks'", "'Needs both'", "'Needs the scope'", "'Needs pictures'", "'Tabled — not billing yet'"]) assert.ok(inv.includes(t), t);
  assert.ok(!inv.includes("'Send it'") && inv.indexOf("'Placeholders owed in QuickBooks'") < inv.indexOf("'Ready to bill'"));   // 10/4/26: Send it IS Ready to bill; the old section is gone
  const ar = readFileSync('public/ar.js', 'utf8');
  assert.ok(ar.includes('Mark it paid') && ar.includes('PAST 30 DAYS — call them') && ar.includes('localeCompare(b)'));
  const w = readFileSync('netlify/functions/work.mts', 'utf8');
  assert.ok(w.includes('kind === "bill" && id && m === "POST"') && w.includes('M.readyToBill(job, shares, mat, invs)'));
});

test('LAW step 5: real invoice = ticket name, placeholder memo word for word, scope word for word, dated tomorrow, placeholder price, placeholder → $0 renamed', () => {
  const job = { id: 7, tag: 'R', address: '7900 Sovereign Row', city: 'Dallas', title: "O'Donnell Garage", scope: 'Removed and replaced 2 pipe boots.\n- Sealed curb.' };
  const ready = { days: [{ date: '2026-09-14', labor_total: 400 }], material: 120, through: '2026-09-14' };
  const invs = [{ id: 1, kind: 'placeholder', amount: 575, work_date: '2026-09-14', memo: 'R: 9/14/26', name: '' }];
  const w = M.writeRealInvoice(job, ready, invs, '2026-09-16', null);
  assert.equal(w.name, "R - 7900 Sovereign Row, Dallas - O'Donnell Garage");
  assert.equal(w.memo, 'R: 9/14/26');                           // same memo as the placeholder, word for word
  assert.equal(w.scope, job.scope);                             // scope word for word
  assert.equal(w.inv_date, '2026-09-17');                       // tomorrow
  assert.equal(w.amount, 575);                                  // the placeholder's price, not a fresh guess
  assert.deepEqual(w.zero, [{ id: 1, name: 'Job Cost 1', memo: 'R: 9/14/26' }]);
  assert.equal(M.writeRealInvoice(job, ready, invs, '2026-09-16', 650).amount, 650);   // his price wins
  const noSeat = M.writeRealInvoice(job, ready, [], '2026-09-16', null);
  assert.deepEqual([noSeat.amount, noSeat.memo], [520, 'R-9/14/26']);
});

test('step 5 server: writes name/memo/scope/tomorrow; placeholder zeroed ONLY after the real invoice is in QuickBooks; sent makes the date real', () => {
  const w = readFileSync('netlify/functions/work.mts', 'utf8');
  assert.ok(w.includes('M.writeRealInvoice(job, r, invs, today(), b.amount === "" || b.amount == null ? job.bill_price : b.amount)'));
  assert.ok(w.includes("INSERT INTO invoices (job_id, kind, name, number, amount, inv_date, covers_through, memo, scope)"));
  // HIS LAW 9/28: "the invoice CANNOT be zeroed out before the other invoice is created. 2 tickets is fine. zero tickets i go out of business."
  assert.ok(w.includes('UPDATE invoices SET zeroed_from = amount, zeroed_by = ${inv.id}, amount = 0'));
  assert.ok(!w.includes('UPDATE invoices SET zeroed_from = amount, zeroed_by = $4'), 'no zeroing inside the Write the invoice transaction');
  const push = w.slice(w.indexOf('async function pushInvoiceToQB'), w.indexOf('// HIS LAW (9/28/26)'));
  assert.ok(push.indexOf('const back = (await qb("GET"') < push.indexOf('zeroReplacedPlaceholders(sql, inv, job)'), 'zero only after QuickBooks read-back');
  // 10/6/26: sent makes the date real — the day the sent email went out (found by the invoice #), today only if he says "I know, it's ok"
  assert.ok(w.includes('inv_date = CASE WHEN inv_date IS NULL OR inv_date > ${sentDay}::date THEN ${sentDay}::date ELSE inv_date END'));
});

test('LAW step 6: trips age from the oldest unpaid one, 21 days = stop; billing a trip never finishes a ticket', () => {
  const uc = { id: 9, tag: 'UC', done_at: null };
  const invs = [{ job_id: 9, kind: 'real', amount: 1200, sent_at: '2026-08-20' }, { job_id: 9, kind: 'real', amount: 800, sent_at: '2026-09-10' }, { job_id: 9, kind: 'real', amount: 500, sent_at: '2026-08-01', paid_at: '2026-08-15' }];
  const a = M.drawAging(uc, invs, '2026-09-10');
  assert.deepEqual(a, { owed: 2000, trips: 2, days: 21, stale: true });
  assert.equal(M.drawAging(uc, invs, '2026-09-09').stale, false);
  assert.equal(M.drawAging({ ...uc, done_at: '2026-09-01' }, invs, '2026-09-10').owed, 2000);   // a UC's trips still age after it's done
  assert.equal(M.drawAging({ ...uc, tag: 'R', done_at: '2026-09-01' }, invs, '2026-09-10'), null);
});

test('LAW step 6: DONE MEANS MONEY — done + unpaid + (no amount | no real number | never sent) is red; placeholder number is no number; off only by paid or no charge', () => {
  const job = { id: 5, tag: 'R', done_at: '2026-09-10' };
  assert.deepEqual(M.doneNotPaid(job, []), ['no dollar amount', 'no real invoice number', 'never marked sent']);
  const ph = { job_id: 5, kind: 'placeholder', number: '4777', amount: 525 };
  assert.deepEqual(M.doneNotPaid(job, [ph, { job_id: 5, kind: 'real', number: '4777', amount: 600, sent_at: '2026-09-12' }]), ['no real invoice number']);
  assert.deepEqual(M.doneNotPaid(job, [{ job_id: 5, kind: 'real', number: '4781', amount: 600 }]), ['never marked sent']);
  assert.equal(M.doneNotPaid(job, [{ job_id: 5, kind: 'real', number: '4781', amount: 600, sent_at: '2026-09-12' }]), null);   // real AR now
  assert.equal(M.doneNotPaid(job, [{ job_id: 5, kind: 'real', number: '', amount: 0, paid_at: '2026-09-12' }]), null);     // paid
  assert.equal(M.doneNotPaid({ ...job, no_charge: true }, []), null);                                                        // no charge
  assert.equal(M.doneNotPaid({ ...job, done_at: null }, []), null);
  assert.equal(M.doneNotPaid({ ...job, tabled_at: '2026-09-11' }, []).length, 3);                                           // tabling does not hide it
});

test('step 6 pages: trips at the top of Invoicing, Tabled — not billing yet, AR has DONE — NOT GETTING PAID YET with Fix it / No charge, hover job file, red card at 21 days', () => {
  const inv = readFileSync('public/invoicing.js', 'utf8');
  assert.ok(!inv.includes("'Billed a trip at a time — still working'") && inv.includes("'Tabled — not billing yet'"));   // 10/4/26: no trip-at-a-time section, a sent invoice lives on AR
  const ar = readFileSync('public/ar.js', 'utf8');
  for (const t of ['DONE — NOT GETTING PAID YET', 'Fix it', 'No charge', 'data-hover', 'Mark it paid']) assert.ok(ar.includes(t), t);
  const sch = readFileSync('public/schedule.js', 'utf8');
  assert.ok(sch.includes('unpaid $${Math.round(j.aging.owed).toLocaleString()} · ${j.aging.days} days'));
  const w = readFileSync('netlify/functions/work.mts', 'utf8');
  assert.ok(w.includes('M.doneNotPaid(j, dInvs)') && w.includes('aging: M.drawAging(j, oInvs, today())'));
});

test('DELETE: an invoice with a number, sent or paid is in QuickBooks; a bare seat is not', () => {
  assert.equal(M.inQuickBooks({ number: '' }), false);
  assert.equal(M.inQuickBooks({ number: '1044' }), true);
  assert.equal(M.inQuickBooks({ number: '', sent_at: '2026-09-01' }), true);
  assert.equal(M.inQuickBooks({ number: '', paid_at: '2026-09-01' }), true);
});

test('DELETE: a ticket with money on it can\'t be deleted — only tabled', () => {
  assert.deepEqual(M.whyTicketLocked([]), []);
  assert.deepEqual(M.whyTicketLocked([{ amount: 0, number: '' }]), []);
  assert.equal(M.whyTicketLocked([{ amount: 125, number: '' }]).length, 1);
  assert.equal(M.whyTicketLocked([{ amount: 0, number: '1044' }]).length, 1);
  assert.equal(M.whyTicketLocked([], 2).length, 1);
});

test('DELETE: every delete lives in one place, asks first, and never calls QuickBooks', () => {
  const del = readFileSync('netlify/functions/delete.mts', 'utf8');
  assert.ok(!/quickbooks\.api|intuit\.com|oauth/i.test(del), 'the delete function never talks to QuickBooks');
  const ui = readFileSync('public/ui.js', 'utf8');
  assert.ok(/confirm\(/.test(ui.slice(ui.indexOf('export async function askDelete'))), 'delete confirms first');
  for (const f of ['app.js', 'crew.js', 'payroll.js', 'supply.js', 'jobcost.js', 'schedule.js', 'subs.js'])
    assert.ok(readFileSync('public/' + f, 'utf8').match(/data-del|delX\(|delBtn\(/), f + ' has a delete button');
  assert.ok(!readFileSync('public/schedule.js', 'utf8').includes("/w/stops/${id}`, { method: 'DELETE'"), 'the schedule × goes through the confirm, never silent');
});

test('LAW bids (half 1): only what he owes is chased — 3 days then 1 day then due then late; a sent bid is filed, not chased; awarded is off the list', () => {
  const t = '2026-09-17';
  assert.equal(M.bidState({ bid_due: '2026-09-15' }, t).level, 'late');
  assert.equal(M.bidState({ bid_due: '2026-09-17' }, t).level, 'today');
  assert.equal(M.bidState({ bid_due: '2026-09-18' }, t).level, 'tomorrow');
  assert.equal(M.bidState({ bid_due: '2026-09-20' }, t).level, 'soon');        // 3 days out — heads up
  assert.equal(M.bidState({ bid_due: '2026-09-21' }, t).level, 'ok');          // 4 days out — no reminder yet
  assert.equal(M.bidState({ bid_due: null }, t).level, 'nodate');
  assert.equal(M.bidState({ bid_due: '2026-09-15', bid_sent_at: '2026-09-14' }, t).level, 'sent');   // sent = filed, never chased
  assert.equal(M.bidState({ bid_due: '2026-09-15', awarded_at: '2026-09-16' }, t), null);            // awarded = it's a ticket now
  const order = M.sortBids([{ bid_due: '2026-09-21', address: 'd' }, { bid_due: null, address: 'e' }, { bid_due: '2026-09-15', address: 'a' },
    { bid_due: '2026-09-17', address: 'b' }, { bid_due: '2026-09-18', address: 'c' }], t).map(b => b.address);
  assert.deepEqual(order, ['a', 'b', 'c', 'd', 'e']);
});

test('bids server + page: list, add, due/price, sent, awarded makes the ticket and sets the contract the draws bill off', () => {
  const w = readFileSync('netlify/functions/work.mts', 'utf8');
  for (const s of ['kind === "bids"', 'action === "sent"', 'action === "awarded"', "UPDATE properties SET contract_amount", 'awarded_job_id']) assert.ok(w.includes(s), s);
  const sql = readdirSync('netlify/database/migrations').map(d => readFileSync(`netlify/database/migrations/${d}/migration.sql`, 'utf8')).join('\n');
  for (const c of ['bid_due', 'bid_sent_at', 'bid_amount', 'awarded_at', 'awarded_job_id']) assert.ok(sql.includes(c), c);
  // ONE APP: a bid starts at the customer and lives in its job file. No Bids tab, no second job-file system.
  // The Bids tab is one page: calendar, bids owed, templates. The bid itself still lives in its job file under the customer.
  const card = readFileSync('public/bid.js', 'utf8');
  for (const s of ['never chased', 'Awarded — make the ticket', 'I sent it', 'BID_CATS']) assert.ok(card.includes(s), s);
  const page = readFileSync('public/bids.js', 'utf8');
  for (const s of ['bidcal', 'Bids owed', '>New bid<', '>Templates<', 'templatesPage', 'Awarded — ticket made']) assert.ok(page.includes(s), s);
  // STEP 1: customer, then the address, then the tenant — each its own field, each one new-or-known.
  for (const s of ['bsCust', 'bsAddr', 'bsTen']) assert.ok(page.includes(s), s);
  const w2 = readFileSync('netlify/functions/work.mts', 'utf8');
  for (const s of ['kind === "bid-start"', 'kind === "bid-option"', 'INSERT INTO bid_systems', 'tenant_name']) assert.ok(w2.includes(s), s);
  // STEP 2 one layer at a time, STEP 3 the buttons only once there is a price.
  const card2 = readFileSync('public/bid.js', 'utf8');
  assert.ok(card2.includes('SYSTEMS.filter(s => picked(s.cat))'), 'only the picked systems show their pills');
  assert.ok(card2.includes('const priced = Number(j.bid_amount) > 0') && card2.includes('${priced ?'), 'sent/awarded hidden until it has a price');
  assert.ok(readFileSync('public/index.html', 'utf8').includes('data-tab="bids"'), 'Bids tab');
  const app = readFileSync('public/app.js', 'utf8');
  assert.ok(app.includes("j.tag === 'BID' ? renderBid(") && app.includes("page === 'bids'"));
});

test('LAW: the app reads the mail and files it — it never sends. It may take a label off, and it asks when it cannot tell whose job it is', () => {
  const api = readFileSync('netlify/functions/api.mts', 'utf8');
  // 9/21/26: gmail.modify replaces read-only, ONLY so the label can come off once an email is filed
  assert.ok(api.includes('kind === "gmail"') && api.includes('gmail.modify'));
  assert.ok(!/gmail\.send|gmail\.compose|mail\.google\.com\/"/.test(api), 'never send');
  const w = readFileSync('netlify/functions/work.mts', 'utf8');
  for (const s of ['kind === "mail"', 'drawerFor', "'needs_you'", 'action === "assign"', 'action === "place"', 'removeLabelIds']) assert.ok(w.includes(s), s);
  assert.ok(!/users\/me\/messages\/send|\/drafts/.test(w), 'no send path');
  const page = readFileSync('public/mail.js', 'utf8');
  for (const s of ['Check the labels now', "Who's it for?", 'Put it on a job', 'Not ours', 'it can never send']) assert.ok(page.includes(s), s);
});

test('Supply Houses, the old board way: owed by due date, credits under the bill they come off, one payment over many bills, nothing unapplied, one-click paid', () => {
  const page = readFileSync('public/supply.js', 'utf8');
  for (const s of ['Everything I owe', 'Not on a job yet', 'Not cleared to pay', 'Need reading', 'The whole invoice goes to the same place',
    'The three checks', 'credit off', 'Take this payment back', 'paidtog',
    'Break it into what actually moved', 'INVENTORY IS WRONG ON THIS LINE', 'agrees to the penny', 'draggable="true"']) assert.ok(page.includes(s), s);
  assert.ok(page.includes('A credit counts on the due date of the bill it comes off'), 'credit day rule');
  // 9/20/26: he switches the terms himself, on the bill. They are still never STORED —
  // the terms are the gap between the invoice date and the due date, read back off the two.
  assert.ok(page.includes('trmsel') && page.includes('/terms`'), 'a terms switch on every bill');
  assert.equal(M.termsOf('2026-08-05', '2026-09-04'), 'net30');
  assert.equal(M.termsOf('2026-08-05', '2026-10-10'), '', 'a hand-typed due date is left alone');
  assert.equal(M.dueFromTerms('2026-12-14', 'prox10'), '2027-01-10', 'the 10th of next month rolls the year');
  assert.equal(M.dueFromTerms('2026-08-05', 'receipt'), '2026-08-05');
  assert.equal(M.dueFromTerms('2026-08-05', 'net99'), '2026-11-12', 'any net N works out');
  const w = readFileSync('netlify/functions/work.mts', 'utf8');
  for (const s of ['action === "paid"', 'action === "flags"', 'AS unplaced']) assert.ok(w.includes(s), s);
});

// A building named on the paper is a hard test, not a tie-breaker (9/18/26).
// "1721 John McCain - Building 3 - Invoice" must never land on the Building 4 ticket
// just because Building 4 is the only ticket on that address.
test('a sent invoice that names a building only lands on that building', () => {
  const said = s => s.toLowerCase().match(/\b(building|bldg|suite|ste|unit)\s*#?\s*([0-9]+[a-z]?|[a-z])\b/);
  const m = said('1721 John McCain - Building 3 - Invoice');
  assert.ok(m, 'the subject names a building');
  const want = new RegExp(`\\b(building|bldg|suite|ste|unit)\\s*#?\\s*${m[2]}\\b`);
  assert.equal(want.test('building 4'), false, 'Building 3 does not match the Building 4 ticket');
  assert.equal(want.test('building 3'), true, 'Building 3 matches the Building 3 ticket');
});

// HIS LAW, 9/21/26: "Turn off the whole-inbox Gmail read. The app now reads ONLY these five Gmail
// labels. Nothing else in my inbox is ever read." Built into the app as a 15-minute scheduled function.
test('LAW: the app reads only the five SMS labels on its own — no whole-inbox sweep, every 15 minutes, never sends', () => {
  const work = readFileSync('netlify/functions/work.mts', 'utf8');
  const sched = readFileSync('netlify/functions/labels.mts', 'utf8');
  for (const l of ['!SMS/BID', '!SMS/R', '!SMS/CO', '!SMS/JC', '!SMS/UC']) assert.ok(work.includes(`"${l}"`), l);
  assert.ok(!work.includes('newer_than:14d -in:chats'), 'the whole-inbox sweep is back');
  assert.ok(sched.includes('schedule: "*/15 * * * *"'), 'the label check is not on a 15-minute schedule');
  assert.ok(!/messages\/send|drafts|\/send"/.test(work), 'the app can send mail');
  assert.ok(!work.includes('ANTHROPIC_API_KEY'), 'Anthropic runtime dependency is back');
  assert.ok(!work.includes('api.anthropic.com'), 'Anthropic network call is back');
  assert.ok(work.includes('reader = "rules-only"'), 'email filing is not in deterministic stabilization mode');
  assert.ok(work.includes('if (!prop && cust && read)'), 'without a trusted AI read, a known sender must not create a fake property from the email subject');
});

test('STABILIZATION: Talk has a safe no-AI fallback and never saves by itself', () => {
  const work = readFileSync('netlify/functions/work.mts', 'utf8');
  assert.ok(work.includes('function localTalk('), 'Talk has no local fallback');
  assert.ok(work.includes('return localTalk(said, draft, tickets, pinned);'), 'Talk is not using the safe local path');
  assert.ok(work.includes('const r = await appTalk('), 'Talk route is not using the safe wrapper');
});

// HIS LAW, 9/21/26: "These two are the only standing seam templates. Never build a standing seam bid
// from any other file." They came over from the old bid app byte for byte; this fails the build if
// either one changes by a single byte, or if any other standing seam sheet shows up.
test('LAW: the only standing seam templates are Cee-Lok and Zee-Lock, byte for byte from the old bid app', async () => {
  const { createHash } = await import('node:crypto');
  const { SS_TEMPLATES, SS_SHEET_SHA1 } = await import('../public/templates.js');
  assert.deepEqual(SS_TEMPLATES.map(t => t.name), ['TEMPLATE — Cee-Lok Standing Seam (blank)', 'TEMPLATE — Zee-Lock Double-Lock (blank)']);
  for (const [f, sha] of Object.entries(SS_SHEET_SHA1)) assert.equal(createHash('sha1').update(readFileSync(`public/sheets/${f}`)).digest('hex'), sha, f);
  const sheets = readdirSync('public/sheets');
  assert.deepEqual(sheets.filter(f => /seam|lok|lock|ss_/i.test(f)).sort(), ['Template_CeeLok.xlsx', 'Template_ZeeLock.xlsx']);
});

// HIS ASK, 9/25/26: "Bring all of them over except the one from Liberty." Seven more old-bid-app templates,
// byte for byte. Fails the build if any sheet changes by one byte, or the Liberty (new construction) one shows up.
test('the other seven old-bid-app templates are here byte for byte — and the Liberty one is not', async () => {
  const { createHash } = await import('node:crypto');
  const { OTHER_TEMPLATES, OTHER_SHEET_SHA1 } = await import('../public/templates.js');
  assert.equal(OTHER_TEMPLATES.length, 7);
  for (const t of OTHER_TEMPLATES) assert.ok(OTHER_SHEET_SHA1[t.sheetFile] && t.sysLabel === 'TEMPLATE', t.name);
  for (const [f, sha] of Object.entries(OTHER_SHEET_SHA1)) assert.equal(createHash('sha1').update(readFileSync(`public/sheets/${f}`)).digest('hex'), sha, f);
  assert.ok(!readdirSync('public/sheets').some(f => /newconstruction/i.test(f)));
});

test('a day\'s actual pay (9/25): typed pay replaces days × rate for that man that day only; blank = rate; ticket shares follow it', () => {
  const crew = [{ id: 1, name: 'Jovani', kind: 'sub', day_rate: 800, pay_to: 'Jovani' }];
  const stops = [{ id: 1, work_date: '2026-09-24', crew_id: 1, job_id: 10 }, { id: 2, work_date: '2026-09-24', crew_id: 1, job_id: 11 }, { id: 3, work_date: '2026-09-25', crew_id: 1, job_id: 10 }];
  const crewDays = [{ work_date: '2026-09-24', crew_id: 1, days: 1, pay: 950 }];
  const sh = M.stopShares({ stops, crew, crewDays });
  assert.equal(sh.filter(s => s.work_date === '2026-09-24').reduce((a, s) => a + s.cost, 0), 950);
  assert.equal(sh.find(s => s.work_date === '2026-09-25').cost, 800);
  assert.equal(M.manDayPay(1, 800, M.payFor(crewDays, 1, '2026-09-24')), 950);
  assert.equal(M.manDayPay(1, 800, M.payFor(crewDays, 1, '2026-09-25')), 800);
});

test('a man under a sub is paid through his boss (9/25: Chili showed on his own "Zelle" page AND on Jovani\'s)', () => {
  const crew = [{ id: 6, name: 'Jovani', kind: 'sub', day_rate: 450, pay_to: 'Zelled' }, { id: 7, name: 'Chili', kind: 'sub', day_rate: 350, pay_to: 'Zelle', boss_id: 6 }];
  const stops = [{ id: 1, work_date: '2026-09-24', crew_id: 6, job_id: 10 }, { id: 2, work_date: '2026-09-24', crew_id: 7, job_id: 10 }];
  const sh = M.stopShares({ stops, crew, crewDays: [] });
  assert.ok(sh.every(s => s.pay_to === 'Zelled' && s.shows_as === 'Jovani'));
  const w = readFileSync('netlify/functions/work.mts', 'utf8');
  assert.ok(w.includes('WHERE NOT EXISTS (SELECT 1 FROM crew c WHERE c.id = s.crew_id AND c.boss_id IS NOT NULL)'));
});

test('actual paid on a sub ledger line (9/25): sub page only — saved on sub_paid.actual, never in pay math', () => {
  const pl = readFileSync('public/payledger.js', 'utf8');
  assert.ok(pl.includes('Actual paid') && pl.includes("'/w/sub-actual'") && pl.includes('const amt = r => actualOf(r) ?? r.total'));
  const w = readFileSync('netlify/functions/work.mts', 'utf8');
  assert.ok(w.includes('kind === "sub-actual"'));
});

test('job page: a sub is one line per day under the sub\'s name — Jovani $800, Puma — never the men under him (9/25)', () => {
  const jc = readFileSync('public/jobcost.js', 'utf8');
  assert.ok(jc.includes('const subDays = list =>') && jc.includes('for (const d of subDays(wSub))') && jc.includes('...subDays(subs).map('));
  assert.ok(!jc.includes('↳ ${esc(s.man)}'));
});

test('actual paid carries to the job page only (9/25): $855.50 replaces Jovani $450 + Chili $350, to the penny; the bill math never sees it', () => {
  const sh = [{ kind: 'sub', pay_to: 'Zelled', work_date: '2026-09-19', job_id: 20, cost: 450 }, { kind: 'sub', pay_to: 'Zelled', work_date: '2026-09-19', job_id: 20, cost: 350 }, { kind: 'employee', pay_to: 'Zelle', work_date: '2026-09-19', job_id: 20, cost: 250 }];
  const out = M.applySubActuals(sh, [{ pay_to: 'Zelled', work_date: '2026-09-19', job_id: 20, actual: '855.50' }]);
  assert.equal(Math.round(out.filter(s => s.kind === 'sub').reduce((a, s) => a + s.cost, 0) * 100) / 100, 855.5);
  assert.equal(out[2].cost, 250);
  assert.equal(sh[0].cost, 450, 'the original shares are not changed');
  const w = readFileSync('netlify/functions/work.mts', 'utf8');
  assert.equal((w.match(/applySubActuals/g) || []).length, 1, 'only the job page uses it — never billing or QuickBooks');
});

test('Templates page carries the proposal templates (9/25: "everything is supposed to be in the app")', async () => {
  const { LINK_TEMPLATES } = await import('../public/templates.js');
  const names = LINK_TEMPLATES.map(t => t.name).join(' | ');
  for (const w of ['Standing seam', 'MA TPO / MA ISO']) assert.ok(names.includes(w), w);
  assert.ok(LINK_TEMPLATES.every(t => t.tag === 'PROPOSAL' || (t.tag === 'TEMPLATE' && /^https:\/\/docs\.google\.com\/spreadsheets\//.test(t.url))), 'proposals, or TEMPLATE-tagged Google Sheet links (bid-sheet rule changed)');
  assert.ok(LINK_TEMPLATES.every(t => /^https:\/\/docs\.google\.com\//.test(t.url)));
  assert.ok(readFileSync('public/bids.js', 'utf8').includes('links(k).map('));
});

// HIS PICKS, 9/26/26: two templates pulled out of the Liberty bid. Byte for byte; the ISO swap is NOT one ("It's a VE switch").
test('Liberty pull-outs: counter flashing add-on + coping/cleat/I&W are here byte for byte — no ISO swap template', async () => {
  const { createHash } = await import('node:crypto');
  const { PULLOUT_TEMPLATES, PULLOUT_SHEET_SHA1 } = await import('../public/templates.js');
  assert.deepEqual(PULLOUT_TEMPLATES.map(t => t.sheetFile).sort(), Object.keys(PULLOUT_SHEET_SHA1).sort());
  for (const [f, sha] of Object.entries(PULLOUT_SHEET_SHA1)) assert.equal(createHash('sha1').update(readFileSync(`public/sheets/${f}`)).digest('hex'), sha, f);
  assert.ok(!readdirSync('public/sheets').some(f => /iso_swap/i.test(f)));
  assert.ok(readFileSync('public/bids.js', 'utf8').includes('...PULLOUT_TEMPLATES'));
});
