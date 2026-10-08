import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { qbPdfLink } from '../public/qbpdf.js';
import {
  serveQbInvoicePdf, fetchQbInvoicePdf, invoicePdfFilename, contentDisposition,
  qbInvoicePdfUrl, qbPdfRefusal, classifyQbPdfFailure,
} from '../lib/qb-pdf.js';

const PDF = Buffer.from('%PDF-1.4\n% fake invoice\n');
const TOKEN = { access_token: 'SECRET-TOKEN-XYZ', realm_id: '1234567890', refresh_token: 'SECRET-REFRESH' };
const INV = { id: 42, kind: 'real', number: '4812', qb_id: '987' };

function mockFetch(status, body, contentType = 'application/pdf') {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    return new Response(buf, { status, headers: { 'content-type': contentType } });
  };
  return { fetchImpl, calls };
}

test('the file is named Invoice <QuickBooks number>.pdf', () => {
  assert.equal(invoicePdfFilename('4812'), 'Invoice 4812.pdf');
  assert.equal(invoicePdfFilename(' 4812 '), 'Invoice 4812.pdf');
  assert.equal(invoicePdfFilename(''), 'Invoice.pdf');
  assert.equal(contentDisposition('4812'), `inline; filename="Invoice 4812.pdf"; filename*=UTF-8''Invoice%204812.pdf`);
  assert.ok(!contentDisposition('4812"\r\nX').includes('\r'));
});

test('GET /pdf returns the QuickBooks bytes as application/pdf and does not write', async () => {
  const { fetchImpl, calls } = mockFetch(200, PDF);
  const res = await serveQbInvoicePdf({ invoice: INV, token: TOKEN, fetchImpl });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  const disp = res.headers.get('content-disposition');
  assert.match(disp, /filename="Invoice 4812\.pdf"/);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  const got = Buffer.from(await res.arrayBuffer());
  assert.equal(got.subarray(0, 4).toString(), '%PDF');
  assert.equal(got.equals(PDF), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.method, 'GET');
  assert.equal(calls[0].opts.redirect, 'manual');
  assert.equal(calls[0].url, qbInvoicePdfUrl('1234567890', '987'));
  assert.match(calls[0].url, /\/invoice\/987\/pdf\?minorversion=75$/);
  assert.equal(calls[0].opts.headers.accept, 'application/pdf');
  assert.equal(calls[0].opts.headers.authorization, 'Bearer SECRET-TOKEN-XYZ');
  assert.equal(calls[0].opts.body, undefined);
  assert.ok(!calls[0].url.includes('SECRET'));
  assert.ok(!disp.includes('SECRET'));
});

test('no QuickBooks id: clear error, QuickBooks is not called', async () => {
  let called = false;
  const res = await serveQbInvoicePdf({
    invoice: { id: 7, kind: 'real', number: '100', qb_id: '  ' },
    token: TOKEN,
    fetchImpl: () => { called = true; throw new Error('should not call'); },
  });
  assert.equal(called, false);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /no QuickBooks id/);
  assert.deepEqual(qbPdfRefusal(null), { status: 404, error: "That invoice doesn't exist." });
});

test('missing CRM invoice is a 404 and does not call QuickBooks', async () => {
  const res = await serveQbInvoicePdf({ invoice: null, token: TOKEN, fetchImpl: () => { throw new Error('no'); } });
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /doesn't exist/);
});

test('not found in QuickBooks (HTTP 404 and Intuit fault 610)', async () => {
  const a = await serveQbInvoicePdf({ invoice: INV, token: TOKEN, fetchImpl: mockFetch(404, 'missing').fetchImpl });
  assert.equal(a.status, 404);
  assert.match((await a.json()).error, /not found in QuickBooks/);
  const fault = JSON.stringify({ Fault: { Error: [{ Message: 'Object Not Found', code: '610' }] } });
  const b = await serveQbInvoicePdf({ invoice: INV, token: TOKEN, fetchImpl: mockFetch(400, fault, 'application/json').fetchImpl });
  assert.equal(b.status, 404);
  assert.match((await b.json()).error, /not found in QuickBooks/);
  assert.equal(classifyQbPdfFailure(400, 'something else').status, 502);
});

