// Disabled until the dedicated payroll bridge is approved and configured.
// Creates/updates an unsent placeholder; never records or initiates a payment.
function postPayrollQuickBooks(ss,props,day,job,log,model) {
  const secret=props.getProperty('PAYROLL_QBO_BRIDGE_SECRET');
  if(!secret){log.push(day.date+': '+job.label+' — payroll QuickBooks bridge is not activated; no invoice created.');return false;}
  const sat=new Date(day.date+'T12:00:00Z');sat.setUTCDate(sat.getUTCDate()-((sat.getUTCDay()+1)%7));
  const weekly=weekTab(ss,Utilities.formatDate(sat,'UTC','yyyy-MM-dd'),log),L=layout(weekly),col=DAY_COL[dow(day.date)];
  const people=weekly.getRange(EMP_FIRST,col+1,L.boxLast-EMP_FIRST+1,2).getValues();
  model.sms.men.forEach(man=>{
    const found=people.filter(row=>norm(row[0])===norm(man.name));
    if(found.length!==1||Math.abs(Number(found[0][1])-man.total)>0.005)throw new Error('Employee payroll readback differs for '+man.name+'; QuickBooks withheld');
  });
  const amount=r2(job.sms.reduce((n,g)=>n+g.men.reduce((s,m)=>s+m.amt,0),0)+job.subs.reduce((n,g)=>n+g.total,0));
  const body=JSON.stringify({job_id:job.id,work_date:day.date,expected_cost:amount,source_spreadsheet:PAYROLL_ID});
  const timestamp=String(Date.now());
  const signature=Utilities.computeHmacSha256Signature(timestamp+'\n'+body,secret).map(n=>(n<0?n+256:n).toString(16).padStart(2,'0')).join('');
  const response=UrlFetchApp.fetch(APP_URL+'/payroll-bridge/qbo',{method:'post',contentType:'application/json',payload:body,headers:{'x-payroll-time':timestamp,'x-payroll-signature':signature},muteHttpExceptions:true});
  const receipt=JSON.parse(response.getContentText());
  if(response.getResponseCode()!==200||!receipt.verified||!receipt.qbId||Math.abs(Number(receipt.cost)-amount)>0.005||Number(receipt.job_id)!==Number(job.id)||receipt.work_date!==day.date)throw new Error('QuickBooks payroll verification failed: '+(receipt.error||'receipt mismatch'));
  props.setProperty('qbo-receipt:'+day.date+':'+job.id,JSON.stringify(receipt));
  job.subs.forEach(b=>ss.getSheetByName('Subs').getRange(b.ledgerRow,4).setNote('Verified Payroll → Subs → QuickBooks invoice #'+receipt.number+' / ID '+receipt.qbId+'; labor cost $'+amount+', customer placeholder $'+receipt.charge+'. Not paid; not sent.'));
  log.push(day.date+': '+job.label+' verified in QuickBooks #'+receipt.number+'; cost $'+amount+', charge $'+receipt.charge+(receipt.reused?' (existing receipt reused).':'.'));
  return true;
}
