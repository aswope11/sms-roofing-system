import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {verifyPayrollRequest,payrollBridgePlan,postPayrollPlaceholder,PAYROLL_SOURCE_ID} from '../lib/payroll-bridge.js';
const request={source_spreadsheet:PAYROLL_SOURCE_ID,work_date:'2026-11-09',job_id:121,expected_cost:200};
const make=extra=>payrollBridgePlan({request,job:{id:121,tag:'R'},approved:true,shares:[{job_id:121,work_date:'2026-11-09',cost:200}],billLabor:s=>({amount:s.cost*1.5}),...extra});
test('bridge defaults disabled and rejects expired or forged requests',()=>{
 assert.throws(()=>verifyPayrollRequest({body:'{}'}),/disabled/);
 assert.throws(()=>verifyPayrollRequest({secret:'x',timestamp:'1',signature:'x',body:'{}'}),/Expired/);
 const timestamp=String(Date.now()),body='{}',signature=createHmac('sha256','secret').update(timestamp+'\n'+body).digest('hex');
 verifyPayrollRequest({secret:'secret',timestamp,signature,body});
 assert.throws(()=>verifyPayrollRequest({secret:'secret',timestamp,signature,body:'{"x":1}'}),/signature/);
});
test('uses existing billing rule and verifies the sheet source, date, approval and ticket',()=>{
 assert.equal(make().charge,300);assert.equal(make().cost,200);
 assert.throws(()=>make({approved:false}),/approved/);
 assert.throws(()=>make({job:{id:121,tag:'JC'}}),/eligible/);
 assert.throws(()=>make({request:{...request,source_spreadsheet:'other'}}),/source/);
 assert.throws(()=>make({request:{...request,expected_cost:201}}),/differs/);
});
test('retries reuse a recorded payroll day without writing QuickBooks',async()=>{
 const plan=make();let writes=0;
 const invoice={Id:'9',DocNumber:'5000',TotalAmt:300,CustomerRef:{value:'123'},Line:[{Description:plan.marker,Amount:300}]};
 const service={customer:async()=>({id:'123'}),existing:async()=>({qbId:'9',dayAmount:300}),readInvoice:async()=>invoice,writeInvoice:async()=>{writes++;}};
 assert.equal((await postPayrollPlaceholder(plan,service)).reused,true);assert.equal(writes,0);
 service.existing=async()=>({qbId:'9',dayAmount:301});await assert.rejects(()=>postPayrollPlaceholder(plan,service),/different price/);
});
test('recovers after QuickBooks succeeds but local receipt save was interrupted',async()=>{
 const plan=make();let writes=0,records=0;
 const invoice={Id:'9',DocNumber:'5000',TotalAmt:300,CustomerRef:{value:'123'},Line:[{Description:plan.marker,Amount:300}]};
 const out=await postPayrollPlaceholder(plan,{customer:async()=>({id:'123'}),existing:async()=>({qbId:'9'}),readInvoice:async()=>invoice,writeInvoice:async()=>{writes++;},record:async()=>{records++;}});
 assert.equal(out.reused,true);assert.equal(writes,0);assert.equal(records,1);
});
test('failed readback does not save a completion receipt',async()=>{
 const plan=make();let records=0;
 await assert.rejects(()=>postPayrollPlaceholder(plan,{customer:async()=>({id:'123'}),existing:async()=>null,writeInvoice:async()=>({Id:'9'}),readInvoice:async()=>({Id:'9',TotalAmt:299,CustomerRef:{value:'123'},Line:[{Description:plan.marker,Amount:300}]}),record:async()=>{records++;}}),/readback/);
 assert.equal(records,0);
});

test('recovers an unrecorded QuickBooks invoice using its unique day marker',async()=>{
 const plan=make();let writes=0,records=0;
 const invoice={Id:'9',DocNumber:'5000',TotalAmt:300,CustomerRef:{value:'123'},Line:[{Description:plan.marker,Amount:300}]};
 await postPayrollPlaceholder(plan,{customer:async()=>({id:'123'}),existing:async()=>null,findInvoiceByMarker:async()=>invoice,readInvoice:async()=>invoice,writeInvoice:async()=>{writes++;},record:async()=>{records++;}});
 assert.equal(writes,0);assert.equal(records,1);
});
test('a receipt with the wrong day amount never counts as verified',async()=>{
 const plan=make();
 await assert.rejects(()=>postPayrollPlaceholder(plan,{customer:async()=>({id:'123'}),existing:async()=>({qbId:'9',dayAmount:300}),readInvoice:async()=>({Id:'9',CustomerRef:{value:'123'},Line:[{Description:plan.marker,Amount:200}]})}),/differs/);
});
