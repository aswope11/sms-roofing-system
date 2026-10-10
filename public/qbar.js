// Opens the QuickBooks A/R aging PDF. GET /w/qb/ar-aging.pdf, same site cookie as the rest of /w.
export function qbArReportLink() {
  return `<a class="qbpdf" href="/w/qb/ar-aging.pdf" target="_blank" rel="noopener">QuickBooks AR report (PDF)</a>`;
}
