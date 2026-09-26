// THE 15-MINUTE LABEL CHECK (9/21/26) — built into the app on Netlify, not a Claude scheduled task.
// Every 15 minutes it looks in his five Gmail labels — SMS/BID, SMS/R, SMS/CO, SMS/JC, SMS/UC — and
// nowhere else. An empty label returns at once and costs nothing: Claude is only called when an email
// is actually sitting in one. Each email is filed one at a time (so nothing times out), up to eight a
// run; anything past that is picked up 15 minutes later.
import type { Config } from "@netlify/functions";

export default async () => {
  const base = Netlify.env.get("URL") || "https://sms-roofing-system.netlify.app";
  let filed = 0;
  for (let i = 0; i < 8; i++) {
    const r = await fetch(`${base}/w/mail/labels`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const d: any = await r.json().catch(() => ({}));
    if (!r.ok || !d.done) break;          // labels empty, Gmail not connected, or something to look at — stop
    filed++;
    if (!d.left) break;
  }
  return new Response(JSON.stringify({ filed }), { headers: { "content-type": "application/json" } });
};

export const config: Config = { schedule: "*/15 * * * *" };
