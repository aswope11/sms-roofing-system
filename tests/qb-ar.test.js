import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { qbArReportLink } from '../public/qbar.js';
import {
  serveArAging, fetchArReports, buildArReport, renderArCsv, renderArPdf,
  chicagoDate, parseAsOf, arReportTitle, arReportFilename, arContentDisposition,
  classifyQbReportFailure,
} from '../lib/qb-ar.js';

const TOKEN = { access_token: 'SECRET-TOKEN-XYZ', realm_id: '1234567890', refresh_token: 'SECRET-REFRESH' };

// Realistic AgedReceivables + AgedReceivableDetail, the shape QuickBooks actually returns:
// a parent with two buildings, flat customers across buckets, a grand total, and detail
// grouped by aging bucket (not by customer) with amount and open balance both present.
const SUMMARY = {
  Header: {
    Time: '2026-10-10T08:15:00-05:00',
    ReportName: 'AgedReceivables',
    ReportBasis: 'Accrual',
    StartPeriod: '2026-10-10',
    EndPeriod: '2026-10-10',
    Currency: 'USD',
    Option: [{ Name: 'report_date', Value: '2026-10-10' }, { Name: 'NoReportData', Value: 'false' }],
  },
  Columns: {
    Column: [
      { ColTitle: '', ColType: 'Customer' },
      { ColTitle: 'Current', ColType: 'Money', MetaData: [{ Name: 'ColKey', Value: 'current' }] },
      { ColTitle: '1 - 30', ColType: 'Money', MetaData: [{ Name: 'ColKey', Value: '1' }] },
      { ColTitle: '31 - 60', ColType: 'Money', MetaData: [{ Name: 'ColKey', Value: '2' }] },
      { ColTitle: '61 - 90', ColType: 'Money', MetaData: [{ Name: 'ColKey', Value: '3' }] },
      { ColTitle: '91 and over', ColType: 'Money', MetaData: [{ Name: 'ColKey', Value: '4' }] },
      { ColTitle: 'Total', ColType: 'Money', MetaData: [{ Name: 'ColKey', Value: 'total' }] },
    ],
  },
  Rows: {
    Row: [
      {
        type: 'Section',
        Header: { ColData: [
          { value: 'Four Corners Property Company', id: '100' },
          { value: '' }, { value: '' }, { value: '' }, { value: '' }, { value: '' }, { value: '' },
        ] },
        Rows: { Row: [
          { type: 'Data', ColData: [
            { value: '1480 N. Custer Rd, Allen', id: '101' },
            { value: '1200.00' }, { value: '' }, { value: '' }, { value: '' }, { value: '' }, { value: '1200.00' },
          ] },
          { type: 'Data', ColData: [
            { value: '2200 Greenville Ave, Dallas', id: '102' },
            { value: '' }, { value: '450.50' }, { value: '' }, { value: '' }, { value: '' }, { value: '450.50' },
          ] },
        ] },
        Summary: { ColData: [
          { value: 'Total for Four Corners Property Company' },
          { value: '1200.00' }, { value: '450.50' }, { value: '' }, { value: '' }, { value: '' }, { value: '1650.50' },
        ] },
      },
      { type: 'Data', ColData: [
        { value: 'Wortham Bros., Inc.', id: '210' },
        { value: '' }, { value: '' }, { value: '3200.00' }, { value: '0.00' }, { value: '810.75' }, { value: '4010.75' },
      ] },
      { type: 'Data', ColData: [
        { value: "Cook Children's Pediatrics", id: '330' },
        { value: '500.00' }, { value: '' }, { value: '' }, { value: '975.25' }, { value: '' }, { value: '1475.25' },
      ] },
      {
        type: 'Section', group: 'GrandTotal',
        Summary: { ColData: [
          { value: 'TOTAL' },
          { value: '1700.00' }, { value: '450.50' }, { value: '3200.00' }, { value: '975.25' }, { value: '810.75' }, { value: '7136.50' },
        ] },
      },
    ],
  },
};

function detailRow(date, txnType, num, customer, due, pastDue, amount, open, txnId) {
  return {
    type: 'Data',
    ColData: [
      { value: date, id: txnId },
      { value: txnType, id: txnId },
      { value: num },
      { value: customer, id: 'cust' },
      { value: due },
      { value: pastDue },
      { value: amount },
      { value: open },
    ],
  };
}

function bucket(label, rows, openTotal) {
  const empty = [{ value: '' }, { value: '' }, { value: '' }, { value: '' }, { value: '' }, { value: '' }, { value: '' }];
  return {
    type: 'Section',
    Header: { ColData: [{ value: label }, ...empty] },
    Rows: { Row: rows },
    Summary: { ColData: [{ value: `Total for ${label}` }, ...empty.slice(0, 6), { value: openTotal }] },
  };
}

