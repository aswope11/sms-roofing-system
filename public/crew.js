import { esc, $app, call, doAndProve, crumbs, setTab, fail, dragRows, saveCrewOrder, delX } from './ui.js';
import { money, crewColor, groupCrew } from './money.js';
import { payrollSection } from './payroll.js';

export async function crewPage() {
  setTab('crew'); crumbs([['Crew']]);
  const crew = groupCrew(await call('/w/crew'));
  const byId = Object.fromEntries(crew.map(c => [c.id, c]));
  const bossOpts = sel => `<option value="">— nobody, he's his own —</option>` + crew.filter(c => !c.boss_id && c.kind === 'sub').map(c => `<option value="${c.id}" ${Number(sel) === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  $app().innerHTML = `
    <h1>Crew</h1>
    <p class="sub">A man is paid his days × his day rate, flat. A ticket is charged his day ÷ the jobs he touched that day. There is no multiplier anywhere.</p>
    <details class="card scroll crewfold">
      <summary><b>The crew</b> <span class="mute">${crew.length} men — ${crew.filter(c => c.kind === 'employee').length} SMS, ${crew.filter(c => c.kind === 'sub').length} subs · click to open</span></summary>
      <table class="grid crewtbl">
        <tr><th></th><th>Name</th><th>Type</th><th class="num">Day rate</th><th>Pay to (Zelle / 1099 name)</th><th>Works under</th><th>Active</th><th></th></tr>
        ${crew.map((c, i) => `${c.group !== (crew[i - 1] || {}).group && !c.group.startsWith('under-') && (i === 0 || (crew[i - 1].group === 'employee') !== (c.group === 'employee'))
            ? `<tr class="grouphead"><th colspan="8">${c.group === 'employee' ? 'SMS employees' : 'Subs — each man under a sub sits right under his boss'}</th></tr>` : ''}
        <tr data-id="${c.id}" data-crew="${c.id}" data-group="${c.group}" data-boss="${c.boss_id || ''}">
          <td class="grip" title="Drag to move him up or down inside his group">⠿</td>
          <td style="border-left:6px solid ${crewColor(c, crew)}${c.group.startsWith('under-') ? ';padding-left:28px' : ''}">${c.group.startsWith('under-') ? '<span class="mute">↳ </span>' : ''}<input name="name" value="${esc(c.name)}"${c.group.startsWith('under-') ? ' style="width:calc(100% - 24px)"' : ''}></td>
          <td><select name="kind"><option value="employee" ${c.kind === 'employee' ? 'selected' : ''}>SMS employee</option><option value="sub" ${c.kind === 'sub' ? 'selected' : ''}>Sub</option></select></td>
          <td><input name="day_rate" type="number" step="0.01" value="${Number(c.day_rate)}" style="width:100px"></td>
          <td><input name="pay_to" value="${esc(c.pay_to)}"></td>
          <td><select name="boss_id">${bossOpts(c.boss_id)}</select></td>
          <td><input name="active" type="checkbox" ${c.active ? 'checked' : ''}></td>
          <td><button class="small ghost save">Save</button> ${delX('crew', c.id)}</td>
        </tr>`).join('') || '<tr><td colspan="8" class="empty">No crew yet.</td></tr>'}
      </table>
      <p class="help">SMS employees are one color. Each sub's crew is its own color, and a man under a sub shows his boss's color. Grab ⠿ and drag a man up or down inside his group — drag a sub and his men come with him. The Schedule shows men in this order.</p>
      <p class="help">"Works under" is for a man paid through a sub (like a man under Puma). He shows by his own name on Payroll only; everywhere else he rolls into his boss's line, and his pay goes to the boss's pay-to name.</p>
      <p class="help">A new man is added at the top of the Schedule tab — that is where you are standing when you hire one.</p>
    </details>
    <div id="payMount"></div>`;
  payrollSection(document.getElementById('payMount')).catch(e => fail(e));
  const tbl = $app().querySelector('table.crewtbl');
  if (tbl) dragRows(tbl, shown => {
    // rebuild the full order from what's on screen: employees, then each sub with his men right under him
    const rows = shown.map(id => byId[id]);
    const bosses = rows.filter(c => c.kind === 'sub' && !c.boss_id);
    const ids = [...rows.filter(c => c.kind !== 'sub' && !c.boss_id).map(c => c.id),
      ...bosses.flatMap(b => [b.id, ...rows.filter(c => c.boss_id === b.id).map(c => c.id)])];
    shown.forEach(id => { if (!ids.includes(id)) ids.push(id); });
    saveCrewOrder(ids).then(() => crewPage()).catch(e => { fail(e); crewPage(); });
  });
  $app().querySelectorAll('button.save').forEach(btn => btn.onclick = async () => {
    const tr = btn.closest('tr'); const id = Number(tr.dataset.id);
    const val = n => tr.querySelector(`[name=${n}]`);
    const b = { name: val('name').value, kind: val('kind').value, day_rate: val('day_rate').value, pay_to: val('pay_to').value, boss_id: val('boss_id').value || null, active: val('active').checked };
    btn.disabled = true;
    try {
      await doAndProve(`/w/crew/${id}`, { method: 'PUT', body: b }, '/w/crew', list => { const c = list.find(x => x.id === id); return c && c.name === b.name.trim() && Number(c.day_rate) === Number(b.day_rate) && c.active === b.active; });
      crewPage();
    } catch (e) { fail(e); btn.disabled = false; }
  });
}
