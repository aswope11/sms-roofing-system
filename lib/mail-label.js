// Whether a message already on the book should be listed as a re-push.
// Same SMS label (or the same ticket type, when the label was not recorded) is quiet.
// A different SMS label is the re-push.
export function repushReason(recorded, seenName, jobTag, seenTag) {
  const rec = String(recorded || "");
  const seen = String(seenName || "");
  if (rec && rec === seen) return "";
  if (rec && rec !== seen) return `Already imported under ${rec}. ${seen} is a different label. Not imported again.`;
  const jt = String(jobTag || "");
  const st = String(seenTag || "");
  if (st && jt && st === jt) return "";
  if (!st && seen === "!SMS/SUPPLY" && !jt) return "";
  if (st && jt && st !== jt) return `Already imported as ${jt}. ${seen} does not match that ticket. Not imported again.`;
  if (st && !jt) return `Already imported. ${seen} is not the label it was filed under. Not imported again.`;
  return "";
}
