import { TAGS, DRAWERS, CHUNK_BYTES } from './rules.js';
import { setTab, delBtn, delX } from './ui.js';
import { schedulePage } from './schedule.js';
import { invoicingPage } from './invoicing.js';
import { renderBid } from './bid.js';
import { bidsPage, templatesPage } from './bids.js';
import { mailStrip } from './mail.js';
import { arPage } from './ar.js';
import { supplyPage, supplyInvoicePage, supplyHousePage } from './supply.js';
import { crewPage } from './crew.js';
import { subsPage } from './subs.js';
import { renderTicket } from './ledger.js';
import { jobCostPage } from './jobcost.js';
import { shopPage } from './shop.js';
import { talkButton } from './talk.js';
import { todoButton } from './todo.js';
import { ticketName, isWork } from './money.js';

const $app = document.getElementById('app');
const $crumbs = document.getElementById('crumbs');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TAG_NAMES = { BID: 'Bid', R: 'Repair', CO: 'Change order', UC: 'Unit cost', JC: 'Job contract' };

function toast(msg, ok = true) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = ok ? 'ok' : 'bad';
  clearTimeout(t._h); t._h = setTimeout(() => (t.className = ''), ok ? 3000 : 7000);
}
async function api(path, opts = {}) {
  const r = await fetch('/api/' + path, { headers: { 'content-type': 'application/json' }, ...opts });
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  if (!r.ok) throw Object.assign(new Error(data?.error || `Error ${r.status}`), { data, status: r.status });
  return data;
}
// Save, then read it back in a separate request and compare. Only then say "Saved".
async function saveAndProve(path, method, body, readPath, fields) {
  const saved = await api(path, { method, body: JSON.stringify(body) });
  const back = await api(readPath(saved));
  for (const f of fields) {
    if (String(back[f] ?? '').trim() !== String(body[f] ?? '').trim()) throw new Error(`Save did not stick: "${f}" reads back different`);
  }
  // SAVE IS NEVER BLOCKED (9/20/26) — it saved; anything still missing is said out loud, not refused.
  const miss = saved.missing || [];
  toast(miss.length ? `Saved — read back and matches. Still missing: ${miss.join(', ')}` : 'Saved — read back from the database and matches');
  return back;
}
function formData(form) { return Object.fromEntries(new FormData(form).entries()); }
function crumbs(list) { $crumbs.innerHTML = list.map(([t, h]) => h ? `<a href="${h}">${esc(t)}</a>` : esc(t)).join(' › '); }
function fail(e, el) { if (el) el.textContent = e.message; toast(e.message, false); }

// ---------------- HOME ----------------
async function home() {
  crumbs([['Customers']]);
  const list = await api('customers');
  $app.innerHTML = `
    <details class="card newcust"><summary><span class="pill">+ New customer</span></summary>
      <form id="f">
        <label>Customer name<input name="name" placeholder="fill it in when you know it"></label>
        <label>Phone<input name="phone"></label>
        <label>Email<input name="email" type="email"></label>
        <label class="full">Notes<textarea name="notes"></textarea></label>
        <div class="actions"><button>Save customer</button></div>
        <div class="err full" id="e"></div>
      </form>
    </details>
    <h1>Customers</h1>
    <div class="card">
      ${list.length ? list.map(c => `<div class="row"><a href="#/customer/${c.id}">${esc(c.name)}</a><span class="mute">${c.property_count} ${c.property_count === 1 ? 'property' : 'properties'} ${delX('customer', c.id)}</span></div>`).join('')
        : '<div class="empty">No customers yet.</div>'}
    </div>`;
  // 10/8/26 his order: the Mail / Import problems box is OFF the customer page. He never uses it here.
  document.getElementById('f').onsubmit = async ev => {
    ev.preventDefault(); const btn = ev.submitter; btn.disabled = true;
    try {
      const b = formData(ev.target);
      const c = await saveAndProve('customers', 'POST', b, s => `customers/${s.id}`, ['name', 'phone', 'email', 'notes']);
      location.hash = `#/customer/${c.id}`;
    } catch (e) { fail(e, document.getElementById('e')); btn.disabled = false; }
  };
}

