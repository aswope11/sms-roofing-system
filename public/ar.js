// AR — copied from the old board's renderAR: aging tiles, one pile per customer A–Z, days out, Mark it paid on the row.
import { esc, $app, call, doAndProve, crumbs, setTab, fail } from './ui.js';
import { money, ticketName, shortDate, round2, missingToMarkPaid, isBill } from './money.js';

const age = (from, to) => Math.max(0, Math.round((new Date(to + 'T12:00:00') - new Date(String(from).slice(0, 10) + 'T12:00:00')) / 86400000));
const BUCKETS = [['current', 'Current', 0, 0], ['b30', '1–30 days', 1, 30], ['b60', '31–60', 31, 60], ['b90', '61–90', 61, 90], ['b90p', '90+', 91, 1e9]];

export async function arPage() {
  setTab('ar'); crumbs([['AR']]);
  const d = await call('/w/ar');
  const rows = d.rows.map(r => ({ ...r, days: age(r.sent_at, d.today) }));
  const total = round2(rows.reduce((a, r) => a + Number(r.amount), 0));
  const sumIn = (lo, hi) => round2(rows.filter(r => r.days >= lo && r.days <= hi).reduce((a, r) => a + Number(r.amount), 0));
  const byCust = {};
  rows.forEach(r => (byCust[r.customer_name || 'No customer on it'] ||= []).push(r));
  const names = Object.keys(byCust).sort((a, b) => a.localeCompare(b));
  const row = r => {
    const late = r.days > 30;
    return `<div class="prow" data-hover="${r.job_id}" style="border-left-color:${late ? 'var(--bad)' : 'var(--ok)'}">
      <a class="pmain" href="#/job/${r.job_id}">
        <div class="pt">${esc(ticketName(r))}</div>
        <div class="ps">${Number(r.amount) > 0 ? `<b class="greentxt">${money(r.amount)}</b> · balance ${money(r.balance)}` : '<b class="redtxt">NO AMOUNT ON IT — open it and put the invoice on</b>'}${r.number ? ` · ${r.kind === 'draw' ? 'draw' : 'invoice'} ${esc(r.number)}` : ''} · sent ${shortDate(r.sent_at)} · <b class="${late ? 'redtxt' : ''}">${r.days} day${r.days === 1 ? '' : 's'} out</b>${r.cost ? ` · cost so far ${money(r.cost)}` : ''}</div>
        ${late ? '<div class="ps redtxt"><b>PAST 30 DAYS — call them</b></div>' : ''}
      </a>
      <div class="lanebtns"><button class="lb on">Sent ${shortDate(r.sent_at)}</button><button class="lb send paid" data-id="${r.id}" data-job="${r.job_id}">Mark it paid</button></div>
    </div>`;
  };
  $app().innerHTML = `<div class="oldgrid oldinv">
    <h1>AR</h1>
    ${d.stuck.length ? `<div class="billgrp stuck" style="--lane:var(--bad)"><div class="bgh"><b>DONE — NOT GETTING PAID YET</b> <span class="lanen">${d.stuck.length}</span></div>
      ${d.stuck.map(t => `<div class="prow" data-hover="${t.id}" style="border-left-color:var(--bad)">
        <a class="pmain" href="#/job/${t.id}"><div class="pt">${esc(ticketName(t))}</div>
          <div class="ps">${esc(t.customer_name)} · done ${shortDate(t.done_at)}${t.invoices.filter(isBill).length ? ' · ' + t.invoices.filter(isBill).map(i => `${esc(i.number) || 'no #'} ${money(i.amount)}`).join(', ') : ''}</div>
          <div class="ps redtxt"><b>${t.why.map(w => w.toUpperCase()).join(' · ')}</b></div></a>
        <div class="lanebtns"><a class="lb send" href="#/jobcost/${t.id}/invoices">Fix it</a><button class="lb nocharge" data-job="${t.id}">No charge</button></div>
      </div>`).join('')}</div>` : ''}
    <div class="invhead">
      <div><div class="ih1">${money(total)}</div><div class="ih2">open receivable</div></div>
      ${BUCKETS.map(([k, l, lo, hi]) => { const v = sumIn(lo, hi); return v ? `<div class="${lo > 60 ? 'warn' : ''}"><div class="ih1">${money(v)}</div><div class="ih2">${l}</div></div>` : ''; }).join('')}
    </div>
    ${rows.length ? names.map(c => {
      const list = byCust[c].sort((a, b) => String(a.sent_at).localeCompare(String(b.sent_at)));
      const owed = round2(list.reduce((a, r) => a + Number(r.amount), 0));
      const late = list.filter(r => r.days > 30).length;
      return `<div class="psec"><h3>${esc(c)} <span class="n">${list.length}</span> <span class="n">${money(owed)}</span>${late ? `<span class="nbad">${late} past 30 days</span>` : ''}</h3>${list.map(row).join('')}</div>`;
    }).join('') : '<div class="card empty">Nothing out there. Everything you have sent has been paid.</div>'}
  </div>`;
  // No charge: the only other way off DONE — NOT GETTING PAID YET
  $app().querySelectorAll('.nocharge').forEach(b => b.onclick = async () => {
    const t = d.stuck.find(x => x.id === Number(b.dataset.job));
    if (!confirm(`No charge on ${ticketName(t)}?\n\nIt comes off DONE — NOT GETTING PAID YET for good.`)) return;
    b.disabled = true;
    try { await doAndProve(`/w/job/${t.id}/no-charge`, { method: 'POST', body: { value: true } }, '/w/ar', bk => !bk.stuck.some(x => x.id === t.id), `${ticketName(t)} — no charge (read back, it's off the list)`); arPage(); }
    catch (e) { fail(e); b.disabled = false; }
  });
  // Hover a row → the whole job file
  document.querySelectorAll('.arpeek').forEach(x => x.remove());
  const tip = document.createElement('div'); tip.className = 'arpeek'; document.body.appendChild(tip);
  let hv = null, ht = null;
  $app().querySelectorAll('[data-hover]').forEach(row => {
    row.onmouseenter = e => { const id = row.dataset.hover; hv = id; clearTimeout(ht); ht = setTimeout(async () => {
      try {
        const [L, f] = await Promise.all([call(`/w/job/${id}`), call(`/api/jobs/${id}`).catch(() => ({ files: [] }))]);
        if (hv !== id) return;
        const j = L.job, cost = round2(L.shares.reduce((a, x) => a + x.cost, 0) + L.material.reduce((a, l) => a + Number(l.line_total), 0));
        tip.innerHTML = `<h4>${esc(ticketName(j))}</h4><div class="pm">${esc(j.customer_name)}${j.tenant ? ' · ' + esc(j.tenant) : ''} · ${esc(L.places.join(' + '))}</div>
          ${j.scope ? `<div class="pv">${esc(j.scope)}</div>` : ''}
          <div class="pk">Invoices</div>${L.invoices.map(i => `<div class="prow"><span>${i.kind === 'placeholder' ? 'Placeholder' : i.kind === 'draw' ? 'Draw' : 'Invoice'} ${esc(i.number) || ''}${i.sent_at ? ' · sent ' + shortDate(i.sent_at) : ''}${i.paid_at ? ' · paid ' + shortDate(i.paid_at) : ''}</span><b>${money(i.amount)}</b></div>`).join('') || '<div class="pnote">none</div>'}
          <div class="pk">Cost so far</div><div class="prow"><span>Labor + material</span><b>${money(cost)}</b></div>
          <div class="pk">Days worked</div><div class="pnote">${[...new Set(L.shares.map(x => shortDate(x.work_date)))].join(', ') || 'none'}</div>
          <div class="pk">File cabinet</div><div class="pnote">${(f.files || []).length} file${(f.files || []).length === 1 ? '' : 's'}${j.scope_ok ? ' · scope checked' : ''}${j.pics_ok ? ' · pictures checked' : ''}</div>`;
        const r = row.getBoundingClientRect();
        tip.classList.add('on'); tip.style.left = Math.min(r.left + 40, innerWidth - 340) + 'px';
        const top = r.bottom + 6; tip.style.top = (top + tip.offsetHeight > innerHeight ? Math.max(8, r.top - tip.offsetHeight - 6) : top) + 'px';
      } catch (e) {}
    }, 500); };
    row.onmouseleave = () => { hv = null; clearTimeout(ht); tip.classList.remove('on'); };
  });
  $app().querySelectorAll('.paid').forEach(b => b.onclick = async () => {
    const r = rows.find(x => x.id === Number(b.dataset.id));
    // MONEY CAME IN — IT GETS MARKED PAID. What is still missing off the invoice is said, never a wall.
    const miss = missingToMarkPaid(r);
    b.disabled = true;
    try {
      await doAndProve(`/w/invoices/${r.id}/paid`, { method: 'POST', body: { value: true } }, '/w/ar', bk => !bk.rows.some(x => x.id === r.id),
        `${ticketName(r)} — paid, off AR (read back and it's gone)${miss.length ? ' · still missing: ' + miss.join(', ') : ''}`);
      arPage();
    } catch (e) { fail(e); b.disabled = false; }
  });
}
