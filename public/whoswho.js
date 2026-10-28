// WHO'S WHO — THE LOCKED CUSTOMER MAP (10/11/26). One screen, one company at a time, tap Confirm or Fix.
// Lives under Customers (no new tab). The app pre-fills every row it can from what's already in the app; only blank or
// disagreeing rows are shown. Confirmed rows are locked — only his tap changes them.
// The popup: any ticket the app stopped on (no confirmed row) is asked here, one at a time, before anything goes to QuickBooks.
import { esc, call, toast, crumbs, $app } from './ui.js';

const blank = '<span style="color:var(--bad);font-weight:700">blank</span>';
const lines = s => esc(s || '').replace(/\n/g, '<br>');
const where = r => `${esc(r.building)}${r.city ? ', ' + esc(r.city) : ''}${r.tenant ? ' — <b>' + esc(r.tenant) + '</b>' : ' — whole building'}`;
// Show the existing QuickBooks path as stacked lines inside one choice.
function customerChoiceLines(label) {
  const path = String(label || '').split(' › ').map(s => s.trim()).filter(Boolean);
  const leaf = path.pop() || '';
  const parts = leaf.split(/\s+-\s+/);
  const lines = [...path, ...parts].filter(Boolean);
  return lines.map(line => `<span style="display:block">${esc(line)}</span>`).join('');
}

let pick = null;   // company shown