// ---------------- CUSTOMER ----------------
async function customer(id) {
  const c = await api(`customers/${id}`);
  crumbs([['Customers', '#/'], [c.name]]);
  $app.innerHTML = `
    <h1>${esc(c.name)} ${delBtn('customer', c.id)}</h1>
    <p class="sub">${esc([c.phone, c.email].filter(Boolean).join(' · ')) || '&nbsp;'}</p>
    <div class="card">
      <h2>Properties</h2>
      ${(() => {
        // Bids only (no real job yet) sit in the "Bids" pill at the bottom; the moment a job is made there it moves up.
        const propRow = p => `<details class="propdd" data-pid="${p.id}"><summary class="row" style="cursor:pointer"><span style="font-weight:600">${p.bill_name ? esc(p.bill_name) + ' - ' : ''}${esc(p.address)}${p.city ? ', ' + esc(p.city) : ''}</span><span class="mute">${p.tenant ? esc(p.tenant) + ' · ' : ''}${p.job_count} job file${p.job_count === 1 ? '' : 's'} ${delX('property', p.id)}</span></summary><div class="propbody" style="padding-left:26px"><div class="mute">Loading…</div></div></details>`;
        const bidOnly = c.properties.filter(p => p.job_count > 0 && p.work_count === 0);
        const rest = c.properties.filter(p => !bidOnly.includes(p));
        if (!c.properties.length) return '<div class="empty">No properties yet.</div>';
        return rest.map(propRow).join('') + (bidOnly.length ? `<details class="bidspill" open><summary><span class="pill">Bids ${bidOnly.length}</span></summary>${bidOnly.map(propRow).join('')}</details>` : '');
      })()}
    </div>
    <div class="card">
      <h2>Pinned</h2>
      ${(c.files || []).map(f => `<div class="row"><a href="/api/files/${f.id}" target="_blank">${esc(f.name)}</a><span class="mute">${new Date(f.created_at).toLocaleDateString()}</span></div>`).join('') || '<div class="empty">Nothing pinned.</div>'}
      <div class="drop" id="pindrop" style="margin-top:10px">Drop a file to pin it to ${esc(c.name)} — or click to pick<input type="file" hidden multiple></div><div class="mute" id="pinprog"></div>
    </div>
    <div class="card">
      <h2>New property</h2>
      <p class="help">The roof's street address. The app checks every address already on file first, so the same building never gets two records.</p>
      <form id="f">
        <label>Address<input name="address" placeholder="fill it in when you know it"></label>
        <label>City<input name="city"></label>
        <label>Tenant<input name="tenant"></label>
        <label>GC / owner<input name="gc"></label>
        <label class="full">Notes<textarea name="notes"></textarea></label>
        <div class="actions"><button>Save property</button></div>
        <div class="err full" id="e"></div>
      </form>
    </div>
    <div class="card">
      <h2>Edit customer</h2>
      <form id="ec">
        <label>Customer name<input name="name" value="${esc(c.name)}"></label>
        <label>Phone<input name="phone" value="${esc(c.phone)}"></label>
        <label>Email<input name="email" value="${esc(c.email)}"></label>
        <label class="full">Notes<textarea name="notes">${esc(c.notes)}</textarea></label>
        <div class="actions"><button class="ghost">Save changes</button></div>
        <div class="err full" id="ee"></div>
      </form>
    </div>`;
  // DROPDOWNS ON THE CUSTOMER PAGE (10/5/26): click a property → it opens right here (no property page):
  // Overall property, then every tenant. Click one → its tickets drop down. Click a ticket → the ticket.
  document.querySelectorAll('details.propdd').forEach(dd => dd.addEventListener('toggle', async () => {
    if (!dd.open || dd.dataset.loaded) return;
    dd.dataset.loaded = '1';
    try { dd.querySelector('.propbody').innerHTML = tenantDrops(await api(`properties/${dd.dataset.pid}`)); }
    catch (e) { dd.dataset.loaded = ''; dd.querySelector('.propbody').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  }));
  document.getElementById('f').onsubmit = async ev => {
    ev.preventDefault(); const btn = ev.submitter; btn.disabled = true; const errEl = document.getElementById('e');
    try {
      const b = { ...formData(ev.target), customer_id: Number(id) };
      const p = await saveAndProve('properties', 'POST', b, s => `properties/${s.id}`, ['address', 'city', 'tenant', 'gc', 'notes']);
      location.hash = `#/property/${p.id}`;
    } catch (e) {
      if (e.status === 409 && e.data?.existing_id) errEl.innerHTML = `${esc(e.message)} <a href="#/property/${e.data.existing_id}">Open it</a>`;
      else fail(e, errEl);
      btn.disabled = false;
    }
  };
  document.getElementById('ec').onsubmit = async ev => {
    ev.preventDefault(); const btn = ev.submitter; btn.disabled = true;
    try { await saveAndProve(`customers/${id}`, 'PUT', formData(ev.target), () => `customers/${id}`, ['name', 'phone', 'email', 'notes']); route(); }
    catch (e) { fail(e, document.getElementById('ee')); btn.disabled = false; }
  };
  // Pinned on the company: same pieces-upload as job files, then read the company back to prove it stuck.
  const pin = document.getElementById('pindrop'), pinIn = pin.querySelector('input'), pinProg = document.getElementById('pinprog');
  const pinUp = async files => {
    try {
      for (const file of files) {
        const meta = await api('files', { method: 'POST', body: JSON.stringify({ customer_id: Number(id), name: file.name, content_type: file.type || 'application/octet-stream', size_bytes: file.size }) });
        for (let n = 0; n < meta.chunks; n++) {
          pinProg.textContent = `${file.name}: piece ${n + 1} of ${meta.chunks}`;
          const r = await fetch(`/api/files/${meta.id}/chunk/${n}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: file.slice(n * CHUNK_BYTES, (n + 1) * CHUNK_BYTES) });
          if (!r.ok) throw new Error(`Piece ${n + 1} failed`);
        }
        await api(`files/${meta.id}/finish`, { method: 'POST' });
        const back = await api(`customers/${id}`);
        if (!(back.files || []).some(x => x.id === meta.id)) throw new Error(`${file.name} did not stick`);
      }
      route();
    } catch (e) { pinProg.textContent = ''; fail(e, pinProg); }
  };
  pin.onclick = () => pinIn.click();
  pinIn.onchange = () => pinUp([...pinIn.files]);
  pin.ondragover = e => { e.preventDefault(); pin.classList.add('over'); };
  pin.ondragleave = () => pin.classList.remove('over');
  pin.ondrop = e => { e.preventDefault(); pin.classList.remove('over'); pinUp([...e.dataTransfer.files]); };
}

// ---------------- PROPERTY ----------------
async function property(id) {
  const p = await api(`properties/${id}`);
  crumbs([['Customers', '#/'], [p.customer_name, `#/customer/${p.customer_id}`], [p.address]]);
  $app.innerHTML = `
    <h1>${esc(p.address)}${p.city ? ', ' + esc(p.city) : ''} ${delBtn('property', p.id)}</h1>
    <p class="sub">${esc(p.customer_name)}</p>
    <div class="card kv">
      <div>Tenant</div><div>${esc(p.tenant) || '—'}</div>
      <div>GC / owner</div><div>${esc(p.gc) || '—'}</div>
      ${p.bill_name ? `<div>Invoice bill-to</div><div>${esc(p.bill_name)}<br>${esc(p.bill_addr).replace(/\n/g, '<br>')}</div>
      <div>Invoice tenant address</div><div>${esc(p.ship_addr || [p.address, p.city].filter(Boolean).join(', ')).replace(/\n/g, '<br>')}</div>` : ''}
      <div>Notes</div><div>${esc(p.notes) || '—'}</div>
    </div>
    <div class="card">
      <h2>Contract on this property</h2>
      <p class="help">The contract lives on the property. Left on the contract = the contract minus every invoice written against it on any ticket here. Change orders don't count against it. Billing only — it never shows on the schedule.</p>
      <form id="fc"><label>Contract amount<input name="amount" type="number" step="0.01" value="${p.contract_amount ?? ''}"></label>
        <div class="actions"><button class="ghost">Save contract</button></div></form>
    </div>
    <div class="card">
      <h2>Job files</h2>
      ${p.jobs.length ? jobFilesByTenant(p)
        : '<div class="empty">No job files yet.</div>'}
    </div>
    <div class="card">
      <h2>New job file</h2>
      <p class="help">One job file per roof scope. A bid that's lost keeps its file forever.</p>
      <form id="f">
        <label>Tag<select name="tag"><option value="">— not decided yet —</option>${TAGS.map(t => `<option value="${t}">${t} — ${TAG_NAMES[t]}</option>`).join('')}</select></label>
        <label>Job name<input name="title" placeholder="e.g. Main roof TPO re-roof"></label>
        ${insideSelect(jobTree(p.jobs), null)}
        <label class="full">Notes<textarea name="notes"></textarea></label>
        <div class="actions"><button>Save job file</button></div>
        <div class="err full" id="e"></div>
      </form>
    </div>
    <div class="card">
      <h2>Edit property</h2>
      <form id="ep">
        <label>Address<input name="address" value="${esc(p.address)}"></label>
        <label>City<input name="city" value="${esc(p.city)}"></label>
        <label>Tenant<input name="tenant" value="${esc(p.tenant)}"></label>
        <label>GC / owner<input name="gc" value="${esc(p.gc)}"></label>
        <label>Invoice bill-to (LLC name — top left of the invoice)<input name="bill_name" value="${esc(p.bill_name)}" placeholder="blank = invoice goes out as usual"></label>
        <label class="full">Invoice bill-to address<textarea name="bill_addr" style="min-height:50px">${esc(p.bill_addr)}</textarea></label>
        <label class="full">Invoice tenant address (right side — blank = the property address)<textarea name="ship_addr" style="min-height:50px">${esc(p.ship_addr)}</textarea></label>
        <label class="full">Notes<textarea name="notes">${esc(p.notes)}</textarea></label>
        <div class="actions"><button class="ghost">Save changes</button></div>
        <div class="err full" id="ee"></div>
      </form>
    </div>`;
  document.getElementById('f').onsubmit = async ev => {
    ev.preventDefault(); const btn = ev.submitter; btn.disabled = true;
    try {
      const b = { ...formData(ev.target), property_id: Number(id) };
      const j = await saveAndProve('jobs', 'POST', b, s => `jobs/${s.id}`, ['tag', 'title', 'notes', 'parent_job_id']);
      location.hash = `#/job/${j.id}`;
    } catch (e) { fail(e, document.getElementById('e')); btn.disabled = false; }
  };
  document.getElementById('fc').onsubmit = async ev => {
    ev.preventDefault(); const btn = ev.submitter; btn.disabled = true;
    const amount = new FormData(ev.target).get('amount');
    try {
      await fetch(`/w/contract/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount }) }).then(async r => { if (!r.ok) throw new Error((await r.json()).error); });
      const back = await api(`properties/${id}`);
      if ((back.contract_amount == null ? '' : Number(back.contract_amount)) !== (amount === '' ? '' : Number(amount))) throw new Error('Contract did not stick on read-back');
      toast('Contract saved — read back and it matches'); route();
    } catch (e) { fail(e); btn.disabled = false; }
  };
  document.getElementById('ep').onsubmit = async ev => {
    ev.preventDefault(); const btn = ev.submitter; btn.disabled = true;
    try { await saveAndProve(`properties/${id}`, 'PUT', { ...formData(ev.target), customer_id: p.customer_id }, () => `properties/${id}`, ['address', 'city', 'tenant', 'gc', 'notes', 'bill_name', 'bill_addr', 'ship_addr']); route(); }
    catch (e) { fail(e, document.getElementById('ee')); btn.disabled = false; }
  };
}

// TENANTS UNDER THE PROPERTY (10/5/26): property › tenant › ticket (6101 Windhaven › Bellezza Spa › Roof leak repair).
// The property's job files list shows one line per tenant. A tenant with one ticket opens that ticket;
// a tenant with more opens to show them. A ticket with no tenant (whole-property work, e.g. a roof inspection) sits right on the property, on its own line.
function jobFilesByTenant(p) {
  const row = ({ j, d }) => `<div class="row"${d ? ` style="padding-left:${d * 26}px"` : ''}><a href="#/job/${j.id}">${d ? '<span class="mute">↳ </span>' : ''}${j.tag ? `<span class="tag">${j.tag}</span>` : ''}${esc(j.title)}</a><span class="mute">${j.file_count} file${j.file_count === 1 ? '' : 's'} · ${new Date(j.created_at).toLocaleDateString()} ${delX('job', j.id)}</span></div>`;
  const byId = new Map(p.jobs.map(j => [j.id, j]));
  const tenantOf = (j, seen = new Set()) => {
    const own = String(j.tenant_name || '').trim();
    if (own) return own;
    const par = byId.get(j.parent_job_id);
    if (par && !seen.has(par.id)) { seen.add(j.id); return tenantOf(par, seen); }
    return String(p.tenant || '').trim();
  };
  const groups = new Map();
  for (const j of p.jobs) { const t = tenantOf(j); (groups.get(t) || groups.set(t, []).get(t)).push(j); }
  const names = [...groups.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b));
  return jobTree(groups.get('') || []).map(row).join('') + names.map(t => {
    const js = groups.get(t);
    if (js.length === 1) { const j = js[0]; return `<div class="row"><a href="#/job/${j.id}">${esc(t)}</a><span class="mute">${j.tag ? `<span class="tag">${j.tag}</span>` : ''}${esc(j.title)}</span></div>`; }
    return `<details><summary class="row" style="cursor:pointer"><a>${esc(t)}</a><span class="mute">${js.length} tickets</span></summary><div style="padding-left:26px">${jobTree(js).map(row).join('')}</div></details>`;
  }).join('');
}

// One dropdown for the whole property ("Overall property" — work with no tenant on the ticket), then one per tenant.
// A ticket's own tenant wins; a ticket inside another ticket takes that ticket's tenant; then the property's tenant.
function tenantDrops(p) {
  const byId = new Map(p.jobs.map(j => [j.id, j]));
  const tenantOf = (j, seen = new Set()) => {
    const own = String(j.tenant_name || '').trim();
    if (own) return own;
    const par = byId.get(j.parent_job_id);
    if (par && !seen.has(par.id)) { seen.add(j.id); return tenantOf(par, seen); }
    return String(p.tenant || '').trim();
  };
  const groups = new Map([['', []]]);
  for (const j of p.jobs) { const t = tenantOf(j); (groups.get(t) || groups.set(t, []).get(t)).push(j); }
  const names = ['', ...[...groups.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b))];
  // TICKET LINE (10/8/26, his drawing): "R - 10/8/26" — the tag and the day worked, nothing else.
  // Open it → the real invoice and the placeholder under it; click the ticket link to open the ticket.
  const invs = p.invoices || [];
  const mdy = d => { const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${Number(m)}/${Number(dd)}/${y.slice(2)}`; };
  const worked = j => { const ds = invs.filter(i => i.job_id === j.id).map(i => i.work_date || i.covers_through).filter(Boolean).map(d => String(d).slice(0, 10)).sort(); return ds[0] || (j.scheduled_date ? String(j.scheduled_date).slice(0, 10) : String(j.created_at).slice(0, 10)); };
  const kindName = k => k === 'real' ? 'Real' : k === 'placeholder' ? 'Placeholder' : 'Draw';
  const ticket = j => { const mine = invs.filter(i => i.job_id === j.id);
    return `<details><summary class="row" style="cursor:pointer"><span>${esc([j.tag, mdy(worked(j))].filter(Boolean).join(' - '))}</span><span class="mute">${mine.length} invoice${mine.length === 1 ? '' : 's'}</span></summary><div style="padding-left:26px"><div class="row"><a href="#/job/${j.id}">Open the ticket</a></div>${mine.map(i => `<div class="row"><span>Invoice #${esc(i.number || '—')}</span><span class="mute">${kindName(i.kind)}</span></div>`).join('') || '<div class="empty">No invoice yet.</div>'}</div></details>`; };
  return names.map(t => {
    const js = groups.get(t);
    return `<details><summary class="row" style="cursor:pointer"><span>${t ? esc(t) : 'Overall property'}</span><span class="mute">${js.length} ticket${js.length === 1 ? '' : 's'}</span></summary><div style="padding-left:26px">${js.length ? js.map(ticket).join('') : '<div class="empty">No tickets yet.</div>'}</div></details>`;
  }).join('');
}

// ---------------- JOB FILE ----------------
// JOB FILES INSIDE JOB FILES (10/1/26): a building holds tenants, a tenant holds its tickets
// (1721 John McCain: Building 1-4 › Vet Clinic › Roof Repair). parent_job_id is the link.
// Returns every job once, in tree order, with its depth. A loop or a missing parent just shows at the top.
function jobTree(jobs) {
  const ids = new Set(jobs.map(j => j.id)), kids = {}, seen = new Set(), out = [];
  for (const j of jobs) { const p = ids.has(j.parent_job_id) && j.parent_job_id !== j.id ? j.parent_job_id : 0; (kids[p] = kids[p] || []).push(j); }
  for (const k in kids) kids[k].sort((a, b) => String(a.title).localeCompare(String(b.title), undefined, { numeric: true }));
  const walk = (p, d) => (kids[p] || []).forEach(j => { if (seen.has(j.id)) return; seen.add(j.id); out.push({ j, d }); walk(j.id, d + 1); });
  walk(0, 0);
  for (const j of jobs) if (!seen.has(j.id)) { seen.add(j.id); out.push({ j, d: 0 }); }
  return out;
}
const insideSelect = (tree, cur) => `<label>Inside<select name="parent_job_id"><option value="">— right on the property —</option>${tree.map(({ j, d }) => `<option value="${j.id}" ${j.id === cur ? 'selected' : ''}>${'— '.repeat(d)}${esc(j.title)}</option>`).join('')}</select></label>`;
const kb = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

async function job(id) {
  const j = await api(`jobs/${id}`);
  const sibs = (await api(`properties/${j.property_id}`).catch(() => ({ jobs: [] }))).jobs || [];
  const byId = Object.fromEntries(sibs.map(x => [x.id, x]));
  const up = []; for (let p = byId[j.parent_job_id]; p && !up.includes(p) && p.id !== j.id; p = byId[p.parent_job_id]) up.unshift(p);
  const tree = jobTree(sibs), me = tree.findIndex(t => t.j.id === j.id);
  const mine = me < 0 ? [] : [tree[me].j.id, ...tree.slice(me + 1, (i => i < 0 ? tree.length : me + 1 + i)(tree.slice(me + 1).findIndex(t => t.d <= tree[me].d))).map(t => t.j.id)];
  const kids = tree.filter(t => t.j.parent_job_id === j.id && t.j.id !== j.id);
  crumbs([['Customers', '#/'], [j.customer_name, `#/customer/${j.customer_id}`], [j.address, `#/property/${j.property_id}`], ...up.map(p => [p.title, `#/job/${p.id}`]), [j.title]]);
  $app.innerHTML = `
    <h1>${esc(ticketName(j))} <button class="pencil" id="editJob" title="Edit job file" aria-label="Edit job file">✎</button> ${delBtn('job', j.id)}</h1>
    <div class="card" id="editBox" hidden>
      <h2>Edit job file</h2>
      <form id="ej">
        <label>Tag<select name="tag"><option value="" ${j.tag ? '' : 'selected'}>— not decided yet —</option>${TAGS.map(t => `<option value="${t}" ${t === j.tag ? 'selected' : ''}>${t} — ${TAG_NAMES[t]}</option>`).join('')}</select></label>
        <label>Job name<input name="title" value="${esc(j.title)}"></label>
        ${insideSelect(tree.filter(t => !mine.includes(t.j.id)), j.parent_job_id)}
        <label class="full">Notes<textarea name="notes">${esc(j.notes)}</textarea></label>
        <div class="actions"><button class="ghost">Save changes</button></div>
        <div class="err full" id="ee"></div>
      </form>
    </div>
    <p class="sub">${esc(j.address)}${j.city ? ', ' + esc(j.city) : ''} · ${esc(j.customer_name)}${j.tenant ? ' · Tenant: ' + esc(j.tenant) : ''}</p>
    ${isWork(j.tag) ? `<div class="btnrow"><a class="jcpill" href="#/jobcost/${j.id}">Job cost sheet ›</a></div>` : ''}
    ${kids.length ? `<div class="card"><h2>Inside ${esc(j.title)}</h2>${kids.map(({ j: k }) => `<div class="row"><a href="#/job/${k.id}">${k.tag ? `<span class="tag">${k.tag}</span>` : ''}${esc(k.title)}</a></div>`).join('')}</div>` : ''}
    <div id="ticketMount"></div>
    <div class="card">
      <h2>File cabinet</h2>
      <p class="help">Drop a file on a drawer or click it. Big files are cut into 4 MB pieces, every piece is checked, and the file only shows once all of it is saved.</p>
      <div class="grid2">
        ${DRAWERS.map(d => {
          const fs = j.files.filter(f => f.drawer === d);
          return `<div class="drawer card" style="margin:0">
            <h3>${d} <span class="mute">(${fs.length})</span></h3>
            ${fs.map(f => `<div class="row"><a href="/api/files/${f.id}" target="_blank">${esc(f.name)}</a><span class="mute">${kb(Number(f.size_bytes))} ${delX('file', f.id)}</span></div>`).join('')}
            <div class="drop" data-drawer="${d}">+ Add to ${d}<input type="file" multiple hidden></div>
            <div class="mute prog"></div>
          </div>`;
        }).join('')}
      </div>
    </div>
    </div>`;
  document.querySelectorAll('.drop').forEach(drop => {
    const input = drop.querySelector('input');
    const prog = drop.nextElementSibling;
    const go = files => uploadAll(id, drop.dataset.drawer, [...files], prog);
    drop.onclick = () => input.click();
    input.onchange = () => go(input.files);
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); go(e.dataTransfer.files); };
  });
  (j.tag === 'BID' ? renderBid(id, document.getElementById('ticketMount')) : renderTicket(id, document.getElementById('ticketMount'))).catch(e => { document.getElementById('ticketMount').innerHTML = `<div class="card err">${esc(e.message)}</div>`; });
  document.getElementById('editJob').onclick = () => { const b = document.getElementById('editBox'); b.hidden = !b.hidden; };
  document.getElementById('ej').onsubmit = async ev => {
    ev.preventDefault(); const btn = ev.submitter; btn.disabled = true;
    try { await saveAndProve(`jobs/${id}`, 'PUT', { ...formData(ev.target), property_id: j.property_id }, () => `jobs/${id}`, ['tag', 'title', 'notes', 'parent_job_id']); route(); }
    catch (e) { fail(e, document.getElementById('ee')); btn.disabled = false; }
  };
}

async function uploadAll(jobId, drawer, files, prog) {
  try {
    for (const file of files) {
      const meta = await api('files', { method: 'POST', body: JSON.stringify({ job_id: Number(jobId), drawer, name: file.name, content_type: file.type || 'application/octet-stream', size_bytes: file.size }) });
      for (let n = 0; n < meta.chunks; n++) {
        prog.textContent = `${file.name}: piece ${n + 1} of ${meta.chunks}`;
        const piece = file.slice(n * CHUNK_BYTES, (n + 1) * CHUNK_BYTES);
        const r = await fetch(`/api/files/${meta.id}/chunk/${n}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: piece });
        if (!r.ok) throw new Error((await r.json()).error || `Piece ${n + 1} failed`);
      }
      await api(`files/${meta.id}/finish`, { method: 'POST' });
      // Proof: read the job file back and make sure the file is listed at the right size.
      const back = await api(`jobs/${jobId}`);
      const found = back.files.find(f => f.id === meta.id && Number(f.size_bytes) === file.size);
      if (!found) throw new Error(`${file.name} did not stick — not in the job file on read-back`);
    }
    toast(`${files.length} file${files.length === 1 ? '' : 's'} saved to ${drawer} — read back and matches`);
    route();
  } catch (e) { prog.textContent = ''; fail(e, prog); }
}

// ---------------- SEARCH ----------------
async function search(q) {
  crumbs([['Customers', '#/'], ['Search']]);
  const r = await api('search?q=' + encodeURIComponent(q));
  $app.innerHTML = `
    <h1>Search: ${esc(q)}</h1>
    <div class="card"><h2>Customers</h2>${r.customers.map(c => `<div class="row"><a href="#/customer/${c.id}">${esc(c.name)}</a></div>`).join('') || '<div class="empty">None.</div>'}</div>
    <div class="card"><h2>Properties</h2>${r.properties.map(p => `<div class="row"><a href="#/property/${p.id}">${esc(p.address)}${p.city ? ', ' + esc(p.city) : ''}</a><span class="mute">${esc(p.customer_name)}</span></div>`).join('') || '<div class="empty">None.</div>'}</div>`;
}

// ---------------- ROUTER ----------------
async function route() {
  const [, page, id, sub] = location.hash.split('/');
  try {
    setTab(page === 'payroll' ? 'crew' : ['schedule', 'bids', 'invoicing', 'ar', 'supply', 'subs', 'crew', 'shop'].includes(page) ? page : 'customers');
    if (page === 'customer') await customer(id);
    else if (page === 'property') await property(id);
    else if (page === 'job') await job(id);
    else if (page === 'jobcost') await jobCostPage(id, sub);
    else if (page === 'search') await search(decodeURIComponent(id || ''));
    else if (page === 'schedule') await schedulePage();
    else if (page === 'bids' && id === 'templates') await templatesPage();
    else if (page === 'bids') await bidsPage();
    else if (page === 'invoicing') await invoicingPage();
    else if (page === 'ar') await arPage();
    else if (page === 'supply' && id === 'house') await supplyHousePage(decodeURIComponent((sub || '').split('?')[0]));
    else if (page === 'supply' && id) await supplyInvoicePage(id.split('?')[0]);
    else if (page === 'supply') await supplyPage();
    else if (page === 'subs') await subsPage(id);
    else if (page === 'crew' || page === 'payroll') await crewPage();
    else if (page === 'shop') await shopPage();
    else await home();
    window.scrollTo(0, 0);
  } catch (e) { $app.innerHTML = `<div class="card err">${esc(e.message)}</div>`; }
}
let st;
document.getElementById('search').oninput = e => {
  clearTimeout(st);
  const q = e.target.value.trim();
  st = setTimeout(() => { location.hash = q ? '#/search/' + encodeURIComponent(q) : '#/'; }, 300);
};
window.addEventListener('hashchange', route);
route();
talkButton();
todoButton();
// Saved emails (.eml) open in Gmail, not the computer's mail program (Outlook).
document.addEventListener('click', async e => {
  const a = e.target.closest('a[href^="/api/files/"]');
  if (!a || !/\.eml$/i.test(a.textContent.trim())) return;
  e.preventDefault();
  const w = window.open('about:blank', '_blank');
  try {
    const head = (await (await fetch(a.getAttribute('href'))).text()).split(/\r?\n\r?\n/)[0];
    const m = head.match(/^Message-ID:\s*<?([^>\r\n]+)>?/im);
    w.location = m ? 'https://mail.google.com/mail/?authuser=adam@smsroofingdfw.com#search/rfc822msgid%3A' + encodeURIComponent(m[1].trim()) : a.href;
  } catch { w.location = a.href; }
});
