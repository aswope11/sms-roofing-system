// TO-DO LIST (10/5/26, his ask): "attach a to do list at the top ... next to the talk button".
// The ☑ button sits beside 🎤 Talk on every page. The list is saved on the server, so every computer sees the same list.
// Every save is read back in a separate request before it says saved.
// Its own data-tdd / data-tdx names, so the app's page-wide delete click (data-del) never grabs these.
// JOB WITH TASKS (10/5/26, his ask "one job. click on it for 2 tasks"): tap a to-do's words to open it and see its tasks, each with its own check box.
import { esc, call, doAndProve, toast, fail } from './ui.js';

let items = [];

export function todoButton() {
  const head = document.querySelector('header');
  if (!head || document.getElementById('todoBtn')) return;
  const b = document.createElement('button');
  b.id = 'todoBtn'; b.title = 'To-do list'; b.style.whiteSpace = 'nowrap';
  b.onclick = openTodo;
  head.appendChild(b);
  label();
  call('/w/todo').then(d => { items = Array.isArray(d) ? d : []; label(); }).catch(() => {});
}

function label() {
  const b = document.getElementById('todoBtn');
  const open = items.filter(x => !x.done).length;
  if (b) b.textContent = '☑ To-do' + (open ? ` (${open})` : '');
}

async function openTodo() {
  if (document.getElementById('todoPanel')) return;
  try { const d = await call('/w/todo'); items = Array.isArray(d) ? d : []; } catch (e) { toast('Could not load the to-do list: ' + e.message, false); }
  const box = document.createElement('div');
  box.id = 'todoPanel';
  box.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:20;overflow:auto;padding:16px';
  box.innerHTML = `
    <div class="card talkcard">
      <div class="talkhead"><b>To-do list</b><button class="ghost" id="tdClose">✕</button></div>
      <form id="tdAdd" style="display:flex;gap:8px;margin-bottom:12px">
        <input id="tdText" placeholder="Add a to-do" style="flex:1;font-size:17px" autocomplete="off">
        <button>Add</button>
      </form>
      <div id="tdList"></div>
    </div>`;
  document.body.appendChild(box);
  box.querySelector('#tdClose').onclick = () => box.remove();
  box.onclick = ev => { if (ev.target === box) box.remove(); };
  box.querySelector('#tdAdd').onsubmit = ev => {
    ev.preventDefault();
    const inp = box.querySelector('#tdText');
    const text = inp.value.trim();
    if (!text) return;
    items.unshift({ id: mkId(), text, done: false, subs: [] });
    inp.value = '';
    save();
  };
  draw();
  box.querySelector('#tdText').focus();
}

const opened = new Set();   // which jobs are open to show their tasks (this screen only)
const subsOf = x => Array.isArray(x.subs) ? x.subs : [];
const mkId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function draw() {
  const list = document.getElementById('tdList');
  if (!list) return;
  const rows = [...items.filter(x => !x.done), ...items.filter(x => x.done)];
  const line = 'display:flex;align-items:center;gap:10px;padding:8px 0';
  list.innerHTML = rows.length ? rows.map(x => {
    const subs = subsOf(x), isOpen = opened.has(x.id);
    const tally = subs.length ? ` <span class="mute" style="font-size:14px">(${subs.filter(s => s.done).length}/${subs.length})</span>` : '';
    return `<div style="border-bottom:1px solid var(--line)">
      <div style="${line}">
        <input type="checkbox" data-tdd="${esc(x.id)}" ${x.done ? 'checked' : ''} style="width:20px;height:20px">
        <span data-tdo="${esc(x.id)}" title="Tap to see its tasks" style="flex:1;cursor:pointer;font-size:17px;${x.done ? 'text-decoration:line-through;opacity:.55' : ''}">${isOpen ? '▾' : '▸'} ${esc(x.text)}${tally}</span>
        <button class="ghost" data-tdx="${esc(x.id)}" title="Remove">✕</button>
      </div>
      ${isOpen ? `<div style="padding:0 0 10px 30px">
        ${subs.map(s => `<div style="${line};padding:4px 0">
          <input type="checkbox" data-tdsd="${esc(x.id)}|${esc(s.id)}" ${s.done ? 'checked' : ''} style="width:18px;height:18px">
          <span style="flex:1;font-size:16px;${s.done ? 'text-decoration:line-through;opacity:.55' : ''}">${esc(s.text)}</span>
          <button class="ghost" data-tdsx="${esc(x.id)}|${esc(s.id)}" title="Remove task">✕</button>
        </div>`).join('')}
        <form data-tdsa="${esc(x.id)}" style="display:flex;gap:8px;margin-top:6px">
          <input placeholder="Add a task" style="flex:1;font-size:16px" autocomplete="off">
          <button>Add</button>
        </form>
      </div>` : ''}
    </div>`;
  }).join('') : '<p class="mute">Nothing on the list.</p>';
  const find = id => items.find(x => x.id === id);
  list.querySelectorAll('[data-tdd]').forEach(el => el.onchange = () => {
    const it = find(el.dataset.tdd); if (it) { it.done = el.checked; save(); }
  });
  list.querySelectorAll('[data-tdx]').forEach(el => el.onclick = () => {
    items = items.filter(x => x.id !== el.dataset.tdx); save();
  });
  list.querySelectorAll('[data-tdo]').forEach(el => el.onclick = () => {
    const id = el.dataset.tdo; opened.has(id) ? opened.delete(id) : opened.add(id); draw();
  });
  list.querySelectorAll('[data-tdsd]').forEach(el => el.onchange = () => {
    const [p, sid] = el.dataset.tdsd.split('|'); const s = subsOf(find(p) || {}).find(y => y.id === sid);
    if (s) { s.done = el.checked; save(); }
  });
  list.querySelectorAll('[data-tdsx]').forEach(el => el.onclick = () => {
    const [p, sid] = el.dataset.tdsx.split('|'); const it = find(p);
    if (it) { it.subs = subsOf(it).filter(y => y.id !== sid); save(); }
  });
  list.querySelectorAll('form[data-tdsa]').forEach(f => f.onsubmit = ev => {
    ev.preventDefault();
    const it = find(f.dataset.tdsa); const text = f.querySelector('input').value.trim();
    if (!it || !text) return;
    it.subs = [...subsOf(it), { id: mkId(), text, done: false }];
    save();
  });
  label();
}

async function save() {
  draw();
  const flat = list => JSON.stringify((list || []).map(x => [x.id, x.text, !!x.done, subsOf(x).map(y => [y.id, y.text, !!y.done])]));
  const want = flat(items);
  try {
    await doAndProve('/w/todo', { method: 'PUT', body: { items } }, '/w/todo',
      back => flat(back) === want, 'To-do saved');
  } catch (e) { fail(e); }
}
