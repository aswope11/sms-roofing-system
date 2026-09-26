// SUPPLY HOUSES — rebuilt off the old board.
// The list is what he owes, laid out by due date. A house page groups the bills by the day they are due,
// credits sit under the bill they come off, and one payment covers many bills. Nothing is ever left unapplied.
import { esc, $app, call, doAndProve, crumbs, setTab, fail, toast, delBtn, delX } from './ui.js';
import { money, round2, linesMatchTotal, missingOnSupplyInvoice, paymentTotals, shortDate, shortDateYY, TERMS, termsOf } from './money.js';
import { CHUNK_BYTES } from './rules.js';

const today = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
// THE OLD BOARD'S WORDING, WORD FOR WORD: a due day reads "Due 9-30-26", the blank one "No due date".
const dayLabel = d => d ? `Due ${shortDateYY(d)}` : 'No due date';
// which days he has folded shut, per house — this browser only, same key shape as the old board
const shutState = () => { try { return JSON.parse(localStorage.getItem('sms_supply_shut_v1') || '{}'); } catch (e) { return {}; } };
const setShut = (k, on) => { const st = shutState(); if (on) st[k] = 1; else delete st[k]; try { localStorage.setItem('sms_supply_shut_v1', JSON.stringify(st)); } catch (e) {} };
// DO NOT PAY / Cleared to pay — the old board's three strings, unchanged
const payState = i => isPaid(i) ? { k: 'paid', l: 'Paid' }
  : i.dispute ? { k: 'hold', l: 'DO NOT PAY \u2014 ' + i.dispute }
  : !(i.qty_ok && i.prod_ok && i.price_ok) ? { k: 'hold', l: 'DO NOT PAY \u2014 not checked' }
  : { k: 'ok', l: 'Cleared to pay' };
const isCredit = i => Number(i.amount) < 0;
let paidOpen = false;   // the Paid fold at the bottom of a house ledger
const balance = i => round2(Number(i.amount) - Number(i.paid_sum || 0));
// Paid = he clicked it paid, or the payments cover it.
// Paid = he clicked it paid, the payments cover it, or it was settled before this book (no date known).
const isPaid = i => !!i.paid_at || i.settled || Math.abs(balance(i)) <= 0.004;
const open = i => !isPaid(i);
// A credit counts on the due date of the bill it comes off — never its own.
const dayOf = (i, all) => (i.credit_of && all.find(x => x.id === i.credit_of)?.due_date) || i.due_date || null;
const pastDue = d => !!d && d < today();

export async function supplyPage() {
  setTab('supply'); crumbs([['Supply Houses']]);
  const d = await call('/w/supply');
  const invs = d.invoices;
  // EVERY SUPPLY HOUSE HE USES IS ON THIS PAGE, empty or not — the same five the old board carried,
  // in the order it kept them, plus anything an invoice has been written against.
  const named = (d.houses || []).map(h => h.name);
  const houses = [...named, ...[...new Set(invs.map(i => i.house))].filter(h => h && !named.includes(h)).sort((a, b) => a.localeCompare(b))];
  const openInvs = invs.filter(open);
  // MOST RECENT FIRST — the newest money is the money he is working on.
  const days = [...new Set(openInvs.map(i => dayOf(i, invs)))].sort((a, b) => (b || '0000').localeCompare(a || '0000'));
  const cell = (h, day) => round2(openInvs.filter(i => i.house === h && dayOf(i, invs) === day).reduce((a, i) => a + balance(i), 0));
  const owed = h => round2(openInvs.filter(i => i.house === h).reduce((a, i) => a + balance(i), 0));
  const grand = round2(openInvs.reduce((a, i) => a + balance(i), 0));

  // the three piles that must never grow: money not on a job, bills not cleared to pay, paper nobody has read
  // PAID MEANS DONE. A paid invoice never shows here — he is not opening a job file to bury a closed bill.
  // Only invoices he still owes can land on this list, because those are the ones that still need a home.
  const notOnJob = openInvs.filter(i => !isCredit(i) && Number(i.unplaced) > 0.004);
  const notCleared = openInvs.filter(i => !isCredit(i) && !(i.qty_ok && i.prod_ok && i.price_ok));
  const needReading = invs.filter(i => i.needs_reading || (!i.line_count && !isCredit(i)));

  const pile = (title, list, why, colour) => list.length ? `<details class="card bidstrip"><summary><b>${title}</b> <span class="lanen" style="background:${colour}">${list.length}</span></summary>
    <div class="row"><span class="mute">${esc(why)}</span></div>
    ${list.map(i => `<div class="row"><a href="#/supply/${i.id}">${esc(i.house)} ${esc(i.number) || 'no invoice #'}</a>
      <span class="mute">${money(i.amount)}${Number(i.unplaced) > 0.004 ? ` · <span class="redtxt">${money(i.unplaced)} not on a job</span>` : ''}${i.due_date ? ' · due ' + shortDate(i.due_date) : ''}</span></div>`).join('')}</details>` : '';

  // THE OLD BOARD, PUT BACK: the add-a-house bar on top, then ONE table — every house, what he owes,
  // and a column for every due day in the whole book so the numbers line up down the page.
  $app().innerHTML = `<div class="oldsub">
    <h1>Supply Houses</h1>
    <div class="tadd" id="supAdd">
      <input id="shNew" placeholder="Add a supply house — name it and hit Add">
      <button class="small" id="shAdd">Add</button>
    </div>
    ${pile('Not on a job yet', notOnJob, 'Every one of these is real money that is not in any job cost.', 'var(--bad)')}
    ${pile('Not cleared to pay', notCleared, 'Nothing gets paid until quantity, product and pricing are all checked.', '#ffd24d')}
    ${pile('Need reading', needReading, 'These landed as paper. Nothing was guessed.', 'var(--mute)')}
    <div class="ledwrap"><div class="smsscroll"><table class="suptbl">
      <thead><tr><th class="sh">Supply house</th><th class="sc">Owed</th>
        ${days.map(day => `<th class="sc smsday${pastDue(day) ? ' past' : ''}">${dayLabel(day)}</th>`).join('')}</tr></thead>
      <tbody>${houses.map(h => { const n = openInvs.filter(i => i.house === h).length; const bal = owed(h); return `<tr class="suprow" data-house="${esc(h)}">
          <td class="sh"><b>${esc(h)}</b>${n ? `<small>${n} open</small>` : ''}</td>
          <td class="sc tot ${bal ? '' : 'zero'}">${bal ? money(bal) : '—'}</td>
          ${days.map(day => { const v = cell(h, day); return `<td class="sc smsday${pastDue(day) ? ' past' : ''}${v ? '' : ' none zero'}">${v ? money(v) : '—'}</td>`; }).join('')}</tr>`; }).join('')
        || `<tr><td class="sh" colspan="${days.length + 2}">No supply houses yet — name the first one above.</td></tr>`}</tbody>
      <tfoot><tr><td class="sh"><b>Everything I owe</b></td>
        <td class="sc tot big">${money(grand)}</td>
        ${days.map(day => { const v = round2(houses.reduce((a, h) => a + cell(h, day), 0)); return `<td class="sc tot smsday${pastDue(day) ? ' past' : ''}">${v ? money(v) : '—'}</td>`; }).join('')}</tr></tfoot>
    </table></div></div>
    <div id="supMail"></div>
    <div class="btnrow"><a class="jcpill" href="#/supply/new">+ Add an invoice by hand</a></div>
  </div>`;
  supplyMailStrip(document.getElementById('supMail'));

  // the whole row is the door into that house's ledger — same as the old board
  $app().querySelectorAll('.suprow[data-house]').forEach(r => {
    r.onclick = () => { location.hash = '#/supply/house/' + encodeURIComponent(r.dataset.house); };
  });

  // a new house is on the page, with its own ledger, the moment it is named
  const nameBox = document.getElementById('shNew');
  const addHouse = async () => {
    const name = nameBox.value.trim();
    if (!name) return toast('Name it first.', false);
    try {
      await doAndProve('/w/supply/house', { method: 'POST', body: { name } }, '/w/supply',
        bk => (bk.houses || []).some(h => h.name.toLowerCase() === name.toLowerCase()),
        `${name} added — read back and it is on the book`);
      supplyPage();
    } catch (e) { fail(e); }
  };
  document.getElementById('shAdd').onclick = addHouse;
  nameBox.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); addHouse(); } };
}

