// THE BID, inside its job file. A bid starts at the customer: customer → property → new job file, tag BID.
// It is not a ticket. Nothing is a ticket until Awarded. Its sheets live in this job file's drawers.
import { esc, call, doAndProve, fail, ask, toast } from './ui.js';
import { money, bidState, sortBids, shortDateYY } from './money.js';

// Template structure carried over from the old bid app (structure only — no estimates, no saved bids yet).
export const BID_CATS = [
  ['ss', 'Standing Seam', ['ceelok|Cee-Lok', 'teelok|Tee-Lok', 'other|Snap-lock']],
  ['trades', 'Metal & Nail Base', []],
  ['tpo', 'TPO — New construction', []],
  ['tpo-tearoff', 'TPO — Tear off', ['ma|Mechanically attached', 'rhino|Rhinobond']],
  ['epdm', 'EPDM', []],
  ['pvc', 'PVC', []],
  ['mod', 'Modified', []],
];

// STEP 2 — one layer at a time. Pick the system, then only that system's pills.
export const SYSTEMS = [
  { cat: 'ss', label: 'Standing Seam', groups: [
    { grp: 'Panel', one: true, opts: ['Cee-Lok', 'Tee-Lok', 'Snap-lock'] },
    { grp: 'Construction', one: true, opts: ['Tear-off', 'New construction'] },
    { grp: 'Under it', opts: ['Ice & water shield', 'Nail base'] } ] },
  { cat: 'tpo', label: 'TPO', groups: [
    { grp: 'How it holds down', one: true, opts: ['Mechanically attached', 'Rhinobond', 'Fully adhered'] },
    { grp: 'Construction', one: true, opts: ['Tear-off', 'New construction'] },
    { grp: 'Under it', opts: ['ISO', 'Cover board', 'Nail base'] } ] },
  { cat: 'epdm', label: 'EPDM', groups: [
    { grp: 'Construction', one: true, opts: ['Tear-off', 'New construction'] },
    { grp: 'Under it', opts: ['ISO', 'Cover board'] } ] },
  { cat: 'pvc', label: 'PVC', groups: [
    { grp: 'How it holds down', one: true, opts: ['Mechanically attached', 'Fully adhered'] },
    { grp: 'Construction', one: true, opts: ['Tear-off', 'New construction'] },
    { grp: 'Under it', opts: ['ISO', 'Cover board'] } ] },
  { cat: 'mod', label: 'Modified', groups: [
    { grp: 'Construction', one: true, opts: ['Tear-off', 'New construction'] },
    { grp: 'Under it', opts: ['ISO', 'Cover board'] } ] },
  { cat: 'trades', label: 'Metal & Nail Base', groups: [
    { grp: 'Pieces', opts: ['Nail base', 'Gutters & downspouts', 'Fascia', 'Coping', 'Gravel stop'] } ] },
];
const sysLabel = cat => (SYSTEMS.find(s => s.cat === cat) || { label: cat }).label;

const catName = k => (BID_CATS.find(c => c[0] === k) || [, ''])[1];
const sysName = (k, s) => ((BID_CATS.find(c => c[0] === k) || [, , []])[2].find(x => x.split('|')[0] === s) || '|').split('|')[1];

