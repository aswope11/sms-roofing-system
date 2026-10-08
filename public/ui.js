// Shared screen helpers for the step-2 pages.
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
