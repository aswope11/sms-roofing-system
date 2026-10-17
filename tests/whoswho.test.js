import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingKey, splitAddress, canonicalBuilding, matchRow, mapDecision, prefillRow, qbIndex, qbFlags, parseQbName, newTenantName, findTenantCustomers } from '../lib/whoswho.js';

const C = (Id, DisplayName, parent, full) => ({ Id, DisplayName, ParentRef: parent ? { value: parent } : undefined, FullyQualifiedName: full || DisplayName });
const QB = [
  C('1', 'Four Corners Property Company'),
  C('1743', '1480 N. Custer Rd, Allen', '1', 'Four Corners Property Company:1480 N. Custer Rd, Allen'),
  C('1744', '1480 N. Custer Rd - Allen - Bread Zeppelin', '1743', 'Four Corners Property Company:1480 N. Custer Rd, Allen:1480 N. Custer Rd - Allen - Bread Zeppelin'),
  C('1745', '1480 N. Custer Rd - Allen - Playa Bowls', '1743', 'Four Corners Property Company:1480 N. Custer Rd, Allen:1480 N. Custer Rd - Allen - Playa Bowls'),
  C('50', 'Med-Tech Construction'),
  C('51', '1480 N Custer - Bread Zeppelin', '50', 'Med-Tech Construction:1480 N Custer - Bread Zeppelin'),
  C('1747', '3009-3011 Belt Line, Irving', '1', 'Four Corners Property Company:3009-3011 Belt Line, Irving'),
  C('1717', '3041 N Belt Line Rd - Irving - Hair Mart', '1747', 'Four Corners Property Company:3009-3011 Belt Line, Irving:3041 N Belt Line Rd - Irving - Hair Mart'),
  C('1359', "Cook Children's Pediatrics-1710 N Greenville Ave. Ste 110"),
  C('1360', '1710 N Greenville Ave, Allen'),
  C('70', 'Wortham Bros., Inc.'),
  C('71', '300 Hickory, Cedar Hill', '70', 'Wortham Bros., Inc.:300 Hickory, Cedar Hill'),
  C('80', '6751 Abrams Rd Ste 100 - Lake Highlands Cafe'),
];
const idx = qbIndex(QB);

test('every spelling of an address is the same building', () => {
  assert.equal(buildingKey('1480 N. Custer Rd Ste 100, Allen, TX 75002'), '1480 custer');
  assert.equal(buildingKey('1480 North Custer Road'), '1480 custer');
  assert.equal(buildingKey('6101 Windhaven Pkwy'), buildingKey('6101 Windhaven Parkway'));
  assert.equal(splitAddress('1480 N. Custer Rd Ste 100').suite, '100');
  assert.equal(splitAddress('1710 N Greenville Ave. Suite 110, Allen').suite, '110');
  assert.equal(canonicalBuilding('3041 N Belt Line Rd', 'Irving'), canonicalBuilding('3009-3011 Belt Line', 'Irving'));
});

test('match by address (any spelling) AND tenant; the suite can name the tenant', () => {
  const rows = [
    { id: 1, property_id: 9, building: '1480 N. Custer Rd', city: 'Allen', tenant: 'Bread Zeppelin', suite: '100', status: 'confirmed', qb_customer_id: '1744' },
    { id: 2, property_id: 9, building: '1480 N. Custer Rd', city: 'Allen', tenant: 'Playa Bowls', suite: '', status: 'confirmed', qb_customer_id: '1745' },
    { id: 3, property_id: 12, building: '3009-3011 Belt Line', city: 'Irving', tenant: 'Hair Mart', status: 'confirmed', qb_customer_id: '1717' },
  ];
  assert.equal(matchRow(rows, { property_id: 9, address: '1480 N. Custer Rd', tenant: 'bread zeppelin' }).row.id, 1);
  assert.equal(matchRow(rows, { address: '1480 North Custer Road Suite 100', city: 'Allen', tenant: '' }).row.id, 1);
  assert.equal(matchRow(rows, { address: '3041 N Belt Line Rd', city: 'Irving', tenant: 'Hair Mart' }).row.id, 3);
  assert.ok(matchRow(rows, { address: '1480 N. Custer Rd', city: 'Allen', tenant: 'Jiu Jitsu' }).none);
  assert.ok(matchRow(rows, { address: '1480 N. Custer Rd', city: 'Plano', tenant: 'Playa Bowls' }).none, 'another city is another building');
});

