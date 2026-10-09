// QUICKBOOKS CUSTOMER LAYERS (10/9/26, his order: "it needs to be the structure of the app … identical from day one").
// Every job lands in QuickBooks the same way, the way the Four Corners and Standridge AR was hand-organized 10/8:
//
//   Company                      Four Corners Property Company
//     └ Building                   1480 N. Custer Rd, Allen
//         └ Tenant                   1480 N. Custer Rd - Allen - Playa Bowls
//
// A whole-property job (no tenant) bills to the Building itself. The ticket is the 4th layer and lives in the app
// (Customer › Owner LLC + building › Tenant › Ticket); the owner LLC rides on the invoice's Bill To, not as a QB layer.
// An old customer that already exists ALWAYS wins (never a duplicate) — new ones are made in the layer they belong in.
//
// api = { query(where) → Customer[] (active, with Id, DisplayName, ParentRef), get(id) → Customer, create(payload) → Customer }

const clean = v => String(v ?? '').trim();
const low = v => clean(v).toLowerCase();

export const buildingName = (addr, city) => [clean(addr), clean(city)].filter(Boolean).join(', ');
export const tenantName = (addr, city, tenant) => [clean(addr), clean(city), clean(tenant)].filter(Boolean).join(' - ');
const qEsc = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

// The top of a customer's tree (the company), walking up through building/tenant parents.
export async function rootOf(api, id) {
  let cur = await api.get(id);
  for (let i = 0; i < 6 && cur?.ParentRef?.value; i++) cur = await api.get(cur.ParentRef.value);
  return cur || null;
}

// The company layer: the hint (where his other buildings for this company already sit), then the billing card's
// QuickBooks name ("Wortham Bros., Inc."), then the app's name. None in QuickBooks → it is made, so nothing lands loose.
export async function companyFor(job, api, hintId) {
  if (hintId) return { Id: hintId };
  for (const n of [job.c_qb_parent, job.customer_name]) {
    if (!clean(n)) continue;
    const hit = (await api.query(`DisplayName = '${qEsc(clean(n))}'`))[0];
    if (hit) return hit;
  }
  const name = clean(job.c_qb_parent) || clean(job.customer_name);
  return name ? await api.create({ DisplayName: name }) : null;
}

const under = parent => parent ? { ParentRef: { value: parent.Id }, Job: true, BillWithParent: false } : {};

export async function placeCustomer(job, api, hint = {}) {
  const addr = clean(job.address), city = clean(job.city), tenant = clean(job.tenant);
  if (!addr) throw new Error('This ticket has no address — QuickBooks needs the building.');
  let found = await api.query(`DisplayName LIKE '${qEsc(addr)}%'`);
  if (city) { const byCity = found.filter(c => low(c.DisplayName).includes(low(city))); if (byCity.length) found = byCity; }

  // TENANT: an existing customer for this tenant at this building wins, wherever it sits.
  if (tenant) {
    const t = low(tenant);
    const exact = found.filter(c => low(c.DisplayName).endsWith(' - ' + t));
    if (exact.length === 1) return exact[0];
    const hit = found.filter(c => { const d = low(c.DisplayName); return d.includes(' - ' + t + ' -') || d.includes(' ' + t); });
    if (hit.length === 1) return hit[0];
  }

  // BUILDING: the customer named for the building itself ("address, city", or just the address).
  const bNames = [low(buildingName(addr, city)), low(addr), low(tenantName(addr, city, ''))];
  let building = found.find(c => bNames.includes(low(c.DisplayName))) || null;
  if (!tenant) {
    if (building) return building;
    if (found.length === 1) return found[0];                 // his one old customer at this address wins
    for (const name of [job.title, job.parent_title]) {      // several buildings at one address: the ticket's own title, then its parent job's
      const n = low(name); if (!n) continue;
      const hit = found.filter(c => low(c.DisplayName).includes(n));
      if (hit.length === 1) return hit[0];
    }
  }

  const company = await companyFor(job, api, hint.companyId);
  if (!building) building = await api.create({ DisplayName: buildingName(addr, city), ...under(company) });
  if (!tenant) return building;
  return await api.create({ DisplayName: tenantName(addr, city, tenant), ...under(building) });
}
