import { esc, call, doAndProve, fail, delX } from './ui.js';
import { stopShares, daysFor, manDayPay, payFor, zelleLines, zelleText, money, shortDate, addDays, round2, crewColor } from './money.js';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayHead = d => { const x = new Date(d + 'T12:00:00'); return `${DOW[x.getDay()]} ${shortDate(d)}`; };

// The pay side, drawn at the bottom of the Crew tab.
export async function payrollSection(mount, start) {
  const $app = () => mount;
  const w = await call('/w/week' + (start ? `?start=${start}` : ''));
  const jobsById = Object.fromEntries(w.jobs.map(j => [j.id, j]));
  const shares = stopShares(w);
  const men = w.crew.filter(c => c.active || w.stops.some(s => s.crew_id === c.id));
  const isGreen = d => w.green.some(g => g.work_date === d && g.green);
  const payCell = (c, d) => {
    const mine = w.stops.filter(s => s.crew_id === c.id && s.work_date === d);
    const typed = w.crewDays.find(x => x.crew_id === c.id && x.work_date === d);
    if (!mine.length && !typed) return { html: '', pay: 0 };
    const days = daysFor(w.crewDays, c.id, d, mine.length);
    const typedPay = payFor(w.crewDays, c.id, d);
    const pay = manDayPay(days, c.day_rate, typedPay);
    const lines = shares.filter(s => s.crew_id === c.id && s.work_date === d)
      .map(s => { const j = jobsById[s.job_id] || {}; return `<div class="mute">${esc(j.tag)} ${esc(j.address)} · ${money(s.cost)}</div>`; }).join('');
    return { pay, html: `<input class="days" type="number" step="0.25" min="0" max="3" value="${days}" data-crew="${c.id}" data-date="${d}" title="Days worked"> day = $<input class="daypay" type="number" step="0.01" min="0" value="${pay}" data-crew="${c.id}" data-date="${d}" data-days="${days}" style="width:90px" title="This day's actual pay. Change it when a quote comes in — his day rate stays the same. Clear it to go back to days × day rate.">${typedPay != null ? ' <span class="mute">(rate ' + money(manDayPay(days, c.day_rate)) + ')</span>' : ''} ${delX('payday', `${c.id}_${d}`)}${lines}` };
  };
  // SUNDAY IS OFF THE BOOK unless somebody actually worked it — then it comes back, and it pays.
  const isSunday = d => new Date(d + 'T12:00:00').getDay() === 0;
  const anyDays = d => w.crewDays.some(x => x.work_date === d && Number(x.days) > 0)
    || shares.some(s => s.work_date === d) || isGreen(d);
  const dates = w.dates.filter(d => !isSunday(d) || anyDays(d));
  const rows = men.map(c => { const cells = dates.map(d => payCell(c, d)); return { c, cells, total: round2(cells.reduce((a, x) => a + x.pay, 0)) }; });
  const grand = round2(rows.reduce((a, r) => a + r.total, 0));
  // what the SMS men cost this week, on its own line at the end of their block
  const smsRows = rows.filter(r => r.c.kind === 'employee');
  const smsTotal = round2(smsRows.reduce((a, r) => a + r.total, 0));
  const lastSms = smsRows.length ? smsRows[smsRows.length - 1].c.id : null;
  const zelle = zelleLines(shares, jobsById);

  $app().innerHTML = `
    <h1 style="margin-top:24px">Payroll</h1>
    <div class="btnrow" style="margin-bottom:12px">
      <button class="ghost small" id="prev">‹ Week before</button>
      <button class="ghost small" id="thisw">This week</button>
      <button class="ghost small" id="next">Week after ›</button>
      <span class="mute" style="align-self:center">Pay week ${dayHead(w.dates[0])} – ${dayHead(w.dates[6])}</span>
    </div>
    <div class="card scroll">
      <table class="grid pay">
        <tr><th></th>${dates.map(d => `<th class="${isGreen(d) ? 'day-green' : ''}">${dayHead(d)}<br>
          <button class="small ${isGreen(d) ? '' : 'ghost'} green" data-date="${d}" data-green="${isGreen(d) ? 1 : 0}">${isGreen(d) ? '● Green — day is final' : '○ Red — not final'}</button></th>`).join('')}<th class="num">Week pay</th></tr>
        ${rows.map(r => `<tr data-crew="${r.c.id}"><th style="border-left:8px solid ${crewColor(r.c, w.crew) || 'transparent'}">${esc(r.c.name)}<div class="mute">${money(r.c.day_rate)}/day${r.c.boss_id ? ' · under ' + esc((w.crew.find(x => x.id === r.c.boss_id) || {}).name) : ''}</div></th>${r.cells.map(x => `<td>${x.html}</td>`).join('')}<td class="num"><b>${money(r.total)}</b></td></tr>`
          + (r.c.id === lastSms ? `<tr class="subtot"><th colspan="${dates.length + 1}" class="num">SMS employees, this week</th><td class="num"><b>${money(smsTotal)}</b></td></tr>` : '')).join('')
          || `<tr><td colspan="${dates.length + 2}" class="empty">Nobody worked this week.</td></tr>`}
        <tr><th colspan="${dates.length + 1}" class="num">Everybody, this week</th><td class="num big">${money(grand)}</td></tr>
      </table>
      <p class="help">A man's pay is his days × his day rate — unless you type that day's actual pay in the $ box (a quote came in); his day rate stays the same, and clearing the box puts it back. Under each day is what each ticket is charged: his day ÷ the jobs he touched that day. Green means the day is finished and correct — red means it hasn't gone anywhere yet. Change the days box when a man worked a half day.</p>
    </div>
    <div class="card">
      <h2>Zelle list — one per job per day, to the pay-to name</h2>
      <p class="help">Each line is the whole crew's share on that job that day. Match these against Chase. The sum of these for the year is the 1099 total.</p>
      ${[...new Set(zelle.map(z => z.pay_to))].map(p => `<h3>${esc(p)}</h3><pre class="zelle">${zelle.filter(z => z.pay_to === p).map(zelleText).join('\n')}\nTotal ${money(zelle.filter(z => z.pay_to === p).reduce((a, z) => a + z.amount, 0))}</pre>`).join('') || '<div class="empty">Nothing to pay this week.</div>'}
    </div>`;

  const weekUrl = `/w/week?start=${w.start}`;
  mount.querySelector('#prev').onclick = () => payrollSection(mount, addDays(w.start, -7));
  mount.querySelector('#next').onclick = () => payrollSection(mount, addDays(w.start, 7));
  mount.querySelector('#thisw').onclick = () => payrollSection(mount);
  $app().querySelectorAll('input.days').forEach(inp => inp.onchange = async () => {
    const body = { crew_id: Number(inp.dataset.crew), work_date: inp.dataset.date, days: Number(inp.value) };
    try {
      await doAndProve('/w/crew-days', { method: 'PUT', body }, weekUrl, back => back.crewDays.some(x => x.crew_id === body.crew_id && x.work_date === body.work_date && Number(x.days) === body.days));
      payrollSection(mount, w.start);
    } catch (e) { fail(e); }
  });
  $app().querySelectorAll('input.daypay').forEach(inp => inp.onchange = async () => {
    const pay = inp.value === '' ? null : Number(inp.value);
    const body = { crew_id: Number(inp.dataset.crew), work_date: inp.dataset.date, days: Number(inp.dataset.days), pay };
    try {
      await doAndProve('/w/crew-days', { method: 'PUT', body }, weekUrl, back => back.crewDays.some(x => x.crew_id === body.crew_id && x.work_date === body.work_date && (pay == null ? x.pay == null : Number(x.pay) === pay)));
      payrollSection(mount, w.start);
    } catch (e) { fail(e); }
  });
  $app().querySelectorAll('button.green').forEach(b => b.onclick = async () => {
    const green = b.dataset.green !== '1'; b.disabled = true;
    try {
      await doAndProve('/w/green', { method: 'PUT', body: { work_date: b.dataset.date, green } }, weekUrl,
        back => back.green.some(g => g.work_date === b.dataset.date && g.green === green) || (!green && !back.green.some(g => g.work_date === b.dataset.date && g.green)),
        green ? 'Day is green — read back and it matches' : 'Day is back to red — read back and it matches');
      payrollSection(mount, w.start);
    } catch (e) { fail(e); b.disabled = false; }
  });
}
