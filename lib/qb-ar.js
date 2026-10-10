// Read-only QuickBooks A/R aging. Two report GETs, then a PDF or CSV laid out from those figures.
// Nothing here creates, updates, sends, voids, or deletes a QuickBooks record, and nothing is written to the CRM.
// Amounts, dates, and days past due are copied off the report. They are not added up or re-aged.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { QB_API } from "./qb-pdf.js";

const AUTH_FAIL = { status: 401, error: "QuickBooks authorization failed — open /api/qbo/connect once to reconnect." };

export function chicagoDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function parseAsOf(raw, now = new Date()) {
  const s = raw == null ? "" : String(raw).trim();
  if (!s) return { ok: true, date: chicagoDate(now) };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { ok: false, error: "as_of must be YYYY-MM-DD." };
  const [y, m, d] = s.split("-").map((n) => Number(n));
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d)
    return { ok: false, error: "as_of must be YYYY-MM-DD." };
  return { ok: true, date: s };
}

export function arReportTitle(date) {
  return `SMS Roofing & Waterproofing - A/R Aging - ${date}`;
}

export function arReportFilename(date, ext) {
  return `AR Aging ${date}.${ext}`;
}

export function arContentDisposition(date, ext) {
  const file = arReportFilename(date, ext);
  return `inline; filename="${file}"; filename*=UTF-8''${encodeURIComponent(file)}`;
}

function jsonError(error, status) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" },
  });
}

export function classifyQbReportFailure(which, status, bodyText) {
  const text = String(bodyText || "");
  if (status === 401 || status === 403 || /AuthenticationFailed|AuthorizationFailed|003100|"code":"3200"/i.test(text))
    return { ...AUTH_FAIL };
  return { status: 502, error: `QuickBooks would not give the A/R aging ${which} (${status}).` };
}

