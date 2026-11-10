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
 c.transferPayrollSubs=()=>[];c.postingPlan=()=>[{id:19,label:'Fate',sms:[],subs:[]}];c.applyJob=()=>{ledgerCalls++;};
 assert.throws(()=>c.postApprovedPayrollDay({}, {getProperty:k=>state.get(k)}, {date:'2026-11-09',stamp:'x'}, logs));
 assert.equal(ledgerCalls,0);assert.match(logs[0],/reconciliation required/);
});
test('scope allocation cells sit beside the ledger and point to the block total',()=>{
 const c=setup();
 assert.deepEqual(JSON.parse(JSON.stringify(c.ledgerScopeRows(32,32,['CF','Drip Edge']))),[['CF','=C32/2'],['Drip Edge','=C32/2']]);
 assert.deepEqual(JSON.parse(JSON.stringify(c.ledgerScopeRows(40,42,['Panels']))),[['Panels','=C42']]);
 assert.equal(c.ledgerScopeRows(40,42,[]).length,0);
});
test('historical migration creates clickable scope amounts and redirects only their summary terms',()=>{
 const grid=new Map();const key=(r,c)=>r+':'+c;
 const set=(r,c,value)=>grid.set(key(r,c),value);
 set(3,2,'=C32');set(2,5,'CF');set(3,5,'Drip Edge');set(2,6,'=C32/2+C36/3');set(3,6,'=C32/2+C36/3');
 set(32,1,new Date('2026-11-06T12:00:00Z'));set(32,2,'Puma');set(32,3,400);set(32,4,'CF · Drip Edge');
 const range=(r,c,h=1,w=1)=>{const a={getValues:()=>Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>grid.get(key(r+i,c+j))??'')),getValue:()=>grid.get(key(r,c))??'',getFormula:()=>String(grid.get(key(r,c))??'').startsWith('=')?grid.get(key(r,c)):'',setFormula:f=>set(r,c,f),setValues:rows=>rows.forEach((row,i)=>row.forEach((v,j)=>set(r+i,c+j,v)))};for(const m of ['setNumberFormat','setFontFamily','setFontSize','setBorder','setBackground'])a[m]=()=>a;return a;};
 const c=setup({Utilities:{formatDate:d=>d.toISOString().slice(0,10)},SpreadsheetApp:{flush(){}}});
 c.migratePostedScopes({getLastRow:()=>38,getRange:range},{date:'2026-11-06'},{sms:[],subs:[{leader:'Puma',total:400,scopes:['CF','Drip Edge']}]},[]);
 assert.equal(grid.get(key(32,5)),'=C32/2');assert.equal(grid.get(key(33,5)),'=C32/2');assert.equal(grid.get(key(32,4)),'CF');assert.equal(grid.get(key(33,4)),'Drip Edge');
 assert.equal(grid.get(key(2,6)),'=E32+C36/3');assert.equal(grid.get(key(3,6)),'=E33+C36/3');assert.equal(grid.get(key(32,3)),400);
 c.migratePostedScopes({getLastRow:()=>38,getRange:range},{date:'2026-11-06'},{sms:[],subs:[{leader:'Puma',total:400,scopes:['CF','Drip Edge']}]},[]);
 assert.equal(grid.get(key(2,6)),'=E32+C36/3');
});

test('gross labor only greens after its own SMS or Subs summary contains its total',()=>{
 const colored=[];let formula='=C99';const c=setup();
 const sh={getRange:(r,col)=>({getFormula:()=>formula,setBackground:v=>colored.push([r,col,v])})};
 assert.throws(()=>c.markLedgerTotalApplied(sh,32,'sub'),/has not reached/);assert.equal(colored.length,0);
 formula='=C14+C32';c.markLedgerTotalApplied(sh,32,'sub');assert.deepEqual(colored,[[32,3,'#00ff00']]);
});
test('payroll transfer verifies Subs before greening payroll; repeat uses existing ledger row',()=>{
 const events=[];let green=0;
 const model={subs:[{leader_id:2,rows:[{},{},{}],men:[{id:2,name:'Puma',shares:[{job_id:19,day_scope:'Term Bar · Walkpad'}]}]}],allocations:[{leader_id:2,job_id:19,label:'Fate',men:[{amount:200}]}]};
 const weekly={getName:()=> 'Nov 07 - Nov 13 2026',getRange:(r,col,h,w)=>({getValue:()=> 'Fate',getValues:()=>[[200]],setBackground:()=>{green++;events.push('payroll green');}})};
 const ledger={getLastRow:()=>1,getRange:(r,col)=>({getValues:()=>[[new Date('2026-11-09T12:00:00Z'),'Puma','Fate',200]],getValue:()=>{events.push('ledger read');return col===3?'Fate':200;}})};
 const c=setup({Utilities:{formatDate:d=>d.toISOString().slice(0,10)},SpreadsheetApp:{flush(){}}});
 c.weekTab=()=>weekly;c.layout=()=>({subFirst:35});
 const result=c.transferPayrollSubs({getSheetByName:()=>ledger},{date:'2026-11-09'},model,[]);
 assert.equal(result[0].amount,200);assert.equal(result[0].row,1);assert.equal(green,1);assert.ok(events.indexOf('ledger read')<events.indexOf('payroll green'));
});
test('checkpoint comparison ignores layout metadata but preserves actual source changes',()=>{
 const c=setup();const old={id:19,subs:[{leaderId:2,leader:'Puma',sig:'Term Bar',scopes:['Term Bar'],total:200}]};
 const next={id:19,subs:[{leaderId:2,leader:'Puma',scopes:['Term Bar'],total:200,ledgerRow:1282}]};
 assert.equal(c.canonicalPostingSignature(JSON.stringify(old)),c.canonicalPostingSignature(JSON.stringify(next)));
 next.subs[0].total=201;assert.notEqual(c.canonicalPostingSignature(JSON.stringify(old)),c.canonicalPostingSignature(JSON.stringify(next)));
});

