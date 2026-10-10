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
    txn: find((type, title) => type === "txn_type" || title === "transaction type" || title === "type"),
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
      txn: at(cells, indexes.txn),
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

const COMPANY = "SMS Roofing & Waterproofing";
const PAGE_W = 792;
const PAGE_H = 612;
const MARGIN = 46;
const INNER = PAGE_W - MARGIN * 2;
const BOTTOM = 54;
const INK = rgb(0.12, 0.13, 0.15);
const MUTE = rgb(0.38, 0.40, 0.44);
const HAIR = rgb(0.86, 0.87, 0.90);
const HEAD_BG = rgb(0.945, 0.949, 0.957);
const HEAD_INK = rgb(0.32, 0.34, 0.38);
const TOTAL_RULE = rgb(0.20, 0.22, 0.26);

const SUMMARY_COLS = [
  { key: "customer", label: "Customer", w: 196, align: "left" },
  { key: "current", label: "Current", w: 84, align: "right", money: true },
  { key: "b30", label: "1-30", w: 84, align: "right", money: true },
  { key: "b60", label: "31-60", w: 84, align: "right", money: true },
  { key: "b90", label: "61-90", w: 84, align: "right", money: true },
  { key: "b91", label: "91 and over", w: 84, align: "right", money: true },
  { key: "total", label: "Total", w: 84, align: "right", money: true },
];

const DETAIL_COLS = [
  { key: "date", label: "Date", w: 98, align: "left" },
  { key: "txn", label: "Transaction type", w: 136, align: "left" },
  { key: "invoice", label: "Num", w: 74, align: "left" },
  { key: "due", label: "Due date", w: 100, align: "left" },
  { key: "days", label: "Past due", w: 76, align: "right" },
  { key: "balance", label: "Open balance", w: 216, align: "right", money: true },
];

// $ and thousands separators are display only. The digits stay the ones QuickBooks sent.
function formatMoney(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  let body = raw.replace(/[\u2212]/g, "-").replace(/[$,\s]/g, "");
  let sign = "";
  if (body.startsWith("(") && body.endsWith(")")) {
    sign = "(";
    body = body.slice(1, -1);
  } else if (body.startsWith("-")) {
    sign = "-";
    body = body.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(body)) return raw;
  const dot = body.indexOf(".");
  const whole = dot < 0 ? body : body.slice(0, dot);
  const frac = dot < 0 ? "" : body.slice(dot);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const shown = `${grouped}${frac}`;
  if (sign === "(") return `($${shown})`;
  if (sign === "-") return `-$${shown}`;
  return `$${shown}`;
}

function asOfHeading(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return iso ? `As of ${iso}` : "As of";
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(dt);
  return `As of ${label}`;
}