const DETAIL = {
  Header: {
    ReportName: 'AgedReceivableDetail',
    EndPeriod: '2026-10-10',
    Currency: 'USD',
    Option: [{ Name: 'report_date', Value: '2026-10-10' }, { Name: 'NoReportData', Value: 'false' }],
    Time: '2026-10-10T08:15:02-05:00',
  },
  Columns: {
    Column: [
      { ColTitle: 'Date', ColType: 'tx_date' },
      { ColTitle: 'Transaction Type', ColType: 'txn_type' },
      { ColTitle: 'Num', ColType: 'doc_num' },
      { ColTitle: 'Customer', ColType: 'cust_name' },
      { ColTitle: 'Due Date', ColType: 'due_date' },
      { ColTitle: 'Past Due', ColType: 'past_due' },
      { ColTitle: 'Amount', ColType: 'subt_amount' },
      { ColTitle: 'Open Balance', ColType: 'subt_open_bal' },
    ],
  },
  Rows: {
    Row: [
      bucket('91 and over', [
        detailRow('2026-05-01', 'Invoice', '4402', 'Wortham Bros., Inc.', '2026-05-31', '132', '810.75', '810.75', '9001'),
      ], '810.75'),
      bucket('61 - 90 days past due', [
        detailRow('2026-07-10', 'Invoice', '4666', "Cook Children's Pediatrics", '2026-07-25', '77', '1100.00', '975.25', '9002'),
      ], '975.25'),
      bucket('31 - 60 days past due', [
        detailRow('2026-08-05', 'Invoice', '4701', 'Wortham Bros., Inc.', '2026-08-20', '51', '3500.00', '3200.00', '9003'),
      ], '3200.00'),
      bucket('1 - 30 days past due', [
        detailRow('2026-09-01', 'Invoice', '4760', '2200 Greenville Ave, Dallas', '2026-09-20', '20', '450.50', '450.50', '9004'),
      ], '450.50'),
      bucket('Current', [
        detailRow('2026-10-01', 'Invoice', '4812', '1480 N. Custer Rd, Allen', '2026-10-31', '0', '1200.00', '1200.00', '9005'),
        detailRow('2026-09-28', 'Invoice', '4900', "Cook Children's Pediatrics", '2026-10-28', '0', '500.00', '500.00', '9006'),
      ], '1700.00'),
      {
        type: 'Section', group: 'GrandTotal',
        Summary: { ColData: [
          { value: 'TOTAL' }, { value: '' }, { value: '' }, { value: '' }, { value: '' }, { value: '' }, { value: '' }, { value: '7136.50' },
        ] },
      },
    ],
  },
};

function mockReports(summary = SUMMARY, detail = DETAIL, opts = {}) {
  const calls = [];
  const fetchImpl = async (url, req) => {
    calls.push({ url, opts: req });
    const u = new URL(url);
    if (opts.fail && u.pathname.includes(opts.fail)) {
      return new Response(opts.body || 'nope', { status: opts.status || 500, headers: { 'content-type': 'application/json' } });
    }
    if (u.pathname.endsWith('/AgedReceivableDetail') && u.searchParams.has('columns') && opts.detailColumnsRejected) {
      return new Response(JSON.stringify({ Fault: { Error: [{ Message: 'Invalid column', code: '4000' }] } }), { status: 400 });
    }
    const body = u.pathname.endsWith('/AgedReceivables') ? summary : detail;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl, calls };
}

function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function pdfText(buf) {
  const b = Buffer.from(buf);
  const parts = [];
  let i = 0;
  while (i < b.length) {
    const s = b.indexOf('stream', i);
    if (s < 0) break;
    const dictStart = b.lastIndexOf('<<', s);
    const dict = b.slice(Math.max(0, dictStart), s).toString('latin1');
    let start = s + 6;
    if (b[start] === 0x0d) start++;
    if (b[start] === 0x0a) start++;
    const end = b.indexOf('endstream', start);
    if (end < 0) break;
    let data = b.slice(start, end);
    if (data.length && data[data.length - 1] === 0x0a) data = data.subarray(0, data.length - 1);
    if (data.length && data[data.length - 1] === 0x0d) data = data.subarray(0, data.length - 1);
    let text = '';
    if (/FlateDecode/.test(dict)) {
      try { text = zlib.inflateSync(data).toString('latin1'); } catch { text = ''; }
    } else text = data.toString('latin1');
    parts.push(text);
    i = end + 9;
  }
  const raw = parts.join('\n');
  const out = [];
  for (const m of raw.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
    let s = '';
    const hex = m[1];
    for (let k = 0; k + 1 < hex.length; k += 2) s += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16));
    out.push(s);
  }
  return out.join('\n');
}

