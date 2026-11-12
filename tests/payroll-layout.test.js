import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPayrollDay, payrollSheetPlan, compactJobLabel } from '../lib/payroll-layout.js';
const date='2026-11-09';
const fixture=()=>({crew:[{id:1,name:'Charlie',kind:'employee',day_rate:250},{id:4,name:'Tony',kind:'employee',day_rate:230},{id:5,name:'Hugo',kind:'employee',day_rate:300},{id:2,name:'Puma',kind:'sub',day_rate:400},{id:3,name:'Moscar',kind:'sub',boss_id:2,day_rate:300}],crewDays:[{crew_id:5,work_date:date,days:0.5}],jobs:[{id:1,tag:'JC',address:'2409 Eastlake Hill',title:'Standing Seam'},{id:19,tag:'JC',address:'4860 E. I - 30',title:'20k'}],stops:[...[[1,1,'Panels · Drip Edge'],[1,19,'Turnbar'],[4,1,'Panels · Drip Edge'],[4,19,'Turnbar'],[5,19,''],[3,1,'Panels · Drip Edge'],[3,19,'Turnbar'],[2,19,'Walkpads']].map(([crew_id,job_id,day_scope],i)=>({id:i+1,crew_id,job_id,day_scope,work_date:date}))]});
test('SMS contains only workers present, job names only, and half-day Hugo gets $150',()=>{const m=buildPayrollDay(fixture(),date);assert.equal(m.sms.rows.length,3);assert.deepEqual(m.sms.rows.map(r=>r.job.text),['JC-2409 Eastlake','JC-Fate - 20k','JC-Fate - 20k']);assert.deepEqual(m.sms.men.map(p=>p.total),[250,230,150]);assert.equal(m.totals.sms,630);});
test('matching workers share color and bold; different day is a different signature even at same site',()=>{const m=buildPayrollDay(fixture(),date);const [c,t,h]=m.sms.men;assert.deepEqual(c.style,t.style);assert.equal(c.style.bold,true);assert.equal(h.style.bold,false);assert.notDeepEqual(c.style,h.style);assert.equal(m.subs[0].men[0].name,'Puma');assert.notDeepEqual(m.subs[0].men[0].style,m.subs[0].men[1].style);});
test('sub breakdown uses saved shares: Moscar 150/150, Puma 400 only on Fate',()=>{const m=buildPayrollDay(fixture(),date);assert.deepEqual(m.allocations.map(a=>[a.label,a.men.map(p=>[p.name,p.amount])]),[['JC-2409 Eastlake',[['Moscar',150]]],['JC-Fate - 20k',[['Puma',400],['Moscar',150]]]]);assert.equal(m.totals.subs,700);});
test('green is a separate phase after verification and does not depend on accounting approval',()=>{const m=buildPayrollDay(fixture(),date);const p=payrollSheetPlan(m,{sheetId:1,col:5});assert.ok(p.green.length);assert.ok(p.requests.every(r=>!r.repeatCell));assert.ok(p.verification.length);assert.equal(p.allocations,undefined);});
test('fifty scope pills do not create fifty payroll rows or suppress Puma',()=>{const w=fixture();w.stops.forEach(s=>{if(s.crew_id===2)s.day_scope=Array.from({length:50},(_,i)=>'Scope '+i).join(' · ');});const m=buildPayrollDay(w,date);assert.equal(m.subs[0].rows.length,3);const p=payrollSheetPlan(m,{sheetId:1,col:5});assert.ok(p.verification.some(x=>x.value.stringValue==='Puma'));assert.ok(!p.verification.some(x=>/Scope|Panels|Walkpads/.test(x.value.stringValue||'')));});
test('distinct tickets at same address stay separate even with matching short labels',()=>{const w=fixture();w.jobs.push({id:20,tag:'CO',address:'2409 Eastlake Hill',title:'Reflash posts'});w.stops.push({id:90,crew_id:1,job_id:20,work_date:date,day_scope:'Posts'});const m=buildPayrollDay(w,date);assert.ok(m.sms.rows.some(r=>r.job?.job_ids.includes(20)));assert.match(compactJobLabel(w.jobs[2]),/CO-.*Reflash posts/);});
test('overcapacity refuses the whole write before omitting any worker',()=>{const m=buildPayrollDay(fixture(),date);assert.throws(()=>payrollSheetPlan(m,{sheetId:1,col:5,subCapacity:1}),/Grow the sub/);assert.throws(()=>payrollSheetPlan(m,{sheetId:1,col:5,employeeCapacity:1}),/Grow the SMS/);});
test('employee daily pay stays exact across rounded job shares in both sync feeds', async()=>{
  const {stopShares,payrollFeed}=await import('../lib/money.js');
  for(const [days,pay,expected] of [[1,null,230],[0.5,null,115],[1,241.25,241.25]]){
    const w=fixture();
    w.jobs.push({id:30,tag:'R',address:'Third job'});
    w.stops=w.jobs.map((j,i)=>({id:i+1,crew_id:4,job_id:j.id,work_date:date}));
    w.crewDays=[{crew_id:4,work_date:date,days,pay}];
    const shares=stopShares(w);
    const model=buildPayrollDay(w,date);
    assert.equal(model.sms.men[0].total,expected);
    assert.equal(model.totals.sms,expected);
    const [legacy]=payrollFeed({dates:[date],shares,crew:Object.fromEntries(w.crew.map(c=>[c.id,c])),jobsById:Object.fromEntries(w.jobs.map(j=>[j.id,j]))});
    assert.equal(legacy.employees[0].pay,expected);
    // The fix must not alter saved job-cost shares to disguise a pay discrepancy.
    assert.ok(shares.every(s=>s.cost===Math.round(expected/3*100)/100));
    const plan=payrollSheetPlan(model,{sheetId:1,col:9});
    assert.ok(plan.verification.some(c=>c.row===13&&c.col===11&&c.value.numberValue===expected));
  }
});
test('Nov 11: independent job list; Charlie bold black, Tony bold red, Hugo+Martin plain', ()=>{
  const d='2026-11-11';
  const w={crew:[{id:1,name:'Charlie',kind:'employee',day_rate:250},{id:4,name:'Tony',kind:'employee',day_rate:230},{id:5,name:'Hugo',kind:'employee',day_rate:300},{id:12,name:'Martin',kind:'employee',day_rate:300}],crewDays:[],
    jobs:[{id:1,tag:'JC',address:'2409 Eastlake Hill',title:'Standing Seam'},{id:18,tag:'JC',address:'4860 E. I - 30',title:'9k'},{id:19,tag:'JC',address:'4860 E. I - 30',title:'20k'}],
    stops:[[1,1,'Drip Edge · Install Panels'],[4,18,'Coping Cap'],[4,19,'Field Details · Term Bar · Gravel Stop'],[5,19,'Field Details · Term Bar · Gravel Stop'],[12,19,'Field Details · Term Bar · Gravel Stop']]
      .map(([crew_id,job_id,day_scope],i)=>({id:i+1,crew_id,job_id,day_scope,work_date:d}))};
  const roster=['Charlie','Tony','Hugo','Martin','Hugo Nephew'];
  const m=buildPayrollDay(w,d,{roster,slots:6});
  const view=m.sms.rows.map(r=>[r.job?.text||'',r.person?.name||'',r.person?.total??'']);
  // RULE 1: every man stays on his own Totals row (12 Charlie, 13 Tony, 14 Hugo, 15 Martin, 16 Hugo Nephew).
  assert.deepEqual(view.map(r=>r[1]),['Charlie','Tony','Hugo','Martin','','']);
  assert.deepEqual(view.map(r=>r[2]),[250,230,300,300,'','']);
  assert.deepEqual(view.slice(0,4).map(r=>r[0]),['JC-2409 Eastlake','JC-Fate - 9k','JC-Fate - 20k','JC-Fate - 20k']);
  const st=n=>m.sms.men.find(p=>p.name===n).style;
  assert.equal(st('Charlie').bold,true);
  assert.deepEqual(st('Charlie').foregroundColor,{red:0,green:0,blue:0});
  assert.equal(st('Tony').bold,true);
  assert.deepEqual(st('Tony').foregroundColor,{red:0.78,green:0.12,blue:0.12});
  assert.equal(st('Hugo').bold,false);
  assert.deepEqual(st('Hugo'),st('Martin'));
  assert.deepEqual(m.sms.rows[0].job.style,st('Charlie'));
  assert.deepEqual(m.sms.rows[1].job.style,st('Tony'));
  assert.deepEqual(m.sms.rows[2].job.style,st('Tony'));
  assert.deepEqual(m.sms.rows[3].job.style,st('Hugo'));
  assert.equal(m.totals.sms,1080);
  // Same input renders byte-identical output (repeat sync = no change).
  assert.equal(JSON.stringify(buildPayrollDay(w,d,{roster,slots:6})),JSON.stringify(m));
});
test('sub crew leader is always on top even when a helper did a different job', ()=>{
  const d='2026-11-09'; const w=fixture();
  const m=buildPayrollDay(w,date);
  assert.equal(m.subs[0].men[0].name,'Puma');
  assert.equal(m.subs[0].rows[0].person.name,'Puma');
});

