// INVOICING — copied from the old board's renderInvoicing (6-old-app-source): Ready to bill (fills itself) → Placeholders owed →
// Send it → three little grids (Needs both / Needs the scope / Needs pictures) → Write it → Billed a trip at a time → Tabled.
import { esc, $app, call, doAndProve, crumbs, setTab, fail, ask, toast, stillMissing } from './ui.js';
import { money, ticketName, invoicingLane, isBill, shortDate, round2 } from './money.js';

const age = (from, to) => from ? Math.max(0, Math.round((new Date(to + 'T12:00:00') - new Date(String(from).slice(0, 10) + 'T12:00:00')) / 86400000)) : null;

// TENANT ON THE FRONT OF EVERY TICKET (10/1/26): tenant first, then the customer.
const who = j => [j.tenant || j.tenant_name, j.customer_name].filter(Boolean).join(' · ');
export async function invoicingPage() {
  setTab('invoicing'); crumbs([['Invoicing']]);
  const d = await call('/w/invoicing');
  const live = d.tickets.filter(t => !t.tabled_at);
  const tabled = d.tickets.filter(t => t.tabled_at);
  const laneOf = t => { const l = invoicingLane(t, t.invoices); if (l !== 'checks') return l; return !t.scope_ok && !t.pics_ok ? 'both' : !t.scope_ok ? 'scope' : 'pics'; };
  const by = k => live.filter(t => laneOf(t) === k);
  // the tab count and every list agree: each ticket counted once, tabled included, nothing counted that isn't drawn
  const onPage = new Set([...d.ready.map(r => r.job.id), ...d.owed.map(o => o.job.id), ...live.map(t => t.id), ...d.draws.map(t => t.id), ...tabled.map(t => t.id)]).size;
  const billsOf = t => t.invoices.filter(isBill);
  const amt = t => round2(billsOf(t).reduce((a, i) => a + Number(i.amount), 0));
  const open = id => `href="#/job/${id}"`;

  const invRow = (t, color) => `<div class="prow" style="border-left-color:${color}">
      <a class="pmain" ${open(t.id)}>
        <div class="pt">${esc(ticketName(t))}</div>
        <div class="ps">${esc(who(t))}${t.last_work_date ? ' · ' + shortDate(t.last_work_date) : ''}${amt(t) ? ` · <b class="greentxt">${money(amt(t))}</b>` : ''}${t.cost ? ` · cost so far ${money(t.cost)}` : ''}</div>
        ${billsOf(t).map(i => `<div class="ps">${i.kind === 'draw' ? 'Draw' : 'Invoice'} ${esc(i.number) || 'no number'} · ${money(i.amount)} · ${i.sent_at ? 'sent ' + shortDate(i.sent_at) : '<span class="ambertxt">not sent</span>'}${i.kind === 'real' ? (i.qb_id ? ' · in QuickBooks' : ' · <span class="redtxt">not in QuickBooks</span>') : ''}</div>${i.kind === 'real' && !i.qb_id && i.qb_error ? `<div class="ps redtxt">${esc(i.qb_error)}</div>` : ''}`).join('')}
      </a>
      <div class="lanebtns">
        ${billsOf(t).filter(i => i.kind === 'real' && !i.qb_id).map(i => `<button class="lb send toqb" data-id="${i.id}" data-job="${t.id}">Send to QuickBooks</button>`).join('')}
        ${billsOf(t).filter(i => !i.sent_at).map(i => `<button class="lb send sent" data-id="${i.id}" data-job="${t.id}">Mark ${esc(i.number) || 'it'} sent</button>`).join('')}
        <button class="lb tbl" data-job="${t.id}">Table it</button>
      </div>
    </div>`;
  const mini = t => `<div class="minirow">
      <a ${open(t.id)}><div class="mt">${esc(ticketName(t))}</div><div class="ms">${esc(who(t))}${t.last_work_date ? ' · ' + shortDate(t.last_work_date) : ''}</div></a>
      <div class="lanebtns">
        <button class="lb chk ${t.scope_ok ? 'on' : ''}" data-job="${t.id}" data-which="scope" data-v="${t.scope_ok ? 0 : 1}">Scope</button>
        <button class="lb chk ${t.pics_ok ? 'on' : ''}" data-job="${t.id}" data-which="pics" data-v="${t.pics_ok ? 0 : 1}">Pictures</button>
      </div></div>`;
  const grp = (color, title, n, body, sub = '') => n ? `<div class="billgrp" style="--lane:${color}"><div class="bgh"><b>${title}</b> <span class="lanen">${n}</span>${sub ? `<span class="spacer"></span><small>${sub}</small>` : ''}</div>${body}</div>` : '';

  let html = '';
  // Step 6: trips billed on live tickets sit at the very top, above every finished bucket
  // BILLED A TRIP AT A TIME — STILL WORKING
  html += grp('var(--mute)', 'Billed a trip at a time — still working', d.draws.length, d.draws.map(t => {
    const unpaid = billsOf(t).filter(i => !i.paid_at);
    const owed = t.aging ? t.aging.owed : 0;
    const oldest = t.aging ? t.aging.days : 0;
    const stale = !!(t.aging && t.aging.stale);
    return `<div class="prow" style="border-left-color:${stale ? 'var(--bad)' : 'var(--mute)'}">
      <a class="pmain" ${open(t.id)}><div class="pt">${esc(ticketName(t))}</div>
        <div class="ps">${esc(who(t))} · <b>${money(owed)}</b> owed on ${unpaid.length} trip${unpaid.length === 1 ? '' : 's'}${t.contract ? ` · ${money(t.contract.billed)} billed of ${money(t.contract.contract)} — ${money(t.contract.left)} left` : ''}${oldest ? ` · oldest ${oldest} days` : ''}</div>
        ${stale ? `<div class="ps redtxt"><b>Unpaid ${money(owed)} · ${oldest} days — don't send a crew back until it clears</b></div>` : ''}</a>
      <div class="lanebtns">${unpaid.filter(i => !i.sent_at).map(i => `<button class="lb send sent" data-id="${i.id}" data-job="${t.id}">Mark ${esc(i.number) || 'it'} sent</button>`).join('')}</div>
    </div>`;
  }).join(''));
  // READY TO BILL — fills itself; nothing is billed until he presses the button
  html += grp('var(--ok)', 'Ready to bill', d.ready.length, d.ready.map((r, k) => `<div class="prow" style="border-left-color:var(--ok)">
      <div class="pmain">
        <a ${open(r.job.id)}><div class="pt">${esc(ticketName(r.job))}</div></a>
        <div class="ps">${esc(who(r.job))} · ${r.days.map(x => shortDate(x.date)).join(', ')}</div>
        <details class="rb"><summary>${r.invoice.amount > 0 ? money(r.invoice.amount) : '<span class="redtxt">not priced</span>'} — labor ${money(r.labor)}${r.material ? ` + material ${money(r.material)}` : ''}</summary>
          ${r.days.map(x => `<div class="ps"><b>${shortDate(x.date)}</b> ${x.labor.map(l => `${esc(l.how)}${l.amount != null ? ' = ' + money(l.amount) : ''}`).join(' · ')}</div>`).join('')}
          ${r.material_cost ? `<div class="ps">material ${money(r.material_cost)}${r.job.tag === 'JC' ? '' : ' × 1.2'} = ${money(r.material)}</div>` : ''}
          <div class="ps">${esc(r.job.scope)}</div>
        </details>
      </div>
      <div class="lanebtns"><button class="lb send bill" data-k="${k}">Write the invoice${r.invoice.amount > 0 ? ' ' + money(r.invoice.amount) : ''}</button></div>
    </div>`).join(''));
  // PLACEHOLDERS OWED
  html += grp('var(--bad)', 'Placeholders owed in QuickBooks', d.owed.length, d.owed.map((o, k) => `<div class="prow" style="border-left-color:var(--bad)">
      <a class="pmain" ${open(o.job.id)}><div class="pt">${shortDate(o.work_date)} · ${esc(ticketName(o.job))}</div>
        <div class="ps">${esc(who(o.job))} · ${o.suggested != null ? money(o.suggested) : '<span class="redtxt">not priced</span>'}</div></a>
      <div class="lanebtns"><button class="lb send phqb" data-k="${k}">Send to QuickBooks${o.suggested != null ? ' ' + money(o.suggested) : ''}</button><button class="lb seat" data-k="${k}">Put the QB number on</button></div></div>`).join(''));
  // SEND IT
  html += grp('var(--bad)', 'Send it', by('send').length, by('send').map(t => invRow(t, 'var(--bad)')).join(''));
  // THREE LITTLE GRIDS
  const WAIT = [{ k: 'both', l: 'Needs both', w: 'scope AND pictures', c: '#ffd24d' }, { k: 'scope', l: 'Needs the scope', w: 'Adam', c: 'var(--brand)' }, { k: 'pics', l: 'Needs pictures', w: 'Ashley', c: 'var(--mute)' }];
  if (WAIT.some(L => by(L.k).length)) html += `<div class="lanegrid">${WAIT.map(L => `<div class="lanecol" style="--lane:${L.c}">
      <div class="lch"><span class="lanen">${by(L.k).length}</span><b>${L.l}</b><small>${L.w}</small></div>
      <div class="lcb">${by(L.k).map(mini).join('') || '<div class="lcempty">clear</div>'}</div></div>`).join('')}</div>`;
  // WRITE IT
  html += grp('#ffd24d', 'Real invoice owed', by('write').length, by('write').map(t => invRow(t, '#ffd24d')).join(''));
  // TABLED
  html += grp('var(--line)', 'Tabled — not billing yet', tabled.length, tabled.map(t => `<div class="prow" style="border-left-color:var(--line)">
      <a class="pmain" ${open(t.id)}><div class="pt">${esc(ticketName(t))}</div><div class="ps">${esc(who(t))} · tabled ${shortDate(t.tabled_at)} — "${esc(t.tabled_why)}"</div></a>
      <div class="lanebtns"><button class="lb back" data-job="${t.id}">Bring it back</button></div></div>`).join(''));

  $app().innerHTML = `<div class="oldgrid oldinv"><h1>Invoicing <span class="lanen big">${onPage}</span></h1>${html || '<div class="card empty">Nothing waiting to be billed.</div>'}</div>`;

  const again = () => invoicingPage();
  const run = async fn => { try { await fn(); again(); } catch (e) { fail(e); } };
  const prove = (path, method, body, check, msg) => doAndProve(path, { method, body }, '/w/invoicing', check, msg);
  $app().querySelectorAll('.bill').forEach(b => b.onclick = () => {
    const r = d.ready[Number(b.dataset.k)];
    const v = ask(`${r.invoice.name}\nMemo: ${r.invoice.memo}\nDated ${shortDate(r.invoice.inv_date)} (tomorrow — stays future until Mark it sent)\n\nPrice on the invoice:`, r.invoice.amount > 0 ? String(r.invoice.amount) : '');
    if (v === null) return;   // blank price still writes the invoice — it reads $0 until he knows it
    const amount = Number(v);
    b.disabled = true;
    run(async () => {
      const w = await call(`/w/bill/${r.job.id}`, { method: 'POST', body: { amount } });
      const back = await call(`/w/job/${r.job.id}`);
      const inv = back.invoices.find(i => i.id === w.invoice_id);
      const ph = back.invoices.filter(i => i.kind === 'placeholder' && r.invoice.zero.some(z => z.id === i.id));
      const ok = inv && Number(inv.amount) === Number(w.amount) && inv.name === r.invoice.name && inv.memo === w.memo && inv.scope === r.job.scope && inv.inv_date > back.today
        && ph.every(p => Number(p.amount) === 0 && /^Job Cost \d+$/.test(p.name) && p.memo === w.memo);
      if (!ok) throw new Error('That did not stick — the read-back does not match (name, memo, scope, date or the placeholder). Nothing was assumed.');
      const said = `Invoice written — ${inv.name} ${money(inv.amount)}, memo "${inv.memo}", dated ${shortDate(inv.inv_date)}${ph.length ? ` · ${ph.length} placeholder${ph.length === 1 ? '' : 's'} → $0` : ''} (read back and it matches)${stillMissing(w)}`;
      if (w.qb && inv.qb_id && inv.number === w.qb.number) toast(`${said} · In QuickBooks as #${w.qb.number} for ${w.qb.customer}`);
      else toast(`${said} · NOT in QuickBooks: ${w.qb_error || 'no QuickBooks number came back'} — press Send to QuickBooks on it`, false);
    });
  });
  $app().querySelectorAll('.chk').forEach(c => c.onclick = () => {
    const id = Number(c.dataset.job), which = c.dataset.which, value = c.dataset.v === '1';
    run(() => doAndProve(`/w/job/${id}/check`, { method: 'PUT', body: { which, value } }, `/w/job/${id}`, bk => bk.job[which === 'scope' ? 'scope_ok' : 'pics_ok'] === value));
  });
  $app().querySelectorAll('.sent').forEach(b => b.onclick = () => {
    if (!confirm('Mark it sent? Only after you have actually emailed it. This moves it to AR.')) return;
    const id = Number(b.dataset.id), job = Number(b.dataset.job); b.disabled = true;
    run(() => doAndProve(`/w/invoices/${id}/sent`, { method: 'POST', body: { value: true } }, `/w/job/${job}`, bk => !!bk.invoices.find(i => i.id === id).sent_at));
  });
  $app().querySelectorAll('.toqb').forEach(b => b.onclick = () => {
    const id = Number(b.dataset.id), job = Number(b.dataset.job); b.disabled = true;
    run(async () => {
      const out = await call(`/w/invoices/${id}/qb`, { method: 'POST', body: {} });
      const back = await call(`/w/job/${job}`);
      const inv = back.invoices.find(i => i.id === id);
      if (!inv || !inv.qb_id || inv.number !== out.number) throw new Error('That did not stick — the read-back does not show the QuickBooks number. Nothing was assumed.');
      toast(`In QuickBooks as #${out.number} for ${out.customer} (read back and it matches)`);
    });
  });
  $app().querySelectorAll('.tbl').forEach(b => b.onclick = () => {
    const why = ask('Why are you tabling it?'); if (why === null) return;   // no reason yet is fine
    const job = Number(b.dataset.job);
    run(() => prove(`/w/job/${job}/table`, 'POST', { why }, bk => bk.tickets.some(t => t.id === job && t.tabled_at), 'Tabled — read back and it matches'));
  });
  $app().querySelectorAll('.back').forEach(b => b.onclick = () => {
    const job = Number(b.dataset.job);
    run(() => prove(`/w/job/${job}/untable`, 'POST', {}, bk => bk.tickets.some(t => t.id === job && !t.tabled_at), 'Back on Invoicing — read back and it matches'));
  });
  $app().querySelectorAll('.phqb').forEach(b => b.onclick = () => {
    const o = d.owed[Number(b.dataset.k)];
    const amount = ask(`Placeholder for ${shortDate(o.work_date)} — ${ticketName(o.job)}\nDated 2 weeks after the day worked.\n\nPrice on it — never $0`, o.suggested != null ? String(o.suggested) : ''); if (amount === null) return;
    b.disabled = true;
    run(async () => {
      const out = await call('/w/placeholder-qb', { method: 'POST', body: { job_id: o.job.id, work_date: o.work_date, amount: Number(amount) } });
      const back = await call(`/w/job/${o.job.id}`);
      const p = back.invoices.find(i => i.kind === 'placeholder' && i.work_date === o.work_date);
      if (!p || !p.qb_id || p.number !== out.number || Number(p.amount) !== Number(out.amount)) throw new Error('That did not stick — the read-back does not show the placeholder. Nothing was assumed.');
      toast(`Placeholder in QuickBooks as #${out.number} for ${out.customer} ${money(out.amount)} (read back and it matches)`);
    });
  });
  $app().querySelectorAll('.seat').forEach(b => b.onclick = () => {
    const o = d.owed[Number(b.dataset.k)];
    const number = ask('QuickBooks placeholder number (blank if not in QuickBooks yet)'); if (number === null) return;
    const amount = ask('Price on it — never $0', o.suggested != null ? String(o.suggested) : ''); if (amount === null) return;
    run(() => prove('/w/invoices', 'POST', { job_id: o.job.id, kind: 'placeholder', number, amount, inv_date: null, work_date: o.work_date },
      bk => !bk.owed.some(x => x.job.id === o.job.id && x.work_date === o.work_date), 'Seated — read back, that day is off the owed list'));
  });
}
