// Plain rules shared by the API and the tests. Every rule here has a test.

// Job tags he uses. BID = a bid. R = repair. CO = change order. UC = unit cost. JC = job contract.
export const TAGS = ['BID', 'R', 'CO', 'UC', 'JC'];

// File cabinet drawers inside one job file.
// 'Emails' (10/1/26): every email that made or joined a ticket is saved here — it has to show on the ticket.
export const DRAWERS = ['Intake', 'Emails', 'Takeoff', 'Bid', 'Documents', 'Plans', 'Contract', 'Photos'];

// Big files are cut into 4 MB pieces and glued back together on download.
export const CHUNK_BYTES = 4 * 1024 * 1024;

// A property is found by its address, so "2409 Eastlake Hill Dr." and "2409 eastlake hill drive" are the same roof.
const WORDS = { drive: 'dr', street: 'st', avenue: 'ave', road: 'rd', lane: 'ln', boulevard: 'blvd', court: 'ct', parkway: 'pkwy', highway: 'hwy', circle: 'cir', place: 'pl', trail: 'trl', north: 'n', south: 's', east: 'e', west: 'w' };
export function addressKey(address) {
  return String(address || '')
    .toLowerCase()
    .replace(/[.,#]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => WORDS[w] || w)
    .join(' ');
}

export function chunkCount(sizeBytes) {
  return Math.max(1, Math.ceil(sizeBytes / CHUNK_BYTES));
}

// WHAT IS STILL MISSING OFF A RECORD — A NOTE, NEVER A BLOCK (locked 9/20/26).
// "Save is never blocked. Anywhere in this app. Ever." He is a one-man shop and gets information as
// it comes in, not all at once. Whatever he has filled in, the app saves. What is missing stays
// missing, in writing, until he knows it. Nothing in this file is ever a reason to refuse a save.
export function missingOnCustomer(c) {
  const miss = [];
  if (!c || !String(c.name || '').trim()) miss.push('Customer name');
  return miss;
}
export function missingOnProperty(p) {
  const miss = [];
  if (!p || !p.customer_id) miss.push('Customer');
  if (!p || !String(p.address || '').trim()) miss.push('Address');
  return miss;
}
export function missingOnJob(j) {
  const miss = [];
  if (!j || !j.property_id) miss.push('Property');
  if (!j || !TAGS.includes(j.tag)) miss.push('Tag (BID, R, CO, UC or JC)');
  if (!j || !String(j.title || '').trim()) miss.push('Job name');
  return miss;
}
export function missingOnFile(f) {
  const miss = [];
  if (!f || (!f.job_id && !f.supply_invoice_id && !f.sub_id && !f.customer_id)) miss.push('Job');
  if (!f || (!f.supply_invoice_id && !f.sub_id && !f.customer_id && !DRAWERS.includes(f.drawer))) miss.push('Drawer');
  if (!f || !String(f.name || '').trim()) miss.push('File name');
  if (!f || !(f.size_bytes >= 0)) miss.push('File size');
  return miss;
}
