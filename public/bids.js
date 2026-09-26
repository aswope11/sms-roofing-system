// BIDS — one page, one header, three things stacked: the calendar, what he owes, and his templates.
// A bid still belongs to a customer and a property; this page is how he gets to them.
import { esc, $app, call, doAndProve, crumbs, setTab, fail, ask, toast } from './ui.js';
import { money, bidState, sortBids, shortDateYY, addDays } from './money.js';
import { BID_CATS } from './bid.js';
import { SS_TEMPLATES, OTHER_TEMPLATES, LINK_TEMPLATES, PULLOUT_TEMPLATES } from './templates.js';

const LANE = { late: 'var(--bad)', today: 'var(--bad)', tomorrow: '#ffd24d', soon: '#ffd24d', ok: 'var(--mute)', nodate: 'var(--line)' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
let calMonth = null;   // 'YYYY-MM', remembered while the app is open

export async function bidsPage() {
  setTab('bids'); crumbs([['Bids']]);
  const d = await call('/w/bids');
  const owe = sortBids(d.owe, d.today);
  const chase = owe.filter(b => ['late', 'today', 'tomorrow', 'soon'].includes(b.state.level));
  if (!calMonth) calMonth = d.today.slice(0, 7);

  // 1 — CALENDAR: the month laid out like the schedule board, every bid sitting on the day it's due.
  const [y, m] = calMonth.split('-').map(Number);
  const first = `${calMonth}-01`;
  const startPad = new Date(first + 'T12:00:00').getDay();               // Sunday first, same as the old board
  const daysIn = new Date(y, m, 0).getDate();
  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let dd = 1; dd <= daysIn; dd++) cells.push(`${calMonth}-${String(dd).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  const dueOn = day => [...owe, ...d.sent].filter(b => b.bid_due === day);
  const cal = `<div class="bidcal">
    <div class="bch"><button class="lb" id="calPrev">‹ Prev</button><b>${MONTHS[m - 1]} ${y}</b><button class="lb" id="calNext">Next ›</button><button class="lb" id="calToday">Today</button></div>
    <div class="bcgrid">
      ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(w => `<div class="bcw">${w}</div>`).join('')}
      ${cells.map(day => {
        if (!day) return '<div class="bcday empty"></div>';
        const list = dueOn(day);
        const isToday = day === d.today;
        return `<div class="bcday${isToday ? ' today' : ''}">
          <div class="bcn">${Number(day.slice(-2))}${isToday ? ' <span class="mute">today</span>' : ''}</div>
          ${list.map(b => { const st = bidState(b, d.today); return `<a class="bcpill" style="border-left-color:${LANE[st.level] || 'var(--line)'}" href="#/job/${b.id}" title="${esc(b.customer_name)}">${esc(b.address)}${b.title ? ' — ' + esc(b.title) : ''}${b.bid_sent_at ? ' ✓' : ''}</a>`; }).join('')}
        </div>`;
      }).join('')}
    </div></div>`;

  // 2 — BIDS OWED: due date first, worst first. Each row opens that bid's job file.
  const row = b => `<div class="prow" style="border-left-color:${LANE[b.state.level]}">
      <a class="pmain" href="#/job/${b.id}">
        <div class="pt">${esc(b.address)}${b.city ? ', ' + esc(b.city) : ''} — ${esc(b.title)}</div>
        <div class="ps">${esc(b.customer_name)}${b.gc ? ' · ' + esc(b.gc) : ''}${b.bid_amount != null ? ' · ' + money(b.bid_amount) : ''}</div>
        <div class="ps ${['late', 'today'].includes(b.state.level) ? 'redtxt' : ['tomorrow', 'soon'].includes(b.state.level) ? 'ambertxt' : ''}"><b>${esc(b.state.say)}</b></div>
      </a></div>`;
  const grp = (color, title, n, body, sub = '') => n ? `<div class="billgrp" style="--lane:${color}"><div class="bgh"><b>${title}</b> <span class="lanen">${n}</span>${sub ? `<span class="spacer"></span><small>${sub}</small>` : ''}</div>${body}</div>` : '';
  const owedList = grp('var(--bad)', 'Bids owed', owe.length, owe.map(row).join(''), 'reminders 3 days and 1 day before the due date')
    + grp('var(--ok)', 'Awarded — ticket made', d.awarded.length, d.awarded.map(b => `<div class="prow" style="border-left-color:var(--ok)">
        <a class="pmain" href="#/job/${b.awarded_job_id || b.id}"><div class="pt">${esc(b.address)}${b.city ? ', ' + esc(b.city) : ''} — ${esc(b.title)}</div>
        <div class="ps">${esc(b.customer_name)} · awarded ${shortDateYY(b.awarded_at)}${b.bid_amount != null ? ' · ' + money(b.bid_amount) : ''}</div></a></div>`).join(''));

  // STEP 1 — who and where. Three fields, each one picks from what he has or takes a new one.
  const cust = await call('/api/customers');
  const props = await call('/api/properties').catch(() => []);
  const box = `<div class="btnrow" style="margin:0 0 12px"><button type="button" id="newBid">New bid</button><button type="button" id="goTpl">Templates</button></div>
  <div class="card talkbox" id="bidForm" style="display:none">
    <label class="full">Customer
      <input id="bsCust" list="bsCustList" placeholder="Standridge — or type a new one"><datalist id="bsCustList">${cust.map(c => `<option value="${esc(c.name)}">`).join('')}</datalist></label>
    <label class="full">Property / address
      <input id="bsAddr" list="bsAddrList" placeholder="6101 Windhaven"><datalist id="bsAddrList">${props.map(p => `<option value="${esc(p.address)}">${esc(p.customer_name || '')}</option>`).join('')}</datalist></label>
    <label class="full">Tenant
      <input id="bsTen" list="bsTenList" placeholder="Cafe Gecko — the one building or space this bid is for"><datalist id="bsTenList">${[...new Set(props.map(p => p.tenant).filter(Boolean))].map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>
    <div class="btnrow"><label>Due date <input id="bsDue" type="date"></label><button id="bsGo">Save and pick the system ›</button></div>
    <p class="help">A new customer or address typed here is created and shows up under Customers. Nothing goes to QuickBooks or the schedule — only Awarded does that.</p>
  </div>`;

  $app().innerHTML = `<div class="oldgrid oldinv"><h1>Bids <span class="lanen big">${chase.length}</span></h1>${box}${cal}${owedList || ''}</div>`;
  // the orange New bid button opens the form; press it again to put it away
  document.getElementById('newBid').onclick = () => { const f = document.getElementById('bidForm'); f.style.display = f.style.display === 'none' ? '' : 'none'; };
  document.getElementById('goTpl').onclick = () => { location.hash = '#/bids/templates'; };

  const again = () => bidsPage();
  const run = async fn => { try { await fn(); again(); } catch (e) { fail(e); } };
  const shift = n => { const dt = new Date(`${calMonth}-01T12:00:00`); dt.setMonth(dt.getMonth() + n); calMonth = dt.toISOString().slice(0, 7); again(); };
  document.getElementById('calPrev').onclick = () => shift(-1);
  document.getElementById('calNext').onclick = () => shift(1);
  document.getElementById('calToday').onclick = () => { calMonth = d.today.slice(0, 7); again(); };

  const go = document.getElementById('bsGo');
  go.onclick = async () => {
    const customer_name = document.getElementById('bsCust').value.trim();
    const address = document.getElementById('bsAddr').value.trim();
    const tenant_name = document.getElementById('bsTen').value.trim();
    const bid_due = document.getElementById('bsDue').value || null;
    go.disabled = true;
    try {
      const known = props.find(p => p.address.toLowerCase() === address.toLowerCase());
      const knownCust = cust.find(c => c.name.toLowerCase() === customer_name.toLowerCase());
      const out = await call('/w/bid-start', { method: 'POST', body: {
        customer_name, customer_id: knownCust ? knownCust.id : null,
        address, property_id: known ? known.id : null, tenant_name, bid_due } });
      const back = await call(`/w/job/${out.job_id}`);
      if (back.job.tag !== 'BID' || back.job.tenant_name !== tenant_name) throw new Error('That did not stick — the read-back does not show the bid. Nothing was assumed.');
      toast(`Bid started — ${customer_name} · ${address}${tenant_name ? ' · ' + tenant_name : ''} (read back and it matches)`);
      location.hash = `#/job/${out.job_id}`;
    } catch (e) { fail(e); go.disabled = false; }
  };

}

