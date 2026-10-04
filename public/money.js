// SMS money + schedule rules. Every rule here has a test in tests/money.test.js.
// Shared by the server (guards) and the browser (screens), so both say the same thing.

export const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
export const money = n => (round2(n) < 0 ? '-$' : '$') + Math.abs(round2(n)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const WORK_TAGS = ['R', 'CO', 'UC', 'JC'];          // BID is never work
export const QB_TAGS = ['R', 'CO', 'UC'];                  // JC never goes to QuickBooks
export const isWork = tag => WORK_TAGS.includes(tag);

// ---------- DATES ----------
export const iso = d => { const x = new Date(d); return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
export function addDays(isoDate, n) { const d = new Date(isoDate + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); }
// His pay week runs Saturday to Friday.
export function payWeekStart(isoDate) { const d = new Date(isoDate + 'T12:00:00'); const back = (d.getDay() + 1) % 7; return addDays(isoDate, -back); }
export function weekDates(startIso) { return Array.from({ length: 7 }, (_, i) => addDays(startIso, i)); }
export const shortDate = isoDate => { const [, m, d] = String(isoDate).split('-'); return `${Number(m)}-${Number(d)}`; };
export const shortDateYY = isoDate => { const [y, m, d] = String(isoDate).split('-'); return `${Number(m)}-${Number(d)}-${y.slice(2)}`; };

// ---------- PAY (rule 1) ----------
// What a man is PAID for a day: his days that day × his day rate — unless he typed that day's actual pay.
export const manDayPay = (days, rate, pay) => pay != null && pay !== '' ? round2(Number(pay)) : round2(Number(days) * Number(rate));

// The actual pay he typed for that man that day (a quote came in), or null = days × day rate.
export function payFor(crewDays, crewId, date) {
  const hit = crewDays.find(d => d.crew_id === crewId && d.work_date === date);
  return hit && hit.pay != null && hit.pay !== '' ? Number(hit.pay) : null;
}

// His days on a date: what was typed, or 1 when he has stops and nothing was typed.
export function daysFor(crewDays, crewId, date, stopCount) {
  const hit = crewDays.find(d => d.crew_id === crewId && d.work_date === date);
  if (hit) return Number(hit.days);
  return stopCount > 0 ? 1 : 0;
}

// ---------- TICKET COST (rule 2) ----------
// What one ticket is CHARGED for a man's day: his day ÷ the jobs he touched that day. No multipliers. Ever.
export const stopCost = (days, rate, stopsThatDay) => stopsThatDay > 0 ? Number(days) * Number(rate) / stopsThatDay : 0;

// ---------- SPLITTING A MAN'S DAY BY PERCENT ----------
// Half day / full day is what he is PAID. The percent is how that day gets divided across his jobs.
// Blank percent = an even share of whatever percent is left. No percents at all = day ÷ stops, same as always.
export function dayFractions(list) {
  const set = list.filter(s => s.pct != null && s.pct !== '');
  const used = set.reduce((a, s) => a + Number(s.pct), 0);
  const unset = list.length - set.length;
  const out = {};
  for (const s of list) out[s.id] = (s.pct != null && s.pct !== '') ? Number(s.pct) / 100 : unset ? Math.max(0, 100 - used) / 100 / unset : 0;
  return out;
}
export function whyCantSplit(pcts) {
  const miss = [];
  const set = pcts.filter(p => p != null && p !== '').map(Number);
  if (set.some(p => !(p >= 0 && p <= 100))) miss.push('every percent has to be between 0 and 100');
  const sum = Math.round(set.reduce((a, p) => a + p, 0) * 100) / 100;
  if (sum > 100) miss.push(`the percents add up to ${sum}% — a day is 100%`);
  else if (set.length === pcts.length && pcts.length && sum !== 100) miss.push(`every job has a percent and they add up to ${sum}% — they have to add up to 100%`);
  return miss;
}

// Every man's share of every stop, with the name it shows under.
// Men who work under a sub (boss_id) show under the boss's name everywhere except Daily Payroll.
export function stopShares({ stops, crew, crewDays }) {
  const byId = Object.fromEntries(crew.map(c => [c.id, c]));
  const out = [];
  const groups = {};
  for (const s of stops) (groups[`${s.work_date}|${s.crew_id}`] ||= []).push(s);
  for (const key in groups) {
    const list = groups[key];
    const [date, cid] = key.split('|');
    const man = byId[cid] || byId[Number(cid)];
    if (!man) continue;
    const days = daysFor(crewDays, man.id, date, list.length);
    const pay = manDayPay(days, man.day_rate, payFor(crewDays, man.id, date));
    const boss = man.boss_id ? byId[man.boss_id] : null;
    const frac = dayFractions(list);
    const split = list.some(x => x.pct != null && x.pct !== '');
    for (const s of list) {
      out.push({
        stop_id: s.id, job_id: s.job_id, work_date: date, crew_id: man.id, man: man.name,
        shows_as: boss ? boss.name : man.name,
        pay_to: boss ? (boss.pay_to || boss.name) : (man.pay_to || man.name),   // a man under a sub is paid through his boss, never on his own
        kind: boss ? 'sub' : man.kind, stops: list.length, days,
        cost: round2(split ? pay * frac[s.id] : pay / list.length),
        frac: frac[s.id], split, day_scope: s.day_scope || '',
      });
    }
  }
  return out;
}

// ---------- A SUB'S ACTUAL PAID (9/25) ----------
// What he typed in "Actual paid" on the sub's page (one job, one day) replaces what the crew's days add up to — on the JOB PAGE only.
// The men's shares are scaled so they add up to it exactly. Never used for the customer bill: he said "job page only".
export function applySubActuals(shares, actuals) {
  const want = {};
  for (const a of actuals || []) if (a.actual != null) want[`${a.pay_to}|${a.work_date}|${a.job_id}`] = Number(a.actual);
  const groups = {};
  shares.forEach((s, i) => { if (s.kind === 'sub') (groups[`${s.pay_to}|${s.work_date}|${s.job_id}`] ||= []).push(i); });
  const out = shares.map(s => ({ ...s }));
  for (const k in groups) {
    if (!(k in want)) continue;
    const idx = groups[k], was = idx.reduce((a, i) => a + out[i].cost, 0);
    let left = want[k];
    idx.forEach((i, n) => {
      const c = n === idx.length - 1 ? round2(left) : round2(was > 0 ? out[i].cost * want[k] / was : want[k] / idx.length);
      left = round2(left - c); out[i].cost = c; out[i].actual = true;
    });
  }
  return out;
}

// ---------- CREW COLOR ----------
// Every SMS employee is one color. Each sub's crew has its own color; a man under a sub shows his boss's color.
export const CREW_COLORS = ['#ff7a3d', '#3dff8f', '#7fe3ff', '#ff4d8d', '#ffd24d', '#b388ff', '#00e5c0', '#ff9cf0'];
export const EMPLOYEE_COLOR = '#7fe3ff';
export function crewColor(man, crew) {
  if (!man) return '';
  const boss = man.boss_id ? crew.find(c => c.id === man.boss_id) : null;
  const head = boss || man;
  if (head.kind !== 'sub') return EMPLOYEE_COLOR;
  // a sub's crew never shares the employees' color
  const subColors = CREW_COLORS.filter(c => c !== EMPLOYEE_COLOR);
  const own = String(head.color || '').toLowerCase();
  return own && own !== EMPLOYEE_COLOR ? own : subColors[head.id % subColors.length];
}
// The crew list order: SMS employees together first, then subs, each man under a sub right under his boss.
// Inside each grouping, the order he dragged (sort_order).
export function groupCrew(crew) {
  const by = (a, b) => (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9) || a.id - b.id;
  const ids = new Set(crew.map(c => c.id));
  const employees = crew.filter(c => c.kind !== 'sub' && !c.boss_id).sort(by).map(c => ({ ...c, group: 'employee' }));
  const bosses = crew.filter(c => c.kind === 'sub' && !(c.boss_id && ids.has(c.boss_id))).sort(by);
  const subs = [];
  for (const b of bosses) {
    subs.push({ ...b, group: 'sub' });
    crew.filter(c => c.boss_id === b.id).sort(by).forEach(m => subs.push({ ...m, group: `under-${b.id}` }));
  }
  return [...employees, ...subs];
}

// ---------- ZELLE (one per job per day, to the pay-to name) ----------
export function zelleLines(shares, jobsById) {
  const g = {};
  for (const s of shares) {
    const k = `${s.work_date}|${s.job_id}|${s.pay_to}`;
    (g[k] ||= { work_date: s.work_date, job_id: s.job_id, pay_to: s.pay_to, amount: 0 }).amount += s.cost;
  }
  return Object.values(g)
    .map(z => { const j = jobsById[z.job_id] || {}; return { ...z, amount: round2(z.amount), memo: `${j.tag || ''} ${j.address || ''}`.trim() }; })
    .filter(z => z.amount > 0)
    .sort((a, b) => a.work_date.localeCompare(b.work_date) || a.memo.localeCompare(b.memo));
}
// The old sub page's Zelle memo: date, ticket type, house number + street with the Rd/Pkwy/N/E junk dropped, 32 characters max.
export function splZelleMemo(workDate, job) {
  const d = shortDate(workDate);
  if (!job) return d;
  const t = String(job.tag || '').toUpperCase();
  const s = String(job.address || job.title || '').replace(/,.*$/, '').split(/\s+/)
    .filter(w => !/^(N|S|E|W|NE|NW|SE|SW|N\.|S\.|E\.|W\.|Rd|Road|Pkwy|Parkway|St|Street|Dr|Drive|Ave|Avenue|Ln|Lane|Blvd|Ct|Cir|Hwy|Trail|Trl|Pl|Way)\.?$/i.test(w)).join(' ');
  return `${d} ${t} ${s}`.replace(/\s+/g, ' ').trim().slice(0, 32);
}
// A sub's pay ledger rows: one per job per day, total = every man's share on that job that day, with the men listed.
export function subLedgerRows(shares) {
  const g = {};
  for (const s of shares) {
    const k = `${s.work_date}|${s.job_id}`;
    (g[k] ||= { work_date: s.work_date, job_id: s.job_id, total: 0, men: [] });
    g[k].total = round2(g[k].total + s.cost);
    g[k].men.push({ name: s.man, amt: s.cost });
  }
  return Object.keys(g).sort().map(k => g[k]);
}
export const zelleText = z => `${shortDate(z.work_date)} - ${z.memo} - ${money(z.amount).replace('.00', '')}`;

// ---------- BILLING (what the customer is charged) ----------
// SMS employees: $50 a man-hour. 1 stop = 8 hrs, 2 = 4 each, 3 = 9-hr day ÷ 3, 4 = 9 ÷ 4. 5 or more = 9 ÷ stops (10/4/26).
export const EMPLOYEE_RATE = 50;
export function billHoursPerStop(stops) {
  if (stops === 1) return 8;
  if (stops === 2) return 4;
  if (stops === 3) return 3;
  if (stops === 4) return 2.25;
  if (stops >= 5) return 9 / stops;   // 5+ stops: same 9-hr day ÷ stops (his answer 10/4/26)
  return null;
}
// A sub (and every man under a sub) is billed at his cost × 1.5.
export function billLabor(share) {
  if (share.kind === 'sub') return { amount: round2(share.cost * 1.5), how: `${share.shows_as} cost ${money(share.cost)} × 1.5` };
  const per = billHoursPerStop(share.stops);
  if (per == null) return { amount: null, how: `${share.man} made ${share.stops} stops that day — NOT PRICED, 5+ stops has never been set` };
  // split by percent: the billed day (8 hrs for 1-2 stops, 9 for 3-4) divides by the same percent as his pay
  const hrs = share.split ? round2(per * share.stops * share.frac) : per;
  return { amount: round2(hrs * share.days * EMPLOYEE_RATE), how: `${share.man} ${round2(hrs * share.days)} hrs × $50` };
}
// Material: cost × 1.2. A JC gets material at cost.
export const materialMarkup = tag => tag === 'JC' ? 1 : 1.2;
export const billMaterial = (cost, tag) => round2(cost * materialMarkup(tag));

// ---------- CUSTOMER INVOICES ----------
// kind: 'placeholder' (a seat with a price), 'real' (the bill), 'draw' (a piece of a contract).
export const isBill = inv => inv.kind === 'real' || inv.kind === 'draw';
export const invoicedAmount = inv => isBill(inv) ? Number(inv.amount) || 0 : 0;   // a placeholder counts $0
export const inAR = inv => isBill(inv) && !!inv.sent_at && !inv.paid_at && !inv.no_charge;

// What is still missing before this one is really "paid". A NOTE, NEVER A BLOCK (9/20/26) —
// he marks it paid when the money came in, and the app writes down whatever isn't filled in yet.
export function missingToMarkPaid(inv) {
  const miss = [];
  if (!isBill(inv)) miss.push('it is a placeholder, not a bill');
  if (!String(inv.number || '').trim()) miss.push('no invoice number');
  if (!(Number(inv.amount) > 0)) miss.push('no dollar amount');
  if (!inv.sent_at) miss.push('never marked sent');
  return miss;
}
// A placeholder is meant to go in WITH A PRICE — $0 is the end state, never the start.
// A NOTE, NEVER A BLOCK (9/20/26): it seats either way and says so until the price is known.
export function missingOnPlaceholder(p) {
  const miss = [];
  if (!(Number(p.amount) > 0)) miss.push('a price — a $0 seat puts nothing in AR and the work disappears');
  return miss;
}
// Zeroed cost sheets are named Job Cost 1, Job Cost 2 … never an invoice number.
export function nextJobCostName(invoices) {
  const used = invoices.map(i => /^Job Cost (\d+)$/.exec(i.name || '')).filter(Boolean).map(m => Number(m[1]));
  return `Job Cost ${used.length ? Math.max(...used) + 1 : 1}`;
}
export const canPlaceholder = tag => QB_TAGS.includes(tag);

// ---------- WHERE A TICKET LIVES ----------
export function inInvoicing(job, invs) {
  if (!job.done_at || job.tabled_at || job.no_charge) return false;
  if (job.tag === 'JC') return false;   // a JC bills by draws. A UC marked done walks the same steps as any ticket (his rule 9/17: done never skips to AR)
  const bills = invs.filter(isBill);
  return bills.length === 0 || bills.some(b => !b.sent_at);
}
// A ticket can never vanish: every ticket is on at least one screen.
export function whereIs(job, invs) {
  const places = [];
  if (!isWork(job.tag)) return ['Bids'];
  if (!job.done_at) places.push('Schedule');
  if (inInvoicing(job, invs)) places.push('Invoicing');
  if (job.done_at && job.tabled_at && !job.no_charge) places.push('Tabled');
  if (invs.some(inAR)) places.push('AR');
  const bills = invs.filter(isBill);
  if (job.done_at && (job.no_charge || (bills.length && bills.every(b => b.paid_at)))) places.push('Filed');
  if (job.done_at && !places.length) places.push('Invoicing');   // backstop: never nowhere
  return places;
}
// A UC is a mini job cost (behaves like a JC): its own contract, every trip bills off it.
export const isContractJob = tag => tag === 'JC' || tag === 'UC';
export function leftOnJobContract(contract, jobId, invoices) {
  const billed = round2(invoices.filter(i => i.job_id === jobId).reduce((s, i) => s + invoicedAmount(i), 0));
  return { contract: round2(contract), billed, left: round2((Number(contract) || 0) - billed) };
}
// Which contract a ticket bills off: UC = its own; JC = the property's; anything else = none.
export function contractFor(job, propJobs, propInvoices) {
  if (job.tag === 'UC') return job.job_contract != null ? leftOnJobContract(job.job_contract, job.id, propInvoices) : null;
  if (job.tag === 'JC') return job.contract_amount != null ? leftOnContract(job.contract_amount, propJobs, propInvoices) : null;
  return null;
}
// Invoicing lane for a done ticket. Checks are HIS ticks; the app never ticks them.
export function invoicingLane(job, invs) {
  const bills = invs.filter(isBill);
  if (bills.some(b => !b.sent_at)) return 'send';             // written, waiting on him to email it
  if (!job.scope_ok || !job.pics_ok) return 'checks';          // needs scope and/or pictures ticked
  return 'write';                                               // checks done, real invoice owed
}
export const LANES = {
  checks: 'Needs the scope and pictures checked',
  write: 'Checked — real invoice owed',
  send: 'Written — mark it sent after you email it',
};

// ---------- CONTRACT ----------
// Left on the contract = contract − everything invoiced against it. Lives on the property. Change orders don't count.
export function leftOnContract(contract, jobs, invoices) {
  // a CO is extra, and a UC carries its own contract: neither bills against the property's contract
  const coJobs = new Set(jobs.filter(j => j.tag === 'CO' || j.tag === 'UC').map(j => j.id));
  const billed = round2(invoices.filter(i => !coJobs.has(i.job_id)).reduce((s, i) => s + invoicedAmount(i), 0));
  return { contract: round2(contract), billed, left: round2((Number(contract) || 0) - billed) };
}

// ---------- COST ----------
export const costSoFar = (labor, material) => round2(labor + material);
export function linesMatchTotal(lines, total) {
  const sum = round2(lines.reduce((s, l) => s + (Number(l.line_total) || 0), 0));
  return { sum, total: round2(total), ok: Math.abs(sum - round2(total)) < 0.005, off: round2(sum - total) };
}
// What is still missing off a supply bill. A NOTE, NEVER A BLOCK (9/20/26): the bill saves with
// whatever he has — no house, no number, no lines, lines that don't tie, lines not on a job yet —
// and every one of those shows on the page until he knows the answer.
export function missingOnSupplyInvoice(inv, lines) {
  const miss = [];
  if (!String(inv.house || '').trim()) miss.push('supply house');
  if (!String(inv.number || '').trim()) miss.push('invoice number');
  if (!inv.inv_date) miss.push('invoice date');
  if (!lines.length) miss.push('the lines — a total is not an invoice');
  lines.forEach((l, i) => {
    if (!String(l.description || '').trim()) miss.push(`line ${i + 1}: what it is`);
    if (!(Number(l.qty) !== 0 && l.qty !== '' && l.qty != null)) miss.push(`line ${i + 1}: quantity`);
    if (!l.job_id && !l.shop) miss.push(`line ${i + 1}: which job (or the shop) — it shows in "Not on a job yet" until it has one`);
  });
  const m = linesMatchTotal(lines, inv.amount);
  if (lines.length && !m.ok) miss.push(`lines add to ${money(m.sum)} but the invoice says ${money(m.total)} — off by ${money(m.off)}`);
  return miss;
}
// ---------- TERMS ON A SUPPLY BILL ----------
// He switches the terms himself, on the bill, and the due date moves with it.
// TERMS ARE NEVER STORED. A bill's terms ARE the gap between its invoice date and its due date,
// so the two can never end up disagreeing with each other. Pick the terms → the due date is worked
// out and saved. Read the bill back → the terms label is worked out from the dates that are on it.
// A due date he typed in by hand that matches none of these reads "set by hand" and is left alone.
export const TERMS = [
  { k: 'receipt', l: 'Due on receipt' },
  { k: 'net10', l: 'Net 10' },
  { k: 'net15', l: 'Net 15' },
  { k: 'net30', l: 'Net 30' },
  { k: 'net45', l: 'Net 45' },
  { k: 'net60', l: 'Net 60' },
  { k: 'prox10', l: '10th of next month' },   // what the big houses bill on
];
// The due date those terms produce off this invoice date. undefined = terms this app does not know.
export function dueFromTerms(invDate, k) {
  const d = String(invDate || '').slice(0, 10);
  if (!d) return null;                                    // no invoice date, so no due date to work out
  if (k === 'receipt') return d;
  const net = /^net(\d+)$/.exec(String(k));
  if (net) return addDays(d, Number(net[1]));
  if (k === 'prox10') {
    const [y, m] = d.split('-').map(Number);
    return `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-10`;
  }
  return undefined;
}
// Read the terms back off the two dates. '' means nothing standard fits — it was set by hand.
export function termsOf(invDate, dueDate) {
  const a = String(invDate || '').slice(0, 10), b = String(dueDate || '').slice(0, 10);
  if (!a || !b) return '';
  for (const t of TERMS) if (dueFromTerms(a, t.k) === b) return t.k;
  return '';
}
export const termsLabel = k => (TERMS.find(t => t.k === k) || {}).l || 'Set by hand';

// Supply payment: one payment, many invoices, each line with its own surcharge %.
export function paymentTotals(lines) {
  const sub = round2(lines.reduce((s, l) => s + Number(l.amount || 0), 0));
  const sur = round2(lines.reduce((s, l) => s + round2(Number(l.amount || 0) * Number(l.surcharge_pct || 0) / 100), 0));
  return { subtotal: sub, surcharge: sur, total: round2(sub + sur) };
}

// ---------- NAMES ON SCREEN ----------
// Dispatch: address, city, tenant. The owner / GC is a billing fact and never shows here.
export const dispatchLine = j => [j.address, j.city, j.tenant].filter(Boolean).join(' · ');
// The date that goes with a job forever = the last day a man was on it.
export function workDate(jobId, stops) {
  const ds = stops.filter(s => s.job_id === jobId).map(s => s.work_date).sort();
  return ds.length ? ds[ds.length - 1] : null;
}
// Open or in Invoicing: type only. Paid and filed: type + the day they were there + what was done.
// Every ticket and every invoice reads: TAG - address, city - detail  (e.g. "JC - 1721 John McCain, Colleyville - Building 4")
export function ticketName(job) {
  const where = [job.address, job.city].filter(Boolean).join(', ');
  return [job.tag, where, job.parent_title, job.title].filter(Boolean).join(' - ');   // a CO shows the job it sits under: CO - address, city - Building 4 - what it is
}

// ---------- JOB COST SHEET (Greenhill layout) ----------
// A man's stop divides across the scopes he worked by the percent set in the schedule popup.
// Blank percent = an even share of what's left. No scope = one line with a blank scope.
export function splitByScope(amount, split) {
  const names = split && typeof split === 'object' ? Object.keys(split).filter(Boolean) : [];
  if (!names.length) return [{ name: '', amount: round2(amount) }];
  const set = names.filter(n => split[n] != null && split[n] !== '');
  const used = set.reduce((a, n) => a + Number(split[n]), 0);
  const unset = names.length - set.length;
  const out = names.map(n => ({ name: n, pct: set.includes(n) ? Number(split[n]) : unset ? Math.max(0, 100 - used) / unset : 0 }));
  let left = round2(amount);
  out.forEach((o, i) => { o.amount = i === out.length - 1 ? round2(left) : round2(amount * o.pct / 100); left = round2(left - o.amount); });
  return out;
}
// Budget | Current | Remaining. Rows the job has (bid + added) in their order, then anything worked with no row yet, then "No scope".
export function budgetTable(rows, spent) {
  const cur = {};
  for (const s of spent) cur[s.name] = round2((cur[s.name] || 0) + Number(s.amount));
  const names = [...rows.map(r => r.name)];
  Object.keys(cur).filter(n => n && !names.includes(n)).forEach(n => names.push(n));
  if (cur[''] != null) names.push('');
  const budgetOf = Object.fromEntries(rows.map(r => [r.name, r.budget == null || r.budget === '' ? null : Number(r.budget)]));
  const out = names.map(n => { const b = budgetOf[n] ?? null, c = cur[n] || 0; return { name: n, budget: b, current: c, remaining: b == null ? null : round2(b - c) }; });
  const budget = round2(out.reduce((a, r) => a + (r.budget || 0), 0)), current = round2(out.reduce((a, r) => a + r.current, 0));
  return { rows: out, budget, current, remaining: round2(budget - current) };
}
// His "Balance" box: materials × 1.2, SMS labor ÷ 0.5, subs ÷ 0.75.
export function pricedBack(material, sms, subs) {
  const m = round2(material * 1.2), s = round2(sms / 0.5), u = round2(subs / 0.75);
  return { material: m, sms: s, subs: u, total: round2(m + s + u) };
}

// ---------- READY TO BILL (fills itself) ----------
// A ticket shows up the moment it has a GREEN day not yet billed. Scope and pictures never hold it (his rule 10/2/26).
// The dollars come from the same rules as everything else: SMS men $50/hr by stops, subs cost × 1.5, material × 1.2 (JC at cost).
// Nothing is billed until he presses the button. A real invoice covers days up to its covers_through (or its invoice date).
export function readyToBill(job, greenShares, materialLines, invoices) {
  if (!canPlaceholder(job.tag) || job.no_charge || job.tabled_at) return null;
  if (!job.done_at && !isContractJob(job.tag)) return null;   // reopened = back on the schedule, not ready to bill (a UC bills a trip at a time)
  const covered = invoices.filter(i => i.kind === 'real' || i.kind === 'draw').map(i => i.covers_through || i.inv_date).filter(Boolean).sort();
  const prev = covered.length ? covered[covered.length - 1] : null;
  const dates = [...new Set(greenShares.filter(s => s.job_id === job.id && (!prev || s.work_date > prev)).map(s => s.work_date))].sort();
  if (!dates.length) return null;
  const days = dates.map(d => {
    const labor = greenShares.filter(s => s.job_id === job.id && s.work_date === d).map(s => ({ ...billLabor(s), man: s.shows_as }));
    return { date: d, labor, labor_total: round2(labor.reduce((a, l) => a + (l.amount || 0), 0)) };
  });
  const mats = materialLines.filter(l => l.job_id === job.id && (!prev || String(l.inv_date) > prev));
  const matCost = round2(mats.reduce((a, l) => a + Number(l.line_total), 0));
  const material = billMaterial(matCost, job.tag);
  const priced = days.every(d => d.labor.every(l => l.amount != null));
  const labor = round2(days.reduce((a, d) => a + d.labor_total, 0));
  return { job_id: job.id, days, through: dates[dates.length - 1], material_cost: matCost, material, labor, priced, total: priced ? round2(labor + material) : null };
}

// ---------- STEP 5: WRITE THE REAL INVOICE (his button) ----------
// 1 name = the ticket name. 2 memo = the placeholder's memo word for word. 3 dated TOMORROW, future until Mark it sent.
// 4 placeholders it replaces → $0 and renamed Job Cost N, same moment. Price = the placeholders' price unless he gave one.
const mdyy = iso => { const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${Number(m)}/${Number(d)}/${y.slice(2)}`; };
export const placeholderMemo = (job, workDate) => `${job.tag}-${mdyy(workDate)}`;
export function writeRealInvoice(job, ready, invoices, today, priceGiven) {
  const covered = invoices.filter(i => i.kind === 'placeholder' && Number(i.amount) > 0 && i.work_date && ready.days.some(d => d.date === i.work_date));
  const seatedDays = new Set(covered.map(p => p.work_date));
  const fromPlaceholders = round2(covered.reduce((a, p) => a + Number(p.amount), 0));
  const unseated = ready.days.filter(d => !seatedDays.has(d.date));
  const computedRest = round2(unseated.reduce((a, d) => a + d.labor_total, 0) + (covered.length ? 0 : ready.material));
  const given = priceGiven === '' || priceGiven == null ? null : Number(priceGiven);
  const amount = given != null ? round2(given) : round2(fromPlaceholders + computedRest);
  const memos = covered.length ? [...new Set(covered.sort((a, b) => a.work_date.localeCompare(b.work_date)).map(p => p.memo || placeholderMemo(job, p.work_date)))] : [placeholderMemo(job, ready.days[0].date)];
  const memo = memos.join(' · ');
  const names = invoices.filter(i => i.kind === 'placeholder').map(i => ({ name: i.name }));
  const zero = covered.map(p => { const name = nextJobCostName(names); names.push({ name }); return { id: p.id, name, memo: p.memo || placeholderMemo(job, p.work_date) }; });
  return { name: ticketName(job), memo, scope: String(job.scope || ''), amount, inv_date: addDays(today, 1), covers_through: ready.through, zero };
}

// ---------- STEP 6 ----------
// 1. Only "Mark it sent" starts AR (inAR above reads sent_at and nothing else — never a date, QuickBooks, pictures or a PDF).
// 3. Trips billed on a live ticket: age from the OLDEST unpaid trip. 21 days = stop sending a crew.
export const DRAW_STALE_DAYS = 21;
const dayDiff = (from, to) => Math.max(0, Math.round((new Date(String(to).slice(0, 10) + 'T12:00:00') - new Date(String(from).slice(0, 10) + 'T12:00:00')) / 86400000));
const tripDate = i => (i.sent_at || String(i.created_at || i.inv_date || '')).slice(0, 10);
export function drawAging(job, invoices, today) {
  if (job.done_at && !isContractJob(job.tag)) return null;
  const unpaid = invoices.filter(i => i.job_id === job.id && isBill(i) && !i.paid_at);
  if (!unpaid.length) return null;
  const oldest = unpaid.map(tripDate).filter(Boolean).sort()[0];
  const days = oldest ? dayDiff(oldest, today) : 0;
  return { owed: round2(unpaid.reduce((a, i) => a + Number(i.amount || 0), 0)), trips: unpaid.length, days, stale: days >= DRAW_STALE_DAYS };
}
// 4. DONE MEANS MONEY. A done, unpaid ticket never goes invisible. Off the list only by getting paid or No charge.
export function doneNotPaid(job, invoices) {
  if (!job.done_at || job.no_charge) return null;
  const mine = invoices.filter(i => i.job_id === job.id);
  const bills = mine.filter(isBill);
  if (bills.length && bills.every(b => b.paid_at)) return null;
  const phNumbers = new Set(mine.filter(i => i.kind === 'placeholder').map(i => String(i.number || '').trim()).filter(Boolean));
  const open = bills.filter(b => !b.paid_at);
  const why = [];
  if (!bills.length || open.some(b => !(Number(b.amount) > 0))) why.push('no dollar amount');
  if (!bills.length || open.some(b => { const n = String(b.number || '').trim(); return !n || phNumbers.has(n); })) why.push('no real invoice number');
  if (!bills.length || open.some(b => !b.sent_at)) why.push('never marked sent');
  return why.length ? why : null;
}

// ---------- DELETE ----------
// An invoice is in QuickBooks once it has a number, or was sent, or was paid. Deleting here never touches QuickBooks.
export const inQuickBooks = inv => !!String(inv.number || '').trim() || !!inv.sent_at || !!inv.paid_at;
// A ticket with money on it can't be deleted — only tabled. Money = a priced invoice, anything in QuickBooks, or a sub marked paid on it.
export function whyTicketLocked(invoices, subPaidCount = 0) {
  const why = [];
  const priced = invoices.filter(i => Number(i.amount) > 0);
  const inQB = invoices.filter(inQuickBooks);
  if (priced.length) why.push(`${priced.length} invoice${priced.length === 1 ? '' : 's'} with money on ${priced.length === 1 ? 'it' : 'them'} (${money(priced.reduce((a, i) => a + Number(i.amount), 0))})`);
  if (inQB.length) why.push(`${inQB.length} invoice${inQB.length === 1 ? '' : 's'} already in QuickBooks`);
  if (subPaidCount > 0) why.push(`${subPaidCount} sub pay line${subPaidCount === 1 ? '' : 's'} marked paid`);
  return why;
}
// "3 job files", "1 file" — what's attached, said plainly.
export const countOf = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

// ---------- BIDS (half 1) ----------
// Only what he OWES somebody is chased. A sent bid is filed with the customer and never followed up.
// Reminders: 3 days out, then 1 day out, then the day itself, then late.
export const BID_HEADS_UP_DAYS = 3;
export function bidState(bid, today) {
  if (bid.awarded_at) return null;                       // awarded — it's a ticket now, off the list
  if (bid.bid_sent_at) return { level: 'sent', days: null, say: 'Sent ' + shortDateYY(bid.bid_sent_at) + ' — filed, not chased' };
  if (!bid.bid_due) return { level: 'nodate', days: null, say: 'No due date on it' };
  const days = Math.round((new Date(String(bid.bid_due).slice(0, 10) + 'T12:00:00') - new Date(String(today).slice(0, 10) + 'T12:00:00')) / 86400000);
  if (days < 0) return { level: 'late', days, say: `LATE by ${-days} day${days === -1 ? '' : 's'} — due ${shortDateYY(bid.bid_due)}` };
  if (days === 0) return { level: 'today', days, say: `DUE TODAY — ${shortDateYY(bid.bid_due)}` };
  if (days <= 1) return { level: 'tomorrow', days, say: `Due tomorrow — ${shortDateYY(bid.bid_due)}` };
  if (days <= BID_HEADS_UP_DAYS) return { level: 'soon', days, say: `Due in ${days} days — ${shortDateYY(bid.bid_due)}` };
  return { level: 'ok', days, say: `Due ${shortDateYY(bid.bid_due)} — ${days} days out` };
}
// The order he works them: late first, then today, then the nearest due date, then the ones with no date.
export function sortBids(bids, today) {
  const rank = { late: 0, today: 1, tomorrow: 2, soon: 3, ok: 4, nodate: 5 };
  return [...bids].map(b => ({ ...b, state: bidState(b, today) }))
    .sort((a, x) => (rank[a.state.level] - rank[x.state.level]) || String(a.bid_due || '9999').localeCompare(String(x.bid_due || '9999')) || String(a.address).localeCompare(String(x.address)));
}
