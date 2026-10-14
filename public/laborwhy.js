// WHY IS THE LABOR ON A PLACEHOLDER AND NOT IN QUICKBOOKS (10/14/26, his ask).
// A red pill on the ticket — only when a green day on it is still owed. Tap it: each day, in plain words, why it
// didn't go, and a box to answer. No labor dollars here — those stay on the job cost sheet (his 10/12 rule).
// His answer is saved and the day goes to QuickBooks; then it is read back.
import { esc, call, toast } from './ui.js';

const mdy = iso => { const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${Number(m)}/${Number(d)}/${y.slice(2)}`; };

export async function laborWhyPill(jobId, pillEl, boxEl) {
  let d;
  try { d = await call(`/w/job/${jobId}/labor-why`); } catch { return; }   // no pill if the check can't run
  if (!d.days || !d.days.length) { pillEl.innerHTML = ''; boxEl.innerHTML = ''; return; }
  pillEl.innerHTML = `<button type="button" class="jcpill" style="border-color:var(--bad);color:var(--bad);cursor:pointer">Why isn't the labor in QuickBooks? (${d.days.length})</button>`;
  pillEl.querySelector('button').onclick = () => { boxEl.hidden = !boxEl.hidden; };
  boxEl.hidden = true;
  const needCust = d.days.some(x => x.reasons.some(r => r.code === 'customer'));
  boxEl.innerHTML = `<div class="card" style="border-left:4px solid var(--bad)">
    <h2>Labor not in QuickBooks yet</h2>
    ${needCust && d.pick ? `<label>Which QuickBooks customer is it?<select id="lwCust"><option value="">— pick —</option>
      ${d.pick.new_under ? `<option value="new:${esc(d.pick.new_under.id)}">New tenant under ${esc(d.pick.new_under.label)}</option>` : ''}
      ${d.pick.tree.map(c => `<option value="${esc(c.id)}">${esc(c.path)}</option>`).join('')}</select></label>` : ''}
    ${d.days.map((x, k) => `<div class="row" style="display:block;padding:10px 0">
      <b>${mdy(x.work_date)}</b>
      ${x.reasons.map(r => `<div class="help">${esc(r.text)}</div>`).join('')}
      ${x.reasons.some(r => r.code === 'price') ? `<label>Price for ${mdy(x.work_date)}<input class="lwAmt" data-k="${k}" inputmode="decimal" placeholder="e.g. 400"></label>` : ''}
    </div>`).join('')}
    <div class="actions"><button type="button" id="lwGo">Send to QuickBooks</button></div>
    <div class="err" id="lwErr"></div></div>`;
  boxEl.querySelector('#lwGo').onclick = async ev => {
    const btn = ev.target; btn.disabled = true;
    const err = boxEl.querySelector('#lwErr'); err.textContent = '';
    const sel = boxEl.querySelector('#lwCust');
    const pick = sel ? sel.value : '';
    if (sel && !pick) { err.textContent = 'Pick the QuickBooks customer first.'; btn.disabled = false; return; }
    const done = [], bad = [];
    let answered = false;
    for (const [k, x] of d.days.entries()) {
      const amtEl = boxEl.querySelector(`.lwAmt[data-k="${k}"]`);
      const amount = amtEl ? amtEl.value.replace(/[$,]/g, '').trim() : '';
      if (amtEl && !(Number(amount) > 0)) { bad.push(`${mdy(x.work_date)}: type a price above $0`); continue; }
      const body = { work_date: x.work_date, amount: amount || null };
      if (pick && !answered) { if (pick.startsWith('new:')) body.new_tenant_under = pick.slice(4); else body.qb_customer_id = pick; }
      try { const r = await call(`/w/job/${jobId}/labor-fix`, { method: 'POST', body }); answered = true; done.push(`${mdy(x.work_date)} → #${r.number}`); }
      catch (e) { bad.push(`${mdy(x.work_date)}: ${e.message}`); }
    }
    // read back in a separate request: the days that went must be off the owed list
    const back = await call(`/w/job/${jobId}/labor-why`).catch(() => ({ days: d.days }));
    const still = (back.days || []).map(x => x.work_date);
    const proven = done.filter(t => !still.some(w => t.startsWith(mdy(w))));
    if (proven.length) toast(`In QuickBooks: ${proven.join(' · ')} (read back)`);
    if (bad.length || proven.length < done.length) err.textContent = [...bad, ...(proven.length < done.length ? ['Sent, but the read-back still shows it owed — check Invoicing.'] : [])].join(' · ');
    if (!bad.length) laborWhyPill(jobId, pillEl, boxEl); else btn.disabled = false;
  };
}