// ---------------- TEMPLATES — its own page, laid out the way the old bid app had it ----------------
// One section per kind of roof, in the old order, each one folds open and shut (remembered on this
// computer). A template is a card: the TEMPLATE tag, its name, and Sheet ⤓. No wording under it.
const TPL_SHUT_KEY = 'sms_tpl_shut_v1';
const tplShut = () => { try { return JSON.parse(localStorage.getItem(TPL_SHUT_KEY) || '{}'); } catch (e) { return {}; } };
export async function templatesPage() {
  setTab('bids'); crumbs([['Bids', '#/bids'], ['Templates']]);
  const byCat = { ss: SS_TEMPLATES };
  // Same sorting as the old bid app: a TPO template marked tear off goes under TPO — Tear off.
  for (const t of [...OTHER_TEMPLATES, ...PULLOUT_TEMPLATES]) { const k = t.cat === 'tpo' && t.construction === 'tearoff' ? 'tpo-tearoff' : t.cat; (byCat[k] = byCat[k] || []).push(t); }
  const links = k => LINK_TEMPLATES.filter(t => t.cat === k);
  const shut = tplShut();
  $app().innerHTML = `<div class="tplpage">
    <button class="jpback" id="tplBack">‹ Bids</button>
    <h1>Templates</h1>
    ${BID_CATS.map(([k, label]) => { const list = byCat[k] || []; const isShut = !!shut[k]; const n = list.length + links(k).length; return `<div class="tcat">
      <div class="tcathead" data-cat="${k}"><span>${esc(label)}</span>${n ? `<span class="tcatn">${n}</span>` : ''}<span class="spacer"></span><span class="tcatchev">${isShut ? '▸' : '▾'}</span></div>
      ${isShut ? '' : list.map(t => `<div class="tcard">
        <span class="ttag">TEMPLATE</span><b class="tname">${esc(t.name)}</b><span class="spacer"></span>
        <a class="tsheet" href="/sheets/${esc(t.sheetFile)}" download>Sheet ⤓</a>
      </div>`).join('')}
      ${isShut ? '' : links(k).map(t => `<div class="tcard">
        <span class="ttag">${esc(t.tag)}</span><b class="tname">${esc(t.name)}</b><span class="spacer"></span>
        <a class="tsheet" href="${esc(t.url)}" target="_blank" rel="noopener">Open ↗</a>
      </div>`).join('')}
    </div>`; }).join('')}
  </div>`;
  document.getElementById('tplBack').onclick = () => { location.hash = '#/bids'; };
  $app().querySelectorAll('.tcathead').forEach(h => h.onclick = () => {
    const st = tplShut(); if (st[h.dataset.cat]) delete st[h.dataset.cat]; else st[h.dataset.cat] = 1;
    try { localStorage.setItem(TPL_SHUT_KEY, JSON.stringify(st)); } catch (e) {}
    templatesPage();
  });
}