// ---------------- 2026, OUT OF HIS EMAIL ----------------
// Every supply house invoice since 1-1-26: vendor, invoice number, date, total, every line it can read,
// the PDF attached. He says once which senders are supply houses. It never sends anything.
async function supplyMailStrip(mount) {
  const st = await call('/api/gmail/status').catch(() => ({ connected: false }));
  if (!st.connected) {
    mount.innerHTML = `<details class="card bidstrip"><summary><b>Bring in 2026 from my email</b> <span class="mute">Gmail is not connected</span></summary>
      <div class="row"><a href="/api/gmail/connect">Connect Gmail — read and file only, it can never send</a></div></details>`;
    return;
  }
  mount.innerHTML = `<details class="card bidstrip"><summary><b>Bring in 2026 from my email</b> <span class="mute">every supply invoice since 1-1-26</span></summary>
    <div class="row"><span class="mute">Invoices with a PDF on them, 1-1-26 forward. You say which senders are supply houses — it never guesses one, and it never sends mail.</span></div>
    <div class="btnrow" style="padding:0 14px 10px"><button class="small ghost" id="supWho">Who has been sending me invoices?</button></div>
    <div id="supWhoList"></div></details>`;

  mount.querySelector('#supWho').onclick = async ev => {
    ev.target.disabled = true; ev.target.textContent = 'Reading the mail\u2026';
    const list = mount.querySelector('#supWhoList');
    try {
      const d = await call('/w/supply-mail/senders');
      list.innerHTML = `${(d.senders || []).map(s => `<div class="row"><label><input type="checkbox" class="supsend" value="${esc(s.addr)}"> ${esc(s.addr)}</label>
          <span class="mute">${s.n} email${s.n === 1 ? '' : 's'}</span></div>`).join('')
        || '<div class="row"><span class="mute">Nothing since 1-1-26 with an invoice PDF on it.</span></div>'}
        <div class="btnrow" style="padding:0 14px 10px"><button class="small" id="supPull">Bring these in</button>
          <span class="mute" id="supPullSay"></span></div>`;
      ev.target.textContent = 'Read the mail again';
      ev.target.disabled = false;
      const pull = list.querySelector('#supPull'), say = list.querySelector('#supPullSay');
      if (!pull) return;
      pull.onclick = async () => {
        const senders = [...list.querySelectorAll('.supsend:checked')].map(c => c.value);
        if (!senders.length) return toast('Tick the ones that are supply houses first.', false);
        pull.disabled = true;
        // a few at a time so nothing times out; it picks up where it left off, and never reads the same email twice
        let made = 0, rounds = 0;
        try {
          while (rounds < 40) {
            rounds++;
            say.textContent = `Reading\u2026 ${made} invoice${made === 1 ? '' : 's'} in so far`;
            const out = await call('/w/supply-mail/import', { method: 'POST', body: { senders, max: 6 } });
            made += (out.made || []).length;
            if (!(out.made || []).length) break;
          }
          const back = await call('/w/supply');
          toast(`${made} invoice${made === 1 ? '' : 's'} in \u2014 read back and the page shows ${back.invoices.length}`);
          supplyPage();
        } catch (e) { pull.disabled = false; say.textContent = ''; fail(e); }
      };
    } catch (e) { ev.target.disabled = false; ev.target.textContent = 'Who has been sending me invoices?'; fail(e); }
  };
}