export async function whosWhoPage() {
  crumbs([['Customers', '#/'], ["Who's Who"]]);
  $app().innerHTML = '<div class="card mute">Building the map from the app and QuickBooks…</div>';
  const d = await call('/w/whoswho');
  let asks;
  try { ({ asks = [] } = await call('/w/whoswho/ask')); }
  catch (e) {
    $app().innerHTML = `<div class="card err">Unable to load jobs needing an answer: ${esc(e.message)} <button id="ww-retry">Retry</button></div>`;
    document.getElementById('ww-retry').onclick = () => whosWhoPage();
    return;
  }
  const byCo = new Map();
  for (const r of d.rows) { const k = r.customer_id || 0; if (!byCo.has(k)) byCo.set(k, { id: k, name: r.customer_name || '(no company)', rows: [] }); byCo.get(k).rows.push(r); }
  const cos = [...byCo.values()].map(c => ({ ...c, open: c.rows.filter(r => r.status !== 'confirmed') }));
  const todo = cos.filter(c => c.open.length);
  if (!pick || !byCo.has(pick)) pick = (todo[0] || cos[0] || {}).id;
  const co = byCo.get(pick);
  const meta = (d.companies || {})[pick] || { tree: [], flags: [] };
  const conf = d.rows.filter(r => r.status === 'confirmed').length;
  $app().innerHTML = `
    <h1>Customer setup</h1>
    <div class="card">
      <h2>Jobs needing an answer (${asks.length})</h2>
      ${asks.length ? asks.map(a => `<div class="row"><span>${esc(a.ticket)}</span><button data-review="${esc(a.job_id)}">Review</button></div>`).join('') : '<p class="help">No jobs waiting for a QuickBooks match.</p>'}
    </div>
    <p class="sub">${conf} of ${d.rows.length} confirmed · ${todo.length ? `${todo.length} compan${todo.length === 1 ? 'y' : 'ies'} to finish` : 'saved customer matches confirmed'}</p>
    <div class="btnrow" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      ${cos.map(c => `<button class="${c.id === pick ? '' : 'ghost'}" data-co="${c.id}">${esc(c.name)} ${c.open.length ? `<span style="color:var(--bad)">· ${c.open.length}</span>` : '✓'}</button>`).join('')}
    </div>
    ${co ? companyCard(co, cos.find(c => c.id === pick), meta) : '<div class="card empty">Nothing outstanding — nothing to map.</div>'}
    <div class="card">
      <h2>Check it against QuickBooks</h2>
      <div class="actions" style="display:flex;gap:8px;flex-wrap:wrap"><button class="ghost" id="ww-test">Check QuickBooks</button><button class="ghost" id="ww-re">Re-check from the app</button><button id="ww-fix">Fix the 8 loose tenants in QuickBooks</button><button id="ww-pay">Re-apply Burrito Bar $3,000 payment to #4363</button></div>
      <div id="ww-out"></div>
    </div>`;
  document.querySelectorAll('[data-co]').forEach(b => b.onclick = () => { pick = Number(b.dataset.co); whosWhoPage(); });
  document.querySelectorAll('[data-review]').forEach(b => b.onclick = () => whosWhoPopup({ force: true, jobId: b.dataset.review }));
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
  document.getElementById('ww-pay').onclick = async ev => {
    ev.target.disabled = true; const out = document.getElementById('ww-out'); out.innerHTML = '<div class="mute">Working in QuickBooks…</div>';
    try { const r = await call('/w/whoswho/fix-payment', { method: 'POST' }); out.innerHTML = r.lines.map(l => `<div class="row"><span>${esc(l)}</span></div>`).join(''); }
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
export async function whosWhoPopup({ force = false, jobId = null } = {}) {
  if (showing) return;
  let later = false; try { later = sessionStorage.getItem('ww-later') === '1'; } catch { /* no storage — ask every time */ }
  if (later && !force) return;
  showing = true;
  let asks;
  try { asks = (await call('/w/whoswho/ask')).asks || []; }
  catch (e) { showing = false; if (force) toast(`Unable to load this job: ${e.message}`, false); return; }
  if (!asks.length) { showing = false; return; }
  const a = jobId == null ? asks[0] : asks.find(a => String(a.job_id) === String(jobId));
  if (!a) { showing = false; return; }
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:50;display:flex;align-items:center;justify-content:center;padding:16px';
  box.innerHTML = `<div class="card" style="max-width:560px;width:100%;max-height:85vh;overflow:auto">
    <div style="display:flex;flex-direction:column;gap:8px">
      ${a.choices.map((c, i) => `<button class="${i ? 'ghost' : ''}" data-qb="${esc(c.qb_customer_id)}" style="text-align:left">${customerChoiceLines(c.label)}</button>`).join('')}
      ${a.new_under ? `<button class="ghost" data-new="${esc(a.new_under.id)}" style="text-align:left">New tenant "${esc(a.tenant)}" under ${esc(a.new_under.label)}</button>` : ''}
      ${a.tree.length ? `<label>Choose another<select id="ww-pick"><option value="">Choose a customer…</option>${a.tree.map(c => `<option value="${esc(c.id)}">${esc(c.path)}</option>`).join('')}</select></label><button id="ww-save" disabled>Confirm selection</button>` : '<p class="help">No other customers loaded. Your job will stay in Customer setup until it is matched.</p>'}
      <button class="ghost" id="ww-later" style="align-self:flex-end">Decide later</button>
      <p class="help">Decide later keeps this job in Customers → Customer setup. It does not move the job or create a customer.</p>
    </div><div class="err" id="ww-err"></div></div>`;
  document.body.appendChild(box);
  const close = () => { box.remove(); showing = false; };
  const answer = async body => {
    box.querySelectorAll('button,select').forEach(x => x.disabled = true);
    try {
      const r = await call('/w/whoswho/answer', { method: 'POST', body: { job_id: a.job_id, ...body } });
      if (!r.matches) throw new Error('Saved, but the ticket does not read back on that row — nothing assumed.');
      close();
      if (location.hash === '#/whoswho') {
        try { await whosWhoPage(); } catch { toast('Customer saved. Reopen Customer setup to refresh.', false); }
      }
      await whosWhoLine();
      if (r.notSent?.length) {
        // Keep partial failures visible; a saved match does not mean every QuickBooks write succeeded.
        const notice = document.createElement('div'); notice.className = 'card err'; notice.setAttribute('role', 'alert');
        notice.textContent = `Customer saved. Still waiting for QuickBooks: ${r.notSent.join('; ')}`;
        $app().prepend(notice);
        toast('Customer saved. Some QuickBooks entries still need attention.', false);
      } else toast(`Customer saved: ${r.row.qb_path}`);
      whosWhoPopup();
    } catch (e) {
      box.querySelector('#ww-err').textContent = e.message;
      box.querySelectorAll('button,select').forEach(x => x.disabled = false);
      const save = box.querySelector('#ww-save'); if (save) save.disabled = !box.querySelector('#ww-pick').value;
    }
  };
  box.querySelectorAll('[data-qb]').forEach(b => b.onclick = () => answer({ qb_customer_id: b.dataset.qb }));
  box.querySelectorAll('[data-new]').forEach(b => b.onclick = () => answer({ new_tenant_under: b.dataset.new }));
  const sel = box.querySelector('#ww-pick'), save = box.querySelector('#ww-save');
  if (sel && save) {
    sel.onchange = () => { save.disabled = !sel.value; };
    save.onclick = () => sel.value && answer({ qb_customer_id: sel.value });
  }
  box.querySelector('#ww-later').onclick = () => { try { sessionStorage.setItem('ww-later', '1'); } catch { /* fine */ } close(); whosWhoLine(); };
}

// One line on the Customers page: how many rows still need him.
export async function whosWhoLine() {
  const el = document.getElementById('ww-line'); if (!el) return;
  try {
    const d = await call('/w/whoswho');
    const { asks = [] } = await call('/w/whoswho/ask');
    const open = d.rows.filter(r => r.status !== 'confirmed').length;
    const parts = [asks.length && `${asks.length} job${asks.length === 1 ? '' : 's'} need an answer`, open && `${open} saved match${open === 1 ? '' : 'es'} to confirm`].filter(Boolean);
    el.innerHTML = `<a href="#/whoswho" class="pill" style="text-decoration:none">Customer setup — ${parts.length ? `<span style="color:var(--bad)">${parts.join(' · ')}</span>` : 'no pending matches ✓'}</a>`;
  } catch {
    el.innerHTML = '<a href="#/whoswho" class="pill">Customer setup — unable to check; open to retry</a>';
  }
}
