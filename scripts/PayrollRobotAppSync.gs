// ===================== APP → DAILY PAYROLL (11/4/26, any-number-of-men 11/5/26) =====================
// Every 5 minutes: reads who went where from the SMS app (read-only) and writes it
// into Daily Payroll. The APP is the one place crew days get typed. Fix a day in
// the app and this replaces that day here — it never adds a day twice.
//   Weekly tab:  every SMS employee goes on his own row in the top day box (the row the
//                Totals block points to). A man not on the Totals block yet gets added to
//                the bottom of it, and the day box grows a row if it needs one — no limit.
//                Subs on the bottom: each crew's box (every job, full day pay), and when a
//                crew split its day, a box per job with each man's share and the job total.
//   GREEN IN THE APP = HIS OK TO APPLY. On that OK the robot puts each sub box's line on the
//   Subs tab, applies the day where it goes (see APPLY below) and greens each piece as it
//   lands. Not applied = not green. OK taken back / day changed in the app = what was applied
//   comes back out, the green comes off, the Subs lines come out, then it is redone.
//   Cells this writes are protected (warning only). Problems go on the "App Sync" tab.
const PAYROLL_ID = '1yY_j6idmY0UY_InoOib9TGPoKdcFRSuqTpQT5Ci0coQ';
const APP_URL = 'https://sms-roofing-system.netlify.app';
const SYNC_TAG = 'SMS app';
const HEAD_ROW = 11, EMP_FIRST = 12;
const DAY_COL = { 6: 1, 1: 5, 2: 9, 3: 13, 4: 17, 5: 21 }; // Sat=A … Fri=U (1-based)
const GREEN = '#00ff00'; // Legacy job-cost helpers only; mirror green means verified breakdown placement.
const GROUP_COLORS = [null, '#0000ff', '#ff0000', '#9900ff', '#ff6d01', '#38761d'];   // 1st crew plain, the rest colored + bold
const SYNC_FROM = '2026-11-03';   // days before this were typed by hand — the app never touches them

// Where things sit on a weekly tab. His template: day box rows 12–16, "Totals" label in
// A26, sub boxes from row 35. When the day box grows, everything below moves down the
// same amount, so it is all measured from the "Totals" label.
function layout(sh) {
  const colA = sh.getRange(1, 1, Math.min(sh.getMaxRows(), 200), 1).getValues();
  let t = 0;
  for (let i = EMP_FIRST; i < colA.length; i++) if (String(colA[i][0]).trim().toLowerCase() === 'totals') { t = i + 1; break; }
  if (!t) throw 'No "Totals" label in column A on ' + sh.getName();
  const off = t - 26;
  // the Totals block: names in column B under the label, down to the "Total" line (or the first blank name)
  let last = t;
  for (let r = t + 1; r < colA.length; r++) {
    const a = String(colA[r - 1][0]).trim().toLowerCase();
    const b = String(sh.getRange(r, 2).getValue()).trim();
    if (a === 'total' || !b) break;
    last = r;
  }
  // the sub area starts under the second date header in column A (row 34 on his template)
  const sat = colA[HEAD_ROW - 1][0];
  let h = 0;
  for (let i = t; i < colA.length; i++) {
    const v = colA[i][0];
    if (v instanceof Date && sat instanceof Date && v.toDateString() === sat.toDateString()) { h = i + 1; break; }
  }
  if (!h) h = 34 + off + (last - (t + 4));   // fallback: template spot, moved by any growth above it
  return { totalsLabel: t, namesFirst: t + 1, namesLast: last,
           boxLast: 16 + off, subFirst: h + 1, subBoxLast: h + 6, subLast: h + 45 };
}

// RUN THIS ONCE: adds the every-5-minute app sync (leaves the other timers alone).
function installAppSync() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'syncFromApp')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncFromApp').timeBased().everyMinutes(5).create();
  return syncFromApp();
}

function syncFromApp() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return 'busy';
  const log = [];
  try {
    const ss = SpreadsheetApp.openById(PAYROLL_ID);
    const props = PropertiesService.getScriptProperties();
    const today = Utilities.formatDate(new Date(), 'America/Chicago', 'yyyy-MM-dd');
    const lastWeek = Utilities.formatDate(new Date(Date.now() - 7 * 864e5), 'America/Chicago', 'yyyy-MM-dd');
    [lastWeek, today].forEach(d => {
      const res = UrlFetchApp.fetch(APP_URL + '/w/payroll-feed?start=' + d, { muteHttpExceptions: true });
      if (res.getResponseCode() !== 200) { log.push('App did not answer (' + res.getResponseCode() + ') for week of ' + d); return; }
      const feed = JSON.parse(res.getContentText());
      const sh = weekTab(ss, feed.start, log);
      if (!sh) return;
      feed.days.forEach(day => {
        if (day.date < SYNC_FROM) return;
        const key = 'day:' + day.date;
        const has = day.employees.length || day.subs.length;
        const was = JSON.parse(props.getProperty(key) || 'null');
        if (was && was.stamp === day.stamp && was.tab === sh.getName()) return;   // nothing changed
        if (!was && !has) return;                                               // nothing to do
        const col = DAY_COL[dow(day.date)];
        if (!col) { if (has) log.push(day.date + ' is a Sunday — no Sunday box on the weekly tab. Not written.'); return; }
        const wrote = writeDay(ss, sh, day, col, was, log);
        props.setProperty(key, JSON.stringify({ stamp: day.stamp, tab: sh.getName(), cells: wrote }));
        log.push('Wrote ' + day.date + ' (' + day.employees.length + ' men, ' + day.subs.length + ' sub boxes)' + (day.green ? ' — OK\'d in the app' : ' — not OK\'d yet'));
      });
    });
    retryApprovedPayroll(ss, props, log, today);
  } catch (e) {
    log.push('ERROR: ' + e);
  } finally {
    writeLog(log);
    lock.releaseLock();
  }
  return log.join('\n');
}

function dow(ymd) { return new Date(ymd + 'T12:00:00').getDay(); }
function md(ymd) { const p = ymd.split('-'); return Number(p[1]) + '/' + Number(p[2]); }