test('the report date is today in America/Chicago, and as_of must be a real YYYY-MM-DD', () => {
  assert.equal(chicagoDate(new Date('2026-10-10T03:30:00Z')), '2026-10-09');
  assert.equal(chicagoDate(new Date('2026-10-10T05:30:00Z')), '2026-10-10');
  assert.equal(chicagoDate(new Date('2026-01-15T05:30:00Z')), '2026-01-14');
  assert.equal(chicagoDate(new Date('2026-01-15T06:30:00Z')), '2026-01-15');
  assert.equal(parseAsOf(null, new Date('2026-10-10T05:30:00Z')).date, '2026-10-10');
  assert.equal(parseAsOf('  ', new Date('2026-10-10T05:30:00Z')).date, '2026-10-10');
  assert.equal(parseAsOf('2026-06-01').date, '2026-06-01');
  for (const bad of ['10/10/2026', '2026-1-1', '2026-02-31', 'yesterday', '2026-13-01']) {
    assert.equal(parseAsOf(bad).ok, false, bad);
  }
  assert.equal(arReportTitle('2026-10-10'), 'SMS Roofing & Waterproofing - A/R Aging - 2026-10-10');
  assert.equal(arReportFilename('2026-10-10', 'pdf'), 'AR Aging 2026-10-10.pdf');
  assert.match(arContentDisposition('2026-10-10', 'pdf'), /^inline; filename="AR Aging 2026-10-10\.pdf"/);
});

test('summary and detail use QuickBooks figures as returned, including nested customers', () => {
  const report = buildArReport(SUMMARY, DETAIL, '2026-10-10');
  assert.equal(report.title, 'SMS Roofing & Waterproofing - A/R Aging - 2026-10-10');
  const names = report.summary.map(r => r.customer);
  assert.deepEqual(names, [
    'Four Corners Property Company',
    '1480 N. Custer Rd, Allen',
    '2200 Greenville Ave, Dallas',
    'Total for Four Corners Property Company',
    'Wortham Bros., Inc.',
    "Cook Children's Pediatrics",
  ]);
  const parent = report.summary[0];
  assert.equal(parent.kind, 'label');
  assert.equal(parent.total, '');
  assert.equal(parent.current, '');
  const custer = report.summary[1];
  assert.equal(custer.current, '1200.00');
  assert.equal(custer.b30, '');
  assert.equal(custer.total, '1200.00');
  assert.equal(custer.depth, 1);
  const wortham = report.summary.find(r => r.customer === 'Wortham Bros., Inc.');
  assert.equal(wortham.b60, '3200.00');
  assert.equal(wortham.b90, '0.00');
  assert.equal(wortham.b91, '810.75');
  assert.equal(wortham.current, '');
  assert.equal(wortham.total, '4010.75');
  const parentTotal = report.summary.find(r => r.kind === 'subtotal');
  assert.equal(parentTotal.total, '1650.50');
  assert.equal(parentTotal.b30, '450.50');
  assert.equal(report.grand.customer, 'TOTAL');
  assert.equal(report.grand.current, '1700.00');
  assert.equal(report.grand.b90, '975.25');
  assert.equal(report.grand.total, '7136.50');

  // Detail stays in QuickBooks' bucket order, then grouped by customer. Not resorted A–Z.
  assert.deepEqual(report.groups.map(g => g.customer), [
    'Wortham Bros., Inc.',
    "Cook Children's Pediatrics",
    '2200 Greenville Ave, Dallas',
    '1480 N. Custer Rd, Allen',
  ]);
  const w = report.groups[0];
  assert.deepEqual(w.lines.map(l => l.invoice), ['4402', '4701']);
  assert.equal(w.lines[0].txn, 'Invoice');
  assert.equal(w.lines[0].days, '132');
  assert.equal(w.lines[0].date, '2026-05-01');
  assert.equal(w.lines[0].due, '2026-05-31');
  assert.equal(w.lines[0].balance, '810.75');
  // Open balance, not the original amount, and not the transaction id.
  assert.equal(w.lines[1].balance, '3200.00');
  assert.equal(w.lines[1].days, '51');
  assert.equal(w.subtotal, '4010.75');
  const cook = report.groups[1];
  assert.equal(cook.lines[0].balance, '975.25');
  assert.equal(cook.lines[0].invoice, '4666');
  assert.equal(cook.lines[1].invoice, '4900');
  assert.equal(cook.subtotal, '1475.25');
  assert.ok(!report.groups.some(g => /Total for \d/.test(g.customer) || g.customer === 'TOTAL'));
});

