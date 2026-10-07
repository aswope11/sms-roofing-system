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
  // 9/28/26: Sent is no longer read — those old rows stay out of the action list.
  // Import problems shows every needs-you row, including those, plus a re-push or a label that does not match.
  const need = (d.needs_you || []).filter(r => !/^Sent invoice/.test(r.what || '') && !/^Import problem/.test(r.what || ''));
  const filed = d.filed || [];
  const held = (d.needs_you || []).filter(r => /^Sent invoice/.test(r.what || '') || /^Import problem/.test(r.what || ''));
  const problems = [
    ...held.map(r => ({ kind: 'mail', id: r.id, what: r.what, subject: r.subject, job_id: r.job_id, tag: r.tag, title: r.title, address: r.address, city: r.city })),
    ...(d.import_problems || []).map(r => ({ kind: 'log', id: r.id, what: r.reason, subject: '', job_id: r.job_id, tag: r.tag, title: r.title, address: r.address, city: r.city })),
  ];
  const jobLink = r => r.job_id ? ` <a href="#/job/${r.job_id}">${esc([r.tag, r.address].filter(Boolean).join(' - ') || 'Open the job')}</a>` : '';
  mount.innerHTML = `<details class="card bidstrip"${need.length || problems.length ? ' open' : ''}>
    <summary><b>Mail</b>${problems.length ? ` <span class="lanen">${problems.length}</span> <span class="redtxt">Import problems</span>` : ''}${need.length ? ` <span class="lanen">${need.length}</span> <span class="redtxt">need you</span>` : ''}${!need.length && !problems.length ? ' <span class="mute">nothing waiting</span>' : ''}</summary>
    <div class="btnrow" style="padding:0 14px 8px"><button class="small ghost" id="mailScan">Check the labels now</button></div>
    ${st.can_label ? '' : `<div class="row"><a href="/api/gmail/connect" class="redtxt">Reconnect Gmail once so a filed email can get the CRM imported label. The import still runs without it.</a></div>`}
    <div class="row"><span class="mute">It reads ONLY emails you put in !SMS/BID, !SMS/R, !SMS/CO, !SMS/JC or !SMS/UC — every 15 minutes on its own. Each one is matched to its property by address, a ticket with that tag is made, and the email and attachments go in that job file. Your label stays. A reply on a thread already filed goes on that same job, and it can never send.</span></div>
    ${problems.length ? `<div class="row"><b>Import problems</b></div>` + problems.map(r => `<div class="row">
      <span>${r.subject ? `<b>${esc(r.subject)}</b><br>` : ''}<span class="mute">${esc(r.what || '')}</span>${jobLink(r)}</span>
      <span class="lanebtns">${r.kind === 'mail' && r.job_id ? `<button class="lb send fileanyway" data-id="${r.id}">File it on this job</button>` : ''}${r.kind === 'mail' ? `<button class="lb dismiss-mail" data-id="${r.id}">Dismiss</button>` : ''}${r.kind === 'log' ? `<button class="lb dismiss" data-prob="${r.id}">Dismiss</button>` : ''}</span>
    </div>`).join('') : ''}
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
  mount.querySelectorAll('.dismiss').forEach(b => b.onclick = () => run(() => doAndProve(`/w/mail/problem/${b.dataset.prob}`, { method: 'POST', body: {} }, '/w/mail',
    bk => !(bk.import_problems || []).some(r => r.id === Number(b.dataset.prob)), 'Off the import problems list')));
  mount.querySelectorAll('.fileanyway').forEach(b => b.onclick = () => run(() => doAndProve(`/w/mail/${b.dataset.id}/file-anyway`, { method: 'POST', body: {} }, '/w/mail',
    bk => !(bk.needs_you || []).some(r => r.id === Number(b.dataset.id)), 'Filed on the job already on that problem')));
  mount.querySelectorAll('.dismiss-mail').forEach(b => b.onclick = () => run(() => doAndProve(`/w/mail/${b.dataset.id}/dismiss`, { method: 'POST', body: {} }, '/w/mail',
    bk => !(bk.needs_you || []).some(r => r.id === Number(b.dataset.id)), 'Off the import problems list')));
}
