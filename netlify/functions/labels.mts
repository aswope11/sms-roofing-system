// THE 15-MINUTE LABEL CHECK (9/21/26) — built into the app on Netlify, not a Claude scheduled task.
// Every 15 minutes it looks in his five Gmail labels — SMS/BID, SMS/R, SMS/CO, SMS/JC, SMS/UC — and
// nowhere else. An empty label returns at once and costs nothing: Claude is only called when an email
// is actually sitting in one. Each email is filed one at a time (so nothing times out), up to eight a
// run; anything past that is picked up 15 minutes later.
import type { Config } from "@netlify/functions";
import work from "./work.mts";

export default async () => {
  const base = Netlify.env.get("URL") || "https://sms-roofing-system.netlify.app";
  const started = Date.now();
  let filed = 0;
  let stopped = "";
  for (let i = 0; i < 8; i++) {
    if (Date.now() - started > 10000) { stopped = "10s budget"; break; }
    // 10/6/26: call the app directly, not through the web address — the site password (401) was silently stopping every run since 10/2.
    const r = await work(new Request(`${base}/w/mail/labels`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    const d: any = await r.json().catch(() => ({}));
    const done = d.done || null;
    console.log(JSON.stringify({
      mail: "label",
      ok: r.ok,
      status: r.status,
      message_id: done ? String(done.message_id || done.id || "") : "",
      state: done ? String(done.state || "") : "",
      what: done ? String(done.what || done.subject || "").slice(0, 180) : "",
      left: d.left || 0,
      error: d.error || null,
    }));
    if (!r.ok || !d.done) break;          // labels empty, Gmail not connected, or something to look at — stop
    filed++;
    if (!d.left) break;
  }
  if (stopped) console.log(JSON.stringify({ mail: "stopped", reason: stopped, filed }));
  return new Response(JSON.stringify({ filed, stopped }), { headers: { "content-type": "application/json" } });
};

export const config: Config = { schedule: "*/15 * * * *" };
