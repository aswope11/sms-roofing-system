import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../scripts/PayrollRobotAppSync.gs',import.meta.url),'utf8');
const load=(extra={})=>vm.createContext({console,...extra});
function setup(extra={}) {const c=load(extra);vm.runInContext(source,c);return c;}
test('posting plan uses saved shares rather than dividing daily pay evenly',()=>{
 const c=setup();
 const model={sms:{rows:[{job:{job_id:19,text:'JC-Fate - 20k'}}],men:[{name:'Tony',shares:[{job_id:19,cost:172.5,day_scope:'Coping Cap'},{job_id:1,cost:57.5,day_scope:'CF'}]}]},subs:[]};
 const p=c.postingPlan(model);
 assert.equal(p.find(j=>j.id===19).sms[0].men[0].amt,172.5);
 assert.equal(p.find(j=>j.id===1).sms[0].men[0].amt,57.5);
});
test('same-address tickets stay distinct and each sub scope keeps its own dollars',()=>{
 const c=setup();const model={sms:{rows:[],men:[]},subs:[{leader_id:2,rows:[{job:{job_id:18,text:'Fate 9k'}},{job:{job_id:19,text:'Fate 20k'}}],men:[{id:2,name:'Puma',shares:[{job_id:18,cost:100,day_scope:'Walls'},{job_id:19,cost:300,day_scope:'Coping Cap'}]}]}]};
 const p=c.postingPlan(model);assert.equal(p.length,2);assert.equal(p[0].subs[0].total,100);assert.equal(p[1].subs[0].total,300);
});
test('historical approved dates retry independently; failure on one date does not skip the next',()=>{
 const calls=[], logs=[], state=new Map();
 const c=setup({Utilities:{formatDate:d=>d.toISOString().slice(0,10)},UrlFetchApp:{fetch:()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({start:'2026-10-31',days:[{date:'2026-11-03',green:true},{date:'2026-11-04',green:true},{date:'2026-11-05',green:false}]})})}});
 c.postApprovedPayrollDay=(_ss,_props,d)=>{calls.push(d.date);if(d.date.endsWith('03'))throw Error('temporary refusal');};
 c.retryApprovedPayroll({}, {getProperty:k=>state.get(k),setProperty:(k,v)=>state.set(k,v)}, logs,'2026-11-05');
 assert.deepEqual(calls,['2026-11-03','2026-11-04']);assert.match(logs[0],/will retry/);assert.equal(state.get('posting-scan:v1'),'2026-11-03');
});
test('changed posted source is blocked rather than adding a second ledger entry',()=>{
 const state=new Map([['posted:v1:2026-11-09:19',JSON.stringify({signature:'old',verified:true})]]);
 const logs=[];let ledgerCalls=0;
 const model={sms:{rows:[],men:[]},subs:[]};
 const c=setup({UrlFetchApp:{fetch:()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify(model)})}});
 c.postingPlan=()=>[{id:19,label:'Fate',sms:[],subs:[]}];c.applyJob=()=>{ledgerCalls++;};
 assert.throws(()=>c.postApprovedPayrollDay({}, {getProperty:k=>state.get(k)}, {date:'2026-11-09',stamp:'x'}, logs));
 assert.equal(ledgerCalls,0);assert.match(logs[0],/reconciliation required/);
});
