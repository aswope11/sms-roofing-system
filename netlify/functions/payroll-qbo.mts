// Isolated payroll-only endpoint. No changes to the general work handler.
import {getDatabase} from "@netlify/database";
import {getStore} from "@netlify/blobs";
import type {Config} from "@netlify/functions";
import * as M from "../../lib/money.js";
import * as W from "../../lib/whoswho.js";
import {verifyPayrollRequest,payrollBridgePlan,postPayrollPlaceholder,payrollInvoiceDate} from "../../lib/payroll-bridge.js";
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const refuse=(error:string,status=400)=>json({error},status);
function norm(v: any): any {
  if (v instanceof Date) {
    if (v.getHours() === 0 && v.getMinutes() === 0 && v.getSeconds() === 0 && v.getMilliseconds() === 0)
      return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
    return v.toISOString();
  }
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === "object") { const o: any = {}; for (const k in v) o[k] = norm(v[k]); return o; }
  return v;
}

const QB_API = "https://quickbooks.api.intuit.com/v3/company";
async function qbToken() {
  const store = getStore({ name: "qbo", consistency: "strong" });
  const t: any = await store.get("tokens", { type: "json" });
  if (!t) throw new Error("QuickBooks isn't connected — open /api/qbo/connect once.");
  if (Date.now() < Number(t.expires_at) - 120000) return t;
  const basic = Buffer.from(`${Netlify.env.get("QBO_CLIENT_ID")}:${Netlify.env.get("QBO_CLIENT_SECRET")}`).toString("base64");
  const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", authorization: `Basic ${basic}` },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh_token }),
  });
  const tok: any = await res.json();
  if (!res.ok) throw new Error("QuickBooks connection expired — open /api/qbo/connect once to reconnect.");
  const next = { ...t, access_token: tok.access_token, refresh_token: tok.refresh_token || t.refresh_token, obtained_at: Date.now(), expires_at: Date.now() + (tok.expires_in || 3600) * 1000 };
  await store.setJSON("tokens", next);
  return next;
}