test('independent job list grows without moving men or merging group labels', ()=>{
  const d='2026-11-11', roster=['Charlie','Tony','Hugo','Martin','Hugo Nephew'];
  const crew=[{id:1,name:'Charlie',kind:'employee',day_rate:250},{id:4,name:'Tony',kind:'employee',day_rate:230},{id:5,name:'Hugo',kind:'employee',day_rate:300},{id:12,name:'Martin',kind:'employee',day_rate:300},{id:13,name:'Hugo Nephew',kind:'employee',day_rate:185}];
  const jobs=[{id:1,tag:'JC',address:'2409 Eastlake Hill'},{id:18,tag:'JC',address:'4860 E. I - 30',title:'9k'},{id:19,tag:'JC',address:'4860 E. I - 30',title:'20k'},{id:30,tag:'R',address:'2800 N Hampton Road'}];
  // everyone works, Charlie on 3 tickets, box has exactly 5 rows → no spare cell
  const stops=[[1,1],[1,18],[1,30],[4,19],[5,19],[12,19],[13,19]].map(([crew_id,job_id],i)=>({id:i+1,crew_id,job_id,work_date:d}));
  const m=buildPayrollDay({crew,crewDays:[],jobs,stops},d,{roster,slots:5});
  assert.deepEqual(m.sms.rows.slice(0,5).map(r=>r.person?.name),roster);
  assert.match(m.sms.rows[0].job.text,/Eastlake/);
  const all=m.sms.rows.map(r=>r.job?.text||'').join('|');
  assert.match(all,/9k/); assert.match(all,/Hampton/);
  const p=payrollSheetPlan(m,{sheetId:1,col:13,employeeCapacity:m.sms.rows.length});
  roster.forEach((n,i)=>assert.ok(p.verification.some(v=>v.row===12+i&&v.col===14&&v.value.stringValue===n)));
  // a man not working leaves his own row empty; the others stay put
  const m2=buildPayrollDay({crew,crewDays:[],jobs,stops:stops.filter(s=>s.crew_id!==4)},d,{roster,slots:5});
  assert.deepEqual(m2.sms.rows.slice(0,5).map(r=>r.person?.name||''),['Charlie','','Hugo','Martin','Hugo Nephew']);
  assert.ok(m.labels[30] && m.labels[18]);
});