test('auth failure is a 401 and the token is not in the response', async () => {
  for (const status of [401, 403]) {
    const res = await serveQbInvoicePdf({ invoice: INV, token: TOKEN, fetchImpl: mockFetch(status, '{"Fault":{"Error":[{"Message":"AuthenticationFailed"}]}}', 'application/json').fetchImpl });
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.match(data.error, /authorization failed/);
    assert.equal(JSON.stringify(data).includes('SECRET'), false);
  }
  const redir = await serveQbInvoicePdf({
    invoice: INV, token: TOKEN,
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://accounts.intuit.com/login' } }),
  });
  assert.equal(redir.status, 401);
  assert.equal(JSON.stringify(await redir.json()).includes('SECRET'), false);
  const bare = await serveQbInvoicePdf({ invoice: INV, token: {}, fetchImpl: () => { throw new Error('no'); } });
  assert.equal(bare.status, 401);
  assert.match((await bare.json()).error, /isn't connected/);
});

test('a non-PDF body is refused, and a network failure is said plainly', async () => {
  const html = await serveQbInvoicePdf({ invoice: INV, token: TOKEN, fetchImpl: mockFetch(200, '<html>sign in</html>', 'text/html').fetchImpl });
  assert.equal(html.status, 502);
  assert.match((await html.json()).error, /did not return a PDF/);
  const down = await fetchQbInvoicePdf(async () => { throw new Error('ECONNRESET SECRET-TOKEN-XYZ'); }, { accessToken: TOKEN.access_token, realmId: TOKEN.realm_id, qbId: INV.qb_id });
  assert.equal(down.ok, false);
  assert.equal(down.status, 502);
  assert.match(down.error, /could not be reached/);
  assert.equal(down.error.includes('SECRET'), false);
});

test('the PDF helper only GETs, and the route looks the invoice up without writing it', () => {
  const lib = readFileSync('lib/qb-pdf.js', 'utf8');
  assert.equal((lib.match(/method:\s*"GET"/g) || []).length, 1);
  assert.ok(!/method:\s*"(POST|PUT|PATCH|DELETE)"/.test(lib), 'the PDF helper never writes to QuickBooks');
  assert.ok(!/console\./.test(lib));
  const w = readFileSync('netlify/functions/work.mts', 'utf8');
  const fn = w.match(/async function invoiceQbPdf[\s\S]*?\n\}/);
  assert.ok(fn, 'invoiceQbPdf exists');
  assert.match(fn[0], /SELECT id, kind, number, qb_id FROM invoices/);
  assert.ok(!/\b(UPDATE|INSERT|DELETE)\b/.test(fn[0]), 'the PDF route does not change the invoice');
  assert.match(fn[0], /qbToken\(\)/);
  assert.match(fn[0], /serveQbInvoicePdf/);
  assert.ok(!fn[0].includes('console.'));
  const block = w.slice(w.indexOf('kind === "invoices"'));
  const pdfAt = block.indexOf('action === "qb-pdf"');
  const writeAt = block.search(/\b(UPDATE|INSERT|DELETE)\b/);
  assert.ok(pdfAt >= 0 && writeAt > pdfAt, 'the PDF GET is handled before any invoice write');
  assert.match(block.slice(0, pdfAt + 80), /m === "GET"/);
});

test('QuickBooks PDF links are plain GETs on real invoices that have a qb_id', () => {
  const html = qbPdfLink({ id: 42, kind: 'real', qb_id: '987', number: '4812' });
  assert.match(html, /href="\/w\/invoices\/42\/qb-pdf"/);
  assert.match(html, />QuickBooks PDF 4812</);
  assert.match(html, /target="_blank"/);
  assert.equal(html.includes('987'), false);
  assert.equal(qbPdfLink({ id: 42, kind: 'real', qb_id: '', number: '4812' }), '');
  assert.equal(qbPdfLink({ id: 42, kind: 'placeholder', qb_id: '987', number: '4812' }), '');
  assert.equal(qbPdfLink({ id: 42, kind: 'draw', qb_id: '987', number: '4812' }), '');
  const nasty = qbPdfLink({ id: 42, kind: 'real', qb_id: '1', number: '"><img' });
  assert.equal(nasty.includes('<img'), false);
  assert.match(nasty, /href="\/w\/invoices\/42\/qb-pdf"/);
  for (const f of ['public/invoicing.js', 'public/ar.js', 'public/jobcost.js', 'public/ledger.js']) {
    const src = readFileSync(f, 'utf8');
    assert.ok(src.includes('qbPdfLink'), f + ' shows the QuickBooks PDF link');
  }
});
