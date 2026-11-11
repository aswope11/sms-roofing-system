// Daily Payroll is a compact job/crew ledger, not a scope-of-work report.
// Source is the app's ticket IDs and saved shares, never spreadsheet example cells.
import { stopShares, round2 } from './money.js';
const BLACK = { red: 0, green: 0, blue: 0 };
const ORANGE = { red: 1, green: 0.6, blue: 0 };
const WHITE = { red: 1, green: 1, blue: 1 };
export const PAYROLL_GREEN = { red: 0, green: 1, blue: 0 };
export function compactJobLabel(j) {
  if (j.payroll_label) return j.payroll_label;
  if (j.tag === 'JC' && j.address === '2409 Eastlake Hill') return 'JC-2409 Eastlake';
  if (j.tag === 'JC' && j.address === '4860 E. I - 30') return `JC-Fate - ${j.title || '4860 E. I - 30'}`;
  return `${j.tag}-${j.address}${j.title ? ' - ' + j.title : ''}`;
}
const signature = shares => JSON.stringify(shares.map(s => [s.job_id,
  String(s.day_scope || '').split(' · ').filter(Boolean).sort()]).sort((a,b) => a[0]-b[0]));
const textStyle = (bold = false, color = BLACK) => ({ fontFamily: 'Calibri', fontSize: 10, bold, foregroundColor: color });
function people(shares, crew) {
  const out = [];
  for (const s of shares) {
    let p = out.find(p => p.id === s.crew_id);
    if (!p) { p = { id: s.crew_id, name: s.man, total: 0, shares: [], leader: crew.find(c => c.id === s.crew_id)?.boss_id || s.crew_id }; out.push(p); }
    p.shares.push(s);
    // Employee wages must not drift when a day is split over three or more jobs.
    // Subcontractor breakdowns retain their existing rounded-share convention.
    p.total = s.kind !== 'sub' && s.day_pay != null ? round2(s.day_pay) : round2(p.total + s.cost);
  }
  return out;
}
// Bump when the rendered sheet output changes, so the Payroll Robot rewrites
// unapproved app days once (approved/posted days are never rewritten for layout).
export const PAYROLL_LAYOUT_VERSION = 'compact-3';
// Distinct ink per assignment group. Index 0 is plain black; every other group is bold
// and gets its own color, so two different assignments never share color+bold.
const GROUP_INKS = [BLACK, { red: 0.12, green: 0.28, blue: 0.85 }, { red: 0.78, green: 0.12, blue: 0.12 },
  { red: 0.48, green: 0.16, blue: 0.67 }, { red: 0.04, green: 0.42, blue: 0.28 }, ORANGE,
  { red: 0.55, green: 0.27, blue: 0.07 }, { red: 0.0, green: 0.5, blue: 0.55 }, { red: 0.85, green: 0.1, blue: 0.55 },
  { red: 0.4, green: 0.4, blue: 0.4 }];
