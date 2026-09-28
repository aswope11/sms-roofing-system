// MAIL — the app's own Gmail. It reads ONLY the SMS labels. It never reads Sent, never sends or replies (his call 9/28/26: "don't read every email").
// Lives as one fold on Customers: what it filed, and the few it can't place without you.
import { esc, call, doAndProve, fail, ask, toast } from './ui.js';
import { ticketName, shortDateYY } from './money.js';

export async function mailStrip(mount) {
  const [st, d] = await Promise.all([call('/api/gmail/status').catch(() => ({ connected: false })), call('/w/mail').catch(() => ({ needs_you: [], filed: [] }))]);
  if (!st.connected) {
    mount.innerHTML = `<details class="card bidstrip"><summary><b>Mail</b> <span class="mute">not connected</span></summary>
      <div class="row"><a href="/api/gmail/connect">Connect Gmail — it reads only your five SMS labels, and it can never send</a></div></details>`;
    return;
  }
  // 9/28/26: Sent is no longer read — any old "Sent invoice" misses stay in the database but never show here.
  const need = (d.needs_you || []).filter(r => !/^Sent invoice/.test(r.what || '')), filed = d.filed || [];
  mount.innerHTML = `<details class="card bidstrip"${need.length ? ' open' : ''}>
    <summary><b>Mail</b>${need.length ? ` <span class="lanen">${need.length}</span> <span class="redtxt">need you</span>` : ' <span class="mute">nothing waiting</span>'}</summary>
    <div class="btnrow" style="padding:0 14px 8px"><button class="small ghost" id="mailScan">Check the labels now</button></div>
    ${st.can_label ? '' : `<div class="row"><a href="/api/gmail/connect" class="redtxt">Reconnect Gmail once so it can take the label off an email when it is done</a></div>`}
    <div class="row"><span class="mute">It reads ONLY emails you put in !SMS/BID, !SMS/R, !SMS/CO, !SMS/JC or !SMS/UC — every 15 minutes on its own. Each one is matched to its property by address, a ticket with that tag is made, the email and attachments go in that job file, and the label comes off. Nothing else in your inbox is read.</span></div>
    ${need.map(r => `<div class="row">
      <span><b>${esc(r.subject || '(no subject)')}</b><br><span class="mute">${esc(r.from_addr)}${r.sent_at ? ' · ' + shortDateYY(String(r.sent_at).slice(0, 10)) : ''} — ${esc(r.what)}</span></span>
      <span class="lanebtns">${/^!?SMS\//.test(r.what || '') ? `<button class="lb send place" data-id="${r.id}">Who's it for?</button>` : `<button class="lb send put" data-id="${r.id}">Put it on a job</button>`}<button class="lb skip" data-id="${r.id}">Not ours</button></span>
    </div>`).join('')}
    ${filed.length ? `<div class="row"><span class="mute">Filed lately: ${filed.slice(0, 6).map(r => esc(r.what)).join(' · ')}</span></div>` : ''}
  </details>`;

  const again = () => mailStrip(mount);
  const run = async fn => { try { await fn(); again(); } catch (e) { fail(e); } };
  mount.querySelector('#mailScan').onclick = async ev => {
    ev.target.disabled = true; ev.target.textContent = 'Reading the mail…';
    try {
      // the five labels, one email at a time until they are empty
      let filed = 0, asked = 0;
      for (let i = 0; i < 20; i++) {
        const r = await call('/w/mail/labels', { method: 'POST', body: {} });
        if (!r.done) break;
        if (r.done.state === 'filed') filed++; else asked++;
        ev.target.textContent = `Reading the labels… ${filed + asked} so far`;
        if (!r.left) break;
      }
      toast(`Labels: ${filed} filed · ${asked} need you`, !asked);
      again();
    } catch (e) { fail(e); ev.target.disabled = false; ev.target.textContent = 'Check the mail now'; }
  };
  mount.querySelectorAll('.put').forEach(b => b.onclick = async () => {
    const q = ask('Which job? (type part of the address)'); if (!q) return;
    try {
      const all = await call('/w/tickets');
      const hits = all.filter(j => [j.address, j.city, j.title, j.customer_name].join(' ').toLowerCase().includes(q.toLowerCase())).slice(0, 9);
      if (!hits.length) return toast('No ticket matches that.', false);
      const pick = hits.length === 1 ? '1' : ask(hits.map((j, i) => `${i + 1}. ${ticketName(j)}`).join('\n') + '\n\nNumber:');
      const j = hits[Number(pick) - 1]; if (!j) return;
      run(() => doAndProve(`/w/mail/${b.dataset.id}/assign`, { method: 'POST', body: { job_id: j.id } }, '/w/mail',
        bk => !bk.needs_you.some(r => r.id === Number(b.dataset.id)), `Filed on ${ticketName(j)} (read back and it matches)`));
    } catch (e) { fail(e); }
  });
  // A LABELED EMAIL IT COULDN'T PLACE: he names the customer — the app makes the property from the email
  // and the ticket with the label's tag. He is never asked to go set up a property first.
  mount.querySelectorAll('.place').forEach(b => b.onclick = async () => {
    try {
      const all = await call('/api/customers');
      const q = ask('Who is it for? (type part of the customer name)\n\n' + all.map(c => c.name).join('\n')); if (q === null) return;
      const hits = all.filter(c => c.name.toLowerCase().includes(q.toLowerCase())).slice(0, 9);
      if (!hits.length) return toast('No customer by that name — add them on Customers, then answer this one.', false);
      const pick = hits.length === 1 ? '1' : ask(hits.map((c, i) => `${i + 1}. ${c.name}`).join('\n') + '\n\nNumber:');
      const c = hits[Number(pick) - 1]; if (!c) return;
      run(() => doAndProve(`/w/mail/${b.dataset.id}/place`, { method: 'POST', body: { customer_id: c.id } }, '/w/mail',
        bk => !bk.needs_you.some(r => r.id === Number(b.dataset.id)), `Made under ${c.name} and the email filed in it (read back and it matches)`));
    } catch (e) { fail(e); }
  });
  mount.querySelectorAll('.skip').forEach(b => b.onclick = () => run(() => doAndProve(`/w/mail/${b.dataset.id}/skip`, { method: 'POST', body: {} }, '/w/mail',
    bk => !bk.needs_you.some(r => r.id === Number(b.dataset.id)), 'Off the list')));
}
