// SHOP TAB (9/28/26). His ask: "a journal of all labor applied to shop and why".
// The labor is whoever is put on the Shop job file on the Schedule (customer "SMS Shop" → property "Shop").
// Days and dollars come off that job's cost sheet — the same numbers payroll uses. Shop is paid, never billed.
import { esc, call, $app, crumbs, doAndProve, fail } from './ui.js';
import { money, shortDateYY } from './money.js';

export async function shopPage() {
  crumbs([['Shop']]);
  const s = await call('/w/shop');
  if (!s.job_id) {
    $app().innerHTML = `<h1>Shop</h1><div class="card"><div class="empty">No Shop job file found (customer "SMS Shop" → property "Shop").</div></div>`;
    return;
  }
  const jc = await call(`/w/jobcost/${s.job_id}`);
  // one line per day per name — a sub's crew is one line under the sub, same as the job cost sheet
  const lines = {};
  for (const x of jc.labor || []) {
    const k = `${x.work_date}|${x.shows_as}`;
    (lines[k] ||= { work_date: x.work_date, shows_as: x.shows_as, cost: 0 }).cost += Number(x.cost) || 0;
  }
  const list = Object.values(lines).sort((a, b) => b.work_date.localeCompare(a.work_date) || a.shows_as.localeCompare(b.shows_as));
  const whyOf = (d, w) => (s.whys.find(y => y.work_date === d && y.shows_as === w) || {}).why || '';
  const total = list.reduce((a, l) => a + l.cost, 0);
  $app().innerHTML = `
    <h1>Shop</h1>
    <div class="card">
      <h2>Labor journal <span class="mute">${money(total)} total</span></h2>
      <p class="help">Everyone put on Shop on the Schedule. Paid, never billed. Type why they were at the shop and press Save.</p>
      ${list.length ? list.map((l, i) => `<div class="row">
        <span><b>${esc(shortDateYY(l.work_date))}</b> · ${esc(l.shows_as)} · ${money(l.cost)}</span>
        <span class="btnrow"><input class="shopwhy" data-i="${i}" placeholder="Why" value="${esc(whyOf(l.work_date, l.shows_as))}" style="min-width:260px">
        <button class="small" data-save="${i}">Save</button></span>
      </div>`).join('') : '<div class="empty">Nobody has been put on Shop yet. On the Schedule, tap + on a man\'s day and pick Shop.</div>'}
    </div>`;
  $app().querySelectorAll('[data-save]').forEach(b => b.onclick = async () => {
    const l = list[Number(b.dataset.save)];
    const why = $app().querySelector(`.shopwhy[data-i="${b.dataset.save}"]`).value.trim();
    b.disabled = true;
    try {
      await doAndProve('/w/shop/why', { method: 'PUT', body: { work_date: l.work_date, shows_as: l.shows_as, why } }, '/w/shop',
        bk => bk.whys.some(y => y.work_date === l.work_date && y.shows_as === l.shows_as && y.why === why), 'Why saved — read back and it matches');
    } catch (e) { fail(e); }
    b.disabled = false;
  });
}