// The bid card inside the job file — step 1 is already done when you get here; this is step 2 and the money.
export async function renderBid(jobId, mount) {
  const L = await call(`/w/job/${jobId}`);
  const j = L.job, sys = L.bidSystems || [], opts = L.bidOptions || [];
  const st = bidState(j, new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10));
  const priced = Number(j.bid_amount) > 0;
  const picked = cat => sys.some(s => s.cat === cat);
  const has = (cat, grp, name) => opts.some(o => o.cat === cat && o.grp === grp && o.name === name);

  // Only the systems on this roof, and under each one only its own pills.
  const layers = SYSTEMS.filter(s => picked(s.cat)).map(s => `<div class="bidlayer">
      <div class="bidlayerhead"><b>${esc(s.label)}</b> <button class="lb drop" data-cat="${s.cat}">take it off</button></div>
      ${s.groups.map(g => `<div class="ps">${esc(g.grp)}</div>
        <div class="btnrow tplrow">${g.opts.map(o => `<button class="lb opt ${has(s.cat, g.grp, o) ? 'on' : ''}" data-cat="${s.cat}" data-grp="${esc(g.grp)}" data-name="${esc(o)}" data-one="${g.one ? 1 : 0}">${esc(o)}</button>`).join('')}</div>`).join('')}
    </div>`).join('');

  mount.innerHTML = `<div class="card">
    <h2>Bid</h2>
    <p class="help">A bid is not a ticket. Nothing goes on the schedule, in a ledger or into QuickBooks until you press Awarded${j.awarded_at ? ` — awarded ${shortDateYY(j.awarded_at)}` : ''}.</p>
    ${j.awarded_at ? `<div class="btnrow"><a class="jcpill" href="#/job/${j.awarded_job_id}">The ticket it made ›</a></div>` : `
    <h3>What it is</h3>
    <p class="help">Pick the system first. Only that system's pills show under it.</p>
    <div class="btnrow tplrow">${SYSTEMS.map(s => `<button class="lb tpl ${picked(s.cat) ? 'on' : ''}" data-cat="${s.cat}">${picked(s.cat) ? '' : '+ '}${esc(s.label)}</button>`).join('')}</div>
    ${layers}
    <h3 style="margin-top:16px">Money and the date</h3>
    <div class="btnrow">
      <label>Due date <input id="bDue" type="date" value="${j.bid_due || ''}"></label>
      <label>Price <input id="bAmt" type="number" step="0.01" min="0" style="width:130px" value="${j.bid_amount != null ? esc(j.bid_amount) : ''}"></label>
      <button class="small ghost" id="bSave">Save</button>
    </div>
    <p class="help ${['late', 'today'].includes(st.level) ? 'redtxt' : ['tomorrow', 'soon'].includes(st.level) ? 'ambertxt' : ''}">${esc(st.say)} — reminders show on the Bids page 3 days out and 1 day out.</p>
    ${priced ? `<div class="btnrow">
      ${j.bid_sent_at ? '' : '<button class="small ghost" id="bSent">I sent it</button>'}
      <button id="bAward">Awarded — make the ticket</button>
    </div>` : '<p class="help">Put a price on it and the "I sent it" and "Awarded" buttons show up.</p>'}
    ${j.bid_said ? `<p class="help">From the email: "${esc(j.bid_said)}"</p>` : ''}
    `}</div>`;

  const again = () => renderBid(jobId, mount);
  const run = async fn => { try { await fn(); again(); } catch (e) { fail(e); } };
  const q = s => mount.querySelector(s);
  const put = (body, check, msg) => doAndProve(`/w/bids/${jobId}`, { method: 'PUT', body }, `/w/job/${jobId}`, check, msg);

  if (q('#bSave')) q('#bSave').onclick = () => {
    const bid_due = q('#bDue').value || null, bid_amount = q('#bAmt').value || null;
    run(() => put({ bid_due, bid_amount }, bk => String(bk.job.bid_due || '') === String(bid_due || '') && String(bk.job.bid_amount == null ? '' : Number(bk.job.bid_amount)) === String(bid_amount ? Number(bid_amount) : ''), 'Saved — read back and it matches'));
  };
  if (q('#bSent')) q('#bSent').onclick = () => {
    if (!confirm('Mark it sent? It gets filed with the customer and never chased again.')) return;
    run(() => doAndProve(`/w/bids/${jobId}/sent`, { method: 'POST', body: { value: true } }, `/w/job/${jobId}`,
      bk => !!bk.job.bid_sent_at, 'Sent — filed with the customer (read back and it matches)'));
  };
  mount.querySelectorAll('.tpl').forEach(b => b.onclick = () => {
    const cat = b.dataset.cat;
    if (picked(cat)) return;
    run(() => doAndProve(`/w/bids/${jobId}/system`, { method: 'POST', body: { cat, system: '' } }, `/w/job/${jobId}`,
      bk => (bk.bidSystems || []).some(s => s.cat === cat), `${sysLabel(cat)} on the bid (read back and it matches)`));
  });
  mount.querySelectorAll('.drop').forEach(b => b.onclick = () => {
    const cat = b.dataset.cat;
    run(() => doAndProve(`/w/bids/${jobId}/system`, { method: 'POST', body: { cat, system: '', remove: true } }, `/w/job/${jobId}`,
      bk => !(bk.bidSystems || []).some(s => s.cat === cat), `${sysLabel(cat)} taken off (read back and it matches)`));
  });
  mount.querySelectorAll('.opt').forEach(b => b.onclick = () => {
    const { cat, grp, name } = b.dataset, one = b.dataset.one === '1', on = b.classList.contains('on');
    run(() => doAndProve(`/w/bid-option/${jobId}`, { method: 'POST', body: { cat, grp, name, one: one && !on, remove: on } }, `/w/job/${jobId}`,
      bk => (bk.bidOptions || []).some(o => o.cat === cat && o.grp === grp && o.name === name) === !on, on ? `${name} off` : `${name} on`));
  });
  if (q('#bAward')) q('#bAward').onclick = () => {
    const tag = (ask(`Awarded: ${j.address} — ${j.title}\n\nWhat is the ticket?\nJC = job cost (draws)\nUC = mini job cost\nR = repair\n\nType JC, UC or R:`, 'JC') || '').trim().toUpperCase();
    if (!tag) return;
    const contract = ask('Contract amount — what the draws bill off', j.bid_amount != null ? String(j.bid_amount) : ''); if (contract === null) return;
    run(async () => {
      const out = await call(`/w/bids/${jobId}/awarded`, { method: 'POST', body: { tag, contract } });
      const made = await call(`/w/job/${out.job_id}`);
      if (made.job.tag !== tag) throw new Error('That did not stick — the read-back does not show the ticket. Nothing was assumed.');
      toast(`Ticket made: ${tag} — ${j.title}${contract ? ' · contract ' + money(Number(contract)) : ''}. Its ledger is open.`);
      location.hash = `#/job/${out.job_id}`;
    });
  };
}
