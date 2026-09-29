// THE SCHEDULE GRID — men down the left, days across the top. Do not redesign it.
// Three things copied off the old board (app-src-schedule-board): the + boxes in the cells and the card look,
// the hover that pops up what THIS man did HERE on THIS day, and the pills under the grid that move a ticket around.
import { esc, $app, call, doAndProve, crumbs, setTab, fail, toast } from './ui.js';
import { groupCrew, dispatchLine, shortDate, addDays, stopShares, daysFor, manDayPay, payFor, crewColor, ticketName, whyCantSplit } from './money.js';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayHead = d => { const x = new Date(d + 'T12:00:00'); return `${DOW[x.getDay()]} - ${x.getMonth() + 1}/${x.getDate()}`; };
// per-day column header, split like the old scheduling board (day name / short date on their own line) — column has its own width now, no need to abbreviate
const dayName = d => { const x = new Date(d + 'T12:00:00'); return DOW[x.getDay()]; };
const dayShort = d => { const x = new Date(d + 'T12:00:00'); return `${x.getMonth() + 1}/${x.getDate()}`; };
// old board BUILTIN_TYPES colours, by billing code
const TYPE_COLOR = { JC: '#4a90e2', R: '#3ea672', UC: '#e8a53c', CO: '#d4557a', BID: '#c0864a' };
const typeColor = t => TYPE_COLOR[t] || '#8a93a3';
// old board STAGES / STAGE_GROUPS. On the schedule page the contract chip reads "Awarded" and its bracket label is blank.
const STAGES = [{ k: 'ready', l: 'Ready to work' }, { k: 'hold', l: 'the customer' }, { k: 'trades', l: 'other trades' }, { k: 'contract', l: 'Awarded' }];
const STAGE_GROUPS = [{ l: '', ks: ['ready'] }, { l: 'Waiting on', ks: ['hold', 'trades'] }, { l: '', ks: ['contract'] }];
const STAGE_LABEL = { ready: 'Ready to work', hold: 'Held up by the customer', trades: 'Waiting on other trades', contract: 'Awarded' };
let schedOpen = { hold: false, trades: false };           // the two hold buckets start shut on every load
const foldState = () => { try { return JSON.parse(localStorage.getItem('smsSchedFold') || '{}') || {}; } catch { return {}; } };

