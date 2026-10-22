// Shared screen helpers for the step-2 pages.
import { placeholderDays, shortDate, ticketName } from './money.js';
import { CHUNK_BYTES } from './rules.js';
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = sel => document.querySelector(sel);
export const $app = () => document.getElementById('app');

export function toast(msg, ok = true) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = ok ? 'ok' : 'bad';
  clearTimeout(t._h); t._h = setTimeout(() => (t.className = ''), ok ? 3000 : 8000);
}
export async function call(path, opts = {}) {
  const r = await fetch(path, { headers: { 'content-type': 'application/json' }, ...opts,
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body });
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  if (!r.ok) throw new Error(data?.error || `Error ${r.status}`);
  return data;
}
// SAVE IS NEVER BLOCKED. ANYWHERE IN THIS APP. EVER. (locked 9/20/26)
// He gets information as it comes in, not all at once. Whatever is filled in gets saved, and what is
// still missing is written down — a note under the save, never a wall in front of it.
export const stillMissing = out => { const m = (out && out.missing) || []; return m.length ? ' · still missing: ' + m.join('; ') : ''; };
// Do it, then read it back in a SEPARATE request and check it stuck. Only then say saved.
export async function doAndProve(path, opts, readPath, check, okMsg = 'Saved — read back and it matches') {
  const result = await call(path, opts);
  const back = await call(readPath);
  if (!check(back, result)) throw new Error('That did not stick — the read-back does not show it. Nothing was assumed.');
  toast(okMsg + stillMissing(result));      // saved, and whatever is still missing said right after it
  return { result, back };
}
// UPLOAD ONE FILE IN PIECES — BUILT ONCE (10/22/26): job files, company pins, supply PDFs and sub W-9s all use this.
// owner = where it files ({ job_id, drawer } / { customer_id } / { supply_invoice_id } / { sub_id }). Each page still proves it by its own read-back.
export async function uploadFile(file, owner, prog, fallbackType = 'application/octet-stream') {
  const meta = await call('/api/files', { method: 'POST', body: { ...owner, name: file.name, content_type: file.type || fallbackType, size_bytes: file.size } });
  for (let n = 0; n < meta.chunks; n++) {
    if (prog) prog.textContent = `${file.name}: piece ${n + 1} of ${meta.chunks}`;
    const r = await fetch(`/api/files/${meta.id}/chunk/${n}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: file.slice(n * CHUNK_BYTES, (n + 1) * CHUNK_BYTES) });
    if (!r.ok) { let why = ''; try { why = (await r.json()).error || ''; } catch {} throw new Error(why || `${file.name}: piece ${n + 1} failed`); }
  }
  await call(`/api/files/${meta.id}/finish`, { method: 'POST' });
  return meta;
}
// COMPLETE — BUILT ONCE (10/22/26): the ticket's Complete button, the Schedule's Complete pill and Talk all use this —
// same HEADS UP, same proof, and it says so out loud if the invoice did NOT get written.
export function doneWarnings(L) {
  const j = L.job, day = d => String(d).slice(0, 10), today = day(L.today);
  const covered = (L.invoices || []).filter(i => i.kind === 'real').map(i => i.covers_through || i.inv_date).filter(Boolean).sort().pop();
  const after = d => !covered || d > day(covered);
  const seated = new Set((L.invoices || []).filter(i => i.kind === 'placeholder' && Number(i.amount) > 0).flatMap(placeholderDays));
  const green = new Set((L.green_dates || []).map(day));
  const logged = [...new Set((L.shares || []).map(s => day(s.work_date)))];
  const notGreen = logged.filter(d => !green.has(d) && after(d));
  const notSeated = logged.filter(d => !seated.has(d) && after(d));
  const planned = j.scheduled_date && day(j.scheduled_date) >= today ? day(j.scheduled_date) : '';
  const later = logged.filter(d => d > today);
  return [notGreen.length ? `${notGreen.map(shortDate).join(', ')} ${notGreen.length === 1 ? 'is' : 'are'} logged but not green yet` : '',
    !notGreen.length && notSeated.length ? `${notSeated.map(shortDate).join(', ')} ${notSeated.length === 1 ? 'has' : 'have'} no placeholder yet` : '',
    planned ? `it's still on the schedule for ${shortDate(planned)}` : '',
    later.length ? `work is already logged on ${later.map(shortDate).join(', ')}` : ''].filter(Boolean);
}
// ask = false only when he already said yes somewhere else (Talk). Returns null if he cancels.
export async function completeTicket(jobId, { ask = true } = {}) {
  const read = `/w/job/${jobId}`;
  const L = await call(read);
  if (ask) {
    const warn = doneWarnings(L);
    if (!confirm(`Are you sure you're done with ${ticketName(L.job)}?\n\nIt moves to Invoicing and the invoice gets written now.${warn.length ? `\n\nHEADS UP: ${warn.join('; ')}. Anything worked after this goes on a SECOND invoice. Cancel, green the day first, then press Complete.` : ''}`)) return null;
  }
  const { result } = await doAndProve(`${read}/done`, { method: 'POST', body: {} }, read, b => !!b.job.done_at, `${ticketName(L.job)} → Complete`);
  const billErr = result.billed && result.billed.error;
  if (billErr) toast(`Complete — but the invoice was NOT written: ${billErr}`, false);
  return result;
}
// GREEN A DAY — BUILT ONCE (10/22/26): Schedule and Crew both use this, so both show what QuickBooks did or didn't do.
export async function setGreen(workDate, green, weekUrl, label = workDate) {
  const { result } = await doAndProve('/w/green', { method: 'PUT', body: { work_date: workDate, green } }, weekUrl,
    back => back.green.some(g => g.work_date === workDate && g.green) === green,
    green ? `${label} is green — good to bill (read back and it matches)` : `${label} taken back — not accounted for (read back and it matches)`);
  const done = result.qb_done || [], errs = result.qb_errors || [];
  if (errs.length) toast(`QuickBooks: ${[...done, ...errs.map(e => 'NOT DONE — ' + e)].join(' · ')}`, false);
  else if (done.length) toast(`${green ? 'Placeholders in QuickBooks' : 'Placeholders deleted from QuickBooks'}: ${done.join(' · ')}`);
  return result;
}
export function crumbs(list) {
  document.getElementById('crumbs').innerHTML = list.map(([t, h]) => h ? `<a href="${h}">${esc(t)}</a>` : esc(t)).join(' › ');
}
export function setTab(name) {
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === name));
}
export const fail = e => toast(e.message, false);
// Drag rows up and down. Grab the ⠿ handle. A row only moves inside its own grouping (data-group). onDrop gets the new order of data-crew ids.
export function dragRows(table, onDrop) {
  let dragging = null;
  table.querySelectorAll('tr[data-crew]').forEach(tr => {
    const handle = tr.querySelector('.grip');
    if (!handle) return;
    handle.onmousedown = () => { tr.draggable = true; };
    tr.ondragstart = e => { dragging = tr; tr.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; };
    tr.ondragend = () => {
      tr.draggable = false; tr.classList.remove('dragging');
      if (dragging) { dragging = null; onDrop([...table.querySelectorAll('tr[data-crew]')].map(r => Number(r.dataset.crew))); }
    };
    tr.ondragover = e => {
      if (!dragging || dragging === tr || dragging.dataset.group !== tr.dataset.group) return;
      e.preventDefault();
      const box = tr.getBoundingClientRect();
      tr.parentNode.insertBefore(dragging, e.clientY < box.top + box.height / 2 ? tr : tr.nextSibling);
    };
  });
}
export async function saveCrewOrder(ids) {
  await call('/w/crew-order', { method: 'PUT', body: { ids } });
  const back = await call('/w/crew');
  const got = back.map(c => c.id).filter(id => ids.includes(id));
  if (got.join(',') !== ids.join(',')) throw new Error('The order did not stick — the read-back shows a different order.');
  toast('Order saved — read back and it matches');
}
export const ask = (q, def = '') => { const v = window.prompt(q, def); return v === null ? null : v.trim(); };

