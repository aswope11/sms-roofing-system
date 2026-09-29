// JOB COST SHEET — built on his "Greenhill Actual Job Cost Sheet.xlsx" (9/16/26).
// Summary page first (numbers only, short on a repair); every detail is a pill that opens its own page.
// Scales from a two-scope repair to a 28-scope, 200-day job: the server adds it up, pages fold what they don't need.
import { esc, $app, call, doAndProve, crumbs, fail, ask, toast, delX } from './ui.js';
import { money, round2, isWork, canPlaceholder, isBill, inAR, shortDate, ticketName, budgetTable, pricedBack, payWeekStart, addDays } from './money.js';

const dt = d => { if (!d) return ''; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${m}/${dd}/${y}`; };
const $0 = n => n == null ? '' : money(n);
const PAGES = { labor: 'Labor', materials: 'Materials', cos: 'Change orders', invoices: 'Invoices & draws', ledger: 'General ledger' };
const foldKey = 'smsJobCostFold';
const folds = () => { try { return JSON.parse(localStorage.getItem(foldKey) || '{}') || {}; } catch { return {}; } };
const setFold = (k, v) => { try { const f = folds(); f[k] = v; localStorage.setItem(foldKey, JSON.stringify(f)); } catch {} };

export async function jobCostPage(jobId, sub) {
  const mount = $app();
  const D = await call(`/w/jobcost/${jobId}`);
  const j = D.job;
  const readUrl = `/w/jobcost/${jobId}`;
  const again = () => jobCostPage(jobId, sub);
  const base = [['Customers', '#/'], [j.customer_name, `#/customer/${j.customer_id}`], [j.address, `#/property/${j.property_id}`], [j.title, `#/job/${jobId}`]];
  crumbs(sub ? [...base, ['Job cost sheet', `#/jobcost/${jobId}`], [PAGES[sub] || sub]] : [...base, ['Job cost sheet']]);

  // ---------- the numbers ----------
  const sms = D.labor.filter(s => s.kind !== 'sub'), subs = D.labor.filter(s => s.kind === 'sub');
  // A SUB IS ONE LINE (9/25): a sub's crew shows as the sub — "Jovani $800", "Puma", never Chili or Moscar. Their names stay on Daily Payroll only.
  const subDays = list => { const g = {}; for (const s of list) { const k = `${s.work_date}|${s.shows_as}`;
      const x = (g[k] ||= { work_date: s.work_date, who: s.shows_as, cost: 0, scopes: {} }); x.cost = round2(x.cost + s.cost);
      for (const sc of s.scopes) x.scopes[sc.name] = round2((x.scopes[sc.name] || 0) + Number(sc.amount)); }
    return Object.values(g).sort((a, b) => a.work_date.localeCompare(b.work_date) || a.who.localeCompare(b.who)); };
  const smsTotal = round2(sms.reduce((a, s) => a + s.cost, 0)), subTotal = round2(subs.reduce((a, s) => a + s.cost, 0));
  const laborTotal = round2(smsTotal + subTotal);
  const matTotal = round2(D.material.reduce((a, l) => a + Number(l.line_total), 0));
  const cost = round2(laborTotal + matTotal);
  const bills = D.invoices.filter(isBill);
  const billed = round2(bills.reduce((a, i) => a + Number(i.amount), 0));
  const collected = round2(bills.filter(i => i.paid_at).reduce((a, i) => a + Number(i.amount), 0));
  const coSold = round2(D.cos.reduce((a, c) => a + Number(c.co_amount || 0), 0));
  const coCost = round2(D.cos.reduce((a, c) => a + c.cost, 0));
  const coBilled = round2(D.cos.reduce((a, c) => a + c.billed, 0));
  const profit = round2(billed - cost);
  const margin = billed > 0 ? Math.round(profit / billed * 1000) / 10 : null;
  const scopeT = budgetTable(D.scopes, [...D.labor.flatMap(s => s.scopes), ...(D.coScopes || [])]);   // CO labor rows under the CO's scope names (9/29)
  const catOf = l => l.category || l.house;
  const catT = budgetTable(D.categories, D.material.map(l => ({ name: catOf(l), amount: l.line_total })));
  const pb = pricedBack(matTotal, smsTotal, subTotal);

  const top = title => `
    <div class="btnrow noprint">${sub ? `<a class="jcpill" href="#/jobcost/${jobId}">‹ Job cost sheet</a>` : `<a class="jcpill" href="#/job/${jobId}">‹ Back to the ticket</a>`}<button class="small ghost" id="printIt">Print / save as PDF</button></div>
    <div class="jc-head"><div class="jc-co">SMS Roofing &amp; Waterproofing, LLC · ${esc(title)}</div>
      <h1>${esc(ticketName(j))}</h1>
      <div class="mute">${esc(j.customer_name)}${j.tenant ? ' · ' + esc(j.tenant) : ''}${j.gc ? ' · ' + esc(j.gc) : ''} · as of ${dt(D.today)}</div></div>`;
  const redIf = n => n != null && n < 0 ? ' redtxt' : '';
  const scopeId = name => (D.scopes.find(s => s.name === name) || {}).id;
  const budgetRows = (t, kind) => t.rows.map(r => `<tr><td>${r.name ? esc(r.name) : '<span class="mute">No scope</span>'}${kind === 'scope' && r.name && scopeId(r.name) ? ' <span class="noprint">' + delX('scope', scopeId(r.name)) + '</span>' : ''}</td>
      <td class="num">${r.name ? `<input class="jc-budget" data-kind="${kind}" data-name="${esc(r.name)}" type="number" step="0.01" min="0" value="${r.budget ?? ''}" placeholder="—">` : ''}</td>
      <td class="num">${money(r.current)}</td><td class="num${redIf(r.remaining)}">${$0(r.remaining)}</td></tr>`).join('');
  const budgetTableHTML = (t, label, kind, addLabel) => `
      <table class="grid jc-t">
        <tr><th>${label}</th><th class="num">Budget</th><th class="num">Current</th><th class="num">Remaining</th></tr>
        ${budgetRows(t, kind) || `<tr><td colspan="4" class="empty">—</td></tr>`}
        <tr class="jc-sum"><td>Total</td><td class="num">${t.budget ? money(t.budget) : ''}</td><td class="num">${money(t.current)}</td><td class="num${redIf(t.budget ? t.remaining : null)}">${t.budget ? money(t.remaining) : ''}</td></tr>
      </table>
      <button class="small ghost noprint jc-add" data-kind="${kind}">＋ ${addLabel}</button>`;
  const pill = (key, label, val) => `<a class="jc-pill" href="#/jobcost/${jobId}/${key}"><span>${label}</span><b>${val}</b></a>`;

  if (!isWork(j.tag)) { mount.innerHTML = top('Job cost sheet') + '<div class="card empty">Bid — no costs.</div>'; wire(); return; }

  let html = '';
  if (!sub) {
    // ---------- SUMMARY ----------
    const tiles = [
      j.tag === 'UC' ? ['Contract', `<input class="jc-contract" type="number" step="0.01" min="0" value="${D.contract ? D.contract.contract : ''}" placeholder="—">`] : D.contract ? ['Contract', money(D.contract.contract)] : null,
      D.cos.length ? ['Change orders', money(coSold)] : null,
      D.contract ? ['Revised contract', money(round2(D.contract.contract + coSold))] : null,
      ['Billed', money(billed)],
      ['Collected', money(collected)],
      D.contract ? ['Left to bill', money(D.contract.left)] : null,
      ['Cost', money(cost)],
      ['Profit', money(profit) + (margin != null ? ` <small>${margin}%</small>` : ''), profit < 0 ? 'bad' : 'good'],
    ].filter(Boolean);
    html = top('Job cost sheet') + `
    <div class="jc-tiles">${tiles.map(([l, v, c]) => `<div class="jc-tile ${c || ''}"><div class="jc-tl">${l}</div><div class="jc-tv">${v}</div></div>`).join('')}</div>
    <div class="jc-pills noprint">
      ${pill('labor', 'Labor', money(laborTotal))}
      ${pill('materials', 'Materials', money(matTotal))}
      ${D.cos.length || j.tag === 'JC' || j.tag === 'UC' ? pill('cos', 'Change orders', money(coSold)) : ''}
      ${pill('invoices', 'Invoices & draws', money(billed))}
      ${pill('ledger', 'General ledger', '')}
    </div>
    <div class="jc-two">
      <div class="card scroll"><h2>Labor by scope</h2>${budgetTableHTML(scopeT, 'Scope', 'scope', 'Scope')}</div>
      <div class="card scroll"><h2>Materials by category</h2>${budgetTableHTML(catT, 'Category', 'category', 'Category')}</div>
    </div>
    <div class="card scroll jc-narrow">
      <table class="grid jc-t">
        <tr><td>SMS labor</td><td class="num">${money(smsTotal)}</td></tr>
        <tr><td>Subs</td><td class="num">${money(subTotal)}</td></tr>
        <tr><td>Materials</td><td class="num">${money(matTotal)}</td></tr>
        <tr class="jc-sum"><td>Total cost</td><td class="num">${money(cost)}</td></tr>
        <tr><td>Billed</td><td class="num">${money(billed)}</td></tr>
        <tr class="jc-sum${redIf(profit)}"><td>Profit${margin != null ? ` · ${margin}%` : ''}</td><td class="num">${money(profit)}</td></tr>
        ${D.cos.length ? `<tr><td>Change orders — sold / billed / cost</td><td class="num">${money(coSold)} / ${money(coBilled)} / ${money(coCost)}</td></tr>` : ''}
        <tr><td>Priced back — materials × 1.2 ${money(pb.material)} · SMS ÷ 0.5 ${money(pb.sms)} · subs ÷ 0.75 ${money(pb.subs)}</td><td class="num">${money(pb.total)}</td></tr>
      </table>
    </div>`;
  } else if (sub === 'labor') {
    // ---------- LABOR ----------
    const f = folds();
    const weeks = {};
    for (const s of D.labor) (weeks[payWeekStart(s.work_date)] ||= []).push(s);
    const wkKeys = Object.keys(weeks).sort().reverse();
    const many = wkKeys.length > 3;
    const scopeCell = s => s.scopes.map(x => `${x.name ? esc(x.name) : '<span class="mute">No scope</span>'}${s.scopes.length > 1 ? ` <span class="mute">${Math.round(x.pct * 10) / 10}% ${money(x.amount)}</span>` : ''}`).join('<br>');
    const dayWord = s => Number(s.days) === 0.5 ? 'Half' : Number(s.days) === 1 ? 'Full' : Number(s.days);
    const shareWord = s => `${Math.round((s.split ? s.frac : 1 / s.stops) * 1000) / 10}%`;
    const men = [...new Set(D.labor.map(s => s.kind === 'sub' ? s.shows_as : s.man))].sort();
    const scopeNames = scopeT.rows.map(r => r.name);
    html = top('Labor') + `
    <div class="jc-tiles">
      <div class="jc-tile"><div class="jc-tl">SMS employees</div><div class="jc-tv">${money(smsTotal)}</div></div>
      <div class="jc-tile"><div class="jc-tl">Subs</div><div class="jc-tv">${money(subTotal)}</div></div>
      <div class="jc-tile"><div class="jc-tl">Total labor</div><div class="jc-tv">${money(laborTotal)}</div></div>
      <div class="jc-tile"><div class="jc-tl">Days</div><div class="jc-tv">${new Set(D.labor.map(s => s.work_date)).size}</div></div>
    </div>
    ${D.labor.length > 12 ? `<div class="btnrow noprint">
      <select id="fScope"><option value="">Every scope</option>${scopeNames.map(n => `<option value="${n ? esc(n) : '__none'}">${n ? esc(n) : 'No scope'}</option>`).join('')}</select>
      <select id="fMan"><option value="">Every man</option>${men.map(n => `<option>${esc(n)}</option>`).join('')}</select></div>` : ''}
    ${wkKeys.map(wk => {
      const list = weeks[wk], open = many ? !!f['w' + jobId + wk] : true;
      const wSms = list.filter(s => s.kind !== 'sub'), wSub = list.filter(s => s.kind === 'sub');
      const tot = round2(list.reduce((a, s) => a + s.cost, 0));
      const subBy = {};
      for (const d of subDays(wSub)) (subBy[d.who] ||= []).push(d);
      return `<div class="card scroll jc-week" data-wk="${wk}">
        <h3 class="jc-wkh" data-wk="${wk}">${many ? (open ? '▾ ' : '▸ ') : ''}Week of ${dt(wk)} – ${dt(addDays(wk, 6))}<span>${money(tot)}</span></h3>
        ${open ? `<table class="grid jc-t">
          <tr><th>Date</th><th>Man</th><th>Day</th><th class="num">Share</th><th>Scope</th><th class="num">Amount</th></tr>
          ${wSms.map(s => `<tr data-man="${esc(s.man)}" data-scopes="${esc(JSON.stringify(s.scopes.map(x => x.name)))}"><td>${dt(s.work_date)}</td><td>${esc(s.man)}</td><td>${dayWord(s)}</td><td class="num">${shareWord(s)}</td><td>${scopeCell(s)}</td><td class="num">${money(s.cost)}</td></tr>`).join('')}
          ${Object.entries(subBy).map(([who, rows]) => `<tr class="jc-subhead"><td colspan="5">${esc(who)} — sub</td><td class="num">${money(round2(rows.reduce((a, s) => a + s.cost, 0)))}</td></tr>
            ${rows.map(d => `<tr data-man="${esc(d.who)}" data-scopes="${esc(JSON.stringify(Object.keys(d.scopes)))}"><td>${dt(d.work_date)}</td><td>${esc(d.who)}</td><td>Crew</td><td class="num"></td><td>${Object.keys(d.scopes).map(n => n ? esc(n) : '<span class="mute">No scope</span>').join('<br>')}</td><td class="num">${money(d.cost)}</td></tr>`).join('')}`).join('')}
        </table>` : ''}
      </div>`;
    }).join('') || '<div class="card empty">No labor.</div>'}`;
  } else if (sub === 'materials') {
    // ---------- MATERIALS ----------
    const byCat = {};
    for (const l of D.material) {
      const c = catOf(l);
      const g = (byCat[c] ||= {});
      (g[l.supply_id] ||= { po: l.po, date: l.inv_date, house: l.house, number: l.invoice_number, id: l.supply_id, category: l.category, total: 0, lines: [] });
      g[l.supply_id].total = round2(g[l.supply_id].total + Number(l.line_total));
      g[l.supply_id].lines.push(l);
    }
    const catNames = [...new Set([...D.categories.map(c => c.name), ...Object.keys(byCat)])];
    html = top('Materials') + `
    <div class="card scroll jc-narrow2"><h2>By category</h2>${budgetTableHTML(catT, 'Category', 'category', 'Category')}</div>
    ${D.material.length > 20 ? `<div class="btnrow noprint"><input id="fFind" placeholder="Find PO, invoice #, supply house"></div>` : ''}
    ${Object.entries(byCat).map(([cat, invs]) => `<div class="card scroll">
      <h3 class="jc-cath">${esc(cat)}<span>${money(round2(Object.values(invs).reduce((a, g) => a + g.total, 0)))}</span></h3>
      <table class="grid jc-t">
        <tr><th>PO</th><th>Date</th><th>Supply house</th><th>Invoice #</th><th class="noprint">Category</th><th class="num">Total</th></tr>
        ${Object.values(invs).map(g => `<tr class="jc-inv" data-find="${esc([g.po, g.number, g.house].join(' ').toLowerCase())}"><td>${esc(g.po || '')}</td><td>${dt(g.date)}</td><td>${esc(g.house)}</td><td><a href="#/supply/${g.id}">${esc(g.number)}</a></td>
          <td class="noprint"><select class="jc-cat" data-inv="${g.id}">${[...new Set([cat, ...catNames])].map(n => `<option ${n === cat ? 'selected' : ''}>${esc(n)}</option>`).join('')}<option value="__new">＋ New category</option></select></td>
          <td class="num">${money(g.total)}</td></tr>`).join('')}
      </table></div>`).join('') || '<div class="card empty">No materials.</div>'}`;
  } else if (sub === 'cos') {
    // ---------- CHANGE ORDERS ----------
    html = top('Change orders') + `
    <div class="card scroll">
      <table class="grid jc-t">
        <tr><th>Change order</th><th class="num">Sold</th><th class="num">Billed</th><th class="num">Labor</th><th class="num">Materials</th><th class="num">Cost</th><th class="num">Profit</th></tr>
        ${D.cos.map(c => `<tr><td><a href="#/jobcost/${c.id}">${esc(c.title)}</a></td>
          <td class="num"><input class="jc-coamt" data-co="${c.id}" type="number" step="0.01" min="0" value="${c.co_amount ?? ''}" placeholder="—"></td>
          <td class="num">${money(c.billed)}</td><td class="num">${money(c.labor)}</td><td class="num">${money(c.material)}</td><td class="num">${money(c.cost)}</td>
          <td class="num${redIf(round2((Number(c.co_amount) || c.billed) - c.cost))}">${money(round2((Number(c.co_amount) || c.billed) - c.cost))}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">None.</td></tr>'}
        <tr class="jc-sum"><td>Total</td><td class="num">${money(coSold)}</td><td class="num">${money(coBilled)}</td><td class="num">${money(round2(D.cos.reduce((a, c) => a + c.labor, 0)))}</td><td class="num">${money(round2(D.cos.reduce((a, c) => a + c.material, 0)))}</td><td class="num">${money(coCost)}</td><td class="num">${money(round2(coSold - coCost))}</td></tr>
      </table>
    </div>`;
  } else if (sub === 'invoices') {
    // ---------- INVOICES & DRAWS ----------
    const L = await call(`/w/job/${jobId}`);
  const invRow = i => `<tr>
    <td>${i.kind === 'placeholder' ? 'Placeholder' : i.kind === 'draw' ? 'Draw' : 'Real invoice'}${i.name ? ' — ' + esc(i.name) : ''}</td>
    <td>${esc(i.number) || '<span class="mute">no number</span>'}</td>
    <td class="num">${money(i.amount)}</td>
    <td>${i.inv_date ? shortDate(i.inv_date) : ''}${i.work_date ? `<div class="mute">day worked ${shortDate(i.work_date)}</div>` : ''}</td>
    <td>${isBill(i) ? (i.sent_at ? `<span class="greentxt">sent ${shortDate(i.sent_at)}</span>` : '<span class="ambertxt">not sent</span>') : '<span class="mute">a seat, never sent</span>'}</td>
    <td>${isBill(i) ? (i.paid_at ? `<span class="greentxt">paid ${shortDate(i.paid_at)}</span>` : inAR(i) ? '<span class="redtxt">in AR</span>' : '') : ''}</td>
    <td class="btnrow" style="margin:0">
      <button class="small ghost inv-edit" data-id="${i.id}">Edit</button>
      ${i.kind === 'placeholder' && Number(i.amount) > 0 ? `<button class="small ghost inv-zero" data-id="${i.id}">Zero it</button>` : ''}
      ${isBill(i) ? `<button class="small ghost inv-sent" data-id="${i.id}" data-v="${i.sent_at ? 0 : 1}">${i.sent_at ? 'Un-mark sent' : 'Mark sent'}</button>` : ''}
      ${delX('invoice', i.id)}
      ${isBill(i) && i.sent_at ? `<button class="small ghost inv-paid" data-id="${i.id}" data-v="${i.paid_at ? 0 : 1}">${i.paid_at ? 'Un-mark paid' : 'Mark paid'}</button>` : ''}
    </td></tr>`;

    html = top('Invoices & draws') + `
    <div class="jc-tiles">
      <div class="jc-tile"><div class="jc-tl">Billed</div><div class="jc-tv">${money(billed)}</div></div>
      <div class="jc-tile"><div class="jc-tl">Collected</div><div class="jc-tv">${money(collected)}</div></div>
      <div class="jc-tile"><div class="jc-tl">Customer owes</div><div class="jc-tv">${money(round2(bills.filter(i => i.sent_at && !i.paid_at).reduce((a, i) => a + Number(i.amount), 0)))}</div></div>
      ${D.contract ? `<div class="jc-tile"><div class="jc-tl">Left to bill</div><div class="jc-tv">${money(D.contract.left)}</div></div>` : ''}
    </div>
    <div class="card scroll noprint">
      <h2>Invoices on this ticket</h2>
      <table class="grid">
        <tr><th>What</th><th>Number</th><th class="num">Amount</th><th>Date</th><th>Sent</th><th>Paid</th><th></th></tr>
        ${L.invoices.map(invRow).join('') || '<tr><td colspan="7" class="empty">None yet.</td></tr>'}
      </table>
      <div class="btnrow">
        ${canPlaceholder(j.tag) ? '<button class="small ghost" id="addPh">+ Placeholder (priced seat)</button>' : ''}
        <button class="small ghost" id="addReal">+ Real invoice</button>
        <button class="small ghost" id="addDraw">+ Draw</button>
      </div>
    </div>`;
    mount.innerHTML = html; wire();
    const jobUrl = `/w/job/${jobId}`;
  const q = s => mount.querySelector(s);
  const run = async (fn) => { try { await fn(); again(); } catch (e) { fail(e); } };
  const act = (path, body, check, msg) => doAndProve(path, { method: path.endsWith('scope') || path.endsWith('plan') || path.endsWith('check') ? 'PUT' : 'POST', body }, jobUrl, check, msg);

  const addInv = kind => {
    const number = ask(kind === 'placeholder' ? 'QuickBooks number for the placeholder (blank if none yet)' : 'Invoice number'); if (number === null) return;
    const amount = ask(kind === 'placeholder' ? 'Price on the placeholder — it goes in WITH a price' : 'Dollar amount'); if (amount === null) return;
    const inv_date = ask('Invoice date (YYYY-MM-DD, blank for none)', L.today); if (inv_date === null) return;
    const work_date = kind === 'placeholder' ? ask('Day worked this seat covers (YYYY-MM-DD)', L.lastWorkDate || L.today) : null;
    const before = L.invoices.length;
    run(() => act('/w/invoices', { job_id: jobId, kind, number, amount, inv_date: inv_date || null, work_date: work_date || null }, b => b.invoices.length === before + 1));
  };
  if (q('#addPh')) q('#addPh').onclick = () => addInv('placeholder');
  q('#addReal').onclick = () => addInv('real');
  q('#addDraw').onclick = () => addInv('draw');
  mount.querySelectorAll('.inv-edit').forEach(b => b.onclick = () => {
    const i = L.invoices.find(x => x.id === Number(b.dataset.id));
    const number = ask('Invoice number', i.number); if (number === null) return;
    const amount = ask('Dollar amount', String(Number(i.amount))); if (amount === null) return;
    const inv_date = ask('Invoice date (YYYY-MM-DD)', i.inv_date || ''); if (inv_date === null) return;
    run(() => doAndProve(`/w/invoices/${i.id}`, { method: 'PUT', body: { number, amount, inv_date: inv_date || null, name: i.name } }, jobUrl,
      bk => { const x = bk.invoices.find(y => y.id === i.id); return x && x.number === number && Number(x.amount) === Number(amount); }));
  });
  mount.querySelectorAll('.inv-zero').forEach(b => b.onclick = () => {
    if (!confirm('Zero this placeholder? It becomes the cost sheet and is named Job Cost 1, 2, 3 in order.')) return;
    const id = Number(b.dataset.id);
    run(() => act(`/w/invoices/${id}/zero`, {}, bk => { const x = bk.invoices.find(y => y.id === id); return x && Number(x.amount) === 0 && /^Job Cost \d+$/.test(x.name); }));
  });
  mount.querySelectorAll('.inv-sent').forEach(b => b.onclick = () => {
    const id = Number(b.dataset.id), v = b.dataset.v === '1';
    if (v && !confirm('Mark it sent? Only do this after you have actually emailed it to the customer. This starts the AR clock.')) return;
    run(() => act(`/w/invoices/${id}/sent`, { value: v }, bk => !!bk.invoices.find(y => y.id === id).sent_at === v));
  });
  mount.querySelectorAll('.inv-paid').forEach(b => b.onclick = () => {
    const id = Number(b.dataset.id), v = b.dataset.v === '1';
    run(() => act(`/w/invoices/${id}/paid`, { value: v }, bk => !!bk.invoices.find(y => y.id === id).paid_at === v));
  });

    return;
  } else {
    // ---------- GENERAL LEDGER ----------
    const rows = [
      ...bills.map(i => ({ date: i.inv_date || '', kind: i.kind === 'draw' ? 'Draw' : 'Invoice', ref: i.number || '', what: j.customer_name, inn: Number(i.amount), out: 0 })),
      ...sms.map(s => ({ date: s.work_date, kind: 'Labor', ref: s.man, what: s.scopes.map(x => x.name).filter(Boolean).join(' · '), inn: 0, out: s.cost })),
      ...subDays(subs).map(d => ({ date: d.work_date, kind: 'Sub', ref: d.who, what: Object.keys(d.scopes).filter(Boolean).join(' · '), inn: 0, out: d.cost })),
      ...D.material.map(l => ({ date: l.inv_date, kind: 'Material', ref: `${l.house} ${l.invoice_number || ''}`, what: [l.sku, l.description].filter(Boolean).join(' '), inn: 0, out: Number(l.line_total) })),
    ].sort((x, y) => String(x.date).localeCompare(String(y.date)));
    let bal = 0;
    html = top('General ledger') + `
    <div class="card scroll"><table class="grid jc-t">
      <tr><th>Date</th><th>Type</th><th>Reference</th><th>Description</th><th class="num">In</th><th class="num">Out</th><th class="num">Balance</th></tr>
      ${rows.map(r => { bal = round2(bal + r.inn - r.out); return `<tr><td>${dt(r.date)}</td><td>${r.kind}</td><td>${esc(r.ref)}</td><td>${esc(r.what)}</td><td class="num">${r.inn ? money(r.inn) : ''}</td><td class="num">${r.out ? money(r.out) : ''}</td><td class="num${redIf(bal)}">${money(bal)}</td></tr>`; }).join('') || '<tr><td colspan="7" class="empty">—</td></tr>'}
      <tr class="jc-sum"><td colspan="4">Total</td><td class="num">${money(billed)}</td><td class="num">${money(cost)}</td><td class="num${redIf(profit)}">${money(profit)}</td></tr>
    </table></div>`;
  }
  mount.innerHTML = html;
  wire();

  function wire() {
    const pr = mount.querySelector('#printIt'); if (pr) pr.onclick = () => window.print();
    const run = async fn => { try { await fn(); again(); } catch (e) { fail(e); } };
    // budgets: type the number, it saves and reads back
    mount.querySelectorAll('.jc-budget').forEach(inp => inp.onchange = () => {
      const kind = inp.dataset.kind, name = inp.dataset.name, budget = inp.value === '' ? null : Number(inp.value);
      run(() => doAndProve(`${readUrl}/${kind}`, { method: 'PUT', body: { name, budget } }, readUrl,
        back => { const r = (kind === 'scope' ? back.scopes : back.categories).find(x => x.name === name); return r && (r.budget == null ? budget == null : Number(r.budget) === budget); },
        `${name} budget ${budget == null ? 'cleared' : money(budget)} — read back and it matches`));
    });
    mount.querySelectorAll('.jc-add').forEach(btn => btn.onclick = () => {
      const kind = btn.dataset.kind;
      const name = ask(kind === 'scope' ? 'Scope name' : 'Category name'); if (name === null) return;   // blank saves and waits for its name
      const b = ask('Budget (blank for none)', ''); if (b === null) return;
      const budget = b === '' ? null : Number(b);
      run(() => doAndProve(`${readUrl}/${kind}`, { method: 'PUT', body: { name, budget } }, readUrl,
        back => (kind === 'scope' ? back.scopes : back.categories).some(x => x.name === name), `${name} added — read back and it's there`));
    });
    mount.querySelectorAll('.jc-cat').forEach(sel => sel.onchange = () => {
      let category = sel.value;
      if (category === '__new') { category = ask('New category name'); if (category === null) { again(); return; } }
      const inv = Number(sel.dataset.inv);
      run(() => doAndProve(`${readUrl}/material-category`, { method: 'PUT', body: { invoice_id: inv, category } }, readUrl,
        back => back.material.filter(l => l.supply_id === inv).every(l => (l.category || l.house) === category), `Moved to ${category} — read back and it matches`));
    });
    const ct = mount.querySelector('.jc-contract');
    if (ct) ct.onchange = () => {
      const amount = ct.value === '' ? null : Number(ct.value);
      run(() => doAndProve(`${readUrl}/contract`, { method: 'PUT', body: { amount } }, readUrl,
        back => amount == null ? back.contract == null : back.contract && Number(back.contract.contract) === amount,
        `Contract ${amount == null ? 'cleared' : money(amount)} — read back and it matches`));
    };
    mount.querySelectorAll('.jc-coamt').forEach(inp => inp.onchange = () => {
      const co_id = Number(inp.dataset.co), amount = inp.value === '' ? null : Number(inp.value);
      run(() => doAndProve(`${readUrl}/co-amount`, { method: 'PUT', body: { co_id, amount } }, readUrl,
        back => { const c = back.cos.find(x => x.id === co_id); return c && (c.co_amount == null ? amount == null : Number(c.co_amount) === amount); },
        `Change order ${amount == null ? 'cleared' : money(amount)} — read back and it matches`));
    });
    mount.querySelectorAll('.jc-wkh').forEach(h => h.onclick = () => { const k = 'w' + jobId + h.dataset.wk; setFold(k, !folds()[k]); again(); });
    const fs = mount.querySelector('#fScope'), fm = mount.querySelector('#fMan');
    const filt = () => mount.querySelectorAll('tr[data-man]').forEach(tr => {
      const okS = !fs || !fs.value || JSON.parse(tr.dataset.scopes).includes(fs.value === '__none' ? '' : fs.value);
      const okM = !fm || !fm.value || tr.dataset.man === fm.value;
      tr.style.display = okS && okM ? '' : 'none';
    });
    if (fs) fs.onchange = filt; if (fm) fm.onchange = filt;
    const ff = mount.querySelector('#fFind');
    if (ff) ff.oninput = () => { const q = ff.value.toLowerCase().trim(); mount.querySelectorAll('tr.jc-inv').forEach(tr => { tr.style.display = !q || tr.dataset.find.includes(q) ? '' : 'none'; }); };
  }
}
