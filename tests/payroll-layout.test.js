import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPayrollDay, payrollSheetPlan, compactJobLabel } from '../lib/payroll-layout.js';
const date='2026-11-09';
const fixture=()=>({crew:[{id:1,name:'Charlie',kind:'employee',day_rate:250},{id:4,name:'Tony',kind:'employee',day_rate:230},{id:5,name:'Hugo',kind:'employee',day_rate:300},{id:2,name:'Puma',kind:'sub',day_rate:400},{id:3,name:'Moscar',kind:'sub',boss_id:2,day_rate:300}],crewDays:[{crew_id:5,work_date:date,days:0.5}],jobs:[{id:1,tag:'JC',address:'2409 Eastlake Hill',title:'Standing Seam'},{id:19,tag:'JC',address:'4860 E. I - 30',title:'20k'}],stops:[...[[1,1,'Panels · Drip Edge'],[1,19,'Turnbar'],[4,1,'Panels · Drip Edge'],[4,19,'Turnbar'],[5,19,''],[3,1,'Panels · Drip Edge'],[3,19,'Turnbar'],[2,19,'Walkpads']].map(([crew_id,job_id,day_scope],i)=>({id:i+1,crew_id,job_id,day_scope,work_date:date}))]});
test('SMS contains only workers present, job names only, and half-day Hugo gets $150',()=>{const m=buildPayrollDay(fixture(),date);assert.equal(m.sms.rows.length,3);assert.deepEqual(m.sms.rows.map(r=>r.job.text),['JC-2409 Eastlake','JC-Fate - 20k','JC-Fate - 20k']);assert.deepEqual(m.sms.men.map(p=>p.total),[250,230,150]);assert.equal(m.totals.sms,630);});
test('matching workers share color and bold; different day is a different signature even at same site',()=>{const m=buildPayrollDay(fixture(),date);const [c,t,h]=m.sms.men;assert.deepEqual(c.style,t.style);assert.equal(c.style.bold,false);assert.equal(h.style.bold,true);assert.notDeepEqual(c.style,h.style);assert.equal(m.subs[0].men[0].name,'Puma');assert.notDeepEqual(m.subs[0].men[0].style,m.subs[0].men[1].style);});
test('sub breakdown uses saved shares: Moscar 150/150, Puma 400 only on Fate',()=>{const m=buildPayrollDay(fixture(),date);assert.deepEqual(m.allocations.map(a=>[a.label,a.men.map(p=>[p.name,p.amount])]),[['JC-2409 Eastlake',[['Moscar',150]]],['JC-Fate - 20k',[['Puma',400],['Moscar',150]]]]);assert.equal(m.totals.subs,700);});
test('green is a separate phase after verification and does not depend on accounting approval',()=>{const m=buildPayrollDay(fixture(),date);const p=payrollSheetPlan(m,{sheetId:1,col:5});assert.ok(p.green.length);assert.ok(p.requests.every(r=>!r.repeatCell));assert.ok(p.verification.length);assert.equal(p.allocations,undefined);});
test('fifty scope pills do not create fifty payroll rows or suppress Puma',()=>{const w=fixture();w.stops.forEach(s=>{if(s.crew_id===2)s.day_scope=Array.from({length:50},(_,i)=>'Scope '+i).join(' · ');});const m=buildPayrollDay(w,date);assert.equal(m.subs[0].rows.length,3);const p=payrollSheetPlan(m,{sheetId:1,col:5});assert.ok(p.verification.some(x=>x.value.stringValue==='Puma'));assert.ok(!p.verification.some(x=>/Scope|Panels|Walkpads/.test(x.value.stringValue||'')));});
test('distinct tickets at same address stay separate even with matching short labels',()=>{const w=fixture();w.jobs.push({id:20,tag:'CO',address:'2409 Eastlake Hill',title:'Reflash posts'});w.stops.push({id:90,crew_id:1,job_id:20,work_date:date,day_scope:'Posts'});const m=buildPayrollDay(w,date);assert.ok(m.sms.rows.some(r=>r.job?.job_id===20));assert.match(compactJobLabel(w.jobs[2]),/CO-.*Reflash posts/);});
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
    assert.ok(plan.verification.some(c=>c.row===12&&c.col===11&&c.value.numberValue===expected));
  }
});
