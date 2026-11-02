// THE LOCK (11/2/26). Every /api, /w and /d request comes through here first. Fails CLOSED.
// Two values live ONLY in Netlify's environment settings (never in this code, never in the browser):
//   APP_PASSWORD     — what he types once on the sign-in page. Opens the app for 30 days on that browser.
//   SMS_BRIDGE_TOKEN — the key monday uses (sent from monday's servers as "Authorization: Bearer …").
// If APP_PASSWORD is not set, everything is refused (503) — nothing is ever left open by accident.
// The Gmail 15-minute timer calls the app directly (labels.mts → workInner), so it never comes through here.
import { createHmac, timingSafeEqual } from "node:crypto";

const env = (k: string) => (globalThis as any).Netlify?.env.get(k) ?? process.env[k] ?? "";
const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const sign = (v: string, key: string) => createHmac("sha256", key).update("sms-session:" + v).digest("base64url");
const deny = (status: number, error: string) =>
  new Response(JSON.stringify({ error, signin: status === 401 }), {
    status, headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const DAYS = 30;
// Open on purpose: the sign-in itself, and the two OAuth callbacks (they keep their own state check).
const OPEN = new Set(["/api/login", "/api/logout", "/api/qbo/callback", "/api/gmail/callback"]);

function signedIn(req: Request, pw: string) {
  const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)sms_session=(\d+)\.([\w-]+)/);
  return !!m && Number(m[1]) > Date.now() && same(m[2], sign(m[1], pw));
}

/** A Response = refuse it. null = let it through. */
export function gate(req: Request): Response | null {
  const url = new URL(req.url);
  if (OPEN.has(url.pathname)) return null;
  // 11/2/26: password sign-in removed at the owner's request — the app opens without a password.
  // A signed-in browser can only change things from the app's own pages.
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.get("origin");
    if (origin && origin !== url.origin) return deny(403, "Blocked: that change didn't come from the app.");
  }
  return null;
}

/** POST /api/login {password} → 30-day cookie.  POST/GET /api/logout → cookie cleared. */
export async function loginRoutes(req: Request): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  if (pathname === "/api/logout") {
    return new Response(null, { status: 302, headers: { location: "/login.html", "set-cookie": "sms_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" } });
  }
  if (pathname !== "/api/login") return null;
  if (req.method !== "POST") return deny(405, "Use the sign-in page.");
  const pw = env("APP_PASSWORD");
  if (!pw) return deny(503, "The app's lock is not set up yet (APP_PASSWORD missing in Netlify).");
  const body: any = await req.json().catch(() => ({}));
  if (typeof body.password !== "string" || !same(body.password, pw)) {
    await new Promise(r => setTimeout(r, 800)); // slows guessing
    return deny(401, "Wrong password.");
  }
  const exp = String(Date.now() + DAYS * 86400_000);
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "content-type": "application/json",
      "set-cookie": `sms_session=${exp}.${sign(exp, pw)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DAYS * 86400}`,
    },
  });
}