function asRows(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function cellValue(cell) {
  if (cell == null || cell.value == null) return "";
  return String(cell.value);
}

function at(cells, index) {
  if (index == null || index < 0 || index >= cells.length) return "";
  return cells[index];
}

function colKey(col) {
  const hit = asRows(col?.MetaData).find((m) => String(m?.Name || "").toLowerCase() === "colkey");
  return hit ? String(hit.Value || "") : "";
}

// QuickBooks names the bucket in ColTitle ("1 - 30", "31 - 60", "61 - 90", "91 and over").
// ColKey is often a period index ("0","1","2","3") that does not match those titles: treating "1" as
// the 1-30 column drops 1-30 and slides every older bucket one column left. The title wins.
function normLabel(value) {
  return String(value ?? "")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function bucketFromLabel(label) {
  const title = normLabel(label);
  if (!title) return "";
  if (title === "current") return "current";
  if (/^1\s*-\s*30\b/.test(title)) return "b30";
  if (/^31\s*-\s*60\b/.test(title)) return "b60";
  if (/^61\s*-\s*90\b/.test(title)) return "b90";
  if (/^91\b/.test(title) || title === "91+" || title === "91 and over") return "b91";
  if (title === "total") return "total";
  if (title === "customer" || title === "client" || title === "name") return "name";
  return "";
}

function bucketOf(col) {
  const type = String(col?.ColType || "").toLowerCase();
  if (type === "customer" || type === "cust_name" || type === "name") return "name";
  const byTitle = bucketFromLabel(col?.ColTitle);
  if (byTitle) return byTitle;
  return bucketFromLabel(colKey(col));
}

function summaryIndexes(columns) {
  const cols = asRows(columns?.Column);
  const idx = { name: -1, current: -1, b30: -1, b60: -1, b90: -1, b91: -1, total: -1 };
  cols.forEach((col, i) => {
    const bucket = bucketOf(col);
    if (bucket) idx[bucket] = i;
  });
  if (idx.name < 0) {
    const used = new Set(Object.values(idx).filter((n) => n >= 0));
    const firstFree = cols.findIndex((_, i) => !used.has(i));
    if (firstFree >= 0) idx.name = firstFree;
  }
  return idx;
}

const OPEN_BALANCE = new Set(["subt_open_bal", "subt_neg_open_bal", "subt_nat_open_bal", "open_bal"]);

function detailIndexes(columns) {
  const cols = asRows(columns?.Column);
  const find = (pred) => cols.findIndex((col) => {
    const type = String(col?.ColType || "").toLowerCase();
    const title = String(col?.ColTitle || "").trim().toLowerCase();
    return pred(type, title);
  });
  return {
    customer: find((type, title) => type === "cust_name" || type === "name" || type === "customer" || title === "customer" || title === "client"),
    invoice: find((type, title) => type === "doc_num" || title === "num" || title === "no." || title === "invoice number"),
    date: find((type, title) => type === "tx_date" || title === "date"),
    due: find((type, title) => type === "due_date" || title === "due date"),
    days: find((type, title) => type === "past_due" || title === "past due" || title === "days past due"),
    balance: find((type, title) => OPEN_BALANCE.has(type) || title === "open balance"),
  };
}

function mapSummary(colData, indexes, kind, depth) {
  const cells = asRows(colData).map(cellValue);
  return {
    kind,
    depth,
    customer: at(cells, indexes.name),
    current: at(cells, indexes.current),
    b30: at(cells, indexes.b30),
    b60: at(cells, indexes.b60),
    b90: at(cells, indexes.b90),
    b91: at(cells, indexes.b91),
    total: at(cells, indexes.total),
  };
}

function hasMoney(row) {
  return [row.current, row.b30, row.b60, row.b90, row.b91, row.total].some((v) => v !== "");
}

function isGrand(row) {
  return row?.group === "GrandTotal";
}

function isAgingBucket(label) {
  const s = String(label || "").trim();
  if (!s) return true;
  if (/^total\b/i.test(s)) return true;
  if (/^current$/i.test(s)) return true;
  if (/days past due$/i.test(s)) return true;
  if (/^91\s*(\+|and over)\b/i.test(s)) return true;
  if (/^\d+\s*-\s*\d+(\s+days)?(\s+past due)?$/i.test(s)) return true;
  return false;
}

function walkSummary(rows, depth, acc, indexes) {
  for (const row of asRows(rows)) {
    if (!row || typeof row !== "object") continue;
    if (isGrand(row)) {
      const grand = mapSummary(row.Summary?.ColData || row.ColData, indexes, "grand", 0);
      if (grand.customer || hasMoney(grand)) acc.grand = grand;
      continue;
    }
    const nested = row.Rows && row.Rows.Row != null ? asRows(row.Rows.Row) : [];
    const section = !!(row.Header || row.Summary || nested.length);
    if (section) {
      if (row.Header?.ColData) {
        const header = mapSummary(row.Header.ColData, indexes, "label", depth);
        if (hasMoney(header)) acc.rows.push({ ...header, kind: "customer" });
        else if (header.customer) acc.rows.push(header);
      }
      if (nested.length) walkSummary(nested, depth + 1, acc, indexes);
      if (row.Summary?.ColData) acc.rows.push(mapSummary(row.Summary.ColData, indexes, "subtotal", depth));
      continue;
    }
    if (row.ColData) acc.rows.push(mapSummary(row.ColData, indexes, "customer", depth));
  }
}

function walkDetail(rows, inherited, lines, indexes) {
  for (const row of asRows(rows)) {
    if (!row || typeof row !== "object") continue;
    if (isGrand(row)) continue;
    const nested = row.Rows && row.Rows.Row != null ? asRows(row.Rows.Row) : [];
    if (nested.length || row.Header) {
      const headerLabel = cellValue(asRows(row.Header?.ColData)[0]);
      const customer = !isAgingBucket(headerLabel) && headerLabel ? headerLabel : inherited;
      if (nested.length) walkDetail(nested, customer, lines, indexes);
      continue;
    }
    if (!row.ColData) continue;
    const cells = asRows(row.ColData).map(cellValue);
    lines.push({
      customer: at(cells, indexes.customer) || inherited || "",
      invoice: at(cells, indexes.invoice),
      date: at(cells, indexes.date),
      due: at(cells, indexes.due),
      days: at(cells, indexes.days),
      balance: at(cells, indexes.balance),
    });
  }
}

function groupDetail(lines, summaryRows) {
  const totals = new Map();
  for (const row of summaryRows) {
    if (row.kind === "customer" && row.customer && !totals.has(row.customer)) totals.set(row.customer, row.total);
  }
  const groups = [];
  const by = new Map();
  for (const line of lines) {
    const key = line.customer;
    if (!by.has(key)) {
      const group = { customer: key, subtotal: totals.has(key) ? totals.get(key) : "", lines: [] };
      by.set(key, group);
      groups.push(group);
    }
    by.get(key).lines.push(line);
  }
  return groups;
}

export function buildArReport(summary, detail, asOf) {
  const acc = { rows: [], grand: null };
  walkSummary(summary?.Rows?.Row, 0, acc, summaryIndexes(summary?.Columns));
  const lines = [];
  walkDetail(detail?.Rows?.Row, "", lines, detailIndexes(detail?.Columns));
  return {
    asOf,
    title: arReportTitle(asOf),
    summary: acc.rows,
    grand: acc.grand,
    groups: groupDetail(lines, acc.rows),
  };
}

function reportUrl(realmId, name, params) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) q.set(key, value);
  q.set("minorversion", "75");
  return `${QB_API}/${encodeURIComponent(String(realmId))}/reports/${name}?${q}`;
}