function generatedStamp(when) {
  const dt = when instanceof Date ? when : new Date(when || Date.now());
  const valid = Number.isNaN(dt.getTime()) ? new Date() : dt;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(valid);
}

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
  doc.setAuthor(COMPANY);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = [];
  let page = null;
  let y = 0;
  const balanceW = DETAIL_COLS[DETAIL_COLS.length - 1].w;

  const newPage = (continued) => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    y = PAGE_H - MARGIN;
    if (!continued) return;
    drawLeft(page, bold, COMPANY, MARGIN, y - 11, 9, INNER, INK);
    y -= 14;
    drawLeft(page, font, asOfHeading(report.asOf), MARGIN, y - 9, 8, INNER, MUTE);
    y -= 20;
  };

  const paintRow = (cols, values, rowFont, color, fill, opts = {}) => {
    const height = opts.height || 20;
    if (y - height < BOTTOM) newPage(true);
    y -= height;
    const bottom = y;
    const baseline = bottom + 6;
    if (fill) page.drawRectangle({ x: MARGIN, y: bottom, width: INNER, height, color: fill });
    if (opts.topRule) {
      page.drawLine({
        start: { x: MARGIN, y: bottom + height },
        end: { x: MARGIN + INNER, y: bottom + height },
        thickness: opts.topRule,
        color: TOTAL_RULE,
      });
    }
    const xs = colStarts(cols);
    const indent = opts.indent || 0;
    cols.forEach((col, i) => {
      const shown = col.money ? formatMoney(values[col.key] ?? "") : (values[col.key] ?? "");
      if (shown === "") return;
      const pad = 6;
      const ind = col.key === "customer" ? indent : 0;
      let maxW = col.w - pad * 2 - ind;
      if (opts.span === col.key) maxW = Math.max(40, INNER - (xs[i] - MARGIN) - (opts.spanReserve || 0) - pad);
      const size = opts.size || 9;
      if (col.align === "right") drawFit(page, rowFont, shown, xs[i] + pad, baseline, size, col.w - pad * 2, color);
      else drawLeft(page, rowFont, shown, xs[i] + pad + ind, baseline, size, maxW, color);
    });
    if (opts.rule !== false) {
      page.drawLine({
        start: { x: MARGIN, y: bottom },
        end: { x: MARGIN + INNER, y: bottom },
        thickness: opts.rule || 0.4,
        color: HAIR,
      });
    }
    return true;
  };

  const ensure = (height) => {
    if (y - height >= BOTTOM) return false;
    newPage(true);
    return true;
  };

  const headerLabels = (cols) => {
    const labels = {};
    for (const col of cols) labels[col.key] = col.label;
    return labels;
  };
  const summaryHeader = () => {
    paintRow(SUMMARY_COLS, headerLabels(SUMMARY_COLS), font, HEAD_INK, HEAD_BG, { height: 22, size: 8, rule: 0.6 });
  };
  const detailHeader = () => {
    paintRow(DETAIL_COLS, headerLabels(DETAIL_COLS), font, HEAD_INK, HEAD_BG, { height: 22, size: 8, rule: 0.6 });
  };

  newPage(false);
  drawLeft(page, font, COMPANY, MARGIN, y - 12, 11, INNER, INK);
  y -= 22;
  drawLeft(page, bold, "A/R Aging Summary", MARGIN, y - 16, 18, INNER, INK);
  y -= 26;
  drawLeft(page, font, asOfHeading(report.asOf), MARGIN, y - 11, 10, INNER, MUTE);
  y -= 28;
  summaryHeader();
  if (!report.summary.length && !report.grand) {
    ensure(20);
    paintRow(SUMMARY_COLS, { customer: "No open balances on this report." }, font, MUTE, null);
  }
  for (const row of report.summary) {
    if (ensure(20)) summaryHeader();
    const indent = Math.min(row.depth, 4) * 12;
    if (row.kind === "label") {
      paintRow(SUMMARY_COLS, { customer: row.customer }, bold, INK, null, { indent });
      continue;
    }
    const boldRow = row.kind === "subtotal";
    paintRow(SUMMARY_COLS, {
      customer: row.customer, current: row.current, b30: row.b30, b60: row.b60, b90: row.b90, b91: row.b91, total: row.total,
    }, boldRow ? bold : font, INK, null, { indent });
  }
  if (report.grand) {
    if (ensure(24)) summaryHeader();
    paintRow(SUMMARY_COLS, {
      customer: report.grand.customer, current: report.grand.current, b30: report.grand.b30, b60: report.grand.b60,
      b90: report.grand.b90, b91: report.grand.b91, total: report.grand.total,
    }, bold, INK, null, { height: 24, topRule: 1.25, rule: 0.6 });
  }

  const openDetail = () => {
    if (y - 92 < BOTTOM) newPage(true);
    else y -= 28;
    drawLeft(page, bold, "A/R Aging Detail", MARGIN, y - 14, 14, INNER, INK);
    y -= 22;
    detailHeader();
  };
  openDetail();
  if (!report.groups.length) {
    ensure(20);
    paintRow(DETAIL_COLS, { date: "No open invoices on this report." }, font, MUTE, null, { span: "date" });
  }
  report.groups.forEach((group, groupIndex) => {
    const name = group.customer || "(No customer name)";
    if (groupIndex > 0 && y - 8 >= BOTTOM) y -= 8;
    if (ensure(20 + 20)) detailHeader();
    paintRow(DETAIL_COLS, { date: name }, bold, INK, null, { span: "date", spanReserve: balanceW });
    for (const line of group.lines) {
      if (ensure(20)) {
        detailHeader();
        paintRow(DETAIL_COLS, { date: `${name} (continued)` }, bold, MUTE, null, { size: 8, span: "date", spanReserve: balanceW });
      }
      paintRow(DETAIL_COLS, {
        date: line.date, txn: line.txn, invoice: line.invoice, due: line.due, days: line.days, balance: line.balance,
      }, font, INK, null);
    }
    if (group.subtotal !== "") {
      if (ensure(22)) detailHeader();
      paintRow(DETAIL_COLS, {
        date: name ? `Total for ${name}` : "Total",
        balance: group.subtotal,
      }, bold, INK, null, { height: 22, topRule: 1, span: "date", spanReserve: balanceW });
    }
  });

  const stamp = generatedStamp(report.generatedAt);
  pages.forEach((p, i) => {
    const label = `Page ${i + 1} of ${pages.length}`;
    const w = font.widthOfTextAtSize(label, 8);
    drawLeft(p, font, stamp, MARGIN, 24, 8, INNER - w - 16, MUTE);
    p.drawText(label, { x: MARGIN + INNER - w, y: 24, size: 8, font, color: MUTE });
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
    report.generatedAt = now;
    if (format === "csv") return fileResponse(renderArCsv(report), "text/csv; charset=utf-8", parsed.date, "csv");
    const pdf = await renderArPdf(report);
    return fileResponse(pdf, "application/pdf", parsed.date, "pdf");
  } catch {
    return jsonError("The A/R aging report could not be built.", 500);
  }
}
