// "Tell it what the job is." One box, his words: "2409 Eastlake, TPO tear-off and 40 squares of standing seam, due next Friday".
// This reads that sentence. Templates are the app's machinery — he never picks one.
// Every rule here has a test in tests/bidtalk.test.js.

// His systems, in his words. First match wins per phrase; a bid can carry as many as he names.
export const SYSTEM_WORDS = [
  { cat: 'ss', system: 'ceelok', words: ['cee-lok', 'ceelok', 'cee lok'] },
  { cat: 'ss', system: 'teelok', words: ['tee-lok', 'teelok', 'tee lok'] },
  { cat: 'ss', system: 'other', words: ['snap-lock', 'snap lock', 'snaplock'] },
  { cat: 'ss', system: '', words: ['standing seam'] },
  { cat: 'tpo-tearoff', system: 'rhino', words: ['rhinobond', 'rhino bond'] },
  { cat: 'tpo-tearoff', system: 'ma', words: ['mechanically attached', 'mech attached', 'mech-attached', 'ma/ma'] },
  { cat: 'tpo', system: '', words: ['tpo'] },
  { cat: 'epdm', system: '', words: ['epdm', 'rubber roof'] },
  { cat: 'pvc', system: '', words: ['pvc'] },
  { cat: 'mod', system: '', words: ['modified', 'mod bit', 'mod-bit'] },
  { cat: 'trades', system: '', words: ['nail base', 'nailbase', 'gutters', 'downspouts', 'fascia', 'sheet metal', 'coping'] },
];
// What each template is called on the bid, in his words.
export const CAT_LABEL = { ss: 'Standing Seam', trades: 'Metal & Nail Base', tpo: 'TPO — New construction', 'tpo-tearoff': 'TPO — Tear off', epdm: 'EPDM', pvc: 'PVC', mod: 'Modified' };
export const SYSTEM_LABEL = { ceelok: 'Cee-Lok', teelok: 'Tee-Lok', other: 'Snap-lock', rhino: 'Rhinobond', ma: 'Mechanically attached' };
export const saySystem = s => CAT_LABEL[s.cat] ? CAT_LABEL[s.cat] + (s.system && SYSTEM_LABEL[s.system] ? ' ' + SYSTEM_LABEL[s.system] : '') : s.cat;

const TEAROFF = ['tear off', 'tear-off', 'tearoff', 're-roof', 'reroof', 'remove and replace', 'r&r'];
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// What is due, and when. "due next friday" · "due 9/26" · "by tomorrow" · "due 2026-10-01".
export function readDue(text, today) {
  const t = String(text || '').toLowerCase();
  const base = new Date(String(today).slice(0, 10) + 'T12:00:00');
  let m = t.match(/(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : base.getFullYear();
    const d = new Date(y, Number(m[1]) - 1, Number(m[2]), 12);
    if (!m[3] && d < base) d.setFullYear(y + 1);          // a date already gone means next year
    return iso(d);
  }
  if (/\btomorrow\b/.test(t)) { const d = new Date(base); d.setDate(d.getDate() + 1); return iso(d); }
  if (/\btoday\b/.test(t)) return iso(base);
  const day = DAYS.findIndex(w => new RegExp('\\b' + w + '\\b').test(t));
  if (day >= 0) {
    const d = new Date(base);
    let add = (day - d.getDay() + 7) % 7;
    if (add === 0) add = 7;                                // "friday" on a Friday means the next one
    if (/\bnext\s+\w*\s*$/.test(t.slice(0, t.indexOf(DAYS[day]))) || /\bnext\s+/.test(t.slice(Math.max(0, t.indexOf(DAYS[day]) - 6), t.indexOf(DAYS[day])))) add += 7;
    d.setDate(d.getDate() + add);
    return iso(d);
  }
  return null;
}

// Which systems he named, in the order he said them, with the size if he gave one.
export function readSystems(text) {
  const t = ' ' + String(text || '').toLowerCase() + ' ';
  const tear = TEAROFF.some(w => t.includes(w));
  const hits = [];
  for (const s of SYSTEM_WORDS) {
    for (const w of s.words) {
      const at = t.indexOf(w);
      if (at < 0) continue;
      let cat = s.cat;
      if (cat === 'tpo' && tear) cat = 'tpo-tearoff';                       // TPO + tear off = the tear-off template
      if (hits.some(h => h.cat === cat && (h.system === s.system || !s.system))) break;
      hits.push({ cat, system: s.system, at, end: at + w.length, size: '' });
      break;
    }
  }
  // sizes he said: "40 squares of standing seam", "tpo 12,000 sf". Each one goes to the system it sits next to, once.
  const sizes = [];
  const re = /(\d[\d,.]*)\s*(squares|sq\b|sf\b|square feet|lf\b)/g;
  let mm;
  while ((mm = re.exec(t))) sizes.push({ text: `${mm[1]} ${mm[2].trim()}`, at: mm.index, end: mm.index + mm[0].length, used: false });
  for (const h of hits) {
    let best = null, bestGap = 26;
    for (const s of sizes) {
      if (s.used) continue;
      const gap = s.end <= h.at ? h.at - s.end : (s.at >= h.end ? s.at - h.end : 0);
      if (gap <= bestGap) { best = s; bestGap = gap; }
    }
    if (best) { best.used = true; h.size = best.text; }
  }
  // a plainer word already covered by a named system drops out (standing seam + cee-lok = one)
  const out = hits.filter(h => h.system || !hits.some(x => x.cat === h.cat && x.system));
  return out.sort((a, b) => a.at - b.at).map(({ cat, system, size }) => ({ cat, system, size }));
}

// The address he led with: the first run of words that starts with a number, up to a comma.
export function readAddress(text) {
  const raw = String(text || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean);
  for (const piece of raw) {
    const m = piece.match(/\d{1,6}\s+[A-Za-z][^,]*/);                        // the run that starts with a street number
    if (m) return m[0].replace(/\s+(due|by)\s+.*$/i, '').trim();
  }
  return raw[0] ? raw[0].replace(/\s+(due|by)\s+.*$/i, '').trim() : '';
}

export function readBid(text, today) {
  return { address: readAddress(text), systems: readSystems(text), due: readDue(text, today), said: String(text || '').trim() };
}