test('posting checkpoint ignores JSON field order but still detects changed dollars',()=>{
 const c=setup();
 const old={id:19,label:'Fate',sms:[],subs:[{leaderId:2,leader:'Puma',sig:'Term Bar|Walkpad',scopes:['Term Bar','Walkpad'],total:200}]};
 const now={id:19,label:'Fate',sms:[],subs:[{leaderId:2,leader:'Puma',total:200,scopes:['Term Bar','Walkpad']}]};
 assert.equal(c.canonicalPostingSignature(JSON.stringify(old)),c.canonicalPostingSignature(JSON.stringify(now)));
 now.subs[0].total=201;assert.notEqual(c.canonicalPostingSignature(JSON.stringify(old)),c.canonicalPostingSignature(JSON.stringify(now)));
});

test('labor balance retains real scopes and exposes unidentified dollars separately',()=>{
 const c=setup();const rows=[{row:2,label:'CF',actualFormula:'=E14'},{row:3,label:'Drip Edge',actualFormula:'=E15'},{row:4,label:'Run Panels',actualFormula:'=E19'},{row:5,label:'',actualFormula:'=SUM(F2:F4)'},{row:6,label:'',actualFormula:'',overheadFormula:''}];
 const p=c.laborBalancePlan(rows);assert.equal(p.total,5);assert.equal(p.unknown,6);assert.equal(p.residual,'=$B$4-SUM(F2,F3,F4)');assert.equal(p.actual,'=SUM(F2,F3,F4,F6)');assert.equal(p.overhead,'=SUM(G2,G3,G4,G6)');
 rows[3].label='Scope total';rows[3].actualFormula=p.actual;rows[4].label=p.unknownLabel;rows[4].actualFormula=p.residual;
 const again=c.laborBalancePlan(rows);assert.equal(again.unknown,6);assert.equal(again.residual,p.residual);
});
test('labor reconciliation refuses to overwrite an occupied summary row',()=>{
 const c=setup();assert.throws(()=>c.laborBalancePlan([{row:2,label:'CF'},{row:3,label:'',actualFormula:'=SUM(F2:F2)'},{row:4,label:'',overheadFormula:'=LegacyBudget'}]),/No empty summary row/);
});

test('green R ticket goes to the QuickBooks bridge; JC without a route does not; failure leaves it white and retryable', () => {
  const props = new Map(), logs = [], greens = [], posted = [];
  const model = {sms: {rows: [], men: []}, subs: [], allocations: []};
  const feed = {start: '2026-11-07', days: [{date: '2026-11-09', green: true, stamp: 's'}]};
  const c = setup({
    UrlFetchApp: {fetch: url => ({getResponseCode: () => 200, getContentText: () => JSON.stringify(/payroll-layout/.test(url) ? model : feed)})},
    SpreadsheetApp: {flush() {}, openById() { return {getSheetByName: () => ({})}; }},
  });
  c.transferPayrollSubs = () => [{jobId: 121, leaderId: 2, leader: 'Puma', amount: 200, scopes: [], row: 9}, {jobId: 55, leaderId: 2, leader: 'Puma', amount: 100, scopes: [], row: 10}];
  c.postingPlan = () => [{id: 121, label: 'R-2800 N Hampton Road', sms: [], subs: []}, {id: 55, label: 'JC-Somewhere', sms: [], subs: []}];
  c.markSubsPosted = (_ss, blocks) => blocks.forEach(b => greens.push(b.ledgerRow));
  c.weekTab = () => ({getRange: () => ({setBackground() {}})});
  c.layout = () => ({});
  c.postPayrollQuickBooks = (_ss, _day, job) => { posted.push(job.id); return {number: '4950', qbId: '1', charge: 300, total: 300}; };
  const P = {getProperty: k => props.get(k), setProperty: (k, v) => props.set(k, v)};
  c.postApprovedPayrollDay({}, P, feed.days[0], logs);
  assert.deepEqual(posted, [121]);
  assert.deepEqual(greens, [9]);
  assert.equal(JSON.parse(props.get('posted:v1:2026-11-09:121')).qb.number, '4950');
  assert.ok(logs.some(l => /JC-Somewhere has no verified posting route/.test(l)));
  // second run: already posted → no second QuickBooks call
  c.postApprovedPayrollDay({}, P, feed.days[0], logs);
  assert.deepEqual(posted, [121]);
  // a refusal stays incomplete
  props.clear(); greens.length = 0;
  c.postPayrollQuickBooks = () => { throw new Error('QuickBooks payroll verification failed: x'); };
  c.postApprovedPayrollDay({}, P, feed.days[0], logs);
  assert.deepEqual(greens, []); assert.equal(props.get('posted:v1:2026-11-09:121'), undefined);
  assert.ok(logs.some(l => /QuickBooks NOT posted/.test(l)));
});

