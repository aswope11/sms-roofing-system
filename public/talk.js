// TALK TO THE APP (10/4/26, his ask). The 🎤 in the top bar, on every page.
// He talks → the app picks the ticket and writes the scope his way → he sees exactly what it will do →
// only his Yes saves it, using the ticket's own buttons (save scope, tick scope, work is done), each read back.
import { esc, call, doAndProve, toast, fail } from './ui.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export function talkButton() {
  const head = document.querySelector('header');
  if (!head || document.getElementById('talkBtn')) return;
  const b = document.createElement('button');
  b.id = 'talkBtn'; b.textContent = '🎤 Talk'; b.title = 'Talk to the app';
  b.onclick = openTalk;
  head.appendChild(b);
}

function openTalk() {
  if (document.getElementById('talkPanel')) return;
  const pinned = (location.hash.match(/^#\/job\/(\d+)/) || [])[1] || null;   // on a ticket page, that ticket
  const box = document.createElement('div');
  box.id = 'talkPanel';
  box.innerHTML = `
    <div class="card talkcard">
      <div class="talkhead"><b>Talk to the app</b><button class="ghost" id="tkClose">✕</button></div>
      <textarea id="tkSaid" placeholder="Tap Start and talk — or use your keyboard's mic"></textarea>
      <div class="btnrow">
        ${SR ? '<button id="tkMic">● Start</button>' : ''}
        <button id="tkRead">Read it</button>
        <button class="ghost" id="tkClear">Clear</button>
      </div>
      <p class="help" id="tkMsg"></p>
      <div id="tkPlan"></div>
    </div>`;
  document.body.appendChild(box);
  const q = s => box.querySelector(s);
  let rec = null, plan = null, base = '';

  const stopMic = () => { if (rec) { rec.onend = null; rec.stop(); rec = null; } if (q('#tkMic')) q('#tkMic').textContent = '● Start'; };
  q('#tkClose').onclick = () => { stopMic(); box.remove(); };
  q('#tkClear').onclick = () => { q('#tkSaid').value = ''; };
  if (q('#tkMic')) q('#tkMic').onclick = () => {
    if (rec) return stopMic();
    rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US';
    base = q('#tkSaid').value ? q('#tkSaid').value.trim() + ' ' : '';
    rec.onresult = e => {
      let fin = '', mid = '';
      for (let i = 0; i < e.results.length; i++) (e.results[i].isFinal ? (fin += e.results[i][0].transcript + ' ') : (mid += e.results[i][0].transcript));
      q('#tkSaid').value = base + fin + mid;
    };
    rec.onerror = e => { q('#tkMsg').textContent = 'Mic: ' + e.error + ' — use your keyboard mic instead.'; stopMic(); };
    rec.onend = () => { if (rec) { base = q('#tkSaid').value.trim() + ' '; rec.start(); } };   // phones stop on a pause — keep going until he taps Stop
    rec.start(); q('#tkMic').textContent = '■ Stop';
  };

  q('#tkRead').onclick = async () => {
    stopMic();
    const text = q('#tkSaid').value.trim();
    if (!text) return;
    q('#tkMsg').textContent = 'Reading…'; q('#tkRead').disabled = true;
    try {
      const r = await call('/w/talk', { method: 'POST', body: { text, draft: plan ? q('#tkScope').value : '', job_id: plan?.job_id || pinned } });
      q('#tkMsg').textContent = '';
      if (!r.job_id) { q('#tkPlan').innerHTML = `<p class="err">${esc(r.question)}</p>`; return; }
      plan = r;
      q('#tkPlan').innerHTML = `
        <div class="talkplan">
          <div><b>Ticket:</b> ${esc(r.ticket)}</div>
          <label class="full"><b>Scope of work</b> <span class="mute">(fix it here or talk again)</span>
            <textarea id="tkScope" style="min-height:180px">${esc(r.scope)}</textarea></label>
          <label class="checkline"><input type="checkbox" id="tkSave" checked> Save this scope on the ticket</label>
          <label class="checkline"><input type="checkbox" id="tkCheck" ${r.check_scope ? 'checked' : ''}> Tick "Scope of work checked"</label>
          ${r.already_done ? '<div class="mute">Work is already marked done.</div>'
            : `<label class="checkline"><input type="checkbox" id="tkDone" ${r.mark_done ? 'checked' : ''}> Mark "Work is done" (moves it to Invoicing)</label>`}
          <div class="btnrow"><button id="tkYes">Yes — do it</button><button class="ghost" id="tkNo">No</button></div>
        </div>`;
      q('#tkSaid').value = '';
      q('#tkNo').onclick = () => { plan = null; q('#tkPlan').innerHTML = ''; };
      q('#tkYes').onclick = () => doIt(plan.job_id);
    } catch (e) { q('#tkMsg').textContent = e.message; fail(e); }
    finally { q('#tkRead').disabled = false; }
  };

  // His Yes. Same order as his own thumb on the ticket: words first, then the scope box, then Work is done.
  async function doIt(jobId) {
    const read = `/w/job/${jobId}`;
    const scope = q('#tkScope').value;
    q('#tkYes').disabled = true;
    const did = [];
    try {
      if (q('#tkSave').checked) { await doAndProve(`${read}/scope`, { method: 'PUT', body: { scope } }, read, b => b.job.scope === scope, 'Scope saved'); did.push('scope saved'); }
      if (q('#tkCheck').checked) { await doAndProve(`${read}/check`, { method: 'PUT', body: { which: 'scope', value: true } }, read, b => b.job.scope_ok === true, 'Scope checked'); did.push('scope checked'); }
      if (q('#tkDone') && q('#tkDone').checked) { await doAndProve(`${read}/done`, { method: 'POST', body: {} }, read, b => !!b.job.done_at, 'Work is done'); did.push('work done'); }
      toast(`Done — ${did.join(' · ')} (each read back from the server)`);
      stopMic(); box.remove();
      location.hash = `#/job/${jobId}`;
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (e) { q('#tkMsg').textContent = (did.length ? 'Got through: ' + did.join(', ') + '. Stopped at: ' : '') + e.message; fail(e); q('#tkYes').disabled = false; }
  }
}