// Finds the weekly tab whose Saturday (A11) is this week. Makes it from the newest week if missing.
function weekTab(ss, sat, log) {
  const want = new Date(sat + 'T12:00:00').toDateString();
  const tabs = ss.getSheets().filter(s => / \d{4}$/.test(s.getName().trim()));
  for (const s of tabs) {
    const v = s.getRange(HEAD_ROW, 1).getValue();
    const d = v instanceof Date ? v : new Date(v);
    if (!isNaN(d) && d.toDateString() === want) return s;
  }
  const newest = tabs.map(s => ({ s, v: s.getRange(HEAD_ROW, 1).getValue() }))
    .filter(x => x.v instanceof Date).sort((a, b) => b.v - a.v)[0];
  if (!newest) { log.push('No weekly tab found to copy for week of ' + sat); return null; }
  const fri = new Date(new Date(sat + 'T12:00:00').getTime() + 6 * 864e5);
  const name = Utilities.formatDate(new Date(sat + 'T12:00:00'), 'America/Chicago', 'MMM dd') + ' - ' +
               Utilities.formatDate(fri, 'America/Chicago', 'MMM dd yyyy');
  const s = newest.s.copyTo(ss).setName(name);
  ss.setActiveSheet(s); ss.moveActiveSheet(newest.s.getIndex());
  // clear only the day boxes (what the app fills); everything else stays as his template
  const L = layout(s);
  Object.keys(DAY_COL).forEach(k => {
    const c = DAY_COL[k];
    s.getRange(EMP_FIRST, c, L.boxLast - EMP_FIRST + 1, 4).clearContent().setBackground(null).setFontColor(null).setFontWeight(null);
    s.getRange(L.subFirst, c, L.subLast - L.subFirst + 1, 4).clearContent().setBackground(null);
    s.getRange(L.subBoxLast + 1, c, L.subLast - L.subBoxLast, 4).setBorder(false, false, false, false, false, false);
  });
  s.getRange(HEAD_ROW, 1).setValue(new Date(sat + 'T12:00:00'));
  log.push('Made new weekly tab "' + name + '" from "' + newest.s.getName() + '"');
  return s;
}

// The man's row = the row his name sits on in the Totals block (1st name → row 12, 2nd → 13 …).
// Not on it yet (any SMS employee in the app counts): he is added at the bottom of the
// Totals block, and the day box grows a row if there isn't one for him.
function empRow(sh, man, log) {
  let L = layout(sh);
  const names = sh.getRange(L.namesFirst, 2, L.namesLast - L.namesFirst + 1, 1).getValues();
  for (let i = 0; i < names.length; i++) if (same(names[i][0], man)) return EMP_FIRST + i;
  // new man → he goes last
  const idx = names.length;
  const row = EMP_FIRST + idx;
  if (row > L.boxLast) { growDayBox(sh, L); L = layout(sh); }
  addToTotals(sh, L, man, row);
  log.push(sh.getName() + ': added ' + man + ' to the Totals block (row ' + row + ' of the day boxes).');
  return row;
}
function same(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase() && !!String(b || '').trim(); }

// One more row inside the day box, above its last row, so the box border, the day
// totals and every formula that adds up the box stretch to include it.
function growDayBox(sh, L) {
  const at = L.boxLast;
  sh.insertRowBefore(at);
  shiftStored(sh.getName(), at);
  // day totals that add the box (e.g. =sum(S12:S16)+sum(T12:T16)) — make sure they reach the new last row
  const last = L.boxLast + 1;
  Object.values(DAY_COL).forEach(c => {
    for (let col = c; col < c + 4; col++) {
      for (let r = last + 1; r <= last + 10; r++) {
        const cell = sh.getRange(r, col);
        const f = cell.getFormula();
        if (!f || f.indexOf('12:') < 0) continue;
        const nf = f.replace(/(\$?[A-Z]+\$?12:\$?[A-Z]+\$?)(\d+)/g, (m, p, n) => Number(n) >= 15 && Number(n) < last ? p + last : m);
        if (nf !== f) cell.setFormula(nf);
      }
    }
  });
}

