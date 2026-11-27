import test from 'node:test';
import assert from 'node:assert/strict';
import { payrollCustomer, qbBuildingCandidates, sameBuildingKey } from '../lib/whoswho.js';

const qb = [
  { Id: '1780', DisplayName: '1201 & 1205 E Levee St, Dallas', Active: true },
  { Id: '1781', DisplayName: '2612 & 2614 Manor Way, Dallas', Active: true },
  { Id: '1658', DisplayName: '4900 E-I30, Fate - Fate Village Phase 2', Active: true },
  { Id: '61', DisplayName: '202 E Irving Blvd, Irving', Active: true },
  { Id: '71', DisplayName: '202 E Irving Blvd, Irving', Active: true },
];
const none = { ok: false };
const go = (address, tenant = '', decision = none, active = () => true) =>
  payrollCustomer({ decision, address, tenant, isActive: async id => active(id), customers: async () => qb });

test('shared building number + same street = same building', () => {
  assert.ok(sameBuildingKey('1205 levee', '1201 1205 levee'));
  assert.ok(!sameBuildingKey('1207 levee', '1201 1205 levee'));
  assert.ok(!sameBuildingKey('1205 elm', '1201 1205 levee'));
});
test('no confirm needed when one QuickBooks customer sits at the building', async () => {
  assert.equal((await go('1205 E Levee')).id, '1780');
  assert.equal((await go('2612/2614 Manor Way')).id, '1781');
});
test('his pinned answer: 4860 E. I-30 -> Fate Village Phase 2', async () => {
  assert.equal((await go('4860 E. I-30')).id, '1658');
  assert.equal((await go('4860 E I30')).id, '1658');
  assert.notEqual((await go('4900 E I-30')).id, '1658');
});
test('two customers at the building still stops', async () => {
  const r = await go('202 E Irving Blvd');
  assert.equal(r.ok, false);
  assert.match(r.why, /2 QuickBooks customers/);
});
test('confirmed active row wins; inactive confirmed row falls back to the building', async () => {
  const d = { ok: true, row: { qb_customer_id: '999' } };
  assert.equal((await go('1205 E Levee', '', d)).id, '999');
  assert.equal((await go('1205 E Levee', '', d, id => id !== '999')).id, '1780');
});
test('tenant on the ticket needs the tenant customer', () => {
  assert.equal(qbBuildingCandidates(qb, '4900 E-I30', 'Fate Village Phase 2').length, 1);
  assert.equal(qbBuildingCandidates(qb, '1205 E Levee', 'Some Shop').length, 0);
});
