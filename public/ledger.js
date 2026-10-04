// The ticket's life, drawn inside the job file page. Money (invoices + general ledger) lives on its own page: jobCostPage.
import { esc, $app, call, doAndProve, crumbs, fail, ask, toast } from './ui.js';
import { money, round2, isWork, canPlaceholder, isBill, inAR, shortDate, costSoFar, LANES, invoicingLane, ticketName, drawAging } from './money.js';

export async function renderTicket(jobId, mount) {
  const L = await call(`/w/job/${jobId}`);
  const j = L.job;
  if (!isWork(j.tag)) { mount.innerHTML = ''; return; }
  const readUrl = `/w/job/${jobId}`;
  // 10/4/26: any redraw first finishes saving the scope words, so a box tick or button can never wipe what he typed
  let flushScope = async () => {};
  const again = async () => { try { await flushScope(); } catch (e) {} return renderTicket(jobId, mount); };
  const lane = j.done_at && L.places.includes('Invoicing') ? LANES[invoicingLane(j, L.invoices)] : null;
  const aging = drawAging(j, L.invoices, L.today);
  const coveredThrough = L.invoices.filter(i => i.kind === 'real').map(i => i.covers_through || i.inv_date).filter(Boolean).sort().pop();
  const phTotal = round2(L.invoices.filter(i => i.kind === 'placeholder' && Number(i.amount) > 0 && (!coveredThrough || String(i.work_date) > coveredThrough)).reduce((a, i) => a + Number(i.amount), 0));

  mount.innerHTML = `
    ${aging && aging.stale ? `<div class="card stalebar">Unpaid ${money(aging.owed)} · ${aging.days} days — don't send a crew back until it clears</div>` : ''}
    <div class="card">
      <h2>Ticket</h2>
      <label class="full" style="margin-top:12px">
        <textarea id="scope" style="min-height:110px" placeholder="Scope of work">${esc(j.scope)}</textarea></label>
      <p class="help" id="scopeSaved"></p>
      <p class="help">Saving words here never ticks the box below. Only you tick it.</p>
      <div class="btnrow">
        <label class="checkline"><input type="checkbox" id="scopeOk" ${j.scope_ok ? 'checked' : ''}> Scope of work checked${j.scope_ok_at ? ` <span class="mute">${new Date(j.scope_ok_at).toLocaleString()}</span>` : ''}</label>
        <label class="checkline"><input type="checkbox" id="picsOk" ${j.pics_ok ? 'checked' : ''}> CompanyCam pictures checked${j.pics_ok_at ? ` <span class="mute">${new Date(j.pics_ok_at).toLocaleString()}</span>` : ''}</label>
      </div>
      <div class="btnrow" style="margin-top:14px">
        ${!j.done_at ? '<button id="done">Work is done</button>' : '<button class="ghost" id="reopen">Reopen — put it back on the schedule</button>'}
        ${j.done_at && !j.tabled_at ? '<button class="ghost" id="table">Table it — not billing yet</button>' : ''}
        ${j.tabled_at ? '<button class="ghost" id="untable">Bring it back to Invoicing</button>' : ''}
        <label class="checkline"><input type="checkbox" id="nocharge" ${j.no_charge ? 'checked' : ''}> No charge on purpose</label>
      </div>
    </div>`;

  const q = s => mount.querySelector(s);
  const run = async (fn) => { try { await fn(); again(); } catch (e) { fail(e); } };
  const act = (path, body, check, msg) => doAndProve(path, { method: path.endsWith('scope') || path.endsWith('plan') || path.endsWith('check') || path.endsWith('bill-price') ? 'PUT' : 'POST', body }, readUrl, check, msg);

  // SCOPE AUTO-SAVES (10/4/26, his rule): no button. Saves a second after he stops typing, when he clicks away, and before any redraw.
  // One save at a time, always the newest words, so a slow early save can never land after a later one (fix 10/4: 8155 Custer kept only "Scope of ").
  let scopeT = 0, scopeLast = j.scope || '', scopeChain = Promise.resolve();
  const saveScope = () => { clearTimeout(scopeT); scopeChain = scopeChain.then(async () => {
    const box = q('#scope'); if (!box) return; const v = box.value; if (v === scopeLast) return;
    if (q('#scopeSaved')) q('#scopeSaved').textContent = 'Saving…';
    try { await act(`/w/job/${jobId}/scope`, { scope: v }, b => b.job.scope === v, 'Scope saved'); scopeLast = v; j.scope = v; if (q('#scopeSaved')) q('#scopeSaved').textContent = 'Saved'; }
    catch (e) { if (q('#scopeSaved')) q('#scopeSaved').textContent = ''; fail(e); }
  }); return scopeChain; };
  flushScope = saveScope;
  q('#scope').oninput = () => { q('#scopeSaved').textContent = ''; clearTimeout(scopeT); scopeT = setTimeout(saveScope, 1200); };
  q('#scope').onblur = () => { saveScope(); };
  // 10/4/26: no invoice price box. The invoice is always the placeholder's price, and the placeholder goes to $0.
  q('#scopeOk').onchange = () => run(() => act(`/w/job/${jobId}/check`, { which: 'scope', value: q('#scopeOk').checked }, b => b.job.scope_ok === q('#scopeOk').checked));
  q('#picsOk').onchange = () => run(() => act(`/w/job/${jobId}/check`, { which: 'pics', value: q('#picsOk').checked }, b => b.job.pics_ok === q('#picsOk').checked));
  q('#nocharge').onchange = () => run(() => act(`/w/job/${jobId}/no-charge`, { value: q('#nocharge').checked }, b => b.job.no_charge === q('#nocharge').checked));
  if (q('#done')) q('#done').onclick = () => { if (confirm(`Are you sure you're done with ${ticketName(j)}?\n\nIt moves to Invoicing.`)) run(() => act(`/w/job/${jobId}/done`, {}, b => !!b.job.done_at)); };
  if (q('#reopen')) q('#reopen').onclick = () => {
    const unsent = L.invoices.filter(i => i.kind === 'real' && !i.sent_at && !i.paid_at);
    if (unsent.length && !confirm(`Reopen it?\n\nThe invoice${unsent.length === 1 ? '' : 's'} not sent yet (${unsent.map(i => (i.number ? '#' + i.number + ' ' : '') + money(i.amount)).join(', ')}) get deleted here and in QuickBooks, and the placeholders go back to their price.`)) return;
    run(async () => {
      const { result } = await act(`/w/job/${jobId}/reopen`, {}, b => !b.job.done_at && !b.invoices.some(i => unsent.some(u => u.id === i.id)), 'Reopened — back on the schedule, off Invoicing (read back and it matches)');
      if ((result.qb_done || []).length) toast(`Reopened · ${result.qb_done.join(' · ')}${(result.sent_left || []).length ? ' · already sent, NOT touched: ' + result.sent_left.join(', ') : ''}`);
      else if ((result.sent_left || []).length) toast(`Reopened · already sent, NOT touched: ${result.sent_left.join(', ')} — fix that one in QuickBooks by hand`, false);
    });
  };
  if (q('#table')) q('#table').onclick = () => { const why = ask('Why are you tabling it? (so it still makes sense in three months)'); if (why !== null) run(() => act(`/w/job/${jobId}/table`, { why }, b => !!b.job.tabled_at)); };
  if (q('#untable')) q('#untable').onclick = () => run(() => act(`/w/job/${jobId}/untable`, {}, b => !b.job.tabled_at));
}
