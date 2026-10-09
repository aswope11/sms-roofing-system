import test from 'node:test';
import assert from 'node:assert/strict';
import { placeCustomer, rootOf } from '../lib/qb-layers.js';

function fakeQB(rows) {
  let n = 1000; const all = rows.map(r => ({ Active: true, ...r }));
  const made = [];
  const api = {
    async query(where) {
      const like = where.match(/DisplayName LIKE '(.*)%'/); const eq = where.match(/DisplayName = '(.*)'/);
      const un = s => s.replace(/\\'/g, "'");
      return all.filter(c => like ? c.DisplayName.startsWith(un(like[1])) : c.DisplayName === un(eq[1]));
    },
    async get(id) { return all.find(c => c.Id === id); },
    async create(p) { const c = { Id: String(n++), Active: true, ...p }; all.push(c); made.push(c); return c; },
  };
  return { api, made, all };
}
const FC = [
  { Id: '1', DisplayName: 'Four Corners Property Company' },
  { Id: '2', DisplayName: '1480 N. Custer Rd, Allen', ParentRef: { value: '1' } },
  { Id: '3', DisplayName: '1480 N. Custer Rd - Allen - Playa Bowls', ParentRef: { value: '2' } },
];
const job = o => ({ customer_name: 'Four Corners Property Company', address: '1480 N. Custer Rd', city: 'Allen', tenant: '', ...o });

test('existing tenant wins', async () => {
  const { api, made } = fakeQB(FC);
  assert.equal((await placeCustomer(job({ tenant: 'Playa Bowls' }), api)).Id, '3'); assert.equal(made.length, 0);
});
test('new tenant goes under the existing building', async () => {
  const { api, made } = fakeQB(FC);
  const c = await placeCustomer(job({ tenant: 'Burger Shop' }), api);
  assert.equal(c.DisplayName, '1480 N. Custer Rd - Allen - Burger Shop'); assert.equal(c.ParentRef.value, '2'); assert.equal(made.length, 1);
});
test('whole property bills to the building', async () => {
  const { api, made } = fakeQB(FC);
  assert.equal((await placeCustomer(job(), api)).Id, '2'); assert.equal(made.length, 0);
});
test('brand-new building + tenant: building under company, tenant under building', async () => {
  const { api, made } = fakeQB(FC);
  const c = await placeCustomer(job({ address: '900 Main St', city: 'Frisco', tenant: 'Taco Spot' }), api);
  assert.equal(made[0].DisplayName, '900 Main St, Frisco'); assert.equal(made[0].ParentRef.value, '1');
  assert.equal(c.DisplayName, '900 Main St - Frisco - Taco Spot'); assert.equal(c.ParentRef.value, made[0].Id);
  assert.equal((await rootOf(api, c.Id)).Id, '1');
});
test('billing card QB name wins over app name', async () => {
  const { api, made } = fakeQB([{ Id: '9', DisplayName: 'Wortham Bros., Inc.' }]);
  await placeCustomer({ customer_name: 'Wortham Brothers Roofing', c_qb_parent: 'Wortham Bros., Inc.', address: '1 Oak', city: 'Plano' }, api);
  assert.equal(made[0].ParentRef.value, '9'); assert.equal(made.length, 1);
});
test('brand-new company is made at the top, nothing loose', async () => {
  const { api, made } = fakeQB([]);
  const c = await placeCustomer({ customer_name: 'New GC LLC', address: '5 Elm', city: 'Dallas', tenant: 'Dentist' }, api);
  assert.deepEqual(made.map(m => m.DisplayName), ['New GC LLC', '5 Elm, Dallas', '5 Elm - Dallas - Dentist']);
  assert.equal((await rootOf(api, c.Id)).DisplayName, 'New GC LLC');
});
test('company hint (where his other buildings sit) wins', async () => {
  const { api, made } = fakeQB(FC);
  await placeCustomer({ customer_name: 'Four Corners', address: '77 Elm', city: 'Allen' }, api, { companyId: '1' });
  assert.equal(made[0].ParentRef.value, '1'); assert.equal(made.length, 1);
});
test('another company\'s building at the same address is never used; same name gets the company on the end', async () => {
  const { api, made } = fakeQB([...FC, { Id: '50', DisplayName: 'Good Seed Consulting Group' }]);
  const c = await placeCustomer({ customer_name: 'Good Seed Consulting Group', address: '1480 N. Custer Rd', city: 'Allen', tenant: 'Playa Bowls' }, api);
  assert.equal(made[0].DisplayName, '1480 N. Custer Rd, Allen - Good Seed Consulting Group'); assert.equal(made[0].ParentRef.value, '50');
  assert.equal(c.DisplayName, '1480 N. Custer Rd - Allen - Playa Bowls - Good Seed Consulting Group');
});