function section(men, jobs, crew, sub = false) {
  const groups = [];
  for (const p of men) {
    const sig = signature(p.shares); let g = groups.find(g => g.sig === sig);
    if (!g) { g = { sig, men: [], jobs: [...new Set(p.shares.map(s => s.job_id))] }; groups.push(g); }
    g.men.push(p);
  }
  // Crew roster order (Charlie, Tony, Hugo, Martin, ...). A sub crew's leader always comes first.
  const rank = p => { const i = crew.findIndex(c => c.id === p.id); return (sub && p.id === p.leader ? -1e6 : 0) + (i < 0 ? 1e5 : i); };
  groups.forEach(g => { g.men.sort((a,b) => rank(a)-rank(b)); g.rank = rank(g.men[0]); });
  groups.sort((a,b) => a.rank-b.rank);
  if (groups.length > GROUP_INKS.length) throw new Error(`More than ${GROUP_INKS.length} different assignments in one section; add inks before writing`);
  groups.forEach((g,i) => { g.style = textStyle(i > 0, sub && i === 0 ? ORANGE : GROUP_INKS[i]); g.men.forEach(p => { p.style = g.style; }); });
  // Each group's job labels sit beside ONLY that group's people (same saved ticket/scope signature).
  const rows = [];
  for (const g of groups) {
    const labels = g.jobs.map(id => ({ job_id:id, text:compactJobLabel(jobs[id]), style:g.style }));
    for (let i=0;i<Math.max(labels.length,g.men.length);i++)
      rows.push({ job:labels[i] || null, person:g.men[i] || null });
  }
  return { rows, men: rows.filter(r=>r.person).map(r=>r.person), groups: groups.map(g => ({ men: g.men.map(p => p.id), jobs: g.jobs })) };
}
export function buildPayrollDay(w, date) {
  const shares = stopShares(w).filter(s => s.work_date === date);
  const jobs = Object.fromEntries(w.jobs.map(j => [j.id,j]));
  const sms = section(people(shares.filter(s => s.kind !== 'sub'), w.crew), jobs, w.crew);
  const subMen = people(shares.filter(s => s.kind === 'sub'), w.crew);
  const leaders = [...new Set(subMen.map(p => p.leader))];
  const subs = leaders.map(id => ({ leader_id: id, ...section(subMen.filter(p => p.leader === id), jobs, w.crew, true) }));
  const allocations = [];
  for (const leader of leaders) {
    const list = shares.filter(s => s.kind === 'sub' && subMen.find(p => p.id === s.crew_id)?.leader === leader);
    for (const job of [...new Set(list.map(s => s.job_id))]) {
      const jobShares = list.filter(s => s.job_id === job).sort((a,b) => (a.crew_id === leader ? 0 : 1)-(b.crew_id === leader ? 0 : 1));
      allocations.push({ leader_id: leader, job_id: job, label: compactJobLabel(jobs[job]),
        men: jobShares.map(s => ({ id:s.crew_id, name:s.man, amount:round2(s.cost) })) });
    }
  }
  // Conservation is checked per man, so a missing job cannot be hidden by a correct crew total.
  for (const p of subMen) {
    const allocated = round2(allocations.flatMap(a => a.men).filter(m => m.id === p.id).reduce((sum,m) => sum+m.amount,0));
    if (allocated !== p.total) throw new Error(`Incomplete job breakdown for ${p.name}`);
  }
  return { version: 2, layout: PAYROLL_LAYOUT_VERSION, date, sms, subs, allocations, totals: { sms: round2(sms.men.reduce((a,p)=>a+p.total,0)), subs: round2(subMen.reduce((a,p)=>a+p.total,0)) } };
}
// No fixed-sized boxes: callers reserve the returned rows before applying requests.
export function payrollSheetPlan(model, { sheetId, col, employeeRow = 12, employeeCapacity = 5, subRow = 35, subCapacity = 6, allocationRow = 0 }) {
  if (model.sms.rows.length > employeeCapacity) throw new Error(`Grow the SMS day box to ${model.sms.rows.length} rows before writing`);
  const summarySize = model.subs.reduce((n,s)=>n+s.rows.length+1,0) - (model.subs.length ? 1 : 0);
  if (summarySize > subCapacity) throw new Error(`Grow the sub day box to ${summarySize} rows before writing`);
  const requests = [], green = [], verification = [], employeePayCells = {};
  const range = (row,n=1) => ({ sheetId, startRowIndex:row-1, endRowIndex:row-1+n, startColumnIndex:col-1, endColumnIndex:col+2 });
  const cell = (v, style=textStyle()) => ({ ...(v === '' ? {} : { userEnteredValue:typeof v === 'number' ? { numberValue:v } : { stringValue:v } }),
    userEnteredFormat:{ textFormat:style, backgroundColor:WHITE, ...(typeof v === 'number' ? { numberFormat:{ type:'CURRENCY', pattern:'$#,##0.00' } } : {}) } });
  const write = (row,rows) => {
    requests.push({ updateCells:{ range:range(row,rows.length), rows:rows.map(values=>({values})), fields:'userEnteredValue,userEnteredFormat.textFormat,userEnteredFormat.backgroundColor,userEnteredFormat.numberFormat' } });
    rows.forEach((cells,i)=>cells.forEach((c,j)=> { if (c.userEnteredValue) verification.push({ row:row+i, col:col+j, value:c.userEnteredValue }); }));
  };
  const border = (row,n) => {
    const edge={style:'SOLID',color:BLACK};
    requests.push({updateBorders:{range:range(row,n),top:edge,bottom:edge,left:edge,right:edge,innerHorizontal:{style:'NONE'},innerVertical:{style:'NONE'}}});
    requests.push({updateBorders:{range:{...range(row,n),startColumnIndex:col,endColumnIndex:col+1},left:edge,right:edge}});
  };
  const clear = (row,n) => { if (n) { requests.push({updateCells:{range:range(row,n),fields:'userEnteredValue,userEnteredFormat.textFormat,userEnteredFormat.backgroundColor'}}); requests.push({updateBorders:{range:range(row,n),top:{style:'NONE'},bottom:{style:'NONE'},left:{style:'NONE'},right:{style:'NONE'},innerHorizontal:{style:'NONE'},innerVertical:{style:'NONE'}}}); } };
  clear(employeeRow, employeeCapacity); clear(subRow, subCapacity);
  if (model.sms.rows.length) {
    write(employeeRow,model.sms.rows.map(r=>[cell(r.job?.text || '',r.job?.style),cell(r.person?.name || '',r.person?.style),cell(r.person?.total ?? '',r.person?.style)]));
    border(employeeRow,model.sms.rows.length);
    model.sms.rows.forEach((r,i)=>{if(r.person)employeePayCells[r.person.name]={row:employeeRow+i,col:col+2};});
  }
  let row = subRow;
  const summaryRefs = [], personCells = new Map(), jobCells = new Map();
  const a1 = (row,column) => { let name = ""; for(let n=column;n>0;n=Math.floor((n-1)/26)) name=String.fromCharCode(65+(n-1)%26)+name;return name+row; };
  const formula = (value, expr) => ({...cell(value),userEnteredValue:{formulaValue:expr}});
  for (const s of model.subs) {
    write(row,s.rows.map(r=>[cell(r.job?.text || '',r.job?.style),cell(r.person?.name || '',r.person?.style),cell(r.person?.total ?? '',r.person?.style)])); border(row,s.rows.length);
    s.rows.forEach((r,i)=>{ if(r.person) personCells.set(r.person.id,{row:row+i,person:r.person}); if(r.job && !jobCells.has(`${s.leader_id}:${r.job.job_id}`)) jobCells.set(`${s.leader_id}:${r.job.job_id}`,row+i); if(r.job)summaryRefs.push({row:row+i,col,kind:'job',jobs:[r.job.job_id],leader:s.leader_id});if(r.person)summaryRefs.push({row:row+i,col:col+1,kind:'person',jobs:[...new Set(r.person.shares.map(s=>s.job_id))],leader:s.leader_id});});
    row += s.rows.length+1;
  }
  row = allocationRow || Math.max(subRow+subCapacity+1,row);
  const allocationStart = row;
  for (const a of model.allocations) {
    write(row,a.men.map((m,i)=>{ const p=personCells.get(m.id); const share=p.person.shares.find(s=>s.job_id===a.job_id); const n=p.person.shares.length; const equal=p.person.shares.every(s=>Math.abs(s.cost-p.person.total/n)<0.011); return [i===0?formula(a.label,`=${a1(jobCells.get(`${a.leader_id}:${a.job_id}`),col)}`):cell(''),formula(m.name,`=${a1(p.row,col+1)}`),formula(m.amount,equal?`=${a1(p.row,col+2)}${n>1?'/'+n:''}`:`=ROUND(${a1(p.row,col+2)}*${share.cost/p.person.total},2)`)]; }));border(row,a.men.length);row+=a.men.length+1;
  }
  // Green refers only to successful placement into the breakdown below, never accounting approval.
  const keys = new Set(model.allocations.map(a=>`${a.leader_id}:${a.job_id}`));
  for(const ref of summaryRefs) if(ref.jobs.every(id=>keys.has(`${ref.leader}:${id}`))) green.push({repeatCell:{range:{sheetId,startRowIndex:ref.row-1,endRowIndex:ref.row,startColumnIndex:ref.col-1,endColumnIndex:ref.col-1+(ref.kind==='person'?2:1)},cell:{userEnteredFormat:{backgroundColor:PAYROLL_GREEN}},fields:'userEnteredFormat.backgroundColor'}});
  return { requests, green, verification, employeePayCells, allocationStart, endRow:row-2, required:{sms:model.sms.rows.length,subs:summarySize} };
}