const REPORT_PARAMS = (asOf) => ({
  report_date: asOf,
  aging_method: "Report_Date",
  aging_period: "30",
  num_periods: "4",
});

const DETAIL_COLUMNS = "tx_date,txn_type,doc_num,cust_name,due_date,past_due,subt_open_bal";

async function getReport(fetchImpl, accessToken, url, which) {
  let res;
  try {
    res = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    });
  } catch {
    return { ok: false, httpStatus: 0, status: 502, error: "QuickBooks could not be reached." };
  }
  if (res.status >= 300 && res.status < 400) return { ok: false, httpStatus: res.status, ...AUTH_FAIL };
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    const mapped = classifyQbReportFailure(which, res.status, text);
    return { ok: false, httpStatus: res.status, ...mapped };
  }
  try {
    const data = JSON.parse(text);
    if (data?.Fault) {
      const mapped = classifyQbReportFailure(which, 400, text);
      return { ok: false, httpStatus: res.status, ...mapped };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, httpStatus: res.status, status: 502, error: `QuickBooks did not return the A/R aging ${which}.` };
  }
}

export async function fetchArReports(fetchImpl, { accessToken, realmId, asOf }) {
  const summaryUrl = reportUrl(realmId, "AgedReceivables", REPORT_PARAMS(asOf));
  const detailParams = { ...REPORT_PARAMS(asOf), columns: DETAIL_COLUMNS };
  const detailUrl = reportUrl(realmId, "AgedReceivableDetail", detailParams);
  const [summary, firstDetail] = await Promise.all([
    getReport(fetchImpl, accessToken, summaryUrl, "summary"),
    getReport(fetchImpl, accessToken, detailUrl, "detail"),
  ]);
  if (!summary.ok) return { ok: false, status: summary.status, error: summary.error };
  let detail = firstDetail;
  // A company that rejects the column list still has the default detail report. Still a GET.
  if (!detail.ok && detail.httpStatus === 400 && detail.status !== 401) {
    detail = await getReport(fetchImpl, accessToken, reportUrl(realmId, "AgedReceivableDetail", REPORT_PARAMS(asOf)), "detail");
  }
  if (!detail.ok) return { ok: false, status: detail.status, error: detail.error };
  return { ok: true, summary: summary.data, detail: detail.data };
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export function renderArCsv(report) {
  const rows = [["Customer", "Invoice number", "Date", "Due date", "Days past due", "Open balance"]];
  for (const group of report.groups) {
    for (const line of group.lines) rows.push([line.customer, line.invoice, line.date, line.due, line.days, line.balance]);
    if (group.subtotal !== "") {
      const label = group.customer ? `Total for ${group.customer}` : "Total";
      rows.push([label, "", "", "", "", group.subtotal]);
    }
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const PAGE_W = 792;
const PAGE_H = 612;
const MARGIN = 40;
const INNER = PAGE_W - MARGIN * 2;
const BOTTOM = 46;
const INK = rgb(0.11, 0.13, 0.16);
const MUTE = rgb(0.33, 0.36, 0.4);
const LINE = rgb(0.76, 0.78, 0.82);
const RULE = rgb(0.18, 0.28, 0.4);
const HEAD_BG = rgb(0.92, 0.93, 0.95);
const ALT = rgb(0.965, 0.97, 0.975);
const TOTAL_BG = rgb(0.89, 0.92, 0.95);
const LABEL_BG = rgb(0.94, 0.95, 0.97);
const GROUP_BG = rgb(0.93, 0.94, 0.96);

const SUMMARY_COLS = [
  { key: "customer", label: "Customer", w: 252, align: "left" },
  { key: "current", label: "Current", w: 72, align: "right" },
  { key: "b30", label: "1-30", w: 72, align: "right" },
  { key: "b60", label: "31-60", w: 72, align: "right" },
  { key: "b90", label: "61-90", w: 72, align: "right" },
  { key: "b91", label: "91+", w: 72, align: "right" },
  { key: "total", label: "Total", w: 100, align: "right" },
];

const DETAIL_COLS = [
  { key: "invoice", label: "Invoice number", w: 130, align: "left" },
  { key: "date", label: "Date", w: 110, align: "left" },
  { key: "due", label: "Due date", w: 110, align: "left" },
  { key: "days", label: "Days past due", w: 130, align: "right" },
  { key: "balance", label: "Open balance", w: 232, align: "right" },
];

function pdfSafe(font, value) {
  const s = String(value ?? "").replace(/[\r\n\t]/g, " ");
  let out = "";
  for (const ch of s) {
    if (ch === "\u2013" || ch === "\u2014" || ch === "\u2212") { out += "-"; continue; }
    if (ch === "\u2018" || ch === "\u2019") { out += "'"; continue; }
    if (ch === "\u201C" || ch === "\u201D") { out += '"'; continue; }
    if (ch === "\u2026") { out += "..."; continue; }
    if (ch === "\u00A0") { out += " "; continue; }
    try { font.encodeText(ch); out += ch; }
    catch { out += "?"; }
  }
  return out;
}

function drawLeft(page, font, text, x, baseline, size, maxW, color) {
  let safe = pdfSafe(font, text);
  if (!safe) return;
  if (font.widthOfTextAtSize(safe, size) > maxW) {
    const ell = "...";
    while (safe.length > 1 && font.widthOfTextAtSize(safe + ell, size) > maxW) safe = safe.slice(0, -1);
    safe = safe.trimEnd() + ell;
  }
  page.drawText(safe, { x, y: baseline, size, font, color });
}

function drawFit(page, font, text, x, baseline, size, maxW, color) {
  const safe = pdfSafe(font, text);
  if (!safe) return;
  let s = size;
  while (s > 5 && font.widthOfTextAtSize(safe, s) > maxW) s -= 0.25;
  const w = font.widthOfTextAtSize(safe, s);
  page.drawText(safe, { x: x + Math.max(0, maxW - w), y: baseline, size: s, font, color });
}

function colStarts(cols) {
  const xs = [];
  let x = MARGIN;
  for (const col of cols) { xs.push(x); x += col.w; }
  return xs;
}

export async function renderArPdf(report) {
  const doc = await PDFDocument.create();
  doc.setTitle(report.title);
  doc.setAuthor("SMS Roofing & Waterproofing");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = [];
  let page = null;
  let y = 0;

  const newPage = (continued) => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    y = PAGE_H - MARGIN;
    if (!continued) return;
    drawLeft(page, bold, report.title, MARGIN, y - 11, 9, INNER, INK);
    y -= 20;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + INNER, y }, thickness: 0.8, color: RULE });
    y -= 12;
  };

  const paintRow = (cols, values, rowFont, color, fill, opts = {}) => {
    const height = opts.height || 16;
    if (y - height < BOTTOM) newPage(true);
    y -= height;
    const bottom = y;
    const baseline = bottom + 4.5;
    if (fill) page.drawRectangle({ x: MARGIN, y: bottom, width: INNER, height, color: fill });
    const xs = colStarts(cols);
    const indent = opts.indent || 0;
    cols.forEach((col, i) => {
      const raw = values[col.key] ?? "";
      if (raw === "") return;
      const pad = 5;
      const ind = col.key === "customer" || (col.key === "invoice" && !opts.span) ? indent : 0;
      let maxW = col.w - pad * 2 - ind;
      if (opts.span === col.key) maxW = Math.max(40, INNER - (xs[i] - MARGIN) - (opts.spanReserve || 0) - pad);
      if (col.align === "right") drawFit(page, rowFont, raw, xs[i] + pad, baseline, opts.size || 8.5, col.w - pad * 2, color);
      else drawLeft(page, rowFont, raw, xs[i] + pad + ind, baseline, opts.size || 8.5, maxW, color);
    });
    if (opts.rule !== false) {
      page.drawLine({ start: { x: MARGIN, y: bottom }, end: { x: MARGIN + INNER, y: bottom }, thickness: opts.rule || 0.4, color: LINE });
    }
    return true;
  };

  const ensure = (height) => {
    if (y - height >= BOTTOM) return false;
    newPage(true);
    return true;
  };

  newPage(false);
  page.drawText(pdfSafe(bold, report.title), { x: MARGIN, y: y - 16, size: 15, font: bold, color: INK });
  y -= 32;
  page.drawText(pdfSafe(font, "QuickBooks Online"), { x: MARGIN, y, size: 9, font, color: MUTE });
  y -= 12;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + INNER, y }, thickness: 1.4, color: RULE });
  y -= 18;

  const summaryValues = (row) => ({
    customer: row.customer, current: row.current, b30: row.b30, b60: row.b60, b90: row.b90, b91: row.b91, total: row.total,
  });
  const summaryHeader = () => {
    const labels = {};
    for (const col of SUMMARY_COLS) labels[col.key] = col.label;
    paintRow(SUMMARY_COLS, labels, bold, MUTE, HEAD_BG, { size: 8, rule: 0.8 });
  };

  page.drawText("A/R Aging Summary", { x: MARGIN, y, size: 11, font: bold, color: INK });
  y -= 8;
  summaryHeader();
  if (!report.summary.length && !report.grand) {
    ensure(16);
    paintRow(SUMMARY_COLS, { customer: "No open balances on this report." }, font, MUTE, null, { rule: 0.4 });
  }
  let stripe = 0;
  for (const row of report.summary) {
    if (ensure(16)) summaryHeader();
    if (row.kind === "label") {
      paintRow(SUMMARY_COLS, { customer: row.customer }, bold, INK, LABEL_BG, { indent: Math.min(row.depth, 4) * 10 });
      continue;
    }
    const boldRow = row.kind === "subtotal";
    const fill = boldRow ? TOTAL_BG : (stripe++ % 2 === 1 ? ALT : null);
    paintRow(SUMMARY_COLS, summaryValues(row), boldRow ? bold : font, INK, fill, {
      indent: Math.min(row.depth, 4) * 10,
      rule: boldRow ? 0.8 : 0.4,
    });
  }
  if (report.grand) {
    if (ensure(20)) summaryHeader();
    paintRow(SUMMARY_COLS, summaryValues(report.grand), bold, INK, TOTAL_BG, { height: 18, rule: 1.2 });
  }

  if (ensure(78)) { /* section starts on the next page */ }
  y -= 16;
  page.drawText("A/R Aging Detail", { x: MARGIN, y, size: 11, font: bold, color: INK });
  y -= 8;
  const detailHeader = () => {
    const labels = {};
    for (const col of DETAIL_COLS) labels[col.key] = col.label;
    paintRow(DETAIL_COLS, labels, bold, MUTE, HEAD_BG, { size: 8, rule: 0.8 });
  };
  detailHeader();
  if (!report.groups.length) {
    ensure(16);
    paintRow(DETAIL_COLS, { invoice: "No open invoices on this report." }, font, MUTE, null);
  }
  for (const group of report.groups) {
    const name = group.customer || "(No customer name)";
    if (ensure(16 + 16)) detailHeader();
    paintRow(DETAIL_COLS, { invoice: name }, bold, INK, GROUP_BG, { rule: 0.6, span: "invoice", spanReserve: 232 });
    group.lines.forEach((line, i) => {
      if (ensure(16)) {
        detailHeader();
        paintRow(DETAIL_COLS, { invoice: `${name} (continued)` }, bold, MUTE, GROUP_BG, { size: 8, rule: 0.6, span: "invoice", spanReserve: 232 });
      }
      paintRow(DETAIL_COLS, {
        invoice: line.invoice, date: line.date, due: line.due, days: line.days, balance: line.balance,
      }, font, INK, i % 2 === 1 ? ALT : null, { indent: 8 });
    });
    if (group.subtotal !== "") {
      if (ensure(16)) detailHeader();
      paintRow(DETAIL_COLS, {
        invoice: name ? `Total for ${name}` : "Total",
        balance: group.subtotal,
      }, bold, INK, TOTAL_BG, { rule: 0.8, span: "invoice", spanReserve: 240 });
    }
  }

  pages.forEach((p, i) => {
    const label = `${i + 1} / ${pages.length}`;
    const w = font.widthOfTextAtSize(label, 8);
    p.drawLine({ start: { x: MARGIN, y: 38 }, end: { x: MARGIN + INNER, y: 38 }, thickness: 0.4, color: LINE });
    drawLeft(p, font, report.title, MARGIN, 26, 8, INNER - w - 16, MUTE);
    p.drawText(label, { x: MARGIN + INNER - w, y: 26, size: 8, font, color: MUTE });
  });

  const bytes = await doc.save({ useObjectStreams: false });
  return bytes;
}

