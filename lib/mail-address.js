const PHONE = /\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const MAPS = /google\.com\/maps|maps\.google|goo\.gl\/maps/i;
const NEAR = 140;
const clean = s => String(s || "").toLowerCase().replace(/\s+/g, " ");
function parts(addr) {
  const m = String(addr || "").trim().match(/^(\d+[a-z]?)\s+(?:[nsew]\.?\s+)?([a-z0-9]+)/i);
  return m ? { num: m[1].toLowerCase(), word: m[2].toLowerCase() } : null;
}
function hits(text, p) {
  const out = []; const re = new RegExp(`\\b${p.num}\\b`, "g"); let m;
  while ((m = re.exec(text))) { if (text.slice(m.index, m.index + 40).includes(p.word)) out.push(m.index); }
  return out;
}
function looksLikeSignature(text, at) {
  const around = text.slice(Math.max(0, at - NEAR), at + NEAR);
  return PHONE.test(around) || EMAIL.test(around) || MAPS.test(around);
}
export function jobSiteAddress({ said, subject, text, jobName }) {
  const subj = String(subject || "").replace(/^\s*((re|fwd?|fw)\s*:\s*)+/gi, "").trim();
  const fallback = String(jobName || "").trim() || subj || "From email";
  const s = String(said || "").trim(); const p = parts(s);
  if (!s || !p) return { address: s || fallback, sure: !!s && !!p, why: s ? "no street number" : "no address in the email" };
  if (hits(clean(subject), p).length) return { address: s, sure: true, why: "in the subject" };
  const body = clean(text); const spots = hits(body, p);
  if (!spots.length) return { address: fallback, sure: false, why: `"${s}" is not in the email` };
  if (spots.some(at => !looksLikeSignature(body, at))) return { address: s, sure: true, why: "in the body" };
  return { address: fallback, sure: false, why: `"${s}" is only in an email signature` };
}
