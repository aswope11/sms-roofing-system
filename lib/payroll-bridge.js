import {createHmac, timingSafeEqual, createHash} from 'node:crypto';

export const PAYROLL_SOURCE_ID='1yY_j6idmY0UY_InoOib9TGPoKdcFRSuqTpQT5Ci0coQ';
export function verifyPayrollRequest({secret,timestamp,signature,body,now=Date.now()}) {
  if(!secret)throw new Error('Payroll QuickBooks bridge is disabled; no write access configured');
  const time=Number(timestamp);
  if(!Number.isFinite(time)||Math.abs(now-time)>300000)throw new Error('Expired payroll request');
  const expected=createHmac('sha256',secret).update(timestamp+'\n'+body).digest('hex');
  const a=Buffer.from(expected),b=Buffer.from(String(signature||''));
  if(a.length!==b.length||!timingSafeEqual(a,b))throw new Error('Invalid payroll signature');
}
export function payrollBridgePlan({request,job,approved,shares,billLabor}) {
  const r=request;
  if(r.source_spreadsheet!==PAYROLL_SOURCE_ID||!/^\d{4}-\d{2}-\d{2}$/.test(r.work_date||''))throw new Error('Verified Daily Payroll source required');
  if(!approved)throw new Error('Payroll date is not approved');
  if(!job||Number(job.id)!==Number(r.job_id)||!['R','CO','UC'].includes(job.tag)||job.no_charge||job.tabled_at)throw new Error('Ticket is not eligible for payroll QuickBooks posting');
  const mine=shares.filter(s=>Number(s.job_id)===Number(r.job_id)&&s.work_date===r.work_date);
  if(!mine.length)throw new Error('No saved work for this ticket and date');
  const cents=n=>Math.round(Number(n)*100);
  const cost=mine.reduce((n,s)=>n+cents(s.cost),0);
  if(!Number.isFinite(Number(r.expected_cost))||cents(r.expected_cost)!==cost)throw new Error('Payroll cost differs from saved work');
  const labor=mine.map(billLabor);
  if(labor.some(l=>l.amount==null||!Number.isFinite(l.amount)))throw new Error('Billing price is not defined');
  const charge=labor.reduce((n,l)=>n+cents(l.amount),0)/100;
  if(!(charge>0))throw new Error('No positive payroll charge');
  const marker='SMS-PAYROLL:'+r.work_date+':'+r.job_id;
  const requestId=createHash('sha256').update(marker).digest('hex').slice(0,40);
  return {cost:cost/100,charge,marker,requestId,labor};
}

// The service owns persistent lookup/recording and holds a per-ticket lock.
// A crash after a QuickBooks write reuses the same request ID; a replay never
// appends a day already present on the invoice.
export async function postPayrollPlaceholder(plan,service) {
  const customer=await service.customer();
  if(!customer?.id)throw new Error('No confirmed QuickBooks customer');
  const seat=await service.existing();
  let invoice;
  const verifyLine=inv=>{
    const lines=(inv?.Line||[]).filter(l=>String(l.Description||'').includes(plan.marker));
    if(lines.length!==1||Math.abs(Number(lines[0].Amount)-plan.charge)>0.004)throw new Error('Payroll invoice day amount differs or is duplicated');
  };
  if(seat?.dayAmount!=null) {
    if(Math.abs(seat.dayAmount-plan.charge)>0.004)throw new Error('Previously posted day has a different price; reconcile first');
    invoice=await service.readInvoice(seat.qbId);
    if(!invoice||String(invoice.CustomerRef?.value)!==String(customer.id))throw new Error('Existing QuickBooks destination differs');
    verifyLine(invoice);
    return {verified:true,duplicate:false,reused:true,qbId:String(invoice.Id),number:invoice.DocNumber,charge:plan.charge,cost:plan.cost};
  }
  const cur=seat?.qbId?await service.readInvoice(seat.qbId):await service.findInvoiceByMarker?.(customer.id,plan.marker);
  if(cur&&String(cur.CustomerRef?.value)!==String(customer.id))throw new Error('Open placeholder belongs to a different customer');
  const had=cur?.Line?.some(l=>String(l.Description||'').includes(plan.marker));
  const total=had?Number(cur.TotalAmt):(Number(cur?.TotalAmt)||0)+plan.charge;
  if(had){verifyLine(cur);invoice=cur;}
  else invoice=await service.writeInvoice({cur,customer,plan,total,requestId:plan.requestId});
  const back=await service.readInvoice(invoice.Id);
  if(!back||String(back.CustomerRef?.value)!==String(customer.id)||Math.abs(Number(back.TotalAmt)-total)>0.004||!back.Line?.some(l=>String(l.Description||'').includes(plan.marker)))throw new Error('QuickBooks payroll readback failed; do not mark complete');
  verifyLine(back);
  await service.record({invoice:back,plan,seat});
  return {verified:true,duplicate:false,reused:!!had,qbId:String(back.Id),number:back.DocNumber,charge:plan.charge,cost:plan.cost};
}