// ---------- DELETE, everywhere ----------
// A button with data-del="type" data-id="id". It asks the server what's attached, shows it, asks first,
// deletes, then reads it back in a separate request to prove it's gone. Deleting never touches QuickBooks.
export { qbPdfLink } from './qbpdf.js';
export const delBtn = (type, id, word = 'Delete') => `<button type="button" class="small ghost delbtn" data-del="${type}" data-id="${esc(id)}" title="${word}">${word === 'Delete' ? '🗑 Delete' : esc(word)}</button>`;
export const delX = (type, id) => `<button type="button" class="delx" data-del="${type}" data-id="${esc(id)}" title="Delete" aria-label="Delete">🗑</button>`;
export async function askDelete(type, id) {
  const path = `/d/${type}/${encodeURIComponent(id)}`;
  const p = await call(path);
  if (p.blocked.length) {
    const msg = `Can't delete this ${p.what}:\n${p.label}\n\n• ${p.blocked.join('\n• ')}`;
    if (p.table_job) {
      if (!confirm(`${msg}\n\nA ticket with money on it can only be tabled. Table it instead?`)) return false;
      const why = ask('Why are you tabling it? (so it still makes sense in three months)');
      if (why === null) return false;   // no reason typed yet is not a reason to stop
      await doAndProve(`/w/job/${p.table_job}/table`, { method: 'POST', body: { why } }, `/w/job/${p.table_job}`, b => !!b.job.tabled_at, 'Tabled — read back and it matches');
      return true;
    }
    alert(p.what === 'customer' || p.what === 'property' ? `${msg}\n\nA ticket with money on it can't be deleted — open it and table it instead.` : msg); return false;
  }
  const list = p.attached.length ? `\n\nThis ${p.what} has:\n• ${p.attached.join('\n• ')}\n\nAll of that goes with it.` : `\n\nNothing else is attached to it.`;
  if (!confirm(`Delete this ${p.what}?\n${p.label}${list}\n\nThis can't be undone. Nothing in QuickBooks is touched.`)) return false;
  const r = await call(path, { method: 'DELETE' });
  const gone = await fetch(path).then(x => x.status === 404);
  if (!gone) throw new Error('That did not delete — the read-back still finds it. Nothing was assumed.');
  toast(`Deleted ${r.deleted} — read back and it's gone`);
  return r;
}
// One listener for every page: click any [data-del] button.
if (!window._smsDel) {
  window._smsDel = true;
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    b.disabled = true;
    try {
      const r = await askDelete(b.dataset.del, b.dataset.id);
      if (r) {
        const here = location.hash || '#/';
        const onIt = r.back && ((b.dataset.del === 'customer' && here.startsWith('#/customer/' + b.dataset.id)) || (b.dataset.del === 'property' && here.startsWith('#/property/' + b.dataset.id))
          || (b.dataset.del === 'job' && (here.startsWith('#/job/' + b.dataset.id) || here.startsWith('#/jobcost/' + b.dataset.id))) || (b.dataset.del === 'supply' && here.startsWith('#/supply/' + b.dataset.id)));
        if (onIt) location.hash = r.back; else window.dispatchEvent(new HashChangeEvent('hashchange'));
      }
    } catch (err) { fail(err); } finally { b.disabled = false; }
  }, true);
}