const fakeSheet=(id,tab,colA,colE)=>({getParent:()=>({getId:()=>id}),getName:()=>tab,getLastRow:()=>300,
 getRange:(r,c,h)=>({getValues:()=>Array.from({length:h},(_,i)=>c===5?[colE[r+i]||'']:[colA[r+i]||'','',''])})});
test('Fate 9K Labor ledger starts at row 18 (its own layout), 20K follows the "Scope not identified" row',()=>{
 const c=setup();
 assert.equal(c.ledgerFirstRow(fakeSheet('1d01rXqlmXxh_CB-xRSs-w5lFVVWo2vy74sSi0Tmew5E','Labor',{},{})),18);
 assert.equal(c.ledgerFirstRow(fakeSheet('1rEaFLZD79_-mTmXsV2EeSiHPBPUtcjJftBffYJnDTto','Actual Labor',{},{29:'Scope total',30:'Scope not identified'})),31);
 assert.equal(c.ledgerFirstRow(fakeSheet('1rEaFLZD79_-mTmXsV2EeSiHPBPUtcjJftBffYJnDTto','Actual Labor',{},{30:'Scope total',31:'Scope not identified'})),32);
 assert.equal(c.routeFor(fakeSheet('1d01rXqlmXxh_CB-xRSs-w5lFVVWo2vy74sSi0Tmew5E','Labor',{},{})).copyFormat,true);
});
test('Fate 9K posts to its ledger without rebuilding its summary; 20K still rebalances',()=>{
 const props=new Map(),logs=[],reconciled=[];
 const model={sms:{rows:[],men:[]},subs:[]},feed={start:'2026-11-07',days:[{date:'2026-11-10',green:true,stamp:'s'}]};
 const c=setup({UrlFetchApp:{fetch:u=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify(/payroll-layout/.test(u)?model:feed)})},
  SpreadsheetApp:{flush(){},openById:id=>({getSheetByName:t=>({id,t})})}});
 c.transferPayrollSubs=()=>[];c.markSubsPosted=()=>{};c.weekTab=()=>({getRange:()=>({setBackground(){}})});c.layout=()=>({});
 c.postingPlan=()=>[{id:18,label:'JC-Fate - 9k',sms:[],subs:[]},{id:19,label:'JC-Fate - 20k',sms:[],subs:[]}];
 c.applyJob=()=>({entry:{first:267}});c.migratePostedScopes=()=>{};c.reconcileLaborSummary=sh=>reconciled.push(sh.t);
 c.postApprovedPayrollDay({}, {getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v)}, feed.days[0], logs);
 assert.deepEqual(reconciled,['Actual Labor']);
 assert.ok(props.get('posted:v1:2026-11-10:18'));assert.ok(props.get('posted:v1:2026-11-10:19'));
});
test('rows inserted on a job cost sheet move its stored posting rows down, other sheets untouched',()=>{
 const state=new Map([
  ['posted:v1:2026-11-09:19',JSON.stringify({verified:true,entry:{id:'A',tab:'Actual Labor',first:316,last:320,refs:[{a1:'B3',tok:'+C319'},{a1:'F10',tok:'+E319'}]}})],
  ['posted:v1:2026-11-09:1',JSON.stringify({verified:true,entry:{id:'B',tab:'Actual Labor',first:316,last:320,refs:[{a1:'B3',tok:'+C319'}]}})]]);
 const c=setup({PropertiesService:{getScriptProperties:()=>({getKeys:()=>[...state.keys()],getProperty:k=>state.get(k),setProperty:(k,v)=>state.set(k,v)})}});
 c.shiftStoredRows('A','Actual Labor',29,1);
 const a=JSON.parse(state.get('posted:v1:2026-11-09:19')).entry;
 assert.deepEqual([a.first,a.last,a.refs[0].tok,a.refs[1].a1,a.refs[1].tok],[317,321,'+C320','F10','+E320']);
 assert.equal(JSON.parse(state.get('posted:v1:2026-11-09:1')).entry.first,316);
});