// New line at the bottom of the Totals block for a new man: Base = his pay in every day box,
// Additional the same way, Total = Base + Additional, Check = Total. The "Total" line under it
// keeps adding up the whole block.
function addToTotals(sh, L, man, dayRow) {
  const r = L.namesLast + 1;
  const nameCell = sh.getRange(r, 2);
  const lineIsFree = !String(nameCell.getValue()).trim() && String(sh.getRange(r, 1).getValue()).trim().toLowerCase() !== 'total';
  if (!lineIsFree) { sh.insertRowBefore(r); shiftStored(sh.getName(), r); }
  const pay = Object.values(DAY_COL).map(c => colA1(c + 2) + dayRow).join('+');
  const add = Object.values(DAY_COL).map(c => colA1(c + 3) + dayRow).join('+');
  sh.getRange(r, 2, 1, 5).setValues([[man, '=' + pay, '=' + add, '=SUM(C' + r + ':D' + r + ')', '=E' + r]]);
  sh.getRange(r, 3, 1, 4).setNumberFormat('$#,##0.00');
  // the Total line right under the names adds up the whole block
  const t = r + 1;
  if (String(sh.getRange(t, 1).getValue()).trim().toLowerCase() === 'total') {
    sh.getRange(t, 3, 1, 4).setFormulas([['C', 'D', 'E', 'F'].map(x => '=SUM(' + x + L.namesFirst + ':' + x + r + ')')]);
  }
}
function colA1(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

// After a row is put in, the cells stored for days already written on this tab move down one.
function shiftStored(tab, at) {
  const props = PropertiesService.getScriptProperties();
  props.getKeys().filter(k => k.indexOf('day:') === 0).forEach(k => {
    const v = JSON.parse(props.getProperty(k));
    if (!v || v.tab !== tab || !v.cells) return;
    v.cells = v.cells.map(a1 => {
      const border = a1.indexOf('BORDER:') === 0;
      const ref = border ? a1.slice(7) : a1;
      const moved = ref.replace(/([A-Z]+)(\d+)/g, (m, c, n) => c + (Number(n) >= at ? Number(n) + 1 : n));
      return (border ? 'BORDER:' : '') + moved;
    });
    props.setProperty(k, JSON.stringify(v));
  });
}

// App mirror and sub breakdown only. Green means placed in the breakdown below.
// Accounting posting and approval are deliberately separate stages.
function writeDay(ss, sh, day, col, was, log) {
  const get = url => {
    const res = UrlFetchApp.fetch(url, {muteHttpExceptions:true});
    if (res.getResponseCode() !== 200) throw new Error('Payroll source refused: '+res.getContentText());
    return JSON.parse(res.getContentText());
  };
  const model = get(APP_URL+'/w/payroll-layout?date='+day.date);
  model.sms.men.forEach(p => empRow(sh,p.name,log));
  let L=layout(sh);
  while(model.sms.rows.length>L.boxLast-EMP_FIRST+1) { growDayBox(sh,L); L=layout(sh); }
  const size=model.subs.reduce((n,s)=>n+s.rows.length+1,0)-(model.subs.length?1:0);
  const result=get(APP_URL+'/w/payroll-layout?date='+day.date+'&sheet_id='+sh.getSheetId()+'&col='+col+
    '&employee_capacity='+(L.boxLast-EMP_FIRST+1)+'&sub_row='+L.subFirst+'&sub_capacity='+Math.max(6,size)+
    '&allocation_row='+(L.subFirst+size+1));
  // The model and plan must come from the same app state; never mix two snapshots.
  if(JSON.stringify(model)!==JSON.stringify(result.model)) throw new Error('App changed during sync; retry next pass');
  const plan=result.plan;
  was=JSON.parse(PropertiesService.getScriptProperties().getProperty('day:'+day.date)||'null')||was;
  let last=Math.max(L.subLast,plan.endRow);
  if(was && was.tab===sh.getName()) (was.cells||[]).forEach(a=>{
    const m=String(a).match(/(?:[A-Z]+)(\d+)$/); if(m) last=Math.max(last,Number(m[1]));
  });
  if(last>sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(),last-sh.getMaxRows());
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).filter(p=>p.getDescription()===SYNC_TAG+' '+day.date).forEach(p=>p.remove());
  // The day-owned area is replaced as a whole, including obsolete scope rows/borders.
  [sh.getRange(EMP_FIRST,col,L.boxLast-EMP_FIRST+1,3),sh.getRange(L.subFirst,col,last-L.subFirst+1,3)].forEach(r=>
    r.clearContent().setBackground('#ffffff').setFontColor('#000000').setFontWeight('normal').setBorder(false,false,false,false,false,false));
  plan.requests.forEach(r=>compactNativeRequest(sh,r));
  // Compact people can change rows. Totals follow names rather than obsolete fixed slots.
  for(let r=L.namesFirst;r<=L.namesLast;r++) {
    [col+2,col+3].forEach((c,idx)=>{
      const target=sh.getRange(r,idx?4:3), f=target.getFormula();
      if(!f) return;
      const letter=colA1(c);
      const expression='SUMIF('+colA1(col+1)+'$'+EMP_FIRST+':'+colA1(col+1)+'$'+L.boxLast+',$B'+r+','+letter+'$'+EMP_FIRST+':'+letter+'$'+L.boxLast+')';
      // Idempotent: replace existing SUMIF for this day, or the original fixed pay reference.
      const prior=new RegExp('SUMIF\\('+colA1(col+1)+'\\$?'+EMP_FIRST+':'+colA1(col+1)+'\\$?\\d+,\\$?B'+r+','+letter+'\\$?'+EMP_FIRST+':'+letter+'\\$?\\d+\\)','g');
      let next=f.replace(prior,expression);
      if(next===f && f.indexOf(expression)<0) next=f.replace(new RegExp('(?<![A-Z0-9_])'+letter+'\\$?\\d+(?![0-9:(])','g'),expression);
      if(next!==f)target.setFormula(next);
    });
  }
  SpreadsheetApp.flush();
  plan.verification.forEach(v=>{
    const c=sh.getRange(v.row,v.col), w=v.value;
    const ok=w.formulaValue!==undefined?c.getFormula()===w.formulaValue:w.numberValue!==undefined?Math.abs(Number(c.getValue())-w.numberValue)<0.005:c.getValue()===w.stringValue;
    if(!ok || /^#(REF!|ERROR!|VALUE!|DIV\/0!)/.test(c.getDisplayValue()))throw new Error('Payroll read-back failed at '+c.getA1Notation());
  });
  // Verify each computed share too, before any completion green is applied.
  let row=plan.allocationStart;
  result.model.allocations.forEach(a=>{
    a.men.forEach((m,i)=>{if(Math.abs(Number(sh.getRange(row+i,col+2).getValue())-m.amount)>0.005)throw new Error('Share mismatch for '+m.name);});
    row+=a.men.length+1;
  });
  plan.green.forEach(r=>compactNativeRequest(sh,r));
  sh.getRange(HEAD_ROW,col).setNote('Mirrors the SMS Schedule. Edit assignments in the app. Green on subs means every share is placed in the breakdown below; it does not mean paid or posted to job cost.');
  log.push(day.date+': compact mirror verified; SMS $'+model.totals.sms+', subs $'+model.totals.subs+'; '+model.allocations.length+' job breakdowns.');
  return [sh.getRange(EMP_FIRST,col,L.boxLast-EMP_FIRST+1,3).getA1Notation(),sh.getRange(L.subFirst,col,Math.max(1,plan.endRow-L.subFirst+1),3).getA1Notation()];
}
function compactNativeRequest(sh,request) {
  const u=request.updateCells||request.updateBorders||request.repeatCell, q=u.range;
  const range=sh.getRange(q.startRowIndex+1,q.startColumnIndex+1,q.endRowIndex-q.startRowIndex,q.endColumnIndex-q.startColumnIndex);
  const color=c=>'#'+['red','green','blue'].map(k=>Math.round((c[k]||0)*255).toString(16).padStart(2,'0')).join('');
  if(request.updateBorders){
    const edge=k=>u[k]===undefined?null:u[k].style!=='NONE';
    range.setBorder(edge('top'),edge('left'),edge('bottom'),edge('right'),edge('innerVertical'),edge('innerHorizontal'));
  } else if(request.repeatCell) {
    range.setBackground(color(u.cell.userEnteredFormat.backgroundColor));
  } else if(!u.rows) {
    range.clearContent().setBackground('#ffffff').setFontColor('#000000').setFontWeight('normal');
  } else {
    u.rows.forEach((r,i)=>r.values.forEach((v,j)=>{
      const c=range.getCell(i+1,j+1), value=v.userEnteredValue, f=v.userEnteredFormat||{}, t=f.textFormat||{};
      if(value) value.formulaValue!==undefined?c.setFormula(value.formulaValue):c.setValue(value.numberValue!==undefined?value.numberValue:value.stringValue);
      else c.clearContent();
      c.setBackground(f.backgroundColor?color(f.backgroundColor):'#ffffff').setFontFamily(t.fontFamily||'Calibri').setFontSize(t.fontSize||10).setFontColor(t.foregroundColor?color(t.foregroundColor):'#000000').setFontWeight(t.bold?'bold':'normal');
      if(f.numberFormat)c.setNumberFormat(f.numberFormat.pattern);
    }));
  }
}
// One-time migration. Preserves the original week before repairing only Nov 9.
function repairNovemberNinePayroll() {
  const ss=SpreadsheetApp.openById(PAYROLL_ID), sh=ss.getSheetByName('Nov 07 - Nov 13 2026');
  const name='Backup before compact Nov09';
  if(!ss.getSheetByName(name))sh.copyTo(ss).setName(name).hideSheet();
  const p=PropertiesService.getScriptProperties(),key='day:2026-11-09',v=JSON.parse(p.getProperty(key)||'null');
  if(v){v.stamp='redo compact v2';p.setProperty(key,JSON.stringify(v));}
  const message=syncFromApp(); console.log(message); return message;
}


// Takes off every Subs line the app wrote for this date (marked "app YYYY-MM-DD" in column I),
// paid or not — his rule: if he changes or un-greens a day in the app, back it all out.
function clearSubsLines(subs, date, log) {
  const last = subs.getLastRow();
  if (last < 1) return;
  const v = subs.getRange(1, 1, last, 9).getValues();
  for (let i = v.length - 1; i >= 0; i--) {
    if (String(v[i][8]).indexOf('app ' + date) !== 0) continue;
    if (String(v[i][4]).trim() !== '') log.push(date + ': ' + v[i][1] + ' / ' + v[i][2] + ' was marked paid (' + v[i][4] + ') and was backed out because the day changed in the app.');
    subs.deleteRow(i + 1);
  }
}

function writeLog(lines) {
  if (!lines.length) return;
  const ss = SpreadsheetApp.openById(PAYROLL_ID);
  const sh = ss.getSheetByName('App Sync') || ss.insertSheet('App Sync');
  const when = Utilities.formatDate(new Date(), 'America/Chicago', 'M/d h:mm a');
  sh.insertRowsBefore(1, lines.length);
  sh.getRange(1, 1, lines.length, 2).setValues(lines.map(l => [when, l]));
  const extra = sh.getMaxRows() - 300;
  if (extra > 0) sh.deleteRows(301, extra);
}

// Rewrites every app day from scratch on the next pass (use after a layout change).
function rewriteAppDays() {
  const props = PropertiesService.getScriptProperties();
  props.getKeys().filter(k => k.indexOf('day:') === 0).forEach(k => {
    const v = JSON.parse(props.getProperty(k)); v.stamp = 'redo'; props.setProperty(k, JSON.stringify(v));
  });
  return syncFromApp();
}


// Rewrites the given days (default: the days the old yellow step touched).
function redoDay(ymd) {
  const props = PropertiesService.getScriptProperties();
  (ymd ? [ymd] : ['2026-11-05', '2026-11-07']).forEach(d => {
    const k = 'day:' + d;
    const v = JSON.parse(props.getProperty(k) || 'null');
    if (v) { v.stamp = 'redo'; props.setProperty(k, JSON.stringify(v)); }
  });
  return syncFromApp();
}

// ===================== APPLY (his process, 11/4 + 11/9/26) =====================
// GREEN IN THE APP = HIS OK TO APPLY. The robot applies the day where it goes and greens
// each piece on the weekly tab AS it lands — no other color, no extra step:
//   • JC job → the job's Actual Job Cost Sheet, Actual Labor log, laid out exactly like his
//     entries (date, man, amount, scope; SMS crew gets a total row; a sub is one line with
//     the leader's name only). The total goes into SMS (B2) or Subs (B3) and into each
//     scope's line (split evenly when a block has more than one scope). Read back, then green.
//   • Everything else (R, UC, CO, W …) → the QuickBooks placeholder. The robot has no
//     QuickBooks connection, so those are NOT applied and NOT green — listed on "App Sync".
//   • Already on the job cost sheet (logged by hand) = counts as applied, never logged twice.
//   • Can't tell the job, no job cost sheet, or a scope with no line on it = not applied, not green.
// Change or un-green in the app = everything the robot applied for that day comes back out
// (rows deleted, the numbers taken back out of B2/B3 and the scope lines), then it is redone.
const JOB_SHEETS = {
  // tag-street# : { id, tab, label as the app writes it }
  'JC-4860': { id: '1rEaFLZD79_-mTmXsV2EeSiHPBPUtcjJftBffYJnDTto', tab: 'Actual Labor', label: 'JC-4860 E. I - 30' }
};
const POST_ROUTES = {
  '19': { key: 'JC-ticket-19', id: '1rEaFLZD79_-mTmXsV2EeSiHPBPUtcjJftBffYJnDTto', tab: 'Actual Labor' },
  '1': { key: 'JC-ticket-1', id: '1opWjiNIMrb41r2c6Ipbob8Mdmw-kV4lQcyVxOIbMQoQ', tab: 'Actual Labor' }
};
Object.keys(POST_ROUTES).forEach(id => { const route = POST_ROUTES[id]; JOB_SHEETS[route.key] = route; });
const LOG_FIRST = 31;   // the Actual Labor log starts under the frozen header

function jobKey(line) {
  const m = String(line || '').match(/^\s*([A-Za-z]+)\s*-\s*(\d+)/);
  return m ? m[1].toUpperCase() + '-' + m[2] : String(line || '').trim();
}
function jobTag(key) { return String(key).split('-')[0]; }
function scopeOf(line) {
  const j = JOB_SHEETS[jobKey(line)];
  if (!j || String(line).indexOf(j.label) !== 0) return '';
  return String(line).slice(j.label.length).replace(/^\s*-\s*/, '').trim();
}
function norm(s) { return String(s || '').replace(/["“”]/g, '').replace(/\s+/g, ' ').trim().toLowerCase(); }
function r2(n) { return Math.round(Number(n) * 100) / 100; }

// What the day puts on each job: SMS men grouped by the exact same scopes (his color rule),
// each man's share = his day ÷ the jobs he went to; each sub = leader + the job's total.
function planDay(day) {
  const jobs = {};
  const J = k => (jobs[k] = jobs[k] || { key: k, sms: [], subs: [] });
  (day.employees || []).forEach(e => {
    const byJob = {};
    (e.lines && e.lines.length ? e.lines : [e.job]).forEach(l => {
      const k = jobKey(l); byJob[k] = byJob[k] || [];
      const s = scopeOf(l); if (s && byJob[k].indexOf(s) < 0) byJob[k].push(s);
    });
    const keys = Object.keys(byJob);
    keys.forEach(k => {
      const sig = byJob[k].slice().sort().join('|');
      let g = J(k).sms.find(x => x.sig === sig);
      if (!g) { g = { sig, scopes: byJob[k], men: [] }; J(k).sms.push(g); }
      g.men.push({ name: e.man, amt: r2(e.pay / keys.length) });
    });
  });
  (day.subs || []).forEach(b => {
    const ls = b.lines && b.lines.length ? b.lines : [b.job];
    const sc = []; ls.forEach(l => { const s = scopeOf(l); if (s && sc.indexOf(s) < 0) sc.push(s); });
    J(jobKey(ls[0])).subs.push({ leader: b.leader, total: r2(b.total), scopes: sc });
  });
  return jobs;
}

// Applies every job of a green day. Returns { applied: {jobKey: true/false}, entries: [...] }.
function applyDay(day, log) {
  const plan = planDay(day);
  const applied = {}, entries = [];
  Object.keys(plan).forEach(k => {
    try {
      const res = applyJob(day, plan[k], log);
      applied[k] = !!res;
      if (res && res.entry) entries.push(res.entry);
    } catch (e) {
      applied[k] = false;
      log.push(md(day.date) + ': ' + k + ' NOT applied — ' + e);
    }
  });
  return { applied, entries };
}

function applyJob(day, job, log) {
  const when = md(day.date);
  if (jobTag(job.key) !== 'JC') {
    log.push(when + ': ' + job.key + ' goes on the QuickBooks placeholder — the robot can\'t reach QuickBooks. Not applied, not green.');
    return null;
  }
  const J = JOB_SHEETS[job.key];
  if (!J) { log.push(when + ': ' + job.key + ' — no Actual Job Cost Sheet on file for this job. Not applied, not green.'); return null; }
  const sh = SpreadsheetApp.openById(J.id).getSheetByName(J.tab);
  if (!sh) throw 'no "' + J.tab + '" tab on the job cost sheet';

  const logFirst=ledgerFirstRow(sh);
  // every scope needs its line in the summary (E2:E…)
  const sumVals = sh.getRange(2, 5, logFirst - 4, 1).getValues();
  const scopeRow = s => { for (let i = 0; i < sumVals.length; i++) if (norm(sumVals[i][0]) === norm(s)) return i + 2; return 0; };
  // blocks to log
  const blocks = [];
  job.sms.forEach(g => blocks.push({ kind: 'sms', scopes: g.scopes, rows: g.men.map(m => [m.name, m.amt]) }));
  job.subs.forEach(s => blocks.push({ kind: 'sub', scopes: s.scopes, rows: [[s.leader, s.total]] }));

  // what's already on the log (his hand entries, or an earlier pass)
  const last = Math.max(sh.getLastRow(), logFirst);
  const logVals = sh.getRange(logFirst, 1, last - logFirst + 1, 5).getValues();
  const dayStr = new Date(day.date + 'T12:00:00').toDateString();
  const sameDay = v => { const d = v instanceof Date ? v : new Date(v); return !isNaN(d) && d.toDateString() === dayStr; };
  const already = b => logVals.some((r,i) => sameDay(r[0]) && (norm(r[3]) === norm(b.scopes.join(' · ')) || b.scopes.every((name,k)=>norm((logVals[i+k]||[])[3])===norm(name))) &&
    b.rows.every((m,k) => logVals[i+k] && norm(logVals[i+k][1])===norm(m[0]) && Math.abs(Number(logVals[i+k][2])-m[1])<0.005));
  for(const b of blocks) {
    if(already(b)) continue;
    if(logVals.some(r=>sameDay(r[0]) && b.rows.some(m=>norm(m[0])===norm(r[1]))))
      throw new Error('Existing labor differs or is incomplete; reconcile before adding another entry');
  }
  const todo = blocks.filter(b => !already(b));
  if (!todo.length) return { entry: null };   // logged by hand already — counts as applied
  const missing = [];
  todo.forEach(b => b.scopes.forEach(s => { if (!scopeRow(s) && missing.indexOf(s) < 0) missing.push(s); }));
  if (missing.length) { log.push(when + ': ' + job.key + ' — scope "' + missing.join('", "') + '" has no line on the job cost sheet. Not applied, not green.'); return null; }

  // his layout: copy the formatting of his last entries of the same kind
  const tpl = findTemplates(sh, logVals, logFirst);
  let r = lastFilled(logVals) + logFirst + 2;   // one blank row, then the block
  const entry = { id: J.id, tab: J.tab, first: r, last: 0, refs: [] };
  const toks = [];   // {a1, tok}
  todo.forEach(b => {
    const top = r;
    const vals = b.rows.map((m, i) => [i ? '' : new Date(day.date + 'T12:00:00'), m[0], m[1], '']);
    sh.getRange(top, 1, vals.length, 4).setValues(vals);
    let tot;
    if (b.kind === 'sms') {
      if (tpl.sms) {
        tpl.sms.first.copyFormatToRange(sh, 1, 4, top, top);
        if (vals.length > 1) tpl.sms.mid.copyFormatToRange(sh, 1, 4, top + 1, top + vals.length - 1);
        tpl.sms.total.copyFormatToRange(sh, 1, 4, top + vals.length, top + vals.length);
      }
      tot = top + vals.length;
      sh.getRange(tot, 3).setFormula('=SUM(C' + top + ':C' + (tot - 1) + ')');
      toks.push({ a1: 'B2', tok: '+C' + tot });
    } else {
      if (tpl.sub) tpl.sub.copyFormatToRange(sh, 1, 4, top, top);
      tot = top;
      toks.push({ a1: 'B3', tok: '+C' + tot });
    }
    formatLedgerBlock(sh,top,b.rows.length,tot,b.kind);
    sh.getRange(top, 1).setNumberFormat('M/d/yyyy');
    sh.getRange(top, 3, tot - top + 1, 1).setNumberFormat('$#,##0.00');
    sh.getRange(tot, 3).setBackground(null);   // green comes last
    const scopeRows = ledgerScopeRows(top, tot, b.scopes);
    if(scopeRows.length) {
      sh.getRange(top,4,scopeRows.length,2).setValues(scopeRows);
      sh.getRange(top,4,scopeRows.length,2).setBorder(true,true,true,true,true,false);
    }
    scopeRows.forEach((line,i) => {
      sh.getRange(top+i,5).setNumberFormat('$#,##0.00');
      toks.push({a1:'F'+scopeRow(line[0]),tok:'+E'+(top+i)});
    });
    b.scopeRows=scopeRows; b.top=top; b.tot = tot;
    entry.last = Math.max(tot, top+scopeRows.length-1);
    r = entry.last + 2;
  });
  toks.forEach(t => {
    const c = sh.getRange(t.a1), f = c.getFormula();
    c.setFormula(f ? f + t.tok : '=' + t.tok.slice(1));
    entry.refs.push(t);
  });
  SpreadsheetApp.flush();
  // read back: every total is in its place before anything goes green
  const has = (f, tok) => new RegExp('(\\+|^=)' + tok.slice(1).replace(/[/]/g, '\\/') + '(?![0-9])').test(f);
  const bad = toks.filter(t => !has(sh.getRange(t.a1).getFormula(), t.tok));
  const scopeOff = todo.some(b => b.scopeRows.some((line,i)=>sh.getRange(b.top+i,4).getValue()!==line[0] || sh.getRange(b.top+i,5).getFormula()!==line[1]));
  const off = todo.filter(b => Math.abs(Number(sh.getRange(b.tot, 3).getValue()) - b.rows.reduce((a, m) => a + m[1], 0)) > 0.01);
  if (bad.length || off.length || scopeOff) {
    log.push('read-back detail: ' + JSON.stringify({ bad: bad, off: off.map(b => [b.tot, sh.getRange(b.tot, 3).getValue()]) }));
    backOut([entry], log);
    log.push(when + ': ' + job.key + ' — read-back failed, taken back out. Not applied, not green.');
    return null;
  }
  todo.forEach(b => {
    markLedgerTotalApplied(sh,b.tot,b.kind);
    b.scopeRows.forEach((line,i)=>sh.getRange(b.top+i,5).setBackground(GREEN));
  });
  log.push(when + ': applied ' + job.key + ' to its Actual Job Cost Sheet (rows ' + entry.first + '–' + entry.last + ').');
  return { entry };
}

function lastFilled(vals) {
  for (let i = vals.length - 1; i >= 0; i--) if (vals[i].some(v => String(v).trim() !== '')) return i;
  return -1;
}

// His last SMS block (rows, then a total row with no name) and his last one-line sub entry.
function findTemplates(sh, vals, firstRow = LOG_FIRST) {
  const out = { sms: null, sub: null };
  let i = vals.length - 1;
  while (i >= 0 && (!out.sms || !out.sub)) {
    while (i >= 0 && !vals[i].some(v => String(v).trim() !== '')) i--;
    if (i < 0) break;
    let j = i; while (j - 1 >= 0 && vals[j - 1].some(v => String(v).trim() !== '')) j--;
    const top = firstRow + j, bot = firstRow + i;
    const isTotal = !String(vals[i][1]).trim() && String(vals[i][2]).trim();
    if (isTotal && bot > top && !out.sms) out.sms = {
      first: sh.getRange(top, 1, 1, 4), mid: sh.getRange(bot - top > 1 ? top + 1 : top, 1, 1, 4), total: sh.getRange(bot, 1, 1, 4) };
    if (bot === top && String(vals[i][1]).trim() && !out.sub) out.sub = sh.getRange(top, 1, 1, 4);
    i = j - 1;
  }
  return out;
}

// Takes what the robot applied back out: numbers out of B2/B3 and the scope lines, rows deleted.
function backOut(entries, log) {
  (entries || []).slice().sort((a, b) => b.first - a.first).forEach(e => {
    const sh = SpreadsheetApp.openById(e.id).getSheetByName(e.tab);
    if (!sh) return;
    e.refs.forEach(t => {
      const c = sh.getRange(t.a1), f = c.getFormula();
      const re = new RegExp(t.tok.replace(/[+/]/g, '\\$&') + '(?![0-9])');
      let nf = f.replace(re, '');
      if (nf === f) {   // it was the first term: "=C290…"
        const re2 = new RegExp('^=' + t.tok.slice(1).replace(/[+/]/g, '\\$&') + '(?![0-9])\\+?');
        nf = f.replace(re2, '=');
      }
      if (nf === '=' || nf === '') c.clearContent(); else if (nf !== f) c.setFormula(nf);
    });
    const n = e.last - e.first + 2;   // the block and the blank row above it
    sh.deleteRows(e.first - 1, n);
    shiftApplied(e.id, e.tab, e.first - 1, n);
  });
}

// After rows are deleted on a job cost sheet, the rows/totals stored for other days move up.
function shiftApplied(id, tab, at, n) {
  const props = PropertiesService.getScriptProperties();
  props.getKeys().filter(k => k.indexOf('applied:') === 0).forEach(k => {
    const list = JSON.parse(props.getProperty(k) || '[]');
    let changed = false;
    list.forEach(e => {
      if (e.id !== id || e.tab !== tab || e.first < at) return;
      e.first -= n; e.last -= n; changed = true;
      e.refs.forEach(t => { t.tok = t.tok.replace(/C(\d+)/, (m, x) => 'C' + (Number(x) >= at ? Number(x) - n : x)); });
    });
    if (changed) props.setProperty(k, JSON.stringify(list));
  });
}


// Posting is independent of the mirror stamp. A copied day is not a posted day.
// Scan historical weeks in bounded batches; retain the cursor until all dates are checked.
function retryApprovedPayroll(ss, props, log, today) {
  const cursorKey = 'posting-scan:v1';
  let cursor = props.getProperty(cursorKey) || SYNC_FROM;
  for (let week = 0; week < 8 && cursor <= today; week++) {
    const response = UrlFetchApp.fetch(APP_URL + '/w/payroll-feed?start=' + cursor, {muteHttpExceptions:true});
    if (response.getResponseCode() !== 200) throw new Error('Posting scan refused; cursor retained at ' + cursor);
    const feed = JSON.parse(response.getContentText());
    feed.days.filter(d => d.date >= SYNC_FROM && d.date <= today && d.green).forEach(day => {
      try { postApprovedPayrollDay(ss, props, day, log); }
      catch (e) { log.push(day.date + ': POSTING INCOMPLETE — ' + e + '; will retry.'); }
    });
    const next = new Date(feed.start + 'T12:00:00Z'); next.setUTCDate(next.getUTCDate() + 7);
    cursor = Utilities.formatDate(next, 'UTC', 'yyyy-MM-dd');
    props.setProperty(cursorKey, cursor > today ? SYNC_FROM : cursor);
  }
}
function postingPlan(model) {
  const jobs = {};
  const labels = {};
  model.sms.rows.forEach(r => { if(r.job) labels[r.job.job_id] = r.job.text; });
  model.subs.forEach(b => b.rows.forEach(r => { if(r.job) labels[r.job.job_id] = r.job.text; }));
  const job = id => jobs[id] || (jobs[id] = {id, label:labels[id], sms:[], subs:[]});
  model.sms.men.forEach(man => man.shares.forEach(share => {
    const scopes = String(share.day_scope || '').split(' · ').filter(Boolean);
    const sig = scopes.slice().sort().join('|');
    const j = job(share.job_id);
    let group = j.sms.find(g => g.sig === sig);
    if(!group) { group = {sig,scopes,men:[]}; j.sms.push(group); }
    group.men.push({name:man.name,amt:r2(share.cost)});
  }));
  model.subs.forEach(crew => crew.men.forEach(man => man.shares.forEach(share => {
    const j=job(share.job_id), scopes=String(share.day_scope||'').split(' · ').filter(Boolean);
    const sig=scopes.slice().sort().join('|');
    let block=j.subs.find(b=>b.leaderId===crew.leader_id && b.sig===sig);
    if(!block) { block={leaderId:crew.leader_id,leader:(crew.men.find(m=>m.id===crew.leader_id)||man).name,sig,scopes,total:0};j.subs.push(block); }
    block.total=r2(block.total+share.cost);
  })));
  return Object.values(jobs);
}
function postApprovedPayrollDay(ss, props, day, log) {
  const response=UrlFetchApp.fetch(APP_URL+'/w/payroll-layout?date='+day.date,{muteHttpExceptions:true});
  if(response.getResponseCode()!==200) throw new Error('Cannot read saved job shares');
  const model=JSON.parse(response.getContentText()), jobs=postingPlan(model), completed={};
  jobs.forEach(job => {
    const key='posted:v1:'+day.date+':'+job.id, signature=JSON.stringify(job);
    const prior=JSON.parse(props.getProperty(key)||'null');
    if(prior && prior.signature!==signature) {
      log.push(day.date+': '+job.label+' changed after posting; reconciliation required. Not marked complete.'); return;
    }
    const route=POST_ROUTES[job.id];
    if(!route) { log.push(day.date+': '+job.label+' has no verified posting route. Not marked complete; will retry.'); return; }
    // Check destination before changing any ledger. A bid Labor tab is not Actual Labor.
    const destination=SpreadsheetApp.openById(route.id).getSheetByName(route.tab);
    if(!destination) { log.push(day.date+': '+job.label+' needs an Actual Labor ledger; the existing bid Labor tab is not a posting destination.'); return; }
    if(prior && prior.verified) {
      migratePostedScopes(destination,day,job,log); completed[job.id]=true; return;
    }
    const result=applyJob(day,{...job,key:route.key},log);
    if(result) migratePostedScopes(destination,day,job,log);
    if(!result) return;
    props.setProperty(key,JSON.stringify({signature,verified:true,entry:result.entry}));
    completed[job.id]=true;
  });
  // Approval may change during a slow ledger write: re-read before marking anything complete.
  const latest=UrlFetchApp.fetch(APP_URL+'/w/payroll-feed?start='+day.date,{muteHttpExceptions:true});
  if(latest.getResponseCode()!==200) throw new Error('Cannot verify approval after posting');
  const current=JSON.parse(latest.getContentText()).days.find(d=>d.date===day.date);
  if(!current || !current.green || current.stamp!==day.stamp) throw new Error('Day changed during posting; completion withheld');
  // Resolve by the feed's Saturday, not the requested day's weekday.
  const saturday=JSON.parse(latest.getContentText()).start;
  const target=weekTab(ss,saturday,log); if(!target) throw new Error('Weekly payroll tab missing');
  const col=DAY_COL[dow(day.date)], L=layout(target);
  model.sms.rows.forEach((r,i)=>{
    if(r.job) target.getRange(EMP_FIRST+i,col).setBackground(completed[r.job.job_id]?GREEN:'#ffffff');
    if(r.person) target.getRange(EMP_FIRST+i,col+1,1,2).setBackground(r.person.shares.every(s=>completed[s.job_id])?GREEN:'#ffffff');
  });
  SpreadsheetApp.flush();
  log.push(day.date+': job-cost posting verified '+Object.keys(completed).length+'/'+jobs.length+' tickets.');
}


// One visible amount per scope beside its ledger block; summaries reference E cells.
function ledgerScopeRows(top,totalRow,scopes) {
  return scopes.map(name=>String(name).trim()).filter(Boolean).map(name=>[name,'=C'+totalRow+(scopes.length>1?'/'+scopes.length:'')]);
}
function migratePostedScopes(sh,day,job,log) {
  const logFirst=ledgerFirstRow(sh);
  const values=sh.getRange(logFirst,1,Math.max(1,sh.getLastRow()-logFirst+1),5).getValues();
  const groups=job.sms.map(g=>({kind:'sms',scopes:g.scopes,men:g.men})).concat(job.subs.map(g=>({kind:'sub',scopes:g.scopes,men:[{name:g.leader,amt:g.total}]})));
  groups.forEach(g=>{
    if(!g.scopes.length)return;
    const matches=[];
    values.forEach((row,i)=>{
      const date=row[0] instanceof Date?row[0]:new Date(row[0]);
      if(isNaN(date)||Utilities.formatDate(date,'America/Chicago','yyyy-MM-dd')!==day.date)return;
      if(g.men.every((m,k)=>values[i+k]&&norm(values[i+k][1])===norm(m.name)&&Math.abs(Number(values[i+k][2])-m.amt)<0.005)) matches.push(i);
    });
    if(matches.length!==1)throw new Error('Cannot uniquely verify ledger block for '+g.men[0].name+'; scope migration withheld');
    const i=matches[0],top=logFirst+i,tot=g.kind==='sms'?top+g.men.length:top;
    const lines=ledgerScopeRows(top,tot,g.scopes), updates=[];
    // Do not overwrite another crew, a different scope, or an existing side calculation.
    lines.forEach((line,k)=>{
      const row=values[i+k]||[];
      if(k>=g.men.length && (row[0]||row[1]))throw new Error('Scope rows overlap another ledger block; migration withheld');
      const old=String(row[3]||'');
      if(old && norm(old)!==norm(line[0]) && !(k===0&&norm(old)===norm(g.scopes.join(' · '))))throw new Error('Different scope beside ledger; migration withheld');
      const existing=sh.getRange(top+k,5).getFormula();
      if((existing&&existing!==line[1])||(!existing&&row[4]!==''&&row[4]!=null))throw new Error('Existing side calculation differs; migration withheld');
      const summary=sh.getRange(2,5,logFirst-4,1).getValues().findIndex(r=>norm(r[0])===norm(line[0]));
      if(summary<0)throw new Error('Missing summary scope '+line[0]);
      const target=sh.getRange(summary+2,6),oldFormula=target.getFormula();
      const term='C'+tot+(lines.length>1?'/'+lines.length:'');
      const escaped=term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      const re=new RegExp('(^=|[+])'+escaped+'(?=$|[+])');
      const updated=oldFormula.replace(re,(_,prefix)=>prefix+'E'+(top+k));
      if(updated===oldFormula && !new RegExp('(^=|[+])E'+(top+k)+'(?=$|[+])').test(oldFormula))throw new Error('Summary does not match recorded allocation; migration withheld');
      updates.push({target,formula:updated});
    });
    formatLedgerBlock(sh,top,g.men.length,tot,g.kind);
    sh.getRange(top,4,lines.length,2).setValues(lines);
    sh.getRange(top,4,lines.length,2).setBorder(true,true,true,true,true,false);
    sh.getRange(top,5,lines.length,1).setNumberFormat('$#,##0.00');
    updates.forEach(u=>u.target.setFormula(u.formula));
    SpreadsheetApp.flush();
    if(lines.some((line,k)=>sh.getRange(top+k,5).getFormula()!==line[1]) || updates.some(u=>u.target.getFormula()!==u.formula))throw new Error('Scope-cell or summary readback failed');
    markLedgerTotalApplied(sh,tot,g.kind);
    lines.forEach((line,k)=>sh.getRange(top+k,5).setBackground(GREEN));
  });
}

function formatLedgerBlock(sh,top,men,total,kind) {
  sh.getRange(top,1,men,3).setFontFamily('Calibri').setFontSize(10).setBorder(true,true,true,true,false,false);
  sh.getRange(top,1).setNumberFormat('M/d/yyyy');
  sh.getRange(top,3,men,1).setNumberFormat('$#,##0.00');
  if(kind==='sms') sh.getRange(total,3).setNumberFormat('$#,##0.00');
}

function ledgerFirstRow(sh) {
  const rows=sh.getRange(1,1,Math.min(30,sh.getLastRow()),3).getValues();
  const header=rows.findIndex(r=>norm(r[0])==='date'&&norm(r[1])==='name'&&norm(r[2])==='amount');
  return header>=0?header+2:LOG_FIRST;
}

// The gross labor total greens after reaching SMS/Subs; each side amount greens
// independently after reaching its scope summary. Neither signal means payment.
function markLedgerTotalApplied(sh,total,kind) {
  const formula=sh.getRange(kind==='sms'?2:3,2).getFormula();
  if(!new RegExp('(^=|[+])C'+total+'(?=$|[+])').test(formula))throw new Error('Gross labor total has not reached '+(kind==='sms'?'SMS':'Subs')+' summary');
  sh.getRange(total,3).setBackground(GREEN);
}