// ---------------- ONE SUPPLY HOUSE ----------------
export async function supplyHousePage(name) {
  setTab('supply'); crumbs([['Supply Houses', '#/supply'], [name]]);
  const d = await call('/w/supply');
  const invs = d.invoices.filter(i => i.house === name);
  const openInvs = invs.filter(open), paid = invs.filter(isPaid);
  // OLDEST DUE DAY FIRST — inside a house, what he owes first is what he pays first.
  // A bill with no due date can't be first in line, so it sits at the end.
  const days = [...new Set(openInvs.map(i => dayOf(i, invs)))].sort((a, b) => (a || '9999').localeCompare(b || '9999'));
  const dayTotal = day => round2(openInvs.filter(i => dayOf(i, invs) === day).reduce((a, i) => a + balance(i), 0));
  const pays = d.payments.filter(p => p.house === name);
  const byNewest = (a, b) => String(b.inv_date || '').localeCompare(String(a.inv_date || '')) || b.id - a.id;
  const byOldest = (a, b) => String(a.inv_date || '9999').localeCompare(String(b.inv_date || '9999')) || a.id - b.id;

  // ONE ROW, THE OLD BOARD'S ROW: number · PO, the date under it, the credit tag, the money with the
  // due date under it, the DO NOT PAY pill, then Edit, ×, ›. Clicking anywhere else opens the invoice.
  const row = (i, live) => { const st = payState(i), cred = isCredit(i); return `<div class="invrow${cred ? ' smscred' : ''}${isPaid(i) ? ' paidrow' : ''}" data-open="${i.id}"${live ? ` draggable="true" data-inv="${i.id}"` : ''}>
      ${live ? '<span class="grip" title="drag it where you want it">⠿</span>' : ''}
      <span class="ir1"><b>${esc(i.number) || 'no invoice #'}</b>${i.po ? ` · PO ${esc(i.po)}` : ''}
        <div class="ir2">${i.inv_date ? esc(shortDateYY(i.inv_date)) : 'no date'}</div>
        ${cred ? `<span class="smscredtag">${i.credit_of ? 'credit off ' + esc(invs.find(x => x.id === i.credit_of)?.number || '') : 'credit — drop it under a bill'}</span>` : ''}
        ${Number(i.unplaced) > 0.004 ? `<span class="smscredtag redtxt">${money(i.unplaced)} not on a job</span>` : ''}</span>
      <span class="spacer"></span>
      <span class="ir3">${money(i.amount)}<small>${i.due_date ? 'due ' + esc(shortDateYY(i.due_date)) : 'no due date'}</small></span>
      ${live && i.inv_date ? (() => { const k = termsOf(i.inv_date, i.due_date); return `<select class="trmsel" data-id="${i.id}" title="Switch the terms — the due date moves with them">
        ${k ? '' : '<option value="" selected>Set by hand</option>'}
        ${TERMS.map(t => `<option value="${t.k}"${t.k === k ? ' selected' : ''}>${esc(t.l)}</option>`).join('')}
      </select>`; })() : ''}
      ${st.k === 'hold' ? `<span class="paypill pay-hold">${esc(st.l)}</span>` : ''}
      ${isPaid(i) ? `<span class="paypill pay-paid">${i.paid_at ? 'Paid ' + shortDateYY(i.paid_at) : 'Paid — no date on it'}</span>` : ''}
      <button class="ghost small paidtog" data-id="${i.id}" data-paid="${isPaid(i) ? 1 : 0}">${isPaid(i) ? 'Open it again' : 'Mark paid'}</button>
      ${delX('supply', i.id)}
      <span class="jrgo">›</span>
    </div>`; };

  const dayNet = day => round2(openInvs.filter(i => dayOf(i, invs) === day).reduce((a, i) => a + balance(i), 0));
  const dayBills = day => openInvs.filter(i => dayOf(i, invs) === day && !isCredit(i)).length;
  const shut = shutState();
  const dayRows = day => {
    const mine = openInvs.filter(i => dayOf(i, invs) === day);
    // inside the day, the oldest invoice is the one that has been sitting longest — it goes on top
    const bills = mine.filter(i => !i.credit_of).sort(byOldest);
    return bills.map(i => row(i, true) + mine.filter(c => c.credit_of === i.id).map(c => row(c, true)).join('')).join('')
      + mine.filter(i => i.credit_of && !mine.some(x => x.id === i.credit_of)).map(i => row(i, true)).join('');
  };

  $app().innerHTML = `<div class="oldsub">
    <button class="jpback" id="supBack">‹ All supply houses</button>
    <div class="ledhead"><h1>${esc(name)}</h1>
      <div class="ledtot">${money(round2(openInvs.reduce((a, i) => a + balance(i), 0)))}<span>owed · ${openInvs.length} invoice${openInvs.length === 1 ? '' : 's'}</span></div>
    </div>
    ${openInvs.length ? `<div id="smsDueBar">${days.map(day => { const key = name + '|' + (day || ''); return `<div class="dcol${pastDue(day) ? ' past' : ''}" data-key="${esc(key)}">
        <div class="dd">${dayLabel(day)}</div>
        <div class="dt">${money(dayNet(day))}</div>
        <div class="dn">${dayBills(day)} bills${pastDue(day) ? ' · past due' : ''}</div></div>`; }).join('')}</div>` : ''}
    <div class="jpbody">
      ${openInvs.length
        ? days.map(day => { const key = name + '|' + (day || ''), isShut = !!shut[key]; return `<div class="smsduehead${pastDue(day) ? ' past' : ''}${isShut ? ' shut' : ''}" data-key="${esc(key)}">
            <span class="dcar">${isShut ? '▶' : '▼'}</span><span>${dayLabel(day)}</span>
            <span class="dcnt">${dayBills(day)} ${dayBills(day) === 1 ? 'bill' : 'bills'}</span><span class="dsum">${money(dayNet(day))}</span></div>
            ${isShut ? '' : dayRows(day)}`; }).join('')
          + `<div class="ledgrand"><b>Total owed to ${esc(name)}</b><span class="spacer"></span><b>${money(round2(openInvs.reduce((a, i) => a + balance(i), 0)))}</b></div>`
        : `<div class="tixrow" style="color:var(--mute)">Nothing open against ${esc(name)}.</div>`}

      <div class="jpcard" style="margin-top:20px">
        <h4>Drop ${esc(name)} invoices here</h4>
        <div class="drop" id="paperdrop">+ Drop the invoice PDFs here — or click to pick<input type="file" hidden multiple accept="application/pdf"></div>
        <p class="help">PDF, CSV, a photo of the ticket. Each one files itself on the invoice whose number is in its name — ${esc(name)} INV52971.pdf lands on INV52971. Anything it cannot match by number is listed, never guessed onto something.</p>
        <div class="mute" id="paperprog"></div>
        <div class="btnrow"><a class="jcpill" href="#/supply/new?house=${encodeURIComponent(name)}">＋ Add an invoice by hand</a>
          <button class="small ghost" id="logpay">+ Log a payment to ${esc(name)}</button>
          <button class="small ghost" id="renameHouse">Rename this house</button></div>
      </div>

      <div class="card"><h2>Payments</h2>
        ${pays.map(p => { const t = paymentTotals(p.lines); return `<details><summary>${shortDate(p.pay_date)} · ${esc(p.method)} ${esc(p.ref)} · ${p.lines.length} lines · <b>${money(t.total)}</b>${t.surcharge ? ` (incl. ${money(t.surcharge)} surcharge)` : ''}${p.voided_at ? ' · <span class="redtxt">taken back</span>' : ''}</summary>
          ${p.lines.map(l => `<div class="row"><span>${esc(l.number)}</span><span>${money(l.amount)}${Number(l.surcharge_pct) ? ` + ${l.surcharge_pct}%` : ''}</span></div>`).join('')}
          <p class="help greentxt">Check it against the receipt: ${p.lines.length} lines adding to ${money(t.subtotal)}${t.surcharge ? `, plus ${money(t.surcharge)} of surcharge,` : ''} comes to ${money(t.total)}.</p>
          ${p.voided_at ? '' : `<button class="small ghost void" data-id="${p.id}">Take this payment back</button>`}</details>`; }).join('') || '<div class="empty">No payments logged.</div>'}
      </div>

      ${paid.length ? `<button class="paidbubble${paidOpen ? ' on' : ''}" id="paidfold">${paidOpen ? '▾' : '▸'} Paid <b>${paid.length}</b> <span class="spacer"></span><b>${money(round2(paid.reduce((a, i) => a + Number(i.amount), 0)))}</b></button>
        ${paidOpen ? `<div style="opacity:.6">${paid.slice().sort(byNewest).map(i => row(i, false)).join('')}</div>` : ''}` : ''}
    </div>
    <div id="payBox"></div>
  </div>`;

  document.getElementById('supBack').onclick = () => { location.hash = '#/supply'; };
  const foldBtn = document.getElementById('paidfold');
  if (foldBtn) foldBtn.onclick = () => { paidOpen = !paidOpen; supplyHousePage(name); };
  // a day heading folds shut and stays shut, in this browser, per house — same as the old board
  $app().querySelectorAll('.smsduehead[data-key]').forEach(h => {
    h.onclick = () => { const k = h.dataset.key; setShut(k, !shutState()[k]); supplyHousePage(name); };
  });
  // a pill at the top opens that day if it was shut, then walks down to it
  $app().querySelectorAll('#smsDueBar .dcol[data-key]').forEach(c => {
    c.onclick = () => {
      const k = c.dataset.key;
      if (shutState()[k]) { setShut(k, false); supplyHousePage(name); return; }
      const head = [...$app().querySelectorAll('.smsduehead')].find(x => x.dataset.key === k);
      if (head) head.scrollIntoView({ behavior: 'smooth', block: 'start' });
      $app().querySelectorAll('#smsDueBar .dcol').forEach(x => x.classList.toggle('here', x.dataset.key === k));
    };
  });
  // clicking the row anywhere that is not a control opens the invoice
  $app().querySelectorAll('.invrow[data-open]').forEach(r => {
    r.onclick = ev => { if (ev.target.closest('button,a,select,input,.delx')) return; location.hash = '#/supply/' + r.dataset.open; };
  });
  // DRAG THEM INTO THE ORDER HE PAYS THEM. A credit dropped under a bill ties itself to that bill.
  let dragging = null;
  $app().querySelectorAll('.invrow[data-inv]').forEach(r => {
    r.ondragstart = e => { dragging = r; r.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; };
    r.ondragend = async () => {
      r.classList.remove('dragging'); dragging = null;
      const rows = [...$app().querySelectorAll('.invrow[data-inv]')].map(x => Number(x.dataset.inv));
      const byId = Object.fromEntries(invs.map(i => [i.id, i]));
      // a credit ties to the nearest bill above it
      let lastBill = null;
      const body = rows.map(id => { const i = byId[id]; if (!isCredit(i)) { lastBill = id; return { id, credit_of: null }; } return { id, credit_of: lastBill }; });
      try {
        await call('/w/supply/order', { method: 'PUT', body: { rows: body } });
        const back = await call('/w/supply');
        const seen = back.invoices.filter(x => rows.includes(x.id)).sort((a, b) => (a.ord ?? 99) - (b.ord ?? 99)).map(x => x.id);
        if (String(seen) !== String(rows)) throw new Error('That did not stick — the read-back has them in a different order. Nothing was assumed.');
        toast('Order saved — read back and it matches');
        supplyHousePage(name);
      } catch (e) { fail(e); }
    };
    r.ondragover = e => {
      e.preventDefault();
      if (!dragging || dragging === r) return;
      const box = r.getBoundingClientRect();
      r.parentNode.insertBefore(dragging, (e.clientY - box.top) / box.height > 0.5 ? r.nextSibling : r);
    };
  });

  // click the amount: paid, with the date stamped. Click it again and it is open again.
  $app().querySelectorAll('.paidtog').forEach(b => b.onclick = async ev => {
    ev.preventDefault();
    const id = Number(b.dataset.id), paid = b.dataset.paid !== '1';
    try {
      await call(`/w/supply/${id}/paid`, { method: 'PUT', body: { paid } });
      const back = await call(`/w/supply/${id}`);
      if (!!(back.paid_at || back.settled) !== paid) throw new Error('That did not stick — the read-back does not show it. Nothing was assumed.');
      toast(paid ? `Marked PAID ${shortDate(back.paid_at)} — ${money(Number(back.amount))} (read back and it matches)` : 'Back to open — read back and it matches');
      supplyHousePage(name);
    } catch (e) { fail(e); }
  });
  // SWITCH THE TERMS RIGHT ON THE BILL. The due date moves with them, it is read back off the
  // server before anything is said, and the ledger re-sorts so the oldest one owed is on top again.
  $app().querySelectorAll('.trmsel').forEach(s => {
    s.onclick = ev => ev.stopPropagation();
    s.onchange = async ev => {
      ev.stopPropagation();
      const id = Number(s.dataset.id), terms = s.value;
      if (!terms) return;                       // "Set by hand" is what it already is — nothing to do
      try {
        await call(`/w/supply/${id}/terms`, { method: 'PUT', body: { terms } });
        const back = await call(`/w/supply/${id}`);
        if (termsOf(back.inv_date, back.due_date) !== terms) throw new Error('That did not stick — the read-back does not show it. Nothing was assumed.');
        toast(`${esc(back.number || 'That invoice')} is now due ${shortDateYY(back.due_date)} (read back and it matches)`);
        supplyHousePage(name);
      } catch (e) { fail(e); }
    };
  });
  $app().querySelectorAll('.void').forEach(b => b.onclick = async () => {
    if (!confirm('Take this payment back? Every invoice on it goes back to open exactly as it was. Nothing is deleted.')) return;
    const id = Number(b.dataset.id);
    try { await doAndProve(`/w/payments/${id}/void`, { method: 'POST' }, '/w/supply', bk => !!bk.payments.find(p => p.id === id).voided_at, 'Taken back — read back, the invoices are open again'); supplyHousePage(name); } catch (e) { fail(e); }
  });
  document.getElementById('logpay').onclick = () => payBox(name, openInvs.filter(i => !isCredit(i)), () => supplyHousePage(name));

  // THE PAPER FILES ITSELF BY THE NUMBER IN ITS NAME. Nothing is guessed onto an invoice.
  const drop = document.getElementById('paperdrop'), pinput = drop.querySelector('input'), pprog = document.getElementById('paperprog');
  const upload = async files => {
    const done = [], nomatch = [];
    try {
      for (const file of [...files]) {
        const hit = invs.find(i => i.number && file.name.toUpperCase().includes(String(i.number).toUpperCase()));
        if (!hit) { nomatch.push(file.name); continue; }
        pprog.textContent = `${file.name} → ${hit.number}…`;
        const meta = await call('/api/files', { method: 'POST', body: { supply_invoice_id: hit.id, name: file.name, content_type: file.type || 'application/pdf', size_bytes: file.size } });
        for (let n = 0; n < meta.chunks; n++) {
          const r = await fetch(`/api/files/${meta.id}/chunk/${n}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: file.slice(n * CHUNK_BYTES, (n + 1) * CHUNK_BYTES) });
          if (!r.ok) throw new Error(`${file.name}: piece ${n + 1} failed`);
        }
        await call(`/api/files/${meta.id}/finish`, { method: 'POST' });
        const back = await call(`/w/supply/${hit.id}`);          // proved by a separate read
        if (!back.files.some(f => f.id === meta.id)) throw new Error(`${file.name} did not stick — it is not on ${hit.number} on the read-back`);
        done.push(hit.number);
      }
      pprog.textContent = '';
      toast(`${done.length} PDF${done.length === 1 ? '' : 's'} filed — read back and each one is on its invoice${nomatch.length ? ` · ${nomatch.length} matched no invoice number: ${nomatch.slice(0, 3).join(', ')}` : ''}`, !nomatch.length);
      supplyHousePage(name);
    } catch (e) { pprog.textContent = ''; fail(e); }
  };
  drop.onclick = () => pinput.click();
  pinput.onchange = () => upload(pinput.files);
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); upload(e.dataTransfer.files); };

  // one vendor, one ledger: the rename takes every invoice already on the old name with it
  document.getElementById('renameHouse').onclick = async () => {
    const to = (prompt(`What should ${name} be called?\n\nEvery invoice already on it comes with it — it stays one ledger.`, name) || '').trim();
    if (!to || to === name) return;
    try {
      await doAndProve('/w/supply/house', { method: 'PUT', body: { from: name, to } }, '/w/supply',
        bk => (bk.houses || []).some(h => h.name === to) && !bk.invoices.some(i => i.house === name),
        `${name} is now ${to} — read back and every invoice came with it`);
      location.hash = '#/supply/house/' + encodeURIComponent(to);
    } catch (e) { fail(e); }
  };
}

// One payment, many bills, a surcharge per line if the card charges one.
function payBox(house, list, done) {
  const box = document.getElementById('payBox');
  box.innerHTML = `<div class="card"><h2>Log a payment to ${esc(house)}</h2>
    <form id="pf" class="grid2">
      <label>Date<input name="pay_date" type="date" value="${today()}"></label>
      <label>How it was paid<select name="method"><option>card</option><option>bank</option><option>check</option><option>cash</option><option>other</option></select></label>
      <label>Reference<input name="ref"></label>
      <label>Note<input name="note"></label>
    </form>
    <div class="btnrow"><button class="small ghost" id="tickAll">Tick them all</button><button class="small ghost" id="untickAll">Untick them all</button>
      <label>Same surcharge on every ticked line %<input class="allpct" type="number" step="0.01" style="width:90px"></label></div>
    <table class="tks"><thead><tr><th></th><th>Invoice</th><th class="num">Still open</th><th class="num">Paying now</th><th class="num">Surcharge %</th></tr></thead>
      <tbody>${list.map(i => `<tr data-inv="${i.id}"><td><input type="checkbox" class="tick"></td>
        <td>${esc(i.number)} · ${shortDate(i.inv_date)}</td><td class="num">${money(balance(i))}</td>
        <td><input class="amt" type="number" step="0.01" value="${balance(i)}"></td>
        <td><input class="pct" type="number" step="0.01" value="0"></td></tr>`).join('')}</tbody></table>
    <p class="totals big"></p>
    <div class="btnrow"><button class="savepay">Log this payment</button><button class="small ghost" id="payCancel">Cancel</button></div></div>`;

  const lines = () => [...box.querySelectorAll('tr[data-inv]')].filter(tr => tr.querySelector('.tick').checked)
    .map(tr => ({ invoice_id: Number(tr.dataset.inv), amount: Number(tr.querySelector('.amt').value || 0), surcharge_pct: Number(tr.querySelector('.pct').value || 0) }));
  const show = () => { const t = paymentTotals(lines()); box.querySelector('.totals').innerHTML = `${lines().length} lines ticked ${money(t.subtotal)} · surcharge ${money(t.surcharge)} · <span class="greentxt">what your statement will say ${money(t.total)}</span>`; };
  box.addEventListener('input', show); show();
  box.querySelector('#tickAll').onclick = () => { box.querySelectorAll('.tick').forEach(c => c.checked = true); show(); };
  box.querySelector('#untickAll').onclick = () => { box.querySelectorAll('.tick').forEach(c => c.checked = false); show(); };
  box.querySelector('.allpct').oninput = e => { box.querySelectorAll('tr[data-inv]').forEach(tr => { if (tr.querySelector('.tick').checked) tr.querySelector('.pct').value = e.target.value; }); show(); };
  box.querySelector('#payCancel').onclick = () => { box.innerHTML = ''; };
  box.querySelector('.savepay').onclick = async () => {
    const f = Object.fromEntries(new FormData(document.getElementById('pf')).entries());
    if (!lines().length) return toast('Tick what you paid first.', false);
    try {
      const before = (await call('/w/supply')).payments.length;
      await doAndProve('/w/payments', { method: 'POST', body: { house, ...f, lines: lines() } }, '/w/supply', bk => bk.payments.length === before + 1, 'Payment logged — read back and it matches');
      done();
    } catch (e) { fail(e); }
  };
}

// ---------------- ONE SUPPLY INVOICE ----------------
export async function supplyInvoicePage(idRaw) {
  setTab('supply');
  const isNew = idRaw === 'new';
  const houseFromUrl = decodeURIComponent((location.hash.split('?house=')[1] || '').split('&')[0] || '');
  const inv = isNew ? { house: houseFromUrl, number: '', inv_date: today(), due_date: '', po: '', amount: '', notes: '', books_as: 'Material', lines: [], files: [] } : await call(`/w/supply/${idRaw}`);
  const jobs = await call('/w/tickets');
  crumbs([['Supply Houses', '#/supply'], ...(inv.house ? [[inv.house, `#/supply/house/${encodeURIComponent(inv.house)}`]] : []), [isNew ? 'New invoice' : inv.number || 'Invoice']]);

  const jobOpts = sel => `<option value="">— put it on a job —</option><option value="SHOP" ${sel === 'SHOP' ? 'selected' : ''}>— THE SHOP — keep it in inventory</option>`
    + jobs.map(j => `<option value="${j.id}" ${String(sel) === String(j.id) ? 'selected' : ''}>${esc(j.tag)} — ${esc(j.address)}${j.title ? ' — ' + esc(j.title) : ''}</option>`).join('');
  // A qty of 1 whose own words name a count — the inventory is wrong on that line until it is broken out.
  const lumpCount = l => {
    if (Number(l.qty) !== 1) return 0;
    const m = String(l.description || '').match(/(?:^|[^\d])(\d{1,3})\s*(?:x|@|ea\b|pcs?\b|bdl\b|bundles?\b|boxes?\b|cartons?\b|rolls?\b|sheets?\b|squares?\b)/i);
    const n = m ? Number(m[1]) : 0;
    return n > 1 ? n : 0;
  };
  const lineRow = (l = {}) => `<tr data-lump="${lumpCount(l)}">
    <td><input name="description" value="${esc(l.description || '')}" placeholder="what it is"><input name="sku" value="${esc(l.sku || '')}" placeholder="SKU" class="small"></td>
    <td><input name="qty" type="number" step="0.001" value="${l.qty ?? ''}" style="width:80px"></td>
    <td><input name="unit" value="${esc(l.unit || '')}" style="width:70px"></td>
    <td><input name="unit_price" type="number" step="0.0001" value="${l.unit_price ?? ''}" style="width:90px"></td>
    <td><input name="line_total" type="number" step="0.01" value="${l.line_total ?? ''}" style="width:100px"></td>
    <td><select class="small" name="job">${jobOpts(l.shop ? 'SHOP' : l.job_id)}</select></td>
    <td><button class="del rmline" type="button">×</button>${lumpCount(l) ? `<button class="lb breakup" type="button">Break it up</button>` : ''}</td></tr>
    ${lumpCount(l) ? `<tr class="lumpwarn"><td colspan="7" class="redtxt">INVENTORY IS WRONG ON THIS LINE — it counted 1 where its own words say ${lumpCount(l)}. The invoice total does not change. Only what the app thinks moved.</td></tr>` : ''}`;

  $app().innerHTML = `<h1>${isNew ? 'New supply invoice' : esc(inv.house + ' ' + inv.number) + ' ' + delBtn('supply', inv.id)}</h1>
    <div class="card"><h2>The details</h2>
      <p class="help">Change anything that came off the paper wrong. Whatever was read off the PDF is a starting point, not the truth.
        Nothing here has to be filled in to save — what is still missing is listed at the bottom.</p>
      <form id="head" class="grid2">
        <label>Supply house<input name="house" value="${esc(inv.house)}"></label>
        <label>Invoice #<input name="number" value="${esc(inv.number)}" placeholder="fill it in when you know it"></label>
        <label>Invoice date<input name="inv_date" type="date" value="${inv.inv_date || ''}"></label>
        <label>Due date<input name="due_date" type="date" value="${inv.due_date || ''}"></label>
        <label>Ship date<input name="ship_date" type="date" value="${inv.ship_date || ''}"></label>
        <label>PO<input name="po" value="${esc(inv.po)}"></label>
        <label>Amount<input name="amount" type="number" step="0.01" value="${inv.amount}"></label>
        <label>Books as<select name="books_as">${['Material', 'Equipment', 'Sub'].map(x => `<option ${inv.books_as === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label class="full">Notes<input name="notes" value="${esc(inv.notes || '')}"></label>
      </form>
    </div>
    ${isNew ? '' : `<div class="card"><h2>The three checks</h2>
      <p class="help">Nothing gets paid until all three are on it. Type your initials.</p>
      <div class="grid2">
        <label>Quantity<input id="qty_ok" value="${esc(inv.qty_ok || '')}" placeholder="initials"></label>
        <label>Product<input id="prod_ok" value="${esc(inv.prod_ok || '')}" placeholder="initials"></label>
        <label>Pricing<input id="price_ok" value="${esc(inv.price_ok || '')}" placeholder="initials"></label>
        <label>Something is wrong with it<input id="dispute" value="${esc(inv.dispute || '')}" placeholder="say what — this stops payment"></label>
      </div>
      <div class="btnrow"><button class="small ghost" id="saveFlags">Save the checks</button>
        <span class="help">${inv.qty_ok && inv.prod_ok && inv.price_ok ? `<span class="greentxt">Cleared to pay${inv.checked_at ? ' ' + shortDate(inv.checked_at) : ''}</span>` : '<span class="ambertxt">Not cleared to pay</span>'}</span></div>
    </div>`}
    <div class="card"><h2>Where each product goes</h2>
      <label class="checkline"><input type="checkbox" id="wholeInv"> The whole invoice goes to the same place.</label>
      <div id="wholeWrap" style="display:none"><select id="wholeJob" class="small">${jobOpts('')}</select></div>
      <p class="help">Each product goes where its own box says. Tax and freight ride along with it — a line with no product on it is spread across the products by what they cost.</p>
      <table class="tks"><thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Price</th><th>Total</th><th>Goes to</th><th></th></tr></thead>
        <tbody id="lines">${(inv.lines || []).map(lineRow).join('') || lineRow()}</tbody></table>
      <div class="btnrow"><button class="small ghost" id="addline" type="button">+ Add a line</button></div>
      <p id="check" class="big"></p>
      <p id="placed" class="help"></p>
      <p id="still" class="help"></p>
      <div class="btnrow"><button id="save">Save the invoice</button></div>
    </div>
    ${isNew ? '' : `<div class="card"><h2>The paper</h2>
      ${(inv.files || []).map(f => `<div class="row"><a href="/api/files/${f.id}" target="_blank">${esc(f.name)}</a><span class="mute">${delX('file', f.id)}</span></div>`).join('') || '<div class="empty">Drop the invoice PDF on the job file drawer, or the mail will file it here.</div>'}
    </div>`}`;

  const collect = () => [...document.querySelectorAll('#lines tr')].map(tr => {
    const v = n => tr.querySelector(`[name="${n}"]`)?.value ?? '';
    const job = v('job');
    return { sku: v('sku'), description: v('description'), qty: v('qty'), unit: v('unit'), unit_price: v('unit_price'), line_total: v('line_total'), shop: job === 'SHOP', job_id: job === 'SHOP' || !job ? null : Number(job) };
  }).filter(l => l.description.trim() || Number(l.line_total));

  const check = () => {
    const f = Object.fromEntries(new FormData(document.getElementById('head')).entries());
    const lines = collect();
    const m = linesMatchTotal(lines, f.amount);
    document.getElementById('check').innerHTML = m.ok
      ? `<span class="greentxt">Lines add to ${money(m.sum)} — matches the invoice total</span>`
      : `<span class="redtxt">Lines add to ${money(m.sum)} against an invoice total of ${money(m.total)} — off by ${money(m.off)}</span>`;
    const unplaced = round2(lines.filter(l => !l.shop && !l.job_id).reduce((a, l) => a + Number(l.line_total || 0), 0));
    document.getElementById('placed').innerHTML = unplaced > 0.004
      ? `<span class="redtxt">${money(unplaced)} is not on any job yet</span>`
      : `<span class="greentxt">All ${money(m.sum)} is on a job or in the shop</span>`;
    // EVERYTHING STILL MISSING, IN WRITING, WHILE HE TYPES — and none of it stops the Save button.
    const still = document.getElementById('still');
    if (still) still.innerHTML = (() => { const q = missingOnSupplyInvoice(f, lines);
      return q.length ? `<span class="mute">It saves either way. Still missing: ${esc(q.join('; '))}</span>` : '<span class="greentxt">Nothing missing off this one.</span>'; })();
  };

  document.getElementById('addline').onclick = () => { document.getElementById('lines').insertAdjacentHTML('beforeend', lineRow()); wire(); check(); };
  const wire = () => {
    document.querySelectorAll('.rmline').forEach(b => b.onclick = () => { const tr = b.closest('tr'); const warn = tr.nextElementSibling; if (warn && warn.classList.contains('lumpwarn')) warn.remove(); tr.remove(); check(); });
    document.querySelectorAll('.breakup').forEach(b => b.onclick = () => splitLine(b.closest('tr')));
  };

  // THE SPLITTER: the one line becomes the rows that actually moved, and they have to tie to the penny.
  function splitLine(tr) {
    const v = n => tr.querySelector(`[name="${n}"]`)?.value ?? '';
    const total = Number(v('line_total') || 0), guess = Number(tr.dataset.lump || 2);
    const box = document.createElement('tr');
    box.className = 'lumpbox';
    const each = round2(total / guess);
    box.innerHTML = `<td colspan="7"><div class="card" style="margin:0">
      <b>Break it into what actually moved</b>
      <p class="help">${esc(v('description'))} — the invoice line says ${money(total)}. These rows have to come to the same thing.</p>
      <table class="tks"><thead><tr><th>What it is</th><th>Part #</th><th>Qty</th><th>Unit</th><th>What one costs</th><th>Line</th></tr></thead>
        <tbody id="lumprows">${Array.from({ length: guess }).map(() => `<tr>
          <td><input class="ld" value="${esc(v('description'))}"></td><td><input class="lsku" value="${esc(v('sku'))}"></td>
          <td><input class="lq" type="number" step="0.001" value="1" style="width:70px"></td>
          <td><input class="lu" value="${esc(v('unit'))}" style="width:70px"></td>
          <td><input class="lp" type="number" step="0.0001" value="${each}" style="width:90px"></td>
          <td><input class="lt" type="number" step="0.01" value="${each}" style="width:100px"></td></tr>`).join('')}</tbody></table>
      <p class="tie big"></p>
      <div class="btnrow"><button class="small ghost" id="lumpAdd" type="button">+ Another row</button>
        <button id="lumpSave" type="button">Save the break-up</button><button class="small ghost" id="lumpCancel" type="button">Cancel</button></div>
    </div></td>`;
    tr.parentNode.insertBefore(box, tr.nextSibling);
    const rows = () => [...box.querySelectorAll('#lumprows tr')].map(r => ({
      description: r.querySelector('.ld').value, sku: r.querySelector('.lsku').value, qty: r.querySelector('.lq').value,
      unit: r.querySelector('.lu').value, unit_price: r.querySelector('.lp').value, line_total: Number(r.querySelector('.lt').value || 0) }));
    const tie = () => {
      const sum = round2(rows().reduce((a, r) => a + Number(r.line_total || 0), 0));
      const off = round2(sum - total);
      box.querySelector('.tie').innerHTML = off === 0
        ? `<span class="greentxt">These rows come to ${money(sum)} — agrees to the penny</span>`
        : `<span class="redtxt">These rows come to ${money(sum)} against ${money(total)} — out by ${money(off)}</span>`;
      // it saves out of balance too — the red line above says by how much, and it is his call
    };
    box.addEventListener('input', tie); tie();
    box.querySelector('#lumpAdd').onclick = () => { const first = box.querySelector('#lumprows tr'); box.querySelector('#lumprows').appendChild(first.cloneNode(true)); tie(); };
    box.querySelector('#lumpCancel').onclick = () => box.remove();
    box.querySelector('#lumpSave').onclick = () => {
      const job = tr.querySelector('[name="job"]').value;
      const html = rows().map(r => lineRow({ ...r, job_id: job === 'SHOP' ? null : Number(job) || null, shop: job === 'SHOP' })).join('');
      const warn = tr.nextElementSibling && tr.nextElementSibling.classList.contains('lumpwarn') ? tr.nextElementSibling : null;
      tr.insertAdjacentHTML('beforebegin', html);
      box.remove(); if (warn) warn.remove(); tr.remove();
      wire(); check();
      toast('Broken out — the invoice total did not change, only what the app thinks moved');
    };
  }
  wire();
  document.getElementById('wholeInv').onchange = e => {
    document.getElementById('wholeWrap').style.display = e.target.checked ? '' : 'none';
    document.querySelectorAll('#lines [name="job"]').forEach(s => s.disabled = e.target.checked);
  };
  document.getElementById('wholeJob').onchange = e => {
    document.querySelectorAll('#lines [name="job"]').forEach(s => { s.value = e.target.value; });
    check();
  };
  $app().addEventListener('input', check);
  check();

  if (document.getElementById('saveFlags')) document.getElementById('saveFlags').onclick = async () => {
    const g = id => document.getElementById(id).value.trim();
    const body = { qty_ok: g('qty_ok'), prod_ok: g('prod_ok'), price_ok: g('price_ok'), dispute: g('dispute'), books_as: inv.books_as, checked_at: g('qty_ok') && g('prod_ok') && g('price_ok') ? today() : null };
    try { await doAndProve(`/w/supply/${inv.id}/flags`, { method: 'PUT', body }, `/w/supply/${inv.id}`, bk => bk.qty_ok === body.qty_ok && bk.dispute === body.dispute, 'Saved — read back and it matches'); supplyInvoicePage(idRaw); } catch (e) { fail(e); }
  };

  document.getElementById('save').onclick = async () => {
    const f = Object.fromEntries(new FormData(document.getElementById('head')).entries());
    const lines = collect();
    // SAVE IS NEVER BLOCKED (9/20/26). It goes in the book with whatever he has — the rest is a note.
    const miss = missingOnSupplyInvoice(f, lines);
    try {
      const out = await call(isNew ? '/w/supply' : `/w/supply/${inv.id}`, { method: isNew ? 'POST' : 'PUT', body: { ...f, lines } });
      const back = await call(`/w/supply/${out.id || inv.id}`);
      if (Number(back.amount) !== (Number(f.amount) || 0) || back.lines.length !== lines.length) throw new Error('That did not stick — the read-back does not match. Nothing was assumed.');
      toast(`Saved — ${back.lines.length} line${back.lines.length === 1 ? '' : 's'} (read back and it matches)${miss.length ? ' · still missing: ' + miss.join('; ') : ''}`);
      location.hash = `#/supply/house/${encodeURIComponent(back.house)}`;
    } catch (e) { fail(e); }
  };
}