test('no confirmed match = STOP, never a guess', () => {
  const rows = [{ id: 1, property_id: 9, building: '1480 N. Custer Rd', city: 'Allen', tenant: 'Playa Bowls', status: 'open', qb_customer_id: '1745' }];
  assert.equal(mapDecision(rows, { property_id: 9, address: '1480 N. Custer Rd', tenant: 'Playa Bowls' }).ok, false);
  assert.equal(mapDecision(rows, { address: '9 Nowhere', tenant: '' }).ok, false);
  rows[0].status = 'confirmed';
  assert.equal(mapDecision(rows, { property_id: 9, address: '1480 N. Custer Rd', tenant: 'Playa Bowls' }).row.qb_customer_id, '1745');
});

const loc = o => ({ property_id: 9, customer_id: 4, company: 'Four Corners Property Company', qb_parent: 'Four Corners Property Company', address: '1480 N. Custer Rd Ste 100', city: 'Allen', tenant: 'Bread Zeppelin',
  p_bill_name: 'Custer Allen LLC', p_bill_addr: '1 Main\nDallas, TX', c_bill_name: '', c_bill_addr: '', gc: 'Med-Tech Construction', mail_from: ['Keeson <tc@fourcorners-co.com>'], invoice_customer_ids: [], ...o });

test('Bread Zeppelin = Four Corners, NEVER Med-Tech — even when an old invoice sits on Med-Tech', () => {
  const r = prefillRow(loc({ invoice_customer_ids: ['51', '1744'] }), idx);
  assert.equal(r.row.qb_customer_id, '1744');
  assert.equal(r.row.status, 'confirmed');
  assert.ok(r.notes.some(n => /Med-Tech/.test(n)));
});

test('Four Corners Bill To = the owner LLC, never the GC; no LLC on file = blank (asked)', () => {
  assert.equal(prefillRow(loc(), idx).row.bill_name, 'Custer Allen LLC');
  const r = prefillRow(loc({ p_bill_name: '', c_bill_name: 'Med-Tech Construction', c_bill_addr: 'x' }), idx);
  assert.equal(r.row.bill_name, ''); assert.equal(r.row.status, 'open');
});

test('Belt Line: 3041 and 3009-3011 are one building — Hair Mart found under it', () => {
  const r = prefillRow(loc({ address: '3041 N Belt Line Rd', city: 'Irving', tenant: 'Hair Mart', p_bill_name: 'Belt Line LLC' }), idx);
  assert.equal(r.row.qb_customer_id, '1717');
  assert.equal(r.row.building_qb_id, '1747');
});

test('new tenant at a known building = blank QB spot, offered under that building; nothing created', () => {
  const r = prefillRow(loc({ tenant: 'Jiu Jitsu', address: '1480 N. Custer Rd' }), idx);
  assert.equal(r.row.qb_customer_id, ''); assert.equal(r.row.building_qb_id, '1743'); assert.equal(r.row.status, 'open');
  assert.equal(newTenantName('1480 N. Custer Rd Ste 300', 'Jiu Jitsu'), '1480 N. Custer Rd - Jiu Jitsu');
});

test('Jen Hill 1710 N Greenville = the Cook Children\'s tenant customer, not the bare building', () => {
  const r = prefillRow(loc({ company: 'Jen Hill', qb_parent: '', address: '1710 N Greenville Ave', city: 'Allen', tenant: '', p_bill_name: '', c_bill_name: 'Jennifer Hill', c_bill_addr: 'a', invoice_customer_ids: ['1360'] }), idx);
  assert.equal(r.row.qb_customer_id, '1359');
});

test('Wortham billing + parent from his rule', () => {
  const r = prefillRow(loc({ company: 'Wortham Brothers Roofing', qb_parent: '', address: '300 Hickory', city: 'Cedar Hill', tenant: '', p_bill_name: '', c_bill_name: '', mail_from: [] }), idx);
  assert.equal(r.row.bill_name, 'Wortham Brothers Roofing'); assert.match(r.row.bill_addr, /1492 FM 2933/);
  assert.equal(r.row.qb_customer_id, '71'); assert.equal(r.row.called_in, 'Med-Tech Construction');
});

test('two past invoices on two different customers = a question, not a pick', () => {
  const qb = qbIndex([...QB, C('1746', '1480 N. Custer Rd - Allen - Bread Zeppelin 2', '1743')]);
  const r = prefillRow(loc({ invoice_customer_ids: ['1744', '1746'] }), qb);
  assert.equal(r.row.qb_customer_id, ''); assert.equal(r.conflicts[0].choices.length, 2); assert.equal(r.row.status, 'open');
});

