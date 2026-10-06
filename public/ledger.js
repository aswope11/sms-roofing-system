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
      ${/standridge|four\s*corners/i.test(j.customer_name || '') ? '<p class="help">Scope goes in the QuickBooks Note to customer (bottom left) with the date — Standridge / Four Corners rule.</p>'
        : `<label class="checkline"><input type="checkbox" id="scopeNote" ${j.scope_note ? 'checked' : ''}> Put the scope in the QuickBooks Note to customer (bottom left), not line 1</label>`}
      <div class="btnrow">
        <label class="checkline"><input type="checkbox" id="scopeOk" ${j.scope_ok ? 'checked' : ''}> Scope of work checked${j.scope_ok_at ? ` <span class="mute">${new Date(j.scope_ok_at).toLocaleString()}</span>` : ''}</label>
        <label class="checkline"><input type="checkbox" id="picsOk" ${j.pics_ok ? 'checked' : ''}> CompanyCam pictures checked${j.pics_ok_at ? ` <span class="mute">${new Date(j.pics_ok_at).toLocaleString()}</span>` : ''}</label>
      </div>
      ${(() => { // 10/4/26: every SENT invoice on this ticket, with its total, so the ticket shows what was billed
        const sent = L.invoices.filter(i => i.kind !== 'placeholder' && i.sent_at);
        if (!sent.length) return '';
        const tot = round2(sent.reduce((a, i) => a + Number(i.amount), 0));
        return `<div style="margin-top:12px"><h3 style="margin:0 0 6px">Invoices sent</h3>${sent.map(i => `<div>Invoice ${esc(i.number)} · ${money(i.amount)} · sent ${shortDate(i.sent_at)}${i.paid_at ? ' · paid' : ''}</div>`).join('')}<div style="margin-top:6px"><b>Total sent: ${money(tot)}</b></div></div>`;
      })()}
      <div class="btnrow" style="margin-top:14px">
        ${!j.done_at ? '<button id="done">Work is done</button>' : '<button class="ghost" id="reopen">Reopen — put it back on the schedule</button>'}
        ${j.done_at && !j.tabled_at ? '<button class="ghost" id="table">Table it — not billing yet</button>' : ''}
        ${j.tabled_at ? '<button class="ghost" id="untable">Bring it back to Invoicing</button>' : ''}
        <label class="checkline"><input type="checkbox" id="nocharge" ${j.no_charge ? 'checked' : ''}> No charge on purpose</label>
      </div>
    </div>`;

  const q = s => mount.querySelector(s);
  const run = async (fn) => { try { await fn(); again(); } catch (e) { fail(e); } };
  const act = (path, body, check, msg) => doAndProve(path, { method: path.endsWith('scope') || path.endsWith('scope-note') || path.endsWith('plan') || path.endsWith('check') || path.endsWith('bill-price') ? 'PUT' : 'POST', body }, readUrl, check, msg);

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
  // 10/6/26 SCOPE BULLETS (his rule, every time): every scope line is a bullet. Lines ending in ":" are headers and stay plain; anything under "Roof Assessment:" stays a paragraph.
  const scopeIsPara = (txt) => { let para = false; for (const l of txt.split('\n')) { const t = l.trim(); if (/:$/.test(t) && !/^[•*-]/.test(t)) para = /assessment/i.test(t); } return para; };
  const bulletScope = (s) => { let para = false; return s.split('\n').map(l => { const t = l.trim(); if (!t) return l; if (/:$/.test(t) && !/^[•*-]/.test(t)) { para = /assessment/i.test(t); return l; } return para ? l : '• ' + t.replace(/^[•*-]\s*/, ''); }).join('\n'); };
  q('#scope').onkeydown = (e) => { if (e.key !== 'Enter' || e.shiftKey) return; const box = e.target; let a = box.selectionStart, b = box.selectionEnd; const before = box.value.slice(0, a); if (scopeIsPara(before)) return;
    const ls = before.lastIndexOf('\n') + 1, cur = before.slice(ls).trim(); e.preventDefault();
    if (cur === '•') { box.setRangeText('', ls, b, 'end'); box.dispatchEvent(new Event('input')); return; }
    if (cur && !/:$/.test(cur) && !/^•/.test(cur)) { const lead = before.slice(ls).length - before.slice(ls).trimStart().length; box.setRangeText('• ', ls + lead, ls + lead, 'preserve'); a = box.selectionStart; b = box.selectionEnd; }
    box.setRangeText('\n• ', a, b, 'end'); box.dispatchEvent(new Event('input')); };
  q('#scope').onblur = () => { const box = q('#scope'); const nv = bulletScope(box.value); if (nv !== box.value) box.value = nv; saveScope(); };
  // 10/4/26: no invoice price box. The invoice is always the placeholder's price, and the placeholder goes to $0.
  q('#scopeOk').onchange = () => run(() => act(`/w/job/${jobId}/check`, { which: 'scope', value: q('#scopeOk').checked }, b => b.job.scope_ok === q('#scopeOk').checked));
  if (q('#scopeNote')) q('#scopeNote').onchange = () => run(() => act(`/w/job/${jobId}/scope-note`, { value: q('#scopeNote').checked }, b => b.job.scope_note === q('#scopeNote').checked));
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
