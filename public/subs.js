// SUBS — rebuilt from the old board's Subs page (index.html renderSubs / subLedgerHTML / subProfileHTML).
// A crew sub like Tenorio Roofing is paid off his pay ledger, not off invoices:
// "From 'their invoices' all the way down, delete everything. The only number I care about is how much I owe him for that exact week."
import { esc, $app, call, doAndProve, crumbs, setTab, fail, toast, delX } from './ui.js';
import { money, round2, shortDate } from './money.js';
import { CHUNK_BYTES } from './rules.js';
import { subPayLedger } from './payledger.js';

let setupOpen = false;

export async function subsPage(id) {
  setTab('subs');
  if (id) return subPage(Number(id));
  crumbs([['Subs']]);
  const subs = await call('/w/subs');
  const owed = s => round2(Number(s.inv_total) - Number(s.paid_total));
  const grand = round2(subs.reduce((a, s) => a + (s.crew_id ? 0 : owed(s)), 0));
  $app().innerHTML = `<div class="oldsub">
    <div class="tadd" id="subAdd" style="grid-template-columns:1fr 220px auto">
      <input id="subNew" placeholder="Subcontractor — company name">
      <input id="subNewWho" placeholder="Who's the contact?">
      <button id="subAddBtn">Add</button>
    </div>
    <p class="invhint" style="margin:0 0 12px">Everybody who works for you and sends you a bill.
      Open one for their contact info, their 1099 and W-9, and every invoice they've sent.</p>
    ${subs.length ? `<div class="ledwrap"><table class="suptbl">
      <thead><tr><th class="sh">Sub</th><th class="sc">Contact</th><th class="sc">Not paid</th><th class="sc">Open</th><th class="sc">Paid to date</th></tr></thead>
      <tbody>${subs.map(s => { const o = s.crew_id ? 0 : owed(s); const paid = Number(s.paid_total);
        return `<tr class="suprow" data-id="${s.id}">
          <td class="sh"><b>${esc(s.name)}</b>${s.trade ? `<small>${esc(s.trade)}</small>` : ''}</td>
          <td class="sc">${esc(s.contact || '—')}</td>
          <td class="sc tot ${o ? '' : 'zero'}">${o ? money(o) : '—'}</td>
          <td class="sc ${s.crew_id || !o ? 'zero' : ''}">${!s.crew_id && o ? s.inv_count : '—'}</td>
          <td class="sc ${paid ? '' : 'zero'}">${paid ? money(paid) : '—'}</td></tr>`; }).join('')}</tbody>
      <tfoot><tr><td class="sh"><b>Owed to subs</b></td><td class="sc"></td><td class="sc tot big">${money(grand)}</td><td class="sc"></td><td class="sc"></td></tr></tfoot>
    </table></div>` : '<div class="empty">No subs yet. Add one above.</div>'}
  </div>`;
  $app().querySelectorAll('.suprow').forEach(tr => tr.onclick = () => { location.hash = `#/subs/${tr.dataset.id}`; });
  const add = async () => {
    const name = document.getElementById('subNew').value.trim(), contact = document.getElementById('subNewWho').value.trim();
    try { await doAndProve('/w/subs', { method: 'POST', body: { name, contact } }, '/w/subs', (list, r) => list.some(x => x.id === r.id && x.name === name), `${name} added — read back and it matches`); subsPage(); }
    catch (e) { fail(e); }
  };
  document.getElementById('subAddBtn').onclick = add;
  ['subNew', 'subNewWho'].forEach(i => document.getElementById(i).onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
}

async function subPage(id) {
  const s = await call(`/w/subs/${id}`);
  crumbs([['Subs', '#/subs'], [s.name]]);
  const open = s.invoices.filter(i => Math.abs(Number(i.amount) - Number(i.paid_sum)) > 0.004);
  const paid = s.invoices.filter(i => !open.includes(i));
  const owed = round2(open.reduce((a, i) => a + Number(i.amount) - Number(i.paid_sum), 0));
  const f = (k, label, ph, type) => `<div class="field"><label>${label}</label>
    <input data-f="${k}" type="${type || 'text'}" value="${esc(s[k] || '')}" placeholder="${ph}"></div>`;
  const top = `<button class="jpback" id="back">‹ All subs</button>
    <div class="ledhead"><h1>${esc(s.name)}</h1>
      <div class="help" style="margin:2px 0 0">${esc(s.contact || 'no contact on file')}${s.phone ? ' · ' + esc(s.phone) : ''}${s.email ? ' · ' + esc(s.email) : ''}</div>
      <div class="ledtot">${money(owed)}<span>owed · ${open.length} invoice${open.length === 1 ? '' : 's'}</span></div>
    </div>`;
  const profile = `<details class="subsetup"${setupOpen ? ' open' : ''}>
    <summary>Contact info, W-9 and 1099${s.contact ? ` — ${esc(s.contact)}` : ''}${s.phone ? ` · ${esc(s.phone)}` : ''}${s.files.length ? ` · ${s.files.length} on file` : ' · <b style="color:var(--warn)">no W-9 yet</b>'}</summary>
    <div class="subsetupbody">
      <div class="field-row">${f('contact', 'Contact name', 'e.g. Francisco Morales')}${f('trade', 'Trade', 'e.g. gutters')}</div>
      <div class="field-row">${f('phone', 'Phone', '(000) 000-0000', 'tel')}${f('email', 'Email', 'name@company.com', 'email')}</div>
      ${f('addr', 'Address', 'Street, city, state, zip')}
      <div class="field"><label>Notes</label><textarea data-f="about" placeholder="Anything you need to remember about them">${esc(s.about || '')}</textarea></div>
      ${s.files.map(x => `<div class="row"><a href="/api/files/${x.id}" target="_blank" style="color:var(--ink)">${esc(x.name)}</a>${delX('file', x.id)}</div>`).join('')}
      <div class="drop" id="w9drop"><b>Drop the W-9, the 1099, the COI</b><br>Drop files here — or click to pick<input type="file" hidden multiple></div><div class="mute" id="w9prog"></div>
    </div>
  </details>`;
  const invRow = (i, isPaid) => `<div class="row"><span><a href="#/supply/${i.id}" style="color:var(--ink)"><b>${esc(i.number)}</b>${i.po ? ` · PO ${esc(i.po)}` : ''}</a>
      <div class="mute">${shortDate(i.inv_date)}</div></span><b>${money(i.amount)}</b>${isPaid ? ' <span class="greentxt">Paid</span>' : ''}</div>`;
  const body = s.crew_id
    ? `${profile}<div id="ledgerMount"></div>`
    : `${profile}
      <div class="card" style="margin-top:14px"><h4 style="margin:0 0 8px">Their invoices</h4>
        <p class="help">Their invoices are entered on the Supply Houses tab under the name "${esc(s.name)}" — every line on a job, the paper on it. They show here.</p>
        <div class="btnrow"><a href="#/supply/new"><button class="ghost small">＋ Add an invoice</button></a></div></div>
      <div class="apmohead" style="margin-top:18px;display:flex"><b>NOT PAID</b><span style="flex:1"></span><b>${money(owed)}</b></div>
      ${open.length ? open.map(i => invRow(i, false)).join('') : `<div class="mute" style="padding:8px 0">Nothing open — they're square.</div>`}
      ${paid.length ? `<details style="margin-top:16px"><summary>Paid ${paid.length} — ${money(paid.reduce((a, i) => a + Number(i.amount), 0))}</summary>${paid.map(i => invRow(i, true)).join('')}</details>` : ''}`;
  $app().innerHTML = `<div class="oldsub">${top}<div class="jpbody">${body}</div></div>`;

  document.getElementById('back').onclick = () => { location.hash = '#/subs'; };
  $app().querySelector('details.subsetup').ontoggle = e => { setupOpen = e.target.open; };
  $app().querySelectorAll('[data-f]').forEach(inp => inp.onchange = async () => {
    const field = inp.dataset.f, value = inp.value;
    try { await doAndProve(`/w/subs/${id}/field`, { method: 'PUT', body: { field, value } }, `/w/subs/${id}`, b => (b[field] || '') === value); subPage(id); }
    catch (e) { fail(e); }
  });
  if (s.crew_id) subPayLedger(document.getElementById('ledgerMount'), s.crew_id, s.name).catch(fail);
  const drop = document.getElementById('w9drop'), input = drop.querySelector('input'), prog = document.getElementById('w9prog');
  const up = async files => {
    try {
      for (const file of files) {
        const meta = await call('/api/files', { method: 'POST', body: { sub_id: id, name: file.name, content_type: file.type || 'application/octet-stream', size_bytes: file.size } });
        for (let n = 0; n < meta.chunks; n++) {
          prog.textContent = `${file.name}: piece ${n + 1} of ${meta.chunks}`;
          const r = await fetch(`/api/files/${meta.id}/chunk/${n}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: file.slice(n * CHUNK_BYTES, (n + 1) * CHUNK_BYTES) });
          if (!r.ok) throw new Error(`Piece ${n + 1} failed`);
        }
        await call(`/api/files/${meta.id}/finish`, { method: 'POST' });
        const back = await call(`/w/subs/${id}`);
        if (!back.files.some(x => x.id === meta.id)) throw new Error(`${file.name} did not stick`);
      }
      toast('Filed — read back and it matches'); subPage(id);
    } catch (e) { prog.textContent = ''; fail(e); }
  };
  drop.onclick = () => input.click();
  input.onchange = () => up([...input.files]);
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); up([...e.dataTransfer.files]); };
}
