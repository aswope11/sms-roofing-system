// A plain GET link to the QuickBooks PDF. Real invoices that are already in QuickBooks only.
// The address is /w/invoices/<crm id>/qb-pdf, so the browser and curl use the same cookie.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function qbPdfLink(inv) {
  if (!inv || inv.kind !== 'real' || !String(inv.qb_id || '').trim()) return '';
  const id = Number(inv.id);
  if (!Number.isInteger(id) || id <= 0) return '';
  const num = String(inv.number || '').trim();
  const label = num ? `QuickBooks PDF ${num}` : 'QuickBooks PDF';
  return `<a class="qbpdf" href="/w/invoices/${id}/qb-pdf" target="_blank" rel="noopener" draggable="false">${esc(label)}</a>`;
}
