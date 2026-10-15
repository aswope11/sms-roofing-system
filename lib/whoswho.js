// WHO'S WHO — THE LOCKED CUSTOMER MAP (10/11/26, his order: "Every QuickBooks problem comes from the app guessing
// who a job belongs to. The app must never guess again.")
//
// One row per job location (building + tenant):
//   WHO PAYS   bill_name + bill_addr (owner LLC, property manager or GC)
//   BUILDING   street address (the QuickBooks building customer)
//   TENANT     the business inside, if any
//   CALLED IN  the GC / property manager contact (can differ from who pays)
//   QB PATH    Company › Building › Tenant, exactly as it sits in QuickBooks
//
// Confirmed rows are LOCKED: nothing in the app changes them except him, on the Who's Who screen or the popup.
// Every ticket / invoice is matched to ONE row before anything goes to QuickBooks. No confirmed match → STOP and ask.
// The app never creates a QuickBooks customer on its own.
// Pure functions only — the server feeds them, tests/whoswho.test.js checks them.

const clean = v => String(v ?? '').trim();

// ---------- ADDRESS + TENANT KEYS ----------
// St/Street, Rd/Road, Ste/Suite, N/North, with or without city — all the same building.
const STREET_WORDS = new Set(['st', 'street', 'rd', 'road', 'ave', 'av', 'avenue', 'blvd', 'boulevard', 'dr', 'drive', 'ln', 'lane',
  'pkwy', 'parkway', 'pky', 'hwy', 'highway', 'fwy', 'freeway', 'ct', 'court', 'cir', 'circle', 'trl', 'trail', 'pl', 'place',
  'ter', 'terrace', 'way', 'expy', 'expressway', 'loop', 'plz', 'plaza', 'sq', 'square']);