export async function schedulePage(start) {
  setTab('schedule'); crumbs([['Schedule']]);
  const w = await call('/w/week' + (start ? `?start=${start}` : ''));
  // same order and groups as the Crew tab: SMS employees, then each sub with his men right under him
  const allCrew = groupCrew(w.crew).filter(c => c.active || w.stops.some(s => s.crew_id === c.id));
  // SUBS ONLY THE WEEK THEY WORK (9/28/26, same as the old board): SMS employees always show. A sub shows when he or
  // one of his men has a job this week, or when he was put up with "Put somebody on the board"; ✕ takes him back off.
  const workedMen = new Set(w.stops.map(s => s.crew_id));
  w.crew.forEach(c => { if (c.boss_id && workedMen.has(c.id)) workedMen.add(c.boss_id); });
  const onBoard = new Set([...workedMen, ...(w.board_add || [])]);
  const crew = groupCrew(w.crew).filter(c => allCrew.some(a => a.id === c.id) && (c.group === 'employee' || onBoard.has(c.id)));
  const offBoard = allCrew.filter(c => c.active && c.group !== 'employee' && !onBoard.has(c.id));
  const jobsById = Object.fromEntries(w.jobs.map(j => [j.id, j]));
  const open = w.jobs.filter(j => !j.done_at);
  // SHOP (9/28/26): Shop is only a pick when logging a man's day — never a row in the job lists below the grid.
  const listed = open.filter(j => j.customer_name !== 'SMS Shop');
  const shares = stopShares(w);
  const nobody = d => open.filter(j => j.scheduled_date === d && !w.stops.some(s => s.job_id === j.id && s.work_date === d));
  const pfx = j => `<span class="pfx">${esc(j.tag)} -</span> `;
  // old board dayState: green when a human says the day is right; a past day nobody signed off shows red
  const isGreen = d => w.green.some(g => g.work_date === d && g.green);
  const dayState = d => isGreen(d) ? 'acct' : d < w.today ? 'late' : 'open';
  // SUNDAY IS OFF THE BOARD. We do not work Sundays, and an empty column he has to look past
  // every week is just something else to get wrong. The pay math still runs all seven days —
  // a Sunday somebody actually worked brings its own column back, and it still pays.
  const isSunday = d => new Date(d + 'T12:00:00').getDay() === 0;
  const worked = d => w.stops.some(s => s.work_date === d) || nobody(d).length > 0 || isGreen(d);
  const dates = w.dates.filter(d => !isSunday(d) || worked(d));

  // ---------- (3) THE PILLS: old stageBarHTML ----------
  const stageBarHTML = j => {
    const st = j.stage || 'ready';
    const chip = x => `<button type="button" class="stchip ${st === x.k ? 'on' : ''}${x.k === 'contract' ? ' toBids' : ''}" data-stage="${x.k}" data-job="${j.id}"
      ${x.k === 'contract' ? 'title="Awarded — this ticket sits in the Awarded lane at the bottom of the Schedule tab"' : ''}>${esc(x.l)}</button>`;
    return `<div class="stbar">${
      STAGE_GROUPS.map(g => `<span class="stgrp">${g.l ? `<span class="stgl">${esc(g.l)}</span>` : ''}${g.ks.map(k => chip(STAGES.find(x => x.k === k))).join('')}</span>`).join('')}</div>`;
  };
  // ---------- (1) THE CARD: old jobCardHTML ----------
  // Step 6: oldest unpaid trip 21+ days → the card goes red
  const stale = j => j.aging && j.aging.stale;
  const unpaidLine = j => stale(j) ? `<div class="js unpaidline">unpaid $${Math.round(j.aging.owed).toLocaleString()} · ${j.aging.days} days</div>` : '';
  const jobCardHTML = (j, row, day, stopId) => `<div class="jobcard${stale(j) ? ' stale' : ''}" style="border-left-color:${stale(j) ? 'var(--bad)' : typeColor(j.tag)}"
      data-peek="${j.id}" data-row="${row || ''}" data-day="${day || ''}">
      ${stopId ? `<span class="kill" data-del="stop" data-id="${stopId}" title="Delete this entry">×</span>` : ''}
      ${j.customer_name ? `<div class="js jcust">${esc(j.customer_name)}</div>` : ''}
      <div class="jt">${pfx(j)}${esc(j.address)}</div>
      ${j.tenant ? `<div class="js jwho">${esc(j.tenant)}</div>` : ''}
      ${j.city ? `<div class="js">${esc(j.city)}</div>` : ''}
      ${unpaidLine(j)}
    </div>`;   // same card in every row — the stage pills live on the job's row at the bottom of the page

  // ---------- (3) THE ROWS UNDER THE GRID: old pRow / jobCmp / renderSchedSections ----------
  const rank = j => j.sched_rank == null ? 9999 : j.sched_rank;
  // Repairs jump the line because they're repairs — no button, no reason (9/21/26).
  const jobCmp = (a, b) => ((b.tag === 'R' ? 1 : 0) - (a.tag === 'R' ? 1 : 0)) || (rank(a) - rank(b))
    || String(a.scheduled_date || '9999').localeCompare(String(b.scheduled_date || '9999')) || String(a.address || '').localeCompare(String(b.address || ''));
  const bucketOf = j => ['ready', 'hold', 'trades', 'contract'].includes(j.stage) ? j.stage : 'ready';
  const pRow = j => `<div class="prow${stale(j) ? ' stale' : ''}" style="border-left-color:${stale(j) ? 'var(--bad)' : typeColor(j.tag)}" data-peek="${j.id}" data-open="${j.id}">
      <div class="pmain">
        <div class="pt">${pfx(j)}${esc(j.address)}${j.city ? `<span class="pcity">${esc(j.city)}</span>` : ''}</div>
        ${j.tenant ? `<div class="ps jwho">${esc(j.tenant)}</div>` : ''}
        ${j.title ? `<div class="ps">${esc(j.title)}</div>` : ''}
        ${j.customer_name ? `<div class="ps pcust">${esc(j.customer_name)}</div>` : ''}
        ${stale(j) ? `<div class="ps unpaidline">unpaid $${Math.round(j.aging.owed).toLocaleString()} · ${j.aging.days} days — don't send a crew back until it clears</div>` : ''}
        ${stageBarHTML(j)}
      </div>
      <span class="tmove"><button type="button" class="tup" data-bump="${j.id}" data-dir="-1">▲</button><button type="button" class="tup" data-bump="${j.id}" data-dir="1">▼</button></span>
      <span class="pgo">›</span>
    </div>`;
  const rowHTML = j => j.tag === 'R' ? `<div class="smsrep">${pRow(j)}</div>` : pRow(j);
  const fold = foldState();
  let sections = '';
  const readyRows = listed.filter(j => bucketOf(j) === 'ready').sort(jobCmp);
  if (readyRows.length) sections += `<div class="psec"><h3 data-fold="readytowork">${fold.readytowork ? '▸' : '▾'} Ready to work <span class="n">${readyRows.length}</span></h3>${fold.readytowork ? '' : readyRows.map(rowHTML).join('')}</div>`;
  [{ k: 'hold', l: 'Waiting on the customer' }, { k: 'trades', l: 'Waiting on other trades' }].forEach(h => {
    const rows = listed.filter(j => bucketOf(j) === h.k); if (!rows.length) return;
    sections += `<div class="${schedOpen[h.k] ? 'parked open' : 'parked'}"><h3 data-hold="${h.k}">${schedOpen[h.k] ? '▾' : '▸'} ${esc(h.l)} <span class="n">${rows.length}</span></h3>
      <div class="plist"><div class="psec">${rows.sort(jobCmp).map(rowHTML).join('')}</div></div></div>`;
  });
  {
    const rows = listed.filter(j => bucketOf(j) === 'contract').sort(jobCmp);
    sections += `<div class="parked open" id="smsAwardedLane"><h3 data-fold="awarded">${fold.awarded ? '▸' : '▾'} Awarded <span class="n">${rows.length}</span></h3>${
      fold.awarded ? '' : `<div class="plist"><div class="psec">${rows.map(rowHTML).join('') || '<div class="empty">Nothing sold without a ticket right now.</div>'}</div></div>`}</div>`;
  }

  // ADD A MAN, WHERE HE IS STANDING WHEN HE HIRES ONE (off the Crew page, 9/18).
  const bossOpts = `<option value="">— nobody, he's his own —</option>` +
    allCrew.filter(c => !c.boss_id && c.kind === 'sub').map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  $app().innerHTML = `<div class="oldgrid">
    <h1>Schedule</h1>
    <div style="margin-bottom:12px"><button type="button" id="addManBtn">Add a man</button></div>
      <form id="addMan" class="card" style="display:none">
        <label>Name<input name="name" placeholder="fill it in when you know it"></label>
        <label>Type<select name="kind"><option value="employee">SMS employee — billed $50 a man-hour</option><option value="sub">Sub — billed at his cost × 1.5</option></select></label>
        <label>Day rate<input name="day_rate" type="number" step="0.01" placeholder="leave it blank until it is settled"></label>
        <label>Pay to (Zelle / 1099 name)<input name="pay_to"></label>
        <label>Works under<select name="boss_id">${bossOpts}</select></label>
        <div class="actions"><button>Add to crew</button></div>
      </form>
    <div class="weeknav">
      <button id="prev">‹ Prev</button>
      <span class="range">Week of ${dayHead(w.dates[0])} – ${dayHead(w.dates[6])}</span>
      <button id="next">Next ›</button>
      <button id="thisw">Today</button>
    </div>
    <div class="btnrow" style="margin-bottom:10px"><span class="mute">Put somebody on the board</span>
      <input id="acName" list="acList" placeholder="type his name — new or on file" autocomplete="off">
      <datalist id="acList">${offBoard.map(c => `<option value="${esc(c.name)}">`).join('')}</datalist>
      <button type="button" class="small" id="acAdd">Add</button></div>
    <div class="card fitgrid">
      <table class="grid schedgrid">
        <colgroup><col class="mancol">${dates.map(() => '<col>').join('')}</colgroup>
        <tr><th></th>${dates.map(d => { const st = dayState(d); return `<th class="hcell ${st}${d === w.today ? ' today' : ''}" data-green="${d}" title="Tap when the day is right — every man and every job accounted for, good to bill">
          <div class="d">${dayName(d)}</div><div class="dt">${dayShort(d)}</div>
          <div class="dchk">${st === 'acct' ? '✓ good to bill' : st === 'late' ? 'not accounted' : 'tap when right'}</div></th>`; }).join('')}</tr>
        <tr><th>Nobody on it yet</th>${dates.map(d => `<td class="cell">${nobody(d).map(j => `${jobCardHTML(j, '', d)}
          <select class="small putman" data-job="${j.id}" data-date="${d}"><option value="">put a man on it</option>${allCrew.filter(c => c.active).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>`).join('')}</td>`).join('')}</tr>
        ${crew.map((c, i) => `${i === 0 || (crew[i - 1].group === 'employee') !== (c.group === 'employee') ? `<tr class="grouphead"><th colspan="${dates.length + 1}">${c.group === 'employee' ? 'SMS employees' : 'Subs'}</th></tr>` : ''}<tr><th style="border-left:4px solid ${crewColor(c, w.crew)}">${c.group.startsWith('under-') ? '<span class="mute">↳ </span>' : ''}${esc(c.name)}${c.group !== 'employee' && !workedMen.has(c.id) ? ` <span class="delx" data-drop="${c.id}" title="Take him off this week" style="cursor:pointer">✕</span>` : ''}</th>${dates.map(d => {
          const mine = w.stops.filter(s => s.crew_id === c.id && s.work_date === d);
          return `<td class="cell">${mine.map(s => jobsById[s.job_id] ? jobCardHTML(jobsById[s.job_id], c.id, d, s.id) : '').join('')}
            <div class="plus ${mine.length ? 'has' : ''}" data-crew="${c.id}" data-date="${d}">+</div></td>`;
        }).join('')}</tr>`).join('') || `<tr><td colspan="${dates.length + 1}" class="empty">No crew yet — add men on the <a href="#/crew">Crew</a> tab.</td></tr>`}
      </table>
      <p class="help">Putting a man on a day is a plan. Tap the day at the top when every man and every job that day is right — it turns green: good to bill, and it pays. Tap again to take it back. Same switch as the Crew tab.</p>
    </div>
    <div id="schedSections">${sections}</div>
    <div class="peek" id="peek"></div>
    <div class="modalback" id="logBack" style="display:none"><div class="card logbox">
      <h2 id="logTitle"></h2>
      <div id="lPick">
        <input id="lSearch" placeholder="Type to find the job — address, tenant, type">
        <div id="lHits"></div>
        <div class="btnrow"><button class="ghost small" id="logCancel">Cancel</button></div>
      </div>
      <div id="lForm" style="display:none"></div>
    </div></div>
  </div>`;

  const reload = () => schedulePage(w.start);
  // the orange button opens the form; press it again to put the form away
  document.getElementById('addManBtn').onclick = () => { const f = document.getElementById('addMan'); f.style.display = f.style.display === 'none' ? '' : 'none'; };
  document.getElementById('addMan').onsubmit = async ev => {
    ev.preventDefault(); const b = Object.fromEntries(new FormData(ev.target)); ev.submitter.disabled = true;
    try {
      await doAndProve('/w/crew', { method: 'POST', body: b }, '/w/crew',
        (list, r) => list.some(c => c.id === r.id && c.name === b.name.trim() && Number(c.day_rate) === Number(b.day_rate)),
        `${b.name.trim()} is on the crew — read back and he is there`);
      reload();
    } catch (e) { fail(e); ev.submitter.disabled = false; }
  };
  const weekUrl = `/w/week?start=${w.start}`;
  document.getElementById('prev').onclick = () => schedulePage(addDays(w.start, -7));
  document.getElementById('next').onclick = () => schedulePage(addDays(w.start, 7));
  document.getElementById('thisw').onclick = () => schedulePage();
  const addStop = (crew_id, job_id, work_date) => doAndProve('/w/stops', { method: 'POST', body: { crew_id, job_id, work_date } }, weekUrl,
    back => back.stops.some(s => s.crew_id === Number(crew_id) && s.job_id === Number(job_id) && s.work_date === work_date));
  const run = async fn => { try { await fn(); reload(); } catch (e) { fail(e); } };
  // put a sub up for this week / take him back off (only a sub who has no job this week can come off)
  const board = (id, on) => run(() => doAndProve('/w/board-add', { method: 'PUT', body: { week_start: w.start, crew_id: id, on } }, weekUrl,
    back => (back.board_add || []).includes(id) === on, on ? 'On the board this week — read back and he is there' : 'Off this week\'s board — he comes back the week he works'));
  const acAdd = document.getElementById('acAdd');
  // TYPE A GUY IN (9/29/26, the old board's way): a name on file goes up for this week; a new name is added
  // to the crew as a sub for good (rate blank until it's settled) and goes up for this week.
  const acName = document.getElementById('acName');
  const addTyped = async () => {
    const name = acName.value.trim(); if (!name) return;
    const known = w.crew.find(c => c.name.trim().toLowerCase() === name.toLowerCase());
    if (known && ((known.kind !== 'sub' && !known.boss_id) || onBoard.has(known.id))) { toast(`${known.name} is already on the board this week`); return; }
    if (known) return board(known.id, true);
    acAdd.disabled = true;
    try {
      const { result } = await doAndProve('/w/crew', { method: 'POST', body: { name, kind: 'sub' } }, '/w/crew',
        (list, r) => list.some(c => c.id === r.id && c.name === name), `${name} is on the crew for good — read back and he is there`);
      board(result.id, true);
    } catch (e) { fail(e); acAdd.disabled = false; }
  };
  acAdd.onclick = addTyped;
  acName.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); addTyped(); } };
  $app().querySelectorAll('[data-drop]').forEach(x => x.onclick = ev => { ev.stopPropagation(); board(Number(x.dataset.drop), false); });

  // tap a day header: green it (good to bill) or take it back
  $app().querySelectorAll('th[data-green]').forEach(th => th.onclick = () => {
    const d = th.dataset.green, green = !isGreen(d);
    run(async () => {
      const { result } = await doAndProve('/w/green', { method: 'PUT', body: { work_date: d, green } }, weekUrl,
        back => back.green.some(g => g.work_date === d && g.green) === green,
        green ? `${dayHead(d)} is green — good to bill (read back and it matches)` : `${dayHead(d)} taken back — not accounted for (read back and it matches)`);
      const done = result.qb_done || [], errs = result.qb_errors || [];
      if (errs.length) toast(`QuickBooks: ${[...done, ...errs.map(e => 'NOT DONE — ' + e)].join(' · ')}`, false);
      else if (done.length) toast(`${green ? 'Placeholders in QuickBooks' : 'Placeholders deleted from QuickBooks'}: ${done.join(' · ')}`);
    });
  });

  // (1) the + box: pick the job for this man on this day
  const logBack = document.getElementById('logBack');
  let logFor = null;
  const renderHits = () => {
    const q = document.getElementById('lSearch').value.toLowerCase().trim();
    const order = { R: 0, UC: 1, CO: 2, JC: 3 };
    // no search: only what's ready to work. Typing finds anything open, ready or not.
    // a ticket marked done still shows if men are already on it that day, so another man can be added to it
    const workedToday = new Set(w.stops.filter(s => logFor && s.work_date === logFor.date).map(s => s.job_id));
    const pool = [...open, ...w.jobs.filter(j => j.done_at && workedToday.has(j.id))];
    const hits = pool.filter(j => q ? [j.tag, j.address, j.city, j.tenant, j.title, j.customer_name, j.parent_title].join(' ').toLowerCase().includes(q) : (bucketOf(j) === 'ready' || !!j.done_at))
      .sort((a, b) => ((order[a.tag] ?? 9) - (order[b.tag] ?? 9)) || String(a.address).localeCompare(String(b.address)));
    document.getElementById('lHits').innerHTML = hits.map(j => `<div class="jhit" data-job="${j.id}">
      <span class="jhp" style="background:${typeColor(j.tag)}">${esc(j.tag)}</span>
      <span class="jhn">${esc(j.address)}${j.parent_title ? ' — ' + esc(j.parent_title) : ''}${j.title ? ' — ' + esc(j.title) : ''}${j.done_at ? ' <b class="ambertxt">(marked done)</b>' : ''}</span>
      <span class="jhs">${esc([j.tenant, j.city, j.customer_name].filter(Boolean).join(' · '))}</span></div>`).join('') || `<div class="empty">${q ? 'No open ticket matches.' : 'Nothing is marked ready to work — type to find any job.'}</div>`;
    document.querySelectorAll('#lHits .jhit').forEach(h => h.onclick = () => openLogForm(Number(h.dataset.job)));
  };
  $app().querySelectorAll('.plus').forEach(p => p.onclick = e => {
    e.stopPropagation(); hidePeek();
    logFor = { crew: p.dataset.crew, date: p.dataset.date };
    const man = crew.find(c => c.id === Number(p.dataset.crew));
    document.getElementById('logTitle').textContent = `${man ? man.name : ''} — ${dayHead(p.dataset.date)}`;
    document.getElementById('lSearch').value = '';
    document.getElementById('lPick').style.display = ''; document.getElementById('lForm').style.display = 'none';
    renderHits(); logBack.style.display = 'flex'; document.getElementById('lSearch').focus();
  });

  // the popup, step 2: full/half day (what he's PAID), what he did, change order, and how his day splits by percent
  function openLogForm(jobId) {
    const j = jobsById[jobId]; if (!j) return;
    const crewId = Number(logFor.crew), day = logFor.date;
    const man = crew.find(c => c.id === crewId);
    const mine = w.stops.filter(s => s.crew_id === crewId && s.work_date === day);
    const existing = mine.find(s => s.job_id === j.id);
    const others = mine.filter(s => s.job_id !== j.id);
    const days = daysFor(w.crewDays, crewId, day, 1);
    const pctVal = s => s && s.pct != null ? Number(s.pct) : '';
    // old board jobParts: the scopes already on THIS job, tap to reuse, ＋ Add for a new one
    const lib = [...new Set((w.scopes || []).filter(x => x.job_id === j.id).map(x => x.name))];
    const picked = new Set(existing && existing.day_scope ? existing.day_scope.split(' · ').filter(Boolean) : []);
    picked.forEach(n => { if (!lib.includes(n)) lib.push(n); });
    const also = new Set();
    // how this stop divides across the scopes he tapped (old board renderLogSplit) — percent, blank = even
    const scopePct = { ...(existing && existing.scope_split ? existing.scope_split : {}) };
    const f = document.getElementById('lForm');
    f.innerHTML = `
      <div class="lfjob">${esc(ticketName(j))}<div class="mute">${esc(j.customer_name || '')}</div></div>
      <div class="lfrow"><span class="lfl">Paid</span>
        <label class="lfpick"><input type="radio" name="lfDays" value="1" ${days !== 0.5 ? 'checked' : ''}> Full day</label>
        <label class="lfpick"><input type="radio" name="lfDays" value="0.5" ${days === 0.5 ? 'checked' : ''}> Half day</label></div>
      <div class="lfl">What are they doing on it today?</div>
      <div class="cchips" id="lfScopes"></div>
      <input id="lfScopeNew" placeholder="Name it, then Enter" style="display:none;margin-top:8px">
      <div class="lfsplit" id="lfScopeSplit"></div>
      <div class="lfl">Anybody else on it that day?</div>
      <div class="cchips" id="lfAlso"></div>
      <label class="lfpick lfco"><input type="checkbox" id="lfCo"> This is a change order</label>
      <div id="lfCoWrap" style="display:none"><input id="lfCoTitle" placeholder="What's the change order?"></div>
      <div class="lfsplit">
        <div class="lfsrow"><span id="lfThisName">${esc(j.tag)} - ${esc(j.address)}</span><input class="lfpct" data-key="this" type="number" min="0" max="100" step="1" value="${pctVal(existing)}"><span>%</span></div>
        ${others.map(s => { const o = jobsById[s.job_id] || {}; return `<div class="lfsrow"><span>${esc(o.tag || '')} - ${esc(o.address || 'job ' + s.job_id)}</span><input class="lfpct" data-key="${s.job_id}" type="number" min="0" max="100" step="1" value="${pctVal(s)}"><span>%</span></div>`; }).join('')}
      </div>
      <div class="err" id="lfErr"></div>
      <div class="btnrow"><button class="ghost small" id="lfBack">‹ Back</button><button id="lfSave">Log it</button></div>`;
    document.getElementById('lPick').style.display = 'none'; f.style.display = '';
    const renderScopes = () => {
      document.getElementById('lfScopes').innerHTML = lib.map((n, i) => `<button type="button" class="cchip ${picked.has(n) ? 'on' : ''}" data-i="${i}">${esc(n)}</button>`).join('')
        + `<button type="button" class="cchip add" id="lfScopeAdd">＋ Add</button>`;
      f.querySelectorAll('#lfScopes .cchip[data-i]').forEach(b => b.onclick = () => { const n = lib[Number(b.dataset.i)]; picked.has(n) ? picked.delete(n) : picked.add(n); renderScopes(); });
      const on = lib.filter(n => picked.has(n));
      const sp = document.getElementById('lfScopeSplit');
      sp.innerHTML = on.length > 1 ? on.map((n, i) => `<div class="lfsrow"><span>${esc(n)}</span><input class="lfspct" data-i="${lib.indexOf(n)}" type="number" min="0" max="100" step="1" value="${scopePct[n] == null ? '' : scopePct[n]}"><span>%</span></div>`).join('') : '';
      const hint = () => {
        const ins = [...sp.querySelectorAll('.lfspct')];
        const used = ins.filter(i => i.value !== '').reduce((a, i) => a + Number(i.value), 0);
        const blank = ins.filter(i => i.value === '');
        blank.forEach(i => { i.placeholder = String(Math.round(Math.max(0, 100 - used) / blank.length * 10) / 10); });
      };
      sp.querySelectorAll('.lfspct').forEach(i => i.oninput = () => { const n = lib[Number(i.dataset.i)]; scopePct[n] = i.value === '' ? null : Number(i.value); hint(); });
      hint();
      document.getElementById('lfScopeAdd').onclick = () => { const box = document.getElementById('lfScopeNew'); box.style.display = ''; box.value = ''; box.focus(); };
    };
    const addScope = () => {
      const box = document.getElementById('lfScopeNew'); const n = box.value.trim(); box.style.display = 'none';
      if (!n) return; if (!lib.includes(n)) lib.push(n); picked.add(n); renderScopes();
    };
    document.getElementById('lfScopeNew').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); addScope(); } };
    document.getElementById('lfScopeNew').onblur = addScope;
    renderScopes();
    // old board renderLogAlso: every other man as a bubble; each one lit gets his own day and his own card
    const renderAlso = () => {
      document.getElementById('lfAlso').innerHTML = crew.filter(c => c.active && c.id !== crewId).map(c => {
        const col = crewColor(c, w.crew), boss = c.boss_id ? w.crew.find(x => x.id === c.boss_id) : null, on = also.has(c.id);
        return `<button type="button" class="cchip ${on ? 'on' : ''}" data-man="${c.id}" style="${on ? `border-color:${col};background:${col}22` : ''}"><i class="cdot" style="background:${col}"></i>${esc(c.name)}${boss ? `<span style="opacity:.6"> · ${esc(boss.name)}</span>` : ''}</button>`;
      }).join('');
      f.querySelectorAll('#lfAlso .cchip').forEach(b => b.onclick = () => { const id = Number(b.dataset.man); also.has(id) ? also.delete(id) : also.add(id); renderAlso(); });
    };
    renderAlso();
    const co = document.getElementById('lfCo');
    const thisName = () => { document.getElementById('lfThisName').textContent = co.checked ? `CO - ${document.getElementById('lfCoTitle').value.trim() || 'new change order'}` : `${j.tag} - ${j.address}`; };
    co.onchange = () => { document.getElementById('lfCoWrap').style.display = co.checked ? '' : 'none'; thisName(); if (co.checked) document.getElementById('lfCoTitle').focus(); };
    document.getElementById('lfCoTitle').oninput = thisName;
    const evenHint = () => {
      const ins = [...f.querySelectorAll('.lfpct')];
      const used = ins.filter(i => i.value !== '').reduce((a, i) => a + Number(i.value), 0);
      const blank = ins.filter(i => i.value === '');
      blank.forEach(i => { i.placeholder = blank.length ? String(Math.round(Math.max(0, 100 - used) / blank.length * 10) / 10) : ''; });
    };
    f.querySelectorAll('.lfpct').forEach(i => i.oninput = evenHint); evenHint();
    document.getElementById('lfBack').onclick = () => { f.style.display = 'none'; document.getElementById('lPick').style.display = ''; };
    document.getElementById('lfSave').onclick = async () => {
      const err = document.getElementById('lfErr'); err.textContent = '';
      const split = {}; f.querySelectorAll('.lfpct').forEach(i => { split[i.dataset.key] = i.value === '' ? null : Number(i.value); });
      const miss = whyCantSplit(Object.values(split));
      if (miss.length) { err.textContent = miss.join('; '); return; }
      const scopes = lib.filter(n => picked.has(n));
      const scope_split = Object.fromEntries(scopes.map(n => [n, scopes.length > 1 && scopePct[n] != null ? scopePct[n] : null]));
      const smiss = whyCantSplit(Object.values(scope_split));
      if (smiss.length) { err.textContent = smiss.map(x => 'scopes: ' + x).join('; '); return; }
      const body = { crew_id: crewId, work_date: day, job_id: j.id, days: Number(f.querySelector('input[name=lfDays]:checked').value),
        scopes, scope_split, also_crew: [...also], co: co.checked, co_title: document.getElementById('lfCoTitle').value.trim(), split };
      if (body.co && !body.co_title) { err.textContent = "Say what the change order is."; return; }
      const btn = document.getElementById('lfSave'); btn.disabled = true;
      try {
        const saved = await call('/w/log', { method: 'POST', body });
        const back = await call(weekUrl);
        const want = scopes.join(' · ');
        const menOk = [crewId, ...also].every(cid => {
          const st = back.stops.find(s => s.crew_id === cid && s.work_date === day && s.job_id === saved.job_id);
          const cd = back.crewDays.find(d => d.crew_id === cid && d.work_date === day);
          return st && st.day_scope === want && cd && Number(cd.days) === body.days;
        });
        const st = back.stops.find(s => s.crew_id === crewId && s.work_date === day && s.job_id === saved.job_id);
        const pctOk = st && (split.this == null ? st.pct == null : Number(st.pct) === split.this);
        const splitOk = st && scopes.every(n => ((st.scope_split || {})[n] == null ? null : Number(st.scope_split[n])) === scope_split[n]);
        const libOk = scopes.every(n => (back.scopes || []).some(x => x.job_id === saved.job_id && x.name === n));
        if (!menOk || !pctOk || !libOk || !splitOk) throw new Error('That did not stick — the read-back does not show it. Nothing was assumed.');
        toast(`${man ? man.name : ''}${also.size ? ` + ${also.size} more` : ''} — ${body.co ? 'new CO: ' + body.co_title : ticketName(j)} · ${body.days === 0.5 ? 'half day' : 'full day'} — read back and it matches`);
        logBack.style.display = 'none'; reload();
      } catch (e) { err.textContent = e.message; fail(e); btn.disabled = false; }
    };
  }
  document.getElementById('lSearch').oninput = renderHits;
  document.getElementById('logCancel').onclick = () => { logBack.style.display = 'none'; };
  logBack.onclick = e => { if (e.target === logBack) logBack.style.display = 'none'; };

  // the × on a card in a man's cell: take HIM off THIS job on THIS day
  $app().querySelectorAll('.jobcard .kill').forEach(k => k.addEventListener('mousedown', () => hidePeek()));
  $app().querySelectorAll('.jobcard').forEach(c => c.onclick = e => { if (e.target.closest('.kill,.stbar')) return; hidePeek(); location.hash = `#/job/${c.dataset.peek}`; });
  $app().querySelectorAll('select.putman').forEach(sel => sel.onchange = () => { if (sel.value) run(() => addStop(sel.value, sel.dataset.job, sel.dataset.date)); });

  // (3) the pills
  const jobUrl = id => `/w/job/${id}`;
  $app().querySelectorAll('.stchip[data-stage]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    const j = jobsById[b.dataset.job], k = b.dataset.stage;
    run(() => doAndProve(`/w/job/${j.id}/stage`, { method: 'PUT', body: { stage: k } }, jobUrl(j.id), back => back.job.stage === k,
      `${j.tag} - ${j.address} → ${STAGE_LABEL[k]}`));
  });
  $app().querySelectorAll('.tup[data-bump]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    const me = jobsById[b.dataset.bump], dir = Number(b.dataset.dir);
    const mine = open.filter(x => x.tag !== 'R' && bucketOf(x) === bucketOf(me)).sort(jobCmp);
    const at = mine.findIndex(x => x.id === me.id), to = at + dir;
    if (at < 0 || to < 0 || to >= mine.length) return;
    mine.splice(to, 0, mine.splice(at, 1)[0]);
    const ids = mine.map(x => x.id);
    run(async () => {
      await call('/w/sched-order', { method: 'PUT', body: { ids } });
      const back = await call(weekUrl);
      const got = back.jobs.filter(x => ids.includes(x.id)).sort((a, c) => (a.sched_rank ?? 9999) - (c.sched_rank ?? 9999)).map(x => x.id);
      if (got.join(',') !== ids.join(',')) throw new Error('The order did not stick — the read-back shows a different order.');
    });
  });
  $app().querySelectorAll('[data-open]').forEach(r => r.onclick = e => { if (e.target.closest('.stbar,.tmove')) return; hidePeek(); location.hash = `#/job/${r.dataset.open}`; });
  $app().querySelectorAll('h3[data-fold]').forEach(h => h.onclick = () => {
    const f = foldState(); f[h.dataset.fold] = !f[h.dataset.fold];
    try { localStorage.setItem('smsSchedFold', JSON.stringify(f)); } catch {}
    reload();
  });
  $app().querySelectorAll('h3[data-hold]').forEach(h => h.onclick = () => { schedOpen[h.dataset.hold] = !schedOpen[h.dataset.hold]; reload(); });

  // ---------- (2) THE HOVER: old peekHTML / showPeek / mousemove 900 ms ----------
  const peekEl = document.getElementById('peek');
  const peekHTML = (j, crewId, day) => {
    const head = `<h4>${esc(j.tag)} - ${esc(j.address)}</h4>`;
    const e = crewId ? crew.find(c => c.id === Number(crewId)) : null;
    if (!e || !day) return head;
    const stops = w.stops.filter(s => s.crew_id === e.id && s.work_date === day);
    const dayPay = manDayPay(daysFor(w.crewDays, e.id, day, stops.length), e.day_rate, payFor(w.crewDays, e.id, day));
    const cost = jid => (shares.find(s => s.crew_id === e.id && s.work_date === day && s.job_id === jid) || {}).cost || 0;
    const $ = n => '$' + Math.round(n).toLocaleString();
    const days = daysFor(w.crewDays, e.id, day, stops.length);
    const name = o => `${esc(o.tag)} - ${esc(o.address)}`;
    // old board .peek .prow: every job he went to that day, same bold, same color, each with its dollars
    const order = [j.id, ...stops.map(s => s.job_id).filter(id => id !== j.id)];
    return head +
      `<div class="pwho"><i class="cdot" style="background:${crewColor(e, w.crew)}"></i>${esc(e.name)} — ${dayHead(day)} · ${days === 0.5 ? 'half day' : 'full day'}${dayPay ? ' ' + $(dayPay) : ''}</div>` +
      (dayPay ? order.map(id => jobsById[id] ? `<div class="prow"><span>${name(jobsById[id])}</span><b>${$(cost(id))}</b></div>` : '').join('') : `<div class="pnote">No day rate set for him yet.</div>`);
  };
  let peekTimer = null, peekId = null, hoverKey = null;
  function hidePeek() { clearTimeout(peekTimer); peekEl.classList.remove('on'); peekId = null; }
  const showPeek = (id, x, y, row, day) => {
    const j = jobsById[id]; if (!j) return;
    peekEl.innerHTML = peekHTML(j, row, day); peekEl.classList.add('on'); peekId = id;
    const r = peekEl.getBoundingClientRect();
    const left = Math.min(Math.max(8, x - r.width / 2), window.innerWidth - r.width - 8);
    let top = y + 16; if (top + r.height > window.innerHeight - 8) top = Math.max(8, y - r.height - 16);
    peekEl.style.left = left + 'px'; peekEl.style.top = top + 'px';
  };
  if (window._smsPeekMove) document.removeEventListener('mousemove', window._smsPeekMove);
  window._smsPeekMove = e => {
    if (!document.body.contains(peekEl)) return;
    if (e.target.closest('#peek')) return;
    const card = e.target.closest('[data-peek]');
    const key = card ? `${card.dataset.peek}|${card.dataset.row || ''}|${card.dataset.day || ''}` : null;
    if (key === hoverKey) return;
    hoverKey = key; clearTimeout(peekTimer);
    if (peekId) hidePeek();
    if (!card) return;
    const x = e.clientX, y = e.clientY;
    peekTimer = setTimeout(() => showPeek(Number(card.dataset.peek), x, y, card.dataset.row || '', card.dataset.day || ''), 900);
  };
  document.addEventListener('mousemove', window._smsPeekMove);
}