function fileResponse(body, contentType, date, ext) {
  const bytes = typeof body === "string" ? Buffer.from(body) : body;
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-disposition": arContentDisposition(date, ext),
      "content-length": String(bytes.byteLength),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function serveArAging({ token, url, format, fetchImpl = fetch, now = new Date() }) {
  try {
    const asOfRaw = new URL(url, "http://localhost").searchParams.get("as_of");
    const parsed = parseAsOf(asOfRaw, now);
    if (!parsed.ok) return jsonError(parsed.error, 400);
    if (!token || !token.access_token || !token.realm_id)
      return jsonError("QuickBooks isn't connected — open /api/qbo/connect once.", 401);
    const got = await fetchArReports(fetchImpl, {
      accessToken: token.access_token,
      realmId: token.realm_id,
      asOf: parsed.date,
    });
    if (!got.ok) return jsonError(got.error, got.status);
    const report = buildArReport(got.summary, got.detail, parsed.date);
    if (format === "csv") return fileResponse(renderArCsv(report), "text/csv; charset=utf-8", parsed.date, "csv");
    const pdf = await renderArPdf(report);
    return fileResponse(pdf, "application/pdf", parsed.date, "pdf");
  } catch {
    return jsonError("The A/R aging report could not be built.", 500);
  }
}