test('summary buckets follow QuickBooks column titles, not ColKey indexes or position', () => {
  // Live AgedReceivables headers. ColKey is a period index: "1" is the 31-60 column, not 1-30.
  // Reading those numbers as columns drops 1-30 and slides every older bucket one to the left.
  const money = (title, key) => ({ ColTitle: title, ColType: 'Money', MetaData: [{ Name: 'ColKey', Value: key }] });
  const columns = [
    { ColTitle: '', ColType: 'Customer', MetaData: [{ Name: 'ColKey', Value: 'customer' }] },
    money('Current', 'current'),
    money('1 - 30', '0'),
    money('31 - 60', '1'),
    money('61 - 90', '2'),
    money('91 and over', '3'),
    money('Total', 'total'),
  ];
  const figures = ['10527.23', '53531.04', '9871.13', '1165.00', '26983.21', '102077.61'];
  const cells = (name, nums) => [{ value: name }, ...nums.map(value => ({ value }))];
  const summary = {
    Columns: { Column: columns },
    Rows: { Row: [
      { type: 'Data', ColData: cells('All customers', figures) },
      { group: 'GrandTotal', type: 'Section', Summary: { ColData: cells('TOTAL', figures) } },
    ] },
  };
  const detail = {
    Columns: { Column: [
      { ColTitle: 'Date', ColType: 'tx_date' },
      { ColTitle: 'Transaction Type', ColType: 'txn_type' },
      { ColTitle: 'Num', ColType: 'doc_num' },
      { ColTitle: 'Customer', ColType: 'cust_name' },
      { ColTitle: 'Due Date', ColType: 'due_date' },
      { ColTitle: 'Past Due', ColType: 'past_due' },
      { ColTitle: 'Amount', ColType: 'subt_amount' },
      { ColTitle: 'Open Balance', ColType: 'subt_open_bal' },
    ] },
    Rows: { Row: [detailRow('2026-09-01', 'Invoice', '4812', 'All customers', '2026-09-20', '20', '3000.00', '2500.50', '9001')] },
  };
  const report = buildArReport(summary, detail, '2026-10-10');
  for (const row of [report.summary[0], report.grand]) {
    assert.equal(row.current, '10527.23');
    assert.equal(row.b30, '53531.04');
    assert.equal(row.b60, '9871.13');
    assert.equal(row.b90, '1165.00');
    assert.equal(row.b91, '26983.21');
    assert.equal(row.total, '102077.61');
  }
  assert.equal(report.summary[0].customer, 'All customers');
  assert.equal(report.groups[0].subtotal, '102077.61');
  assert.equal(report.groups[0].lines[0].balance, '2500.50');
  assert.equal(report.groups[0].lines[0].days, '20');
  const csv = parseCsv(renderArCsv(report));
  assert.equal(csv.find(r => r[1] === '4812')[5], '2500.50');
  assert.equal(csv.find(r => r[0] === 'Total for All customers')[5], '102077.61');
  assert.equal(csv.some(r => r.includes('53531.04') || r.includes('9871.13')), false);

  // Same headers out of order, one of them written with an en dash, so a positional read cannot pass.
  const shuffled = [
    money('Total', 'total'),
    money('91 and over', '3'),
    { ColTitle: '', ColType: 'Customer', MetaData: [{ Name: 'ColKey', Value: 'customer' }] },
    money('61 - 90', '2'),
    money('1 \u2013 30', '0'),
    money('Current', 'current'),
    money('31 - 60', '1'),
  ];
  const byTitle = {
    'Total': '102077.61', '91 and over': '26983.21', '': 'All customers', '61 - 90': '1165.00',
    '1 \u2013 30': '53531.04', 'Current': '10527.23', '31 - 60': '9871.13',
  };
  const moved = buildArReport({
    Columns: { Column: shuffled },
    Rows: { Row: [{ ColData: shuffled.map(col => ({ value: byTitle[col.ColTitle] })) }] },
  }, { Rows: {} }, '2026-10-10');
  assert.equal(moved.summary[0].customer, 'All customers');
  assert.equal(moved.summary[0].current, '10527.23');
  assert.equal(moved.summary[0].b30, '53531.04');
  assert.equal(moved.summary[0].b60, '9871.13');
  assert.equal(moved.summary[0].b90, '1165.00');
  assert.equal(moved.summary[0].b91, '26983.21');
  assert.equal(moved.summary[0].total, '102077.61');

  // A blank title still maps when ColKey repeats the header text, not a period index.
  const fromKey = buildArReport({
    Columns: { Column: [
      { ColTitle: '', ColType: 'Customer' },
      { ColTitle: '', ColType: 'Money', MetaData: [{ Name: 'ColKey', Value: '1 - 30' }] },
      { ColTitle: 'Total', ColType: 'Money', MetaData: [{ Name: 'ColKey', Value: 'total' }] },
    ] },
    Rows: { Row: [{ ColData: [{ value: 'Acme' }, { value: '53531.04' }, { value: '53531.04' }] }] },
  }, { Rows: {} }, '2026-10-10');
  assert.equal(fromKey.summary[0].b30, '53531.04');
  assert.equal(fromKey.summary[0].b60, '');
  assert.equal(fromKey.summary[0].b91, '');
  assert.equal(fromKey.summary[0].total, '53531.04');
});

