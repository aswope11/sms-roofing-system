// Read-only QuickBooks invoice PDF. GET the PDF bytes and hand them back.
// Nothing here creates, updates, sends, voids, or deletes a QuickBooks record.

export const QB_API = "https://quickbooks.api.intuit.com/v3/company";

export function qbInvoicePdfUrl(realmId, qbId) {
  return `${QB_API}/${encodeURIComponent(String(realmId))}/invoice/${encodeURIComponent(String(qbId))}/pdf?minorversion=75`;
}

// Adam attaches the file as "Invoice NNNN.pdf". The number is the QuickBooks DocNumber stored on the CRM invoice.
export function invoicePdfFilename(number) {
  const n = String(number ?? "").replace(/[\u0000-\u001f"\\;]/g, "").trim();
  return n ? `Invoice ${n}.pdf` : "Invoice.pdf";
}

export function contentDisposition(number) {
  const file = invoicePdfFilename(number);
  return `inline; filename="${file}"; filename*=UTF-8''${encodeURIComponent(file)}`;
}

export function qbPdfRefusal(invoice) {
  if (!invoice) return { status: 404, error: "That invoice doesn't exist." };
  if (!String(invoice.qb_id || "").trim()) return { status: 400, error: "That invoice is not in QuickBooks — it has no QuickBooks id." };
  return null;
}

function jsonError(error, status) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" },
  });
}

// Map a failed QuickBooks PDF response to a short message. The body is only used to tell
// "not found" from "not authorized". It is never returned and never logged.
export function classifyQbPdfFailure(status, bodyText) {
  const text = String(bodyText || "");
  if (status === 401 || status === 403 || /AuthenticationFailed|AuthorizationFailed|003100|"code":"3200"/i.test(text))
    return { status: 401, error: "QuickBooks authorization failed — open /api/qbo/connect once to reconnect." };
  if (status === 404 || /Object Not Found|"code":"610"|was deleted/i.test(text))
    return { status: 404, error: "That invoice was not found in QuickBooks." };
  return { status: 502, error: `QuickBooks would not give the PDF (${status}).` };
}

const AUTH_FAIL = { status: 401, error: "QuickBooks authorization failed — open /api/qbo/connect once to reconnect." };

// Fetch one invoice PDF. fetchImpl is injectable so tests never call QuickBooks.
// The access token is sent only as the Authorization header. It is not put in the URL,
// the response, or an error message.
export async function fetchQbInvoicePdf(fetchImpl, { accessToken, realmId, qbId }) {
  const url = qbInvoicePdfUrl(realmId, qbId);
  let res;
  try {
    res = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/pdf" },
    });
  } catch {
    return { ok: false, status: 502, error: "QuickBooks could not be reached." };
  }
  if (res.status >= 300 && res.status < 400) return { ok: false, ...AUTH_FAIL };
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, ...classifyQbPdfFailure(res.status, text) };
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length < 5 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== "%PDF")
    return { ok: false, status: 502, error: "QuickBooks did not return a PDF." };
  return { ok: true, bytes };
}

export async function serveQbInvoicePdf({ invoice, token, fetchImpl = fetch }) {
  const refused = qbPdfRefusal(invoice);
  if (refused) return jsonError(refused.error, refused.status);
  if (!token || !token.access_token || !token.realm_id)
    return jsonError("QuickBooks isn't connected — open /api/qbo/connect once.", 401);
  const got = await fetchQbInvoicePdf(fetchImpl, {
    accessToken: token.access_token,
    realmId: token.realm_id,
    qbId: String(invoice.qb_id).trim(),
  });
  if (!got.ok) return jsonError(got.error, got.status);
  return new Response(got.bytes, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": contentDisposition(invoice.number),
      "content-length": String(got.bytes.byteLength),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