async function qb(method: string,path: string,payload?: any,_opts?: any) {
 if(method!=="GET" && !(method==="POST" && /^invoice\?requestid=[a-f0-9]{40}$/.test(path)))throw new Error("Payroll endpoint cannot perform this QuickBooks operation");
 const t=await qbToken();const sep=path.includes("?")?"&":"?";
 const res=await fetch(`${QB_API}/${t.realm_id}/${path}${sep}minorversion=75`,{method,headers:{authorization:`Bearer ${t.access_token}`,accept:"application/json",...(payload?{"content-type":"application/json"}:{})},body:payload?JSON.stringify(payload):undefined});
 const data:any=await res.json();if(!res.ok)throw new Error("QuickBooks refused payroll: "+(data?.Fault?.Error?.[0]?.Detail||res.status));return data;
}
const qbQuery=(q:string)=>qb("GET",`query?query=${encodeURIComponent(q)}`).then((d:any)=>d.QueryResponse||{});
const qEsc=(s:string)=>String(s||"").replace(/\\/g,"\\\\").replace(/'/g,"\\'");
const mdyy=(d:string)=>d.slice(5,7)+"/"+d.slice(8,10)+"/"+d.slice(2,4);

async function qbNextNumber() {
  const rows = (await qbQuery("SELECT DocNumber FROM Invoice ORDERBY MetaData.CreateTime DESC MAXRESULTS 100")).Invoice || [];
  const nums = rows.map((r: any) => Number(r.DocNumber)).filter((n: number) => Number.isFinite(n) && n > 0);
  return String((nums.length ? Math.max(...nums) : 0) + 1);
}

const NO_PAY_CUSTOMERS = /wortham|standridge|four corners/i;
const noPay = (job: any) => (NO_PAY_CUSTOMERS.test(String(job?.customer_name || "")) || !!job?.c_no_pay)
  ? { AllowOnlinePayment: false, AllowOnlineCreditCardPayment: false, AllowOnlineACHPayment: false, AllowIPNPayment: false } : {};
// BILL TO / SHIP TO (10/8/26): the building's own bill name wins (Four Corners' owner LLCs), else the company's billing card.
// Ship To ALWAYS goes on — tenant on line 1, job address under it — even when no Bill To is on file.
function billTo(job: any) {
  const own = String(job.bill_name || "").trim();
  const name = own || String(job.c_bill_name || "").trim();
  const addr = own ? String(job.bill_addr || "") : String(job.c_bill_addr || "");
  const lines = (arr: string[]) => Object.fromEntries(arr.filter(Boolean).slice(0, 5).map((l, i) => [`Line${i + 1}`, l]));
  const shipAddr = String(job.ship_addr || "").trim() || [job.address, job.city].filter(Boolean).join(", ");
  const shipLines = [String(job.tenant || "").trim(), ...shipAddr.split(/\n/).map(s => s.trim())];
  const out: any = { ShipAddr: lines(shipLines) };
  if (name) out.BillAddr = lines([name, ...addr.split(/\n/).map(s => s.trim())]);
  return out;
}

const mapTicket = (job: any) => ({ property_id: job.property_id, address: job.address, city: job.city, tenant: job.tenant });
async function mapDecisionFor(sql: any, job: any) {
  return W.mapDecision(norm(await sql`SELECT * FROM whoswho`), mapTicket(job));
}
// Bill To comes from the map row (it is what he confirmed) — billTo() reads the job's own bill_name first.
const withMapBill = (job: any, row: any) => row && String(row.bill_name || "").trim() ? { ...job, bill_name: row.bill_name, bill_addr: row.bill_addr } : job;

const dayMap = (p: any): Record<string, number> => {
  let d: any = p?.days;
  if (typeof d === "string") { try { d = JSON.parse(d); } catch { d = null; } }
  const out: Record<string, number> = {};
  if (d && typeof d === "object") for (const k of Object.keys(d)) out[String(k).slice(0, 10)] = Number(d[k]) || 0;
  if (!Object.keys(out).length && p?.work_date) out[String(p.work_date).slice(0, 10)] = Number(p.amount) || 0;
  return out;
};

const qbSalesLines=(invoice:any)=>(invoice?.Line||[]).filter((line:any)=>line.DetailType==="SalesItemLineDetail");
export default async function handler(req:Request) {
 if(req.method!=="POST")return refuse("POST required",405);
 const db=getDatabase(),sql=db.sql,kind="payroll-qbo",m=req.method;
 const loadJob=async(jid:number)=>(await sql`SELECT j.*,p.address,p.city,COALESCE(NULLIF(j.tenant_name,''),p.tenant) AS tenant,p.customer_id,p.bill_name,p.bill_addr,p.ship_addr,c.name AS customer_name,c.bill_name AS c_bill_name,c.bill_addr AS c_bill_addr,c.no_pay AS c_no_pay FROM jobs j JOIN properties p ON p.id=j.property_id JOIN customers c ON c.id=p.customer_id WHERE j.id=${jid}`)[0];
 const shareRowsFor=async(dates:string[])=>norm({stops:await sql`SELECT * FROM stops WHERE work_date=ANY(${dates}::date[]) ORDER BY seq NULLS LAST,id`,crewDays:await sql`SELECT * FROM crew_days WHERE work_date=ANY(${dates}::date[])`});
 try {
    // Disabled unless a dedicated key is configured. Only signed Daily Payroll
    // requests reach this path; general app QuickBooks writes remain blocked.
    if(kind === "payroll-qbo" && m === "POST") {
      const raw=await req.text(), secret=Netlify.env.get("PAYROLL_BRIDGE_SECRET")||"";
      try {verifyPayrollRequest({secret,timestamp:req.headers.get("x-payroll-time"),signature:req.headers.get("x-payroll-signature"),body:raw});}
      catch(e:any){return refuse(String(e?.message||e),secret?401:503);}
      const b=JSON.parse(raw), jid=Number(b.job_id), date=String(b.work_date||"");
      if(!Number.isSafeInteger(jid)||jid<=0||!/^\d{4}-\d{2}-\d{2}$/.test(date))return refuse("Invalid payroll ticket or date");
      const lock=await db.pool.connect();
      try {
        await lock.query("BEGIN");
        await lock.query("SELECT pg_advisory_xact_lock(hashtext($1))",["sms-payroll-qbo:"+jid]);
        const job=norm(await loadJob(jid));
        const greens=norm(await sql`SELECT work_date FROM green_days WHERE green AND work_date=${date}::date`);
        const {stops,crewDays}=await shareRowsFor([date]);
        const crew=norm(await sql`SELECT * FROM crew`);
        const shares=M.stopShares({stops,crew,crewDays});
        const plan=payrollBridgePlan({request:b,job,approved:greens.length===1,shares,billLabor:M.billLabor});
        const invoiceDate=payrollInvoiceDate();
        const decision=await mapDecisionFor(sql,job);
        if(!decision.ok)throw new Error("No confirmed QuickBooks customer for this ticket; no write made");
        const customerId=String(decision.row.qb_customer_id);
        const customer=(await qb("GET",`customer/${customerId}`)).Customer;
        if(!customer||customer.Active===false)throw new Error("Confirmed QuickBooks customer is inactive or missing");
        const covered=norm(await sql`SELECT id FROM invoices WHERE job_id=${jid} AND kind='real' AND covers_through>=${date}::date`);
        if(covered.length)throw new Error("A real invoice already covers this payroll day; reconcile before posting");
        const seats=norm(await sql`SELECT * FROM invoices WHERE job_id=${jid} AND kind='placeholder' AND amount>0 AND zeroed_by IS NULL ORDER BY id`);
        if(seats.length>1)throw new Error("Multiple open placeholders require reconciliation; no duplicate added");
        const seat=seats[0]||null;
        if(seat&&!seat.qb_id)throw new Error("Existing placeholder is not verified in QuickBooks; no second placeholder made");
        const receipt=await postPayrollPlaceholder(plan,{
          customer:async()=>({id:customerId}),
          existing:async()=>seat?{qbId:seat.qb_id,dayAmount:dayMap(seat)[date]}:null,
          readInvoice:async(qid:string)=>(await qb("GET",`invoice/${qid}`)).Invoice,
          findInvoiceByMarker:async()=>{
            // Search all invoice dates: an interrupted posting may be on an older placeholder.
            // At the query limit, refuse the write rather than assume no duplicate exists.
            const candidates=(await qbQuery(`SELECT * FROM Invoice WHERE CustomerRef = '${qEsc(customerId)}' MAXRESULTS 1000`)).Invoice||[];
            if(candidates.length>=1000)throw new Error("Invoice search requires paging before safe duplicate detection");
            const found=candidates.filter((inv:any)=>(inv.Line||[]).some((l:any)=>String(l.Description||'').includes(plan.marker)));
            if(found.length>1)throw new Error("Duplicate payroll receipts already exist in QuickBooks; reconcile first");
            return found[0]||null;
          },
          writeInvoice:async({cur,requestId}:any)=>{
            const line={DetailType:"SalesItemLineDetail",Amount:plan.charge,Description:[`Date: ${mdyy(date)}`,plan.marker,...plan.labor.map((l:any)=>l.how)].join("\n"),SalesItemLineDetail:{ItemRef:{value:"1"},Qty:1,UnitPrice:plan.charge}};
            const payload=cur?{Id:cur.Id,SyncToken:cur.SyncToken,sparse:true,CustomerRef:cur.CustomerRef,TxnDate:invoiceDate,DueDate:invoiceDate,Line:[...qbSalesLines(cur),line]}:
              {CustomerRef:{value:customerId},DocNumber:await qbNextNumber(),TxnDate:invoiceDate,DueDate:invoiceDate,PrivateNote:plan.marker,...billTo(withMapBill(job,decision.row)),...noPay(job),Line:[line]};
            return (await qb("POST","invoice?requestid="+requestId,payload,{payroll:true})).Invoice;
          },
          record:async({invoice}:any)=>{
            const days={...(seat?dayMap(seat):{}),[date]:plan.charge};
            if(seat)await sql`UPDATE invoices SET amount=${Number(invoice.TotalAmt)},inv_date=${invoice.TxnDate}::date,days=${JSON.stringify(days)}::jsonb,qb_error='' WHERE id=${seat.id}`;
            else await sql`INSERT INTO invoices(job_id,kind,name,number,amount,inv_date,work_date,days,qb_id,memo) VALUES(${jid},'placeholder','Placeholder',${invoice.DocNumber},${Number(invoice.TotalAmt)},${invoice.TxnDate}::date,${date}::date,${JSON.stringify(days)}::jsonb,${String(invoice.Id)},${plan.marker})`;
          }
        });
        await lock.query("COMMIT");
        return json({...receipt,job_id:jid,work_date:date,customer:customer.FullyQualifiedName||customer.DisplayName});
      } catch(e){await lock.query("ROLLBACK");throw e;}
      finally{lock.release();}
    }

 }catch(e:any){return refuse(String(e?.message||e));}
 return refuse("Unsupported payroll request",404);
}
export const config:Config={path:"/payroll-bridge/qbo"};