test('flags: loose tenants and duplicates are reported, never touched', () => {
  const f = qbFlags([...QB, C('90', '1480 N. Custer Rd - Allen - Playa Bowls')], ['1480 custer', '6751 abrams']);
  assert.ok(f.some(x => x.kind === 'duplicate'));
  assert.ok(f.some(x => x.kind === 'loose-tenant' && /Lake Highlands/.test(x.text)));
  assert.equal(parseQbName('1480 N. Custer Rd, Allen').tenant, '');
});

test('the server never guesses a QuickBooks customer: no placeCustomer, every customer pick goes through the map', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../netlify/functions/work.mts', import.meta.url), 'utf8');
  assert.ok(!/L\.placeCustomer\(/.test(src), 'placeCustomer (the guess) must not be called');
  const creates = src.match(/qb\("POST", "invoice", \{\s*CustomerRef: \{ value: cust\.Id \}/g) || [];
  assert.equal(creates.length, 3, 'every invoice write uses the map customer (10/16/26: + supply bill placeholder)');
  // 10/15/26: both picks still start from the map, then the ticket's own placeholder customer wins
  assert.equal((src.match(/followPlaceholder\(sql, [a-z.]+, await qbCustomerFor\(/g) || []).length, 3);
  assert.ok(/async function qbCustomerFor\(job: any, sql: any\) \{\s*const d = await mapDecisionFor/.test(src));
});

// 10/15/26 — Playa Bowls ended up as 3 QuickBooks customers because tenant-first names were invisible.
test('tenant-first QuickBooks names are read as a tenant at a building', () => {
  const p = parseQbName('Playa Bowls - 1480 Custer - Allen');
  assert.equal(p.isAddress, true);
  assert.equal(p.building, '1480 custer');
  assert.equal(p.tenant, 'Playa Bowls');
  assert.equal(parseQbName('1480 N. Custer Rd - Allen - Bread Zeppelin').tenant, 'Bread Zeppelin');   // address-first unchanged
  assert.equal(parseQbName('Four Corners Property Company').isAddress, false);
});
test('every existing customer for a tenant is found, any spelling, anywhere', () => {
  const all = [
    C('1667', 'Playa Bowls - 1480 Custer - Allen', '1'),
    C('1631', '1480 N. Custer Rd Ste 150 - Playa Bowls'),
    C('1744', '1480 N. Custer Rd - Allen - Bread Zeppelin', '1743'),
    { ...C('9', '1480 Custer - Allen - Playa Bowls', '1743'), Active: false },
  ];
  const hits = findTenantCustomers(all, '1480 N. Custer Rd Ste 150', 'Allen', 'Playa Bowls').map(c => c.Id).sort();
  assert.deepEqual(hits, ['1631', '1667']);                       // inactive leftover and other tenants left out
  assert.deepEqual(findTenantCustomers(all, '1480 N. Custer Rd', 'Allen', 'Smoothie King'), []);
});
test('a duplicate with the tenant written first is flagged', () => {
  const f = qbFlags([...QB, C('91', 'Playa Bowls - 1480 Custer - Allen', '1')], ['1480 custer']);
  assert.ok(f.some(x => x.kind === 'duplicate' && /Playa Bowls - 1480 Custer - Allen/.test(x.text)));
});

test('green day placement: company parent, existing building wins, new building name', async () => {
  const W = await import('../lib/whoswho.js');
  const qb = [
    { Id: '385', DisplayName: 'Wortham Bros., Inc.', Active: true },
    { Id: '9', DisplayName: '175 Stonebridge, Southlake', ParentRef: { value: '385' }, Active: true },
    { Id: '10', DisplayName: '2264 Vantage, Dallas (deleted)', ParentRef: { value: '385' }, Active: false },
  ];
  const assert = (await import('node:assert')).strict;
  assert.equal(W.companyQbParent(qb, 'Wortham Brothers Roofing').Id, '385');
  assert.equal(W.findBuildingCustomer(qb, '385', '175 Stonebridge Dr', 'Southlake').Id, '9');
  assert.equal(W.findBuildingCustomer(qb, '385', '2264 Vantage', 'Dallas'), null);
  assert.equal(W.newBuildingName('2264 Vantage', 'Dallas'), '2264 Vantage, Dallas');
});