const DIRS = new Set(['n', 's', 'e', 'w', 'north', 'south', 'east', 'west', 'ne', 'nw', 'se', 'sw']);
const SUITE_RE = /(?:\b(?:ste|suite|unit|bldg|building|space|spc)\.?\s*|#\s*)([a-z0-9-]+)/i;

// "1480 N. Custer Rd Ste 100, Allen, TX 75002" → { street: "1480 N. Custer Rd", suite: "100" }
export function splitAddress(addr) {
  let s = clean(addr).replace(/\s+/g, ' ');
  const sm = s.match(SUITE_RE);
  const suite = sm ? sm[1].toLowerCase() : '';
  if (sm) s = (s.slice(0, sm.index) + ' ' + s.slice(sm.index + sm[0].length)).trim();
  const street = clean(s.split(',')[0]);
  return { street, suite };
}
// Building key: the number + the street's name words, nothing else ("1480 custer", "3041 belt line", "6101 windhaven").
export function buildingKey(addr) {
  const { street } = splitAddress(addr);
  const words = street.toLowerCase().replace(/[.,'’]/g, ' ').replace(/[^a-z0-9\- ]/g, ' ').split(/\s+/).filter(Boolean);
  const out = words.filter((w, i) => !(i > 0 && (STREET_WORDS.has(w) || DIRS.has(w))) && !/^\d{5}$/.test(w) && w !== 'tx' && w !== 'texas');
  return out.join(' ');
}
export const cityKey = c => clean(c).toLowerCase().replace(/[^a-z ]/g, '').trim();
export const tenantKey = t => clean(t).toLowerCase().replace(/[’']/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

// ---------- HIS KNOWN FACTS (10/11/26, loaded as law) ----------
export const KNOWN = {
  // Same building, different spellings.
  sameBuilding: [
    { keys: ['3009-3011 belt line', '3041 belt line'], city: 'irving', qbBuilding: '3009-3011 Belt Line, Irving' },
  ],
  // A building that always belongs to one company, under one QuickBooks building customer.
  buildingOwner: [
    { key: '1480 custer', city: 'allen', company: /four\s*corners/i, qbBuilding: '1480 N. Custer Rd, Allen', never: /med-?\s*tech/i },
    { key: '3009-3011 belt line', city: 'irving', company: /four\s*corners/i, qbBuilding: '3009-3011 Belt Line, Irving' },
  ],
  // A location pinned to one exact QuickBooks customer.
  pinned: [
    { key: '1710 greenville', city: 'allen', company: /jen(nifer)?\s*hill/i, qbCustomer: "Cook Children's Pediatrics-1710 N Greenville Ave. Ste 110" },
  ],
  // Who pays, per company.
  billing: [
    { company: /wortham/i, qbParent: 'Wortham Bros., Inc.', bill_name: 'Wortham Brothers Roofing', bill_addr: '1492 FM 2933\nMcKinney, TX 75071' },
    { company: /standridge/i, qbParent: 'Standridge Companies', bill_name: 'Standridge Companies', bill_addr: '10711 Preston Rd, Suite 222\nDallas, TX 75230' },
  ],
  // Four Corners: Bill To = the owner LLC of that building (Four Corners Property List), NEVER the GC.
  ownerLLC: /four\s*corners/i,
};

// The one key every spelling of a building collapses to.
export function canonicalBuilding(addr, city) {
  const k = buildingKey(addr), c = cityKey(city);
  for (const g of KNOWN.sameBuilding) if (g.keys.includes(k) && (!c || !g.city || c === g.city)) return g.keys[0];
  return k;
}
export const sameCity = (a, b) => !cityKey(a) || !cityKey(b) || cityKey(a) === cityKey(b);
const tenantsMatch = (a, b) => {
  const x = tenantKey(a), y = tenantKey(b);
  if (!x || !y) return x === y;
  if (x === y) return true;
  const [s, l] = x.length < y.length ? [x, y] : [y, x];
  return s.length >= 5 && (l.startsWith(s + ' ') || l.endsWith(' ' + s));   // "Cook Childrens" ~ "Cook Childrens Pediatrics"
};

// ---------- MATCH A TICKET TO ONE ROW ----------
// ticket = { property_id, address, city, tenant }. rows = map rows (any status).
// → { row } exactly one · { none: true, sameBuilding: [...] } · { many: [...] }
export function matchRow(rows, t) {
  const tk = tenantKey(t.tenant);
  const exact = rows.filter(r => t.property_id && r.property_id === t.property_id && tenantKey(r.tenant) === tk);
  if (exact.length === 1) return { row: exact[0] };
  const bk = canonicalBuilding(t.address, t.city);
  const bldg = rows.filter(r => bk && canonicalBuilding(r.building, r.city) === bk && sameCity(r.city, t.city));
  let hit = bldg.filter(r => tenantKey(r.tenant) === tk);
  if (!hit.length && tk) hit = bldg.filter(r => tenantsMatch(r.tenant, t.tenant));
  if (!hit.length && !tk) {                                     // no tenant on the ticket: its suite can name the tenant's row
    const { suite } = splitAddress(t.address);
    if (suite) hit = bldg.filter(r => clean(r.suite).toLowerCase() === suite);
  }
  if (hit.length === 1) return { row: hit[0] };
  if (hit.length > 1) return { many: hit };
  return { none: true, sameBuilding: bldg };
}
// A ticket may go to QuickBooks only on a CONFIRMED row that names its QuickBooks customer.
export function mapDecision(rows, t) {
  const m = matchRow(rows, t);
  if (m.row && m.row.status === 'confirmed' && clean(m.row.qb_customer_id)) return { ok: true, row: m.row };
  if (m.row) return { ok: false, row: m.row, why: m.row.status !== 'confirmed' ? 'its Who\'s Who row is not confirmed yet' : 'its Who\'s Who row has no QuickBooks customer' };
  if (m.many) return { ok: false, why: `${m.many.length} Who's Who rows match it — pick one`, choices: m.many };
  return { ok: false, why: 'no Who\'s Who row for this building + tenant', choices: m.sameBuilding || [] };
}

// ---------- QUICKBOOKS CUSTOMER NAMES ----------
// "1480 N. Custer Rd - Allen - Playa Bowls" → building 1480 custer, tenant "Playa Bowls"; "1480 N. Custer Rd, Allen" → building only.
export function parseQbName(name) {
  const n = clean(name);
  const parts = n.split(/\s+-\s+/).map(clean).filter(Boolean);
  // Tenant written first (10/15/26, Playa Bowls twice): "Playa Bowls - 1480 Custer - Allen" → building 1480 custer, tenant "Playa Bowls".
  // Before this the app couldn't see these as a tenant at a building, so it made a second customer for the same tenant.
  const at = parts.findIndex(x => /^\d/.test(x));
  if (at > 0) return { building: buildingKey(parts[at].split(',')[0]), tenant: parts[0], isAddress: true };
  const addrPart = parts[0] || n;
  const hasNum = /^\d/.test(addrPart);
  const tenant = hasNum && parts.length >= 2 ? parts[parts.length - 1] : '';
  return { building: hasNum ? buildingKey(addrPart.split(',')[0]) : '', tenant: tenant && !/^\d/.test(tenant) ? tenant : '', isAddress: hasNum };
}
// customers: [{ Id, DisplayName, FullyQualifiedName, ParentRef }] → helpers
export function qbIndex(customers) {
  const byId = new Map(customers.map(c => [String(c.Id), c]));
  const root = c => { let cur = c; for (let i = 0; i < 8 && cur?.ParentRef?.value && byId.get(String(cur.ParentRef.value)); i++) cur = byId.get(String(cur.ParentRef.value)); return cur; };
  const byName = n => customers.find(c => clean(c.DisplayName).toLowerCase() === clean(n).toLowerCase()) || null;
  const path = c => clean(c?.FullyQualifiedName || c?.DisplayName).split(':').map(clean).join(' › ');
  return { byId, root, byName, path };
}

// ---------- PRE-FILL ----------
// loc = { property_id, customer_id, company (app name), qb_parent, address, city, tenant, suite,
//         p_bill_name, p_bill_addr, c_bill_name, c_bill_addr, gc, mail_from: [..newest first], invoice_customer_ids: [..] }
// Returns the row to save + its open questions. His answers (KNOWN) win over anything found in the data.
export function prefillRow(loc, idx) {
  const conflicts = [], sources = {}, notes = [];
  const company = clean(loc.company);
  const bk = canonicalBuilding(loc.address, loc.city), ck = cityKey(loc.city);
  const row = {
    property_id: loc.property_id, customer_id: loc.customer_id, tenant: clean(loc.tenant), tenant_key: tenantKey(loc.tenant),
    building: splitAddress(loc.address).street || clean(loc.address), city: clean(loc.city), suite: clean(loc.suite) || splitAddress(loc.address).suite,
    bill_name: '', bill_addr: '', called_in: '', qb_customer_id: '', qb_path: '',
  };

  // WHO PAYS
  const bill = KNOWN.billing.find(b => b.company.test(company));
  if (KNOWN.ownerLLC.test(company)) {
    if (clean(loc.p_bill_name)) { row.bill_name = clean(loc.p_bill_name); row.bill_addr = clean(loc.p_bill_addr); sources.bill = 'building\'s owner LLC (Four Corners Property List)'; }
    else notes.push('Four Corners building with no owner LLC on file');
  } else if (clean(loc.p_bill_name)) { row.bill_name = clean(loc.p_bill_name); row.bill_addr = clean(loc.p_bill_addr); sources.bill = 'building billing'; }
  else if (clean(loc.c_bill_name)) { row.bill_name = clean(loc.c_bill_name); row.bill_addr = clean(loc.c_bill_addr); sources.bill = 'company billing card'; }
  else if (bill) { row.bill_name = bill.bill_name; row.bill_addr = bill.bill_addr; sources.bill = 'your rule'; }

  // WHO CALLED IT IN
  const caller = (loc.mail_from || []).map(clean).find(f => f && !/smsroofingdfw\.com/i.test(f));
  if (caller) { row.called_in = caller; sources.called_in = 'the email that came in'; }
  else if (clean(loc.gc)) { row.called_in = clean(loc.gc); sources.called_in = 'GC / owner on the property'; }

  // QB PATH — his rules first, then past invoices, then his existing QuickBooks customers (an old customer always wins).
  const owner = KNOWN.buildingOwner.find(o => o.key === bk && (!o.city || !ck || o.city === ck));
  const pin = KNOWN.pinned.find(p => p.key === bk && (!p.city || !ck || p.city === ck));
  const expectRootName = bill?.qbParent || clean(loc.qb_parent) || company;
  const expectRoot = idx.byName(expectRootName) || (owner ? idx.byName('Four Corners Property Company') : null);
  const qbBuilding = owner ? idx.byName(owner.qbBuilding) : (KNOWN.sameBuilding.find(g => g.keys[0] === bk)?.qbBuilding ? idx.byName(KNOWN.sameBuilding.find(g => g.keys[0] === bk).qbBuilding) : null);
  const ok = c => {
    if (!c) return false;
    const r = idx.root(c);
    if (owner?.never && owner.never.test(clean(r?.DisplayName))) { notes.push(`left out "${idx.path(c)}" — your rule: never ${r.DisplayName}`); return false; }
    if (expectRoot && r && String(r.Id) !== String(expectRoot.Id)) { notes.push(`left out "${idx.path(c)}" — sits under ${r.DisplayName}, not ${expectRoot.DisplayName}`); return false; }
    if (qbBuilding) {
      const isB = String(c.Id) === String(qbBuilding.Id), under = String(c.ParentRef?.value || '') === String(qbBuilding.Id);
      if (row.tenant_key ? !under : !isB) { notes.push(`left out "${idx.path(c)}" — not under ${qbBuilding.DisplayName}`); return false; }
    }
    return true;
  };
  let picked = null;
  if (pin) {
    picked = idx.byName(pin.qbCustomer);
    if (picked) sources.qb = 'your rule';
  }
  if (!picked) {
    const fromInv = [...new Set((loc.invoice_customer_ids || []).map(String))].map(id => idx.byId.get(id)).filter(Boolean);
    const good = fromInv.filter(c => {
      // an invoice on the building itself doesn't speak for a tenant row (and vice versa)
      const p = parseQbName(c.DisplayName);
      if (row.tenant_key && p.isAddress && !p.tenant && String(c.Id) !== String(qbBuilding?.Id || '')) return false;
      return ok(c);
    });
    if (good.length === 1) { picked = good[0]; sources.qb = 'past invoices'; }
    else if (good.length > 1) conflicts.push({ field: 'qb', why: 'past invoices sit on different QuickBooks customers', choices: good.map(c => ({ value: String(c.Id), label: idx.path(c) })) });
  }
  if (!picked && !conflicts.length) {
    const all = [...idx.byId.values()];
    const hits = all.filter(c => {
      const p = parseQbName(c.DisplayName);
      if (row.tenant_key) {
        const underB = qbBuilding && String(c.ParentRef?.value || '') === String(qbBuilding.Id);
        return (underB || canonicalBuilding(p.building) === bk) && p.tenant && tenantsMatch(p.tenant, row.tenant);
      }
      return qbBuilding ? String(c.Id) === String(qbBuilding.Id) : (p.isAddress && !p.tenant && canonicalBuilding(p.building) === bk);
    }).filter(ok);
    if (hits.length === 1) { picked = hits[0]; sources.qb = 'your QuickBooks customer list'; }
    else if (hits.length > 1) conflicts.push({ field: 'qb', why: 'more than one QuickBooks customer fits', choices: hits.map(c => ({ value: String(c.Id), label: idx.path(c) })) });
  }
  if (picked) { row.qb_customer_id = String(picked.Id); row.qb_path = idx.path(picked); }

  // Where a new tenant would go (the building customer), for the "new tenant under building X" answer.
  const bCust = qbBuilding || [...idx.byId.values()].find(c => { const p = parseQbName(c.DisplayName); return p.isAddress && !p.tenant && canonicalBuilding(p.building) === bk && (!expectRoot || String(idx.root(c)?.Id) === String(expectRoot.Id)); }) || null;
  row.building_qb_id = bCust ? String(bCust.Id) : '';
  row.building_qb_path = bCust ? idx.path(bCust) : '';

  const blanks = [!row.bill_name && 'who pays', !row.bill_addr && 'mailing address', !row.qb_customer_id && 'QuickBooks spot', !row.called_in && 'who called it in'].filter(Boolean);
  row.status = !blanks.length && !conflicts.length ? 'confirmed' : 'open';
  return { row, conflicts, sources, notes, blanks };
}

// ---------- FLAGS (never acted on — he says what to merge) ----------
// For the buildings in play: same building+tenant twice in QuickBooks, tenants with no building above them, buildings with no company above them.
export function qbFlags(customers, buildingKeys) {
  const idx = qbIndex(customers), keys = new Set(buildingKeys), flags = [], seen = new Map();
  for (const c of customers) {
    const p = parseQbName(c.DisplayName);
    if (!p.isAddress) continue;
    const bk = canonicalBuilding(p.building);
    if (!keys.has(bk)) continue;
    const k = bk + '|' + tenantKey(p.tenant);
    if (seen.has(k)) flags.push({ kind: 'duplicate', text: `Duplicate: "${idx.path(seen.get(k))}" and "${idx.path(c)}"` });
    else seen.set(k, c);
    const parent = c.ParentRef?.value ? idx.byId.get(String(c.ParentRef.value)) : null;
    if (p.tenant && !parent) flags.push({ kind: 'loose-tenant', text: `Loose tenant (no building above it): "${c.DisplayName}"` });
    if (!p.tenant && !parent) flags.push({ kind: 'no-parent', text: `Building with no company above it: "${c.DisplayName}"` });
  }
  return flags;
}

// QuickBooks name for a new tenant customer — his rule: "Address - Tenant Name" under the building.
export const newTenantName = (address, tenant) => `${splitAddress(address).street || clean(address)} - ${clean(tenant)}`;

// EVERY QUICKBOOKS CUSTOMER FOR THIS TENANT AT THIS BUILDING (10/15/26, his rule: never make a customer that already exists).
// Matched by building + tenant however the name is written, wherever it sits in QuickBooks. Active customers only.
export function findTenantCustomers(customers, address, city, tenant) {
  const bk = canonicalBuilding(address, city);
  if (!bk || !tenantKey(tenant)) return [];
  return customers.filter(c => c.Active !== false).filter(c => {
    const p = parseQbName(c.DisplayName);
    return p.isAddress && p.tenant && canonicalBuilding(p.building) === bk && tenantsMatch(p.tenant, tenant);
  });
}