test('Nov 10 walkthrough: Fate labels together, fixed men, Tony separate, standard grid',()=>{
  const d='2026-11-10';
  const crew=[{id:1,name:'Charlie',kind:'employee',day_rate:250},{id:4,name:'Tony',kind:'employee',day_rate:230},{id:5,name:'Hugo',kind:'employee',day_rate:300},{id:12,name:'Martin',kind:'employee',day_rate:300}];
  const jobs=[{id:19,tag:'JC',address:'4860 E. I - 30',title:'20k'},{id:18,tag:'JC',address:'4860 E. I - 30',title:'9k'},{id:120,tag:'UC',address:'10914 Strait Lane'},{id:119,tag:'CO',address:'10914 Strait Lane'},{id:121,tag:'R',address:'2800 N Hampton Road'}];
  const stops=[[1,19],[1,18],[4,120],[4,119],[4,121],[5,19],[5,18],[12,19],[12,18]].map(([crew_id,job_id],i)=>({id:i+1,crew_id,job_id,work_date:d}));
  const m=buildPayrollDay({crew,jobs,stops,crewDays:[]},d,{slots:6});
  assert.deepEqual(m.sms.men.map(p=>p.name),['Charlie','Tony','Hugo','Martin']);
  assert.deepEqual(m.sms.men.map(p=>p.total),[250,230,300,300]);
  assert.deepEqual(m.sms.rows.filter(r=>r.job).map(r=>r.job.job_id),[19,18,120,119,121]);
  const [c,t,h,martin]=m.sms.men;
  assert.equal(c.style.bold,true); assert.equal(t.style.bold,false);
  assert.deepEqual(c.style,h.style);assert.deepEqual(c.style,martin.style);
  assert.deepEqual(m.sms.rows[1].job.style,c.style); // job beside Tony belongs to bold Fate group
  assert.deepEqual(m.sms.rows[2].job.style,t.style); // label beside Hugo belongs to plain Tony group
  const plan=payrollSheetPlan(m,{sheetId:1,col:9,employeeCapacity:6});
  const grid=plan.requests.find(r=>r.updateBorders?.range.startRowIndex===11&&r.updateBorders.innerHorizontal?.style==='SOLID');
  assert.ok(grid);assert.deepEqual(grid.updateBorders.innerHorizontal,grid.updateBorders.innerVertical);
  assert.ok(plan.green.every(r=>r.repeatCell.range.startRowIndex>=34));
});
test('same tickets with different split proportions remain separate groups',()=>{
  const w=fixture();w.crewDays=[];w.stops=w.stops.filter(s=>[1,4].includes(s.crew_id));
  w.stops.forEach(s=>{s.pct=s.crew_id===1?(s.job_id===1?75:25):50;});
  const m=buildPayrollDay(w,date);assert.equal(m.sms.groups.length,2);
});
