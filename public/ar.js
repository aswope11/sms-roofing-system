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
  // QB A/R AGING SUMMARY (10/6): looks exactly like the QuickBooks report. Click a ticket name or its total and it opens the ticket.
  const COLS = [['Current', 0, 0], ['1 - 30', 1, 30], ['31 - 60', 31, 60], ['61 - 90', 61, 90], ['91 and Over', 91, 1e9]];
  const fmt = v => v ? Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
  const fmtT = v => '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const bucketsOf = list => COLS.map(([, lo, hi]) => round2(list.filter(r => r.days >= lo && r.days <= hi).reduce((a, r) => a + Number(r.amount), 0)));
  const asOf = new Date(d.today + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const qbTable = () => {
    if (!rows.length) return '<div class="card empty">Nothing out there. Everything you have sent has been paid.</div>';
    const grand = bucketsOf(rows);
    const body = names.map(c => {
      const byJob = {}; byCust[c].forEach(r => (byJob[r.job_id] ||= []).push(r));
      const jobs = Object.values(byJob).sort((a, b) => ticketName(a[0]).localeCompare(ticketName(b[0])));
      const ct = bucketsOf(byCust[c]);
      return `<tbody class="qbgrp"><tr class="qbparent"><td colspan="8"><span class="qbcar">&#9662;</span>${esc(c)}</td></tr>
        ${jobs.map(js => { const b = bucketsOf(js), t = round2(b.reduce((a, v) => a + v, 0)), id = js[0].job_id;
          return `<tr class="qbrow" data-hover="${id}"><td class="qbname" title="${esc(ticketName(js[0]))}">${esc(ticketName(js[0]))}</td>${b.map(v => `<td class="qbn">${v ? `<a href="#/job/${id}">${fmt(v)}</a>` : ''}</td>`).join('')}<td class="qbn"><a href="#/job/${id}">${fmt(t) || '0.00'}</a></td><td class="qbpay"><button class="lb send paid" data-ids="${js.map(r => r.id).join(',')}">Paid</button></td></tr>`; }).join('')}
        <tr class="qbtot"><td class="qbname">Total for ${esc(c)}</td>${ct.map(v => `<td class="qbn">${fmt(v)}</td>`).join('')}<td class="qbn">${fmtT(round2(ct.reduce((a, v) => a + v, 0)))}</td><td></td></tr></tbody>`;
    }).join('');
    return `<style>
      .qbrep{background:var(--card);color:var(--ink);max-width:1120px;margin-top:12px;padding:26px 24px 32px;border:1px solid var(--line);border-radius:12px;font-size:14px}
      .qbhead{text-align:center;margin-bottom:22px}.qbco{font-size:22px;font-weight:800}.qbsub,.qbasof{font-size:13px;color:var(--mute);margin-top:4px}
      .qbtab{width:100%;border-collapse:collapse;table-layout:fixed}
      .qbtab th{font-weight:700;text-align:right;padding:9px 8px;color:var(--mute);font-size:12px;text-transform:uppercase;letter-spacing:.04em;border-bottom:2px solid var(--line);width:10%}
      .qbtab th:first-child{width:34%}
      .qbtab th:last-child{width:6%}
      .qbtab th{white-space:nowrap}
      .qbpay{text-align:right;padding:4px 0 4px 8px!important}
      .qbpay .lb{padding:3px 10px;font-size:12px}
      .qbtab td{padding:7px 8px;line-height:1.3}
      .qbn{text-align:right;white-space:nowrap}
      .qbname{padding-left:30px!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .qbparent td{cursor:pointer;color:var(--mute);font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:.05em;padding-top:16px}
      .qbcar{display:inline-block;width:16px;color:var(--mute);transition:transform .15s}
      .qbgrp.closed .qbcar{transform:rotate(-90deg)}
      .qbgrp.closed .qbrow{display:none}
      .qbrow td{border-bottom:1px solid var(--panel2)}
      .qbrow .qbname{color:var(--ink);font-weight:600}
      .qbrow a{text-decoration:none}
      .qbrow .qbn a{color:var(--ok);font-weight:600}
      .qbrow a:hover{color:var(--brand);text-decoration:underline}
      .qbrow:hover td{background:var(--panel2)}
      .qbtot td{font-weight:800;border-top:1px solid var(--line)}
      .qbtot .qbn:last-child{color:var(--ok)}
      .qbgrand td{font-weight:800;font-size:15px;padding-top:12px;border-top:2px solid var(--line);border-bottom:3px double var(--line)}
      .qbgrand .qbn:last-child{color:var(--ok)}
    </style><div class="qbrep"><div class="qbhead"><div class="qbco">SMS Roofing &amp; Waterproofing, LLC</div><div class="qbsub">A/R Aging Summary Report</div><div class="qbasof">As of ${asOf}</div></div>
      <table class="qbtab"><thead><tr><th></th>${COLS.map(([l]) => `<th>${l}</th>`).join('')}<th>Total</th><th></th></tr></thead>${body}
      <tfoot><tr class="qbgrand"><td>TOTAL</td>${grand.map(v => `<td class="qbn">${fmtT(v)}</td>`).join('')}<td class="qbn">${fmtT(total)}</td><td></td></tr></tfoot></table></div>`;
  };
  $app().innerHTML = `<div class="oldgrid oldinv">
    ${d.stuck.length ? `<div class="billgrp stuck" style="--lane:var(--bad)"><div class="bgh"><b>DONE — NOT GETTING PAID YET</b> <span class="lanen">${d.stuck.length}</span></div>
      ${d.stuck.map(t => `<div class="prow" data-hover="${t.id}" style="border-left-color:var(--bad)">
        <a class="pmain" href="#/job/${t.id}"><div class="pt">${esc(ticketName(t))}</div>
          <div class="ps">${esc(t.customer_name)} · done ${shortDate(t.done_at)}${t.invoices.filter(isBill).length ? ' · ' + t.invoices.filter(isBill).map(i => `${esc(i.number) || 'no #'} ${money(i.amount)}`).join(', ') : ''}</div>
          <div class="ps redtxt"><b>${t.why.map(w => w.toUpperCase()).join(' · ')}</b></div></a>
        <div class="lanebtns"><a class="lb send" href="#/jobcost/${t.id}/invoices">Fix it</a><button class="lb nocharge" data-job="${t.id}">No charge</button></div>
      </div>`).join('')}</div>` : ''}
    ${qbTable()}
  </div>`;
  // Click a customer line to fold it up, like QuickBooks
  $app().querySelectorAll('.qbparent').forEach(p => p.onclick = () => p.parentElement.classList.toggle('closed'));
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
    const list = String(b.dataset.ids).split(',').map(Number).map(id => rows.find(x => x.id === id)).filter(Boolean);
    if (!list.length || !confirm(`Paid: ${ticketName(list[0])} — ${money(list.reduce((a, r) => a + Number(r.amount), 0))}?\n\nIt comes off AR.`)) return;
    b.disabled = true;
    try {
      // MONEY CAME IN — IT GETS MARKED PAID. What is still missing off the invoice is said, never a wall.
      for (const r of list) {
        const miss = missingToMarkPaid(r);
        await doAndProve(`/w/invoices/${r.id}/paid`, { method: 'POST', body: { value: true } }, '/w/ar', bk => !bk.rows.some(x => x.id === r.id),
          `${ticketName(r)} — paid, off AR (read back and it's gone)${miss.length ? ' · still missing: ' + miss.join(', ') : ''}`);
      }
      arPage();
    } catch (e) { fail(e); b.disabled = false; }
  });
}