test('pdf currency keeps QuickBooks digits and only adds a dollar sign and separators', async () => {
  const summary = {
    Columns: SUMMARY.Columns,
    Rows: { Row: [
      { ColData: [
        { value: 'Acme' }, { value: '10527.23' }, { value: '4,010.75' }, { value: '-12.50' }, { value: '(8.00)' }, { value: '0.00' }, { value: '14517.48' },
      ] },
      { group: 'GrandTotal', type: 'Section', Summary: { ColData: [
        { value: 'TOTAL' }, { value: '10527.23' }, { value: '53531.04' }, { value: '9871.13' }, { value: '1165.00' }, { value: '26983.21' }, { value: '102077.61' },
      ] } },
    ] },
  };
  const report = buildArReport(summary, { Rows: {} }, '2026-10-10');
  assert.equal(report.summary[0].current, '10527.23');
  assert.equal(report.summary[0].b30, '4,010.75');
  assert.equal(report.grand.b91, '26983.21');
  assert.equal(report.grand.total, '102077.61');
  report.generatedAt = new Date('2026-10-10T13:15:00Z');
  const text = pdfText(await renderArPdf(report));
  assert.match(text, /\$10,527\.23/);
  assert.match(text, /\$4,010\.75/);
  assert.match(text, /-\$12\.50/);
  assert.match(text, /\(\$8\.00\)/);
  assert.match(text, /\$0\.00/);
  assert.match(text, /\$53,531\.04/);
  assert.match(text, /\$9,871\.13/);
  assert.match(text, /\$1,165\.00/);
  assert.match(text, /\$26,983\.21/);
  assert.match(text, /\$102,077\.61/);
  assert.equal(text.includes('10527.23'), false);
  assert.match(text, /As of October 10, 2026/);
  assert.match(text, /Saturday, October 10, 2026 at 8:15 AM CDT/);
  assert.match(text, /Page 1 of 1/);
});

test('a subtotal is the summary total QuickBooks sent, not a sum of the lines', () => {
  const summary = {
    Columns: SUMMARY.Columns,
    Rows: { Row: [
      { ColData: [
        { value: 'Acme' }, { value: '10.00' }, { value: '' }, { value: '' }, { value: '' }, { value: '' }, { value: '4,010.75' },
      ] },
      { group: 'GrandTotal', type: 'Section', Summary: { ColData: [
        { value: 'TOTAL' }, { value: '10.00' }, { value: '' }, { value: '' }, { value: '' }, { value: '' }, { value: '999.01' },
      ] } },
    ] },
  };
  const detail = {
    Columns: DETAIL.Columns,
    Rows: { Row: [
      bucket('Current', [
        detailRow('2020-01-01', 'Invoice', '1', 'Acme', '2020-06-01', '7', '9999.00', '10.00', '1'),
        detailRow('2020-01-02', 'Invoice', '2', 'Acme', '2020-01-15', '7', '9999.00', '10.00', '2'),
        detailRow('2020-01-03', 'Credit Memo', '88', 'Ghost Customer', '2020-02-01', '', '20.00', '20.00', '3'),
      ], '40.00'),
    ] },
  };
  const report = buildArReport(summary, detail, '2026-10-10');
  assert.equal(report.groups[0].subtotal, '4,010.75');
  assert.equal(report.groups[0].lines[0].days, '7');
  assert.equal(report.groups[0].lines[1].days, '7');
  assert.equal(report.groups[0].lines[0].balance, '10.00');
  assert.equal(report.grand.total, '999.01');
  assert.equal(report.groups[1].customer, 'Ghost Customer');
  assert.equal(report.groups[1].subtotal, '');
  const csv = parseCsv(renderArCsv(report));
  const acmeTotal = csv.find(r => r[0] === 'Total for Acme');
  assert.equal(acmeTotal[5], '4,010.75');
  assert.equal(csv.some(r => r[0] === 'Total for Ghost Customer'), false);
  assert.equal(csv.find(r => r[1] === '88')[5], '20.00');
});

test('columns are read by type, so a shuffled detail report still shows open balance and days past due', () => {
  const detail = {
    Columns: { Column: [
      { ColTitle: 'Open Balance', ColType: 'subt_open_bal' },
      { ColTitle: 'Past Due', ColType: 'past_due' },
      { ColTitle: 'Num', ColType: 'doc_num' },
      { ColTitle: 'Customer', ColType: 'cust_name' },
      { ColTitle: 'Due Date', ColType: 'due_date' },
      { ColTitle: 'Date', ColType: 'tx_date' },
    ] },
    Rows: { Row: [{ ColData: [
      { value: '15.50' }, { value: '44' }, { value: '5001' }, { value: 'Plaza' }, { value: '2026-08-01' }, { value: '2026-07-01' },
    ] }] },
  };
  const report = buildArReport({ Rows: { Row: [] } }, detail, '2026-10-10');
  assert.deepEqual(report.groups[0].lines[0], {
    customer: 'Plaza', invoice: '5001', txn: '', date: '2026-07-01', due: '2026-08-01', days: '44', balance: '15.50',
  });
});

