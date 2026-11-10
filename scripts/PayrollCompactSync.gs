// Installation pending. Add this file to Payroll Robot, then run installCompactPayrollSync.
// Replaces only the old payroll timer; leaves the Drive Inbox and invoice timers intact.
// Uses the exact same versioned renderer as the app and the verified November 9 correction.
// This stage mirrors app entries and breaks out subs. It does NOT approve payroll,
// post to Subs/QuickBooks, or apply job costs. Those later stages remain separate.
const COMPACT_PAYROLL_ID = '1yY_j6idmY0UY_InoOib9TGPoKdcFRSuqTpQT5Ci0coQ';
const COMPACT_APP = 'https://sms-roofing-system.netlify.app/w/payroll-layout';
function installCompactPayrollSync() {
  // Prove a full read/render/write/verify cycle first. Only then replace the old timer.
  syncCompactPayrollFromApp();
  ScriptApp.getProjectTriggers().filter(t => ['syncFromApp','syncCompactPayrollFromApp'].includes(t.getHandlerFunction()))
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncCompactPayrollFromApp').timeBased().everyMinutes(5).create();
}
function syncCompactPayrollFromApp() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Payroll sync is busy; no changes made');
  try {
    const date = Utilities.formatDate(new Date(), 'America/Chicago', 'yyyy-MM-dd');
    const col = ({6:1,1:5,2:9,3:13,4:17,5:21})[new Date(date+'T12:00:00').getDay()];
    if (!col) return; // Sunday requires an explicit weekly layout decision.
    const model = compactGet(COMPACT_APP+'?date='+date);
    const ss = SpreadsheetApp.openById(COMPACT_PAYROLL_ID);
    const start = new Date(date+'T12:00:00'); start.setDate(start.getDate()-((start.getDay()+1)%7));
    const sheet = ss.getSheets().find(sh => {
      if (!/ \d{4}$/.test(sh.getName().trim())) return false;
      const v=sh.getRange('A11').getValue(); return v instanceof Date && v.toDateString()===start.toDateString();
    });
    if (!sheet) throw new Error('Weekly tab missing; no existing week copied or overwritten');
    const props=PropertiesService.getScriptProperties(), key='compact:'+date;
    const stamp=JSON.stringify(model), prior=JSON.parse(props.getProperty(key)||'null');
    if (prior && prior.stamp===stamp) return;
    const values=sheet.getRange('A1:B200').getValues();
    const t=values.findIndex((r,i)=>i>=12 && String(r[0]).trim().toLowerCase()==='totals')+1;
    if (!t) throw new Error('Totals block not found; sheet left intact');
    const cap=5+(t-26);
    if (model.sms.rows.length>cap) throw new Error('More SMS rows needed; refusing partial output');
    // Bound employee slots and formulas are part of this workbook's weekly Totals schema.
    // Refuse a roster reorder until every daily reference can be migrated safely.
    model.sms.rows.forEach((r,i)=>{
      if (!r.person) return;
      const expected=String(sheet.getRange(t+1+i,2).getValue()).trim();
      if (expected!==r.person.name) throw new Error('Totals row needs remapping for '+r.person.name+'; no partial write');
    });
    const sat=sheet.getRange('A11').getValue();
    const h=values.findIndex((r,i)=>i>=t && r[0] instanceof Date && r[0].toDateString()===sat.toDateString())+1;
    if (!h) throw new Error('Sub date header missing; sheet left intact');
    const subRow=h+1;
    const subSize=Math.max(0,model.subs.reduce((n,s)=>n+s.rows.length+1,0)-1);
    const allocationRow=subRow+subSize+1;
    const url=COMPACT_APP+'?date='+date+'&sheet_id='+sheet.getSheetId()+'&col='+col+
      '&employee_capacity='+cap+'&sub_row='+subRow+'&sub_capacity='+Math.max(6,subSize)+'&allocation_row='+allocationRow;
    const result=compactGet(url), plan=result.plan;
    // Current demonstration/reference rows are never copied, cleared, or used as data.
    // Stop if new output would collide with non-owned content. No fixed-size truncation.
    const last=prior ? prior.last : subRow-1;
    for(let r=Math.max(last+1,subRow);r<=plan.endRow;r++) {
      const occupied=sheet.getRange(r,col,1,3).getValues()[0].some(v=>String(v).trim());
      if(occupied) throw new Error('Preserve manual content at row '+r+'; reserve output space before installing');
    }
    if(prior) compactBatch([{updateCells:{range:{sheetId:sheet.getSheetId(),startRowIndex:subRow-1,endRowIndex:Math.max(last,plan.endRow),startColumnIndex:col-1,endColumnIndex:col+2},fields:'userEnteredValue,userEnteredFormat.backgroundColor'}}]);
    compactBatch(plan.requests);
    SpreadsheetApp.flush();
    plan.verification.forEach(v=>{
      const c=sheet.getRange(v.row,v.col), want=v.value;
      const ok=want.formulaValue!==undefined?c.getFormula()===want.formulaValue:want.numberValue!==undefined?Math.abs(Number(c.getValue())-want.numberValue)<0.005:c.getValue()===want.stringValue;
      if(!ok || /^#(REF!|ERROR!|VALUE!|DIV\/0!)/.test(c.getDisplayValue())) throw new Error('Read-back failed at '+c.getA1Notation()+'; no green and no checkpoint');
    });
    compactBatch(plan.green);
    props.setProperty(key,JSON.stringify({stamp,last:plan.endRow}));
  } finally {lock.releaseLock();}
}
function compactGet(url) {
  const r=UrlFetchApp.fetch(url,{muteHttpExceptions:true});
  if(r.getResponseCode()!==200) throw new Error('Payroll layout refused: '+r.getContentText());
  return JSON.parse(r.getContentText());
}
function compactBatch(requests) {
  if(!requests.length)return;
  const r=UrlFetchApp.fetch('https://sheets.googleapis.com/v4/spreadsheets/'+COMPACT_PAYROLL_ID+':batchUpdate',{
    method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},
    payload:JSON.stringify({requests}),muteHttpExceptions:true});
  if(r.getResponseCode()!==200)throw new Error('Sheet update failed: '+r.getContentText());
}
