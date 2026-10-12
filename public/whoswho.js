// WHO'S WHO — THE LOCKED CUSTOMER MAP (10/11/26). One screen, one company at a time, tap Confirm or Fix.
// Lives under Customers (no new tab). The app pre-fills every row it can from what's already in the app; only blank or
// disagreeing rows are shown. Confirmed rows are locked — only his tap changes them.
// The popup: any ticket the app stopped on (no confirmed row) is asked here, one at a time, before anything goes to QuickBooks.
import { esc, call, toast, crumbs, $app } from './ui.js';

const blank = '<span style="color:var(--bad);font-weight:700">blank</span>';
const lines = s => esc(s || '').replace(/\n/g, '<br>');
const where = r => `${esc(r.building)}${r.city ? ', ' + esc(r.city) : ''}${r.tenant ? ' — <b>' + esc(r.tenant) + '</b>' : ' — whole building'}`;
let pick = null;   // company shown

export async function whosWhoPage() {
  crumbs([['Customers', '#/'], ["Who's Who"]]);
  $app().innerHTML = '<div class="card mute">Building the map from the app and QuickBooks…</div>';
  const d = await call('/w/whoswho');
  const byCo = new Map();
  for (const r of d.rows) { const k = r.customer_id || 0; if (!byCo.has(k)) byCo.set(k, { id: k, name: r.customer_name || '(no company)', rows: [] }); byCo.get(k).rows.push(r); }
  const cos = [...byCo.values()].map(c => ({ ...c, open: c.rows.filter(r => r.status !== 'confirmed') }));
  const todo = cos.filter(c => c.open.length);
  if (!pick || !byCo.has(pick)) pick = (todo[0] || cos[0] || {}).id;
  const co = byCo.get(pick);
  const meta = (d.companies || {})[pick] || { tree: [], flags: [] };
  const conf = d.rows.filter(r => r.status === 'confirmed').length;
  $app().innerHTML = `
    <h1>Who's Who</h1>
    <p class="sub">${conf} of ${d.rows.length} confirmed · ${todo.length ? `${todo.length} compan${todo.length === 1 ? 'y' : 'ies'} to finish` : 'every customer with open work is confirmed'}</p>
    <div class="btnrow" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      ${cos.map(c => `<button class="${c.id === pick ? '' : 'ghost'}" data-co="${c.id}">${esc(c.name)} ${c.open.length ? `<span style="color:var(--bad)">· ${c.open.length}</span>` : '✓'}</button>`).join('')}
    </div>
    ${co ? companyCard(co, cos.find(c => c.id === pick), meta) : '<div class="card empty">Nothing outstanding — nothing to map.</div>'}
    <div class="card">
      <h2>Check it against QuickBooks</h2>
      <p class="help">Read-only. For each company: one open ticket is run through the map (where it would land), and every open invoice is read back from QuickBooks and compared to its row. Nothing is written.</p>
      <div class="actions" style="display:flex;gap:8px;flex-wrap:wrap"><button class="ghost" id="ww-test">Check QuickBooks</button><button class="ghost" id="ww-re">Re-check from the app</button><button id="ww-fix">Fix the 8 loose tenants in QuickBooks</button></div>
      <p class="help">Fix button: Burrito Bar, Reformed Pilates, 4Korners, Elegant Dentistry (→ Four Corners), Bellezza, Scrambler, Lake Highlands Cafe, MKOA go under their building. Old tenant moves under the building if QuickBooks allows; if not, a tenant under the building gets only the open invoices. Nothing is deleted.</p>
      <div id="ww-out"></div>
    </div>`;
  document.querySelectorAll('[data-co]').forEach(b => b.onclick = () => { pick = Number(b.dataset.co); whosWhoPage(); });
  wireRows(meta);
  document.getElementById('ww-re').onclick = async ev => {
    ev.target.disabled = true;
    try { const r = await call('/w/whoswho/prefill', { method: 'POST' }); toast(`Re-checked ${r.locations} spots — confirmed rows left alone`); whosWhoPage(); }
    catch (e) { toast(e.message, false); ev.target.disabled = false; }
  };
  document.getElementById('ww-fix').onclick = async ev => {
    ev.target.disabled = true; const out = document.getElementById('ww-out'); out.innerHTML = '<div class="mute">Fixing in QuickBooks — about a minute…</div>';
    try { const r = await call('/w/whoswho/fix-qb', { method: 'POST' }); out.innerHTML = r.lines.map(l => `<div class="row"><span>${esc(l)}</span></div>`).join(''); toast('QuickBooks fix ran — every step listed below'); }
    catch (e) { out.innerHTML = `<div class="err">${esc(e.message)}</div>`; ev.target.disabled = false; }
  };
  document.getElementById('ww-test').onclick = async ev => {
    ev.target.disabled = true; const out = document.getElementById('ww-out'); out.innerHTML = '<div class="mute">Reading QuickBooks…</div>';
    try { out.innerHTML = testTable(await call('/w/whoswho/test', { method: 'POST' })); }
    catch (e) { out.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
    ev.target.disabled = false;
  };
}

function companyCard(co, c2, meta) {
  const open = c2.open, done = co.rows.filter(r => r.status === 'confirmed');
  return `
    <div class="card">
      <h2>${esc(co.name)}</h2>
      ${meta.root ? `<p class="help">QuickBooks company: ${esc(meta.root)}</p>` : '<p class="help" style="color:var(--bad)">No company customer found in QuickBooks for this name.</p>'}
      ${(meta.flags || []).length ? `<details open><summary class="mute" style="cursor:pointer">⚠ ${meta.flags.length} QuickBooks flag${meta.flags.length === 1 ? '' : 's'} — nothing is merged or deleted until you say so</summary>
        ${meta.flags.map(f => `<div class="row"><span>${esc(f.text)}</span></div>`).join('')}</details>` : ''}
      ${open.length ? open.map(r => rowCard(r, meta)).join('') : '<div class="empty">Every row for this company is confirmed.</div>'}
      ${done.length ? `<details style="margin-top:12px"><summary class="mute" style="cursor:pointer">Confirmed ${done.length} — locked</summary>${done.map(r => rowCard(r, meta, true)).join('')}</details>` : ''}
    </div>`;
}

function rowCard(r, meta, locked = false) {
  const qbConflict = (r.conflicts || []).find(c => c.field === 'qb');
  const qbCell = qbConflict ? `<div style="color:var(--bad)">${esc(qbConflict.why)} — tap the right one:</div>${qbConflict.choices.map(c => `<label style="flex-direction:row;gap:8px;align-items:center"><input type="radio" name="qb-${r.id}" value="${esc(c.value)}"> ${esc(c.label)}</label>`).join('')}`
    : (r.qb_path ? esc(r.qb_path) : blank);
  return `
    <div class="row" style="display:block" data-row="${r.id}">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><div>${where(r)}</div>
        <div style="display:flex;gap:8px">${locked ? '<span class="mute">🔒</span>' : `<button data-confirm="${r.id}"${qbConflict || !r.qb_customer_id ? ' disabled title="Pick the QuickBooks spot with Fix first"' : ''}>Confirm</button>`}<button class="ghost" data-fix="${r.id}">Fix</button></div></div>
      <div class="kv" style="display:grid;grid-template-columns:150px 1fr;gap:4px 12px;margin-top:6px">
        <span class="mute">Who pays</span><span>${r.bill_name ? lines(r.bill_name + (r.bill_addr ? '\n' + r.bill_addr : '')) : blank}${r.bill_name && !r.bill_addr ? '<br>mailing address ' + blank : ''}</span>
        <span class="mute">Called it in</span><span>${r.called_in ? esc(r.called_in) : blank}</span>
        <span class="mute">QuickBooks</span><span>${qbCell}</span>
        ${(r.notes || []).length ? `<span class="mute">Left out</span><span class="mute">${r.notes.map(esc).join('<br>')}</span>` : ''}
      </div>
      <form data-form="${r.id}" class="grid" style="display:none;margin-top:8px">
        <label>Who pays (Bill To name)<input name="bill_name" value="${esc(r.bill_name)}"></label>
        <label>Called it in<input name="called_in" value="${esc(r.called_in)}"></label>
        <label class="full">Mailing address<textarea name="bill_addr">${esc(r.bill_addr)}</textarea></label>
        <label class="full">QuickBooks spot<select name="qb">
          <option value="">${r.qb_path ? 'keep: ' + esc(r.qb_path) : '— pick one —'}</option>
          ${r.building_qb_id && r.tenant ? `<option value="new:${esc(r.building_qb_id)}">New tenant "${esc(r.tenant)}" under ${esc(r.building_qb_path)}</option>` : ''}
          ${(meta.tree || []).map(c => `<option value="${esc(c.id)}">${esc(c.path)}</option>`).join('')}
        </select></label>
        <div class="actions"><button>Save — it's locked after this</button></div>
      </form>
    </div>`;
}

function wireRows() {
  const save = async (id, b) => {
    const back = await call(`/w/whoswho/${id}`, { method: 'PUT', body: b });
    if (back.status !== 'confirmed') throw new Error('That did not stick — the row reads back unconfirmed.');
    toast('Confirmed and locked — read back from the database');
    whosWhoPage();
  };
  document.querySelectorAll('[data-confirm]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    try { await save(b.dataset.confirm, {}); } catch (e) { toast(e.message, false); b.disabled = false; }
  });
  document.querySelectorAll('[data-row] input[type=radio]').forEach(inp => inp.onchange = async () => {
    const id = inp.closest('[data-row]').dataset.row;
    try { await save(id, { qb_customer_id: inp.value }); } catch (e) { toast(e.message, false); }
  });
  document.querySelectorAll('[data-fix]').forEach(b => b.onclick = () => {
    const f = document.querySelector(`[data-form="${b.dataset.fix}"]`); f.style.display = f.style.display === 'none' ? 'grid' : 'none';
  });
  document.querySelectorAll('[data-form]').forEach(f => f.onsubmit = async ev => {
    ev.preventDefault(); const btn = ev.submitter; btn.disabled = true;
    const fd = Object.fromEntries(new FormData(f).entries());
    const b = { bill_name: fd.bill_name, bill_addr: fd.bill_addr, called_in: fd.called_in };
    if (fd.qb.startsWith('new:')) b.new_tenant_under = fd.qb.slice(4); else if (fd.qb) b.qb_customer_id = fd.qb;
    try { await save(f.dataset.form, b); } catch (e) { toast(e.message, false); btn.disabled = false; }
  });
}