test('GET pdf returns the QuickBooks report inline and does not write', async () => {
  const { fetchImpl, calls } = mockReports();
  const res = await serveArAging({
    token: TOKEN,
    url: 'https://crm.example/w/qb/ar-aging.pdf',
    format: 'pdf',
    fetchImpl,
    now: new Date('2026-01-15T05:30:00Z'),
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition'), /^inline; filename="AR Aging 2026-01-14\.pdf"/);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
  const text = pdfText(bytes);
  assert.match(text, /SMS Roofing & Waterproofing/);
  assert.equal(text.includes('SMS Roofing & Waterproofing - A/R Aging'), false);
  assert.match(text, /A\/R Aging Summary/);
  assert.match(text, /As of January 14, 2026/);
  assert.match(text, /A\/R Aging Detail/);
  assert.match(text, /Transaction type/);
  assert.match(text, /91 and over/);
  assert.equal(text.includes('91+'), false);
  assert.match(text, /Wortham Bros\., Inc\./);
  assert.match(text, /4402/);
  assert.match(text, /\$810\.75/);
  assert.match(text, /\$7,136\.50/);
  assert.match(text, /\$3,200\.00/);
  assert.match(text, /132/);
  assert.match(text, /Current/);
  assert.match(text, /Wednesday, January 14, 2026 at 11:30 PM CST/);
  assert.match(text, /Page 1 of /);
  assert.match(Buffer.from(bytes).toString('latin1'), /\/MediaBox \[ 0 0 792 612 \]/);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    const u = new URL(call.url);
    assert.equal(call.opts.method, 'GET');
    assert.equal(call.opts.redirect, 'manual');
    assert.equal(call.opts.body, undefined);
    assert.equal(call.opts.headers.accept, 'application/json');
    assert.equal(call.opts.headers.authorization, 'Bearer SECRET-TOKEN-XYZ');
    assert.equal(u.searchParams.get('report_date'), '2026-01-14');
    assert.equal(u.searchParams.get('aging_method'), 'Report_Date');
    assert.equal(u.searchParams.get('aging_period'), '30');
    assert.equal(u.searchParams.get('num_periods'), '4');
    assert.equal(u.searchParams.get('minorversion'), '75');
    assert.ok(!call.url.includes('SECRET'));
  }
  assert.ok(calls[0].url.includes('/reports/AgedReceivables?'));
  assert.ok(calls[1].url.includes('/reports/AgedReceivableDetail?'));
  assert.match(new URL(calls[1].url).searchParams.get('columns'), /past_due/);
  assert.match(new URL(calls[1].url).searchParams.get('columns'), /subt_open_bal/);
  assert.ok(!res.headers.get('content-disposition').includes('SECRET'));
});

test('as_of is sent as report_date, and the csv is the same detail', async () => {
  const { fetchImpl, calls } = mockReports();
  const res = await serveArAging({
    token: TOKEN,
    url: 'https://crm.example/w/qb/ar-aging.csv?as_of=2026-06-01',
    format: 'csv',
    fetchImpl,
    now: new Date('2026-10-10T18:00:00Z'),
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.match(res.headers.get('content-disposition'), /^inline; filename="AR Aging 2026-06-01\.csv"/);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.equal(new URL(calls[0].url).searchParams.get('report_date'), '2026-06-01');
  const csv = parseCsv(await res.text());
  assert.deepEqual(csv[0], ['Customer', 'Invoice number', 'Date', 'Due date', 'Days past due', 'Open balance']);
  const wortham = csv.filter(r => r[0] === 'Wortham Bros., Inc.');
  assert.deepEqual(wortham.map(r => r[1]), ['4402', '4701']);
  assert.equal(wortham[0][4], '132');
  assert.equal(wortham[0][5], '810.75');
  assert.equal(wortham[1][5], '3200.00');
  const total = csv.find(r => r[0] === 'Total for Wortham Bros., Inc.');
  assert.equal(total[5], '4010.75');
  assert.equal(total[1], '');
  const cook = csv.find(r => r[1] === '4666');
  assert.equal(cook[0], "Cook Children's Pediatrics");
  assert.equal(cook[2], '2026-07-10');
  assert.equal(cook[3], '2026-07-25');
  assert.equal(cook[5], '975.25');
  assert.equal(csv.at(-1)[0], 'Total for 1480 N. Custer Rd, Allen');
  assert.ok(!csv.some(r => r.includes('3500.00')), 'the original amount is not the open balance');
  assert.ok(!csv.some(r => r.includes('9001')), 'the QuickBooks transaction id is not the invoice number');
});

test('a bad as_of is a 400 and QuickBooks is not called', async () => {
  let called = false;
  const res = await serveArAging({
    token: TOKEN,
    url: 'https://crm.example/w/qb/ar-aging.pdf?as_of=2026-02-31',
    format: 'pdf',
    fetchImpl: () => { called = true; throw new Error('no'); },
  });
  assert.equal(called, false);
  assert.equal(res.status, 400);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.match((await res.json()).error, /YYYY-MM-DD/);
});

test('not connected, auth failure, and a redirect do not leak the token', async () => {
  const bare = await serveArAging({ token: {}, url: 'https://crm.example/w/qb/ar-aging.pdf', format: 'pdf', fetchImpl: () => { throw new Error('no'); } });
  assert.equal(bare.status, 401);
  assert.match((await bare.json()).error, /isn't connected/);
  for (const status of [401, 403]) {
    const { fetchImpl } = mockReports(SUMMARY, DETAIL, { fail: 'AgedReceivables', status, body: '{"Fault":{"Error":[{"Message":"AuthenticationFailed"}]}}' });
    const res = await serveArAging({ token: TOKEN, url: 'https://crm.example/w/qb/ar-aging.pdf', format: 'pdf', fetchImpl });
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.match(data.error, /authorization failed/);
    assert.equal(JSON.stringify(data).includes('SECRET'), false);
  }
  const redir = await serveArAging({
    token: TOKEN,
    url: 'https://crm.example/w/qb/ar-aging.pdf',
    format: 'pdf',
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://accounts.intuit.com/login' } }),
  });
  assert.equal(redir.status, 401);
  assert.equal(JSON.stringify(await redir.json()).includes('SECRET'), false);
  const fault = classifyQbReportFailure('detail', 400, '{"Fault":{"Error":[{"code":"3200","Message":"AuthenticationFailed"}]}}');
  assert.equal(fault.status, 401);
});

test('a QuickBooks failure is a 502, a dead connection is said plainly, and a rejected column list is retried once', async () => {
  const down = await fetchArReports(async () => { throw new Error('ECONNRESET SECRET-TOKEN-XYZ'); }, { accessToken: TOKEN.access_token, realmId: TOKEN.realm_id, asOf: '2026-10-10' });
  assert.equal(down.ok, false);
  assert.equal(down.status, 502);
  assert.match(down.error, /could not be reached/);
  assert.equal(down.error.includes('SECRET'), false);
  const { fetchImpl } = mockReports(SUMMARY, DETAIL, { fail: 'AgedReceivableDetail', status: 500, body: '<html>SECRET-TOKEN-XYZ</html>' });
  const res = await serveArAging({ token: TOKEN, url: 'https://crm.example/w/qb/ar-aging.pdf?as_of=2026-10-10', format: 'pdf', fetchImpl });
  assert.equal(res.status, 502);
  const data = await res.json();
  assert.match(data.error, /aging detail \(500\)/);
  assert.equal(JSON.stringify(data).includes('SECRET'), false);
  const retry = mockReports(SUMMARY, DETAIL, { detailColumnsRejected: true });
  const ok = await serveArAging({ token: TOKEN, url: 'https://crm.example/w/qb/ar-aging.pdf?as_of=2026-10-10', format: 'csv', fetchImpl: retry.fetchImpl });
  assert.equal(ok.status, 200);
  assert.equal(retry.calls.length, 3);
  assert.equal(new URL(retry.calls[2].url).searchParams.get('columns'), null);
  assert.equal(retry.calls[2].opts.method, 'GET');
  const csv = parseCsv(await ok.text());
  assert.equal(csv.find(r => r[1] === '4812')[5], '1200.00');
});

test('an auth-looking 400 is not retried, and an empty report is still a pdf', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    const u = new URL(url);
    if (u.pathname.endsWith('/AgedReceivableDetail')) {
      return new Response('{"Fault":{"Error":[{"Message":"AuthenticationFailed","code":"3200"}]}}', { status: 400 });
    }
    return new Response(JSON.stringify(SUMMARY), { status: 200 });
  };
  const denied = await serveArAging({ token: TOKEN, url: 'https://crm.example/w/qb/ar-aging.pdf?as_of=2026-10-10', format: 'pdf', fetchImpl });
  assert.equal(denied.status, 401);
  assert.equal(calls.length, 2);
  const empty = {
    Header: { ReportName: 'AgedReceivables', Option: [{ Name: 'NoReportData', Value: 'true' }] },
    Columns: SUMMARY.Columns,
    Rows: {},
  };
  const blank = await serveArAging({
    token: TOKEN,
    url: 'https://crm.example/w/qb/ar-aging.pdf?as_of=2026-10-10',
    format: 'pdf',
    fetchImpl: mockReports(empty, { Columns: DETAIL.Columns, Rows: {} }).fetchImpl,
  });
  assert.equal(blank.status, 200);
  const text = pdfText(Buffer.from(await blank.arrayBuffer()));
  assert.match(text, /No open balances on this report/);
  assert.match(text, /No open invoices on this report/);
  const csv = renderArCsv(buildArReport(empty, { Rows: {} }, '2026-10-10'));
  assert.deepEqual(parseCsv(csv), [['Customer', 'Invoice number', 'Date', 'Due date', 'Days past due', 'Open balance']]);
});

test('csv quotes commas and quotes, and a long report still renders', async () => {
  const summary = {
    Columns: SUMMARY.Columns,
    Rows: { Row: [{ ColData: [
      { value: 'Four Corners, "Allen"' }, { value: '1.00' }, { value: '' }, { value: '' }, { value: '' }, { value: '' }, { value: '1.00' },
    ] }] },
  };
  const detail = {
    Columns: DETAIL.Columns,
    Rows: { Row: [detailRow('2026-10-01', 'Invoice', '1', 'Four Corners, "Allen"', '2026-10-31', '0', '1.00', '1.00', '1')] },
  };
  const report = buildArReport(summary, detail, '2026-10-10');
  const csv = renderArCsv(report);
  assert.match(csv, /"Four Corners, ""Allen"""/);
  assert.equal(parseCsv(csv)[1][0], 'Four Corners, "Allen"');
  const many = {
    Columns: DETAIL.Columns,
    Rows: { Row: [bucket('Current', Array.from({ length: 80 }, (_, i) => detailRow('2026-10-01', 'Invoice', String(1000 + i), 'Plaza', '2026-10-31', '0', '1.00', '1.00', String(i))), '80.00')] },
  };
  const wide = {
    Columns: SUMMARY.Columns,
    Rows: { Row: [{ ColData: [{ value: 'Plaza' }, { value: '80.00' }, { value: '' }, { value: '' }, { value: '' }, { value: '' }, { value: '80.00' }] }] },
  };
  const bytes = await renderArPdf(buildArReport(wide, many, '2026-10-10'));
  assert.equal(Buffer.from(bytes).subarray(0, 4).toString(), '%PDF');
  const text = pdfText(bytes);
  assert.match(text, /Plaza \(continued\)/);
  assert.match(text, /Page 2 of /);
});

test('the helper only GETs, and the route is cookie auth with no CRM write', () => {
  const lib = readFileSync('lib/qb-ar.js', 'utf8');
  assert.equal((lib.match(/method:\s*"GET"/g) || []).length, 1);
  assert.ok(!/method:\s*"(POST|PUT|PATCH|DELETE)"/.test(lib), 'the report helper never writes to QuickBooks');
  assert.ok(!/console\./.test(lib));
  assert.ok(!/\b(UPDATE|INSERT|DELETE|parseFloat|parseInt)\b/.test(lib));
  const w = readFileSync('netlify/functions/work.mts', 'utf8');
  const fn = w.match(/async function qbArAging[\s\S]*?\n\}/);
  assert.ok(fn, 'qbArAging exists');
  assert.match(fn[0], /qbToken\(\)/);
  assert.match(fn[0], /serveArAging/);
  assert.ok(!/\b(UPDATE|INSERT|DELETE)\b/.test(fn[0]));
  assert.ok(!fn[0].includes('console.'));
  assert.ok(!fn[0].includes('sql'), 'the aging route does not touch the CRM database');
  const handlerAt = w.indexOf('export default async function handler');
  const routeAt = w.indexOf('ar-aging.pdf', handlerAt);
  const dbAt = w.indexOf('getDatabase()', handlerAt);
  assert.ok(routeAt > handlerAt && routeAt < dbAt, 'the report returns before the database is opened');
  assert.match(w.slice(routeAt, routeAt + 700), /req\.method !== "GET"/);
  assert.match(w.slice(routeAt, routeAt + 700), /ar-aging\.csv/);
  assert.match(w.slice(routeAt, routeAt + 900), /That report is read-only/);
});

test('the AR tab opens the QuickBooks PDF in a new tab', () => {
  const html = qbArReportLink();
  assert.match(html, /href="\/w\/qb\/ar-aging\.pdf"/);
  assert.match(html, />QuickBooks AR report \(PDF\)</);
  assert.match(html, /target="_blank"/);
  const ar = readFileSync('public/ar.js', 'utf8');
  assert.match(ar, /qbArReportLink\(\)/);
  assert.ok(ar.indexOf('qbArReportLink()') < ar.indexOf('DONE — NOT GETTING PAID YET'));
});
