// A SUB'S PAY LEDGER — one line per job per day, in the pay-to name. Brought back from the old app's Subs → Tenorio Roofing page.
// Copy puts the Zelle memo on the clipboard. Tap the dollar amount once it's sent → PAID. Tap the line to see whose day is in it.
import { esc, call, fail, toast } from './ui.js';
import { stopShares, subLedgerRows, splZelleMemo, payWeekStart, addDays, shortDate } from './money.js';

const splM = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });   // to the penny — Jovani is an LLC and this is his 1099 number (e.g. $855.50)
const fmtRange = ws => { const f = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); return `${f(ws)} – ${f(addDays(ws, 6))}`; };
const state = {};

export async function subPayLedger(mount, bossId, title) {
  const d = await call(`/w/pay-ledger?boss=${bossId}`);
  const st = (state[bossId] ||= { wk: payWeekStart(d.today), all: false });
  const jobs = Object.fromEntries(d.jobs.map(j => [j.id, j]));
  const all = subLedgerRows(stopShares(d));
  const we = addDays(st.wk, 6);
  const rows = st.all ? all : all.filter(r => r.work_date >= st.wk && r.work_date <= we);
  const isPaid = r => d.paid.some(p => p.work_date === r.work_date && p.job_id === r.job_id);
  // ACTUAL PAID (9/25): what he really sent for that line — sub page only. Blank = the men's days.
  const actualOf = r => { const a = (d.actuals || []).find(p => p.work_date === r.work_date && p.job_id === r.job_id); return a && a.actual != null ? Number(a.actual) : null; };
  const amt = r => actualOf(r) ?? r.total;
  let total = 0, owe = 0;
  const body = rows.map((r, i) => {
    const a = actualOf(r); total += r.total; const j = jobs[r.job_id]; const paid = isPaid(r); if (!paid) owe += r.total;   // GREEN NUMBERS NEVER CHANGE (10/5): green = the men's days. Actual paid is only what gets marked PAID.
    const label = j ? `${esc(j.tag)} - ${esc(j.address)}${j.tenant ? ` · ${esc(j.tenant)}` : ''}${j.title && j.title !== j.address ? `<small>${esc(j.title)}</small>` : ''}` : 'deleted ticket';
    return `<div class="spl-row ${paid ? 'paid' : ''}" data-i="${i}">
      <div class="spl-main"><span class="spl-d">${shortDate(r.work_date)}</span>
        <span class="spl-j">${label}</span>
        <button class="spl-copy" data-memo="${esc(splZelleMemo(r.work_date, j))}">Copy</button>
        <button class="spl-a" data-i="${i}">${paid ? '✓ PAID — ' + splM(amt(r)) : splM(r.total)}</button>
        <label class="spl-act">Actual paid <input type="number" step="0.01" min="0" data-i="${i}" value="${a != null ? a.toFixed(2) : ''}" placeholder="${Number(r.total).toFixed(2)}" title="What you actually sent for this job this day. Changes this page and the job page, not the customer bill. Clear it to go back to the men's days."></label></div>
      <div class="spl-men">${r.men.map(x => `<span>${esc(x.name)} ${splM(x.amt)}</span>`).join('')}${a != null ? `<span>days add up to ${splM(r.total)} · actual paid ${splM(a)}</span>` : ''}${paid ? `<span>paid ${splM(amt(r))}</span>` : ''}</div>
    </div>`;
  }).join('');
  mount.innerHTML = `<div class="spl">
    <h4>Pay ledger — ${esc(title || d.pay_to)}</h4>
    <p class="spl-note">One line per job per day = one Zelle to ${esc(title || d.pay_to)}. Got a quote or sent a different number? Type it in <b>Actual paid</b> — that is the number that gets marked PAID and goes on the job page (job cost). The green number never changes. The customer bill stays on the day rates. <b>Copy</b> puts the Zelle memo on your clipboard. Tap the <b>dollar amount</b> once you've sent it — it turns to PAID. Tap the line to see whose day is in it.</p>
    <div class="spl-wk">
      <button data-w="-1">‹</button>
      <b>${st.all ? 'All dates' : fmtRange(st.wk)}</b>
      <button data-w="1">›</button>
      <button class="${st.all ? 'on' : ''}" data-w="0">${st.all ? 'This week only' : 'All'}</button>
      <span class="spl-owe"><small>${st.all ? 'Still owed, all dates' : 'Still owed this week'}</small>${splM(owe)}${owe !== total ? `<em>of ${splM(total)}</em>` : ''}</span>
    </div>
    ${rows.length ? body : `<div class="spl-empty">Nothing logged ${st.all ? 'yet' : 'this week'}.</div>`}
  </div>`;

  const again = () => subPayLedger(mount, bossId, title);
  mount.querySelectorAll('.spl-wk button').forEach(b => b.onclick = () => {
    const w = Number(b.dataset.w);
    if (w === 0) st.all = !st.all; else { st.all = false; st.wk = addDays(st.wk, 7 * w); }
    again();
  });
  mount.querySelectorAll('.spl-row').forEach(el => el.onclick = () => el.classList.toggle('open'));
  mount.querySelectorAll('.spl-copy').forEach(b => b.onclick = async e => {
    e.stopPropagation();
    try { await navigator.clipboard.writeText(b.dataset.memo); } catch {
      const ta = document.createElement('textarea'); ta.value = b.dataset.memo; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    const old = b.textContent; b.textContent = 'Copied'; b.classList.add('did');
    setTimeout(() => { b.textContent = old; b.classList.remove('did'); }, 1200);
  });
  mount.querySelectorAll('.spl-act').forEach(l => l.onclick = e => e.stopPropagation());
  mount.querySelectorAll('.spl-act input').forEach(inp => inp.onchange = async () => {
    const r = rows[Number(inp.dataset.i)]; const actual = inp.value === '' ? null : Number(inp.value);
    try {
      await call('/w/sub-actual', { method: 'PUT', body: { pay_to: d.pay_to, work_date: r.work_date, job_id: r.job_id, actual } });
      const back = await call(`/w/pay-ledger?boss=${bossId}`);
      const got = (back.actuals || []).find(p => p.work_date === r.work_date && p.job_id === r.job_id);
      if ((got ? Number(got.actual) : null) !== actual) throw new Error('That did not stick — the read-back does not show it.');
      toast(actual == null ? 'Back to the men\'s days — read back and it matches' : `Actual paid ${splM(actual)} — read back and it matches`);
      again();
    } catch (err) { fail(err); }
  });
  mount.querySelectorAll('button.spl-a').forEach(b => b.onclick = async e => {
    e.stopPropagation();
    const r = rows[Number(b.dataset.i)]; const paid = !isPaid(r);
    try {
      await call('/w/sub-paid', { method: 'PUT', body: { pay_to: d.pay_to, work_date: r.work_date, job_id: r.job_id, paid } });
      const back = await call(`/w/pay-ledger?boss=${bossId}`);
      if (back.paid.some(p => p.work_date === r.work_date && p.job_id === r.job_id) !== paid) throw new Error('That did not stick — the read-back does not show it.');
      toast(paid ? `Marked PAID — ${splM(amt(r))} to ${title || d.pay_to}. Read back and it matches` : 'Back to not paid — read back and it matches');
      again();
    } catch (err) { fail(err); }
  });
}