function testTable(out) {
  const cos = Object.values(out);
  if (!cos.length) return '<div class="empty">Nothing outstanding.</div>';
  const mark = ok => ok ? '<span style="color:var(--ok)">✓</span>' : '<span style="color:var(--bad)">✗</span>';
  return cos.map(c => `
    <div style="margin-top:12px"><b>${esc(c.customer)}</b>
      <div class="row">${mark(c.ticket?.ok)} <span>Test ticket ${esc(c.ticket?.ticket || '')} → ${c.ticket?.ok ? esc(c.ticket.lands) : esc(c.ticket?.why || '')}</span></div>
      ${c.invoices.map(i => `<div class="row">${mark(i.spot_ok && i.bill_ok)} <span>#${esc(i.number)} (${esc(i.kind)}) — in QuickBooks: ${esc(i.in_qb)}${i.spot_ok ? '' : ` · map says: ${esc(i.map)}`}${i.bill_ok ? '' : ` · Bill To in QuickBooks: "${esc(i.bill_in_qb)}"`}</span></div>`).join('')}
    </div>`).join('');
}

// ---------------- THE POPUP ----------------
// One ticket at a time. Pick an existing customer, or "new tenant under building X". Never creates anything on its own.
let showing = false;
export async function whosWhoPopup() {
  if (showing) return;
  let later = false; try { later = sessionStorage.getItem('ww-later') === '1'; } catch { /* no storage — ask every time */ }
  if (later) return;
  let asks;
  try { asks = (await call('/w/whoswho/ask')).asks || []; } catch { return; }
  if (!asks.length) return;
  showing = true;
  const a = asks[0];
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:50;display:flex;align-items:center;justify-content:center;padding:16px';
  box.innerHTML = `<div class="card" style="max-width:560px;width:100%;max-height:85vh;overflow:auto">
    <h2 style="margin-top:0">Who's Who — whose is this?</h2>
    <p><b>${esc(a.ticket)}</b><br>${esc(a.address)}${a.city ? ', ' + esc(a.city) : ''}${a.tenant ? ' — ' + esc(a.tenant) : ''}<br><span class="mute">${esc(a.customer || '')} · ${esc(a.why)}</span></p>
    <p class="help">Nothing goes to QuickBooks for this ticket until you answer.${asks.length > 1 ? ` (${asks.length - 1} more after this)` : ''}</p>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${a.choices.map(c => `<button class="ghost" data-qb="${esc(c.qb_customer_id)}" style="text-align:left">${esc(c.label)}</button>`).join('')}
      ${a.new_under ? `<button class="ghost" data-new="${esc(a.new_under.id)}" style="text-align:left">New tenant "${esc(a.tenant)}" under ${esc(a.new_under.label)}</button>` : ''}
      ${a.tree.length ? `<select id="ww-pick"><option value="">Another customer in QuickBooks…</option>${a.tree.map(c => `<option value="${esc(c.id)}">${esc(c.path)}</option>`).join('')}</select>` : ''}
      <button class="ghost" id="ww-later" style="align-self:flex-end">Later</button>
    </div><div class="err" id="ww-err"></div></div>`;
  document.body.appendChild(box);
  const close = () => { box.remove(); showing = false; };
  const answer = async body => {
    box.querySelectorAll('button,select').forEach(x => x.disabled = true);
    try {
      const r = await call('/w/whoswho/answer', { method: 'POST', body: { job_id: a.job_id, ...body } });
      if (!r.matches) throw new Error('Saved, but the ticket does not read back on that row — nothing assumed.');
      toast(`Locked: ${r.row.qb_path}`); close(); whosWhoPopup();
    } catch (e) { document.getElementById('ww-err').textContent = e.message; box.querySelectorAll('button,select').forEach(x => x.disabled = false); }
  };
  box.querySelectorAll('[data-qb]').forEach(b => b.onclick = () => answer({ qb_customer_id: b.dataset.qb }));
  box.querySelectorAll('[data-new]').forEach(b => b.onclick = () => answer({ new_tenant_under: b.dataset.new }));
  const sel = box.querySelector('#ww-pick'); if (sel) sel.onchange = () => sel.value && answer({ qb_customer_id: sel.value });
  box.querySelector('#ww-later').onclick = () => { try { sessionStorage.setItem('ww-later', '1'); } catch { /* fine */ } close(); };
}

// One line on the Customers page: how many rows still need him.
export async function whosWhoLine() {
  try {
    const el = document.getElementById('ww-line'); if (!el) return;
    const d = await call('/w/whoswho');
    const open = d.rows.filter(r => r.status !== 'confirmed').length;
    el.innerHTML = `<a href="#/whoswho" class="pill" style="text-decoration:none">Who's Who — ${open ? `<span style="color:var(--bad)">${open} to confirm</span>` : 'all confirmed ✓'}</a>`;
  } catch { /* the line just stays empty */ }
}
