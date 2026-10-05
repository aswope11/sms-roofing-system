// TO-DO LIST (10/5/26, his ask): "attach a to do list at the top ... next to the talk button".
// The ☑ button sits beside 🎤 Talk on every page. The list is saved on the server, so every computer sees the same list.
// Every save is read back in a separate request before it says saved.
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
    items.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, done: false });
    inp.value = '';
    save();
  };
  draw();
  box.querySelector('#tdText').focus();
}

function draw() {
  const list = document.getElementById('tdList');
  if (!list) return;
  const rows = [...items.filter(x => !x.done), ...items.filter(x => x.done)];
  list.innerHTML = rows.length ? rows.map(x => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)">
      <input type="checkbox" data-done="${esc(x.id)}" ${x.done ? 'checked' : ''} style="width:20px;height:20px">
      <span style="flex:1;font-size:17px;${x.done ? 'text-decoration:line-through;opacity:.55' : ''}">${esc(x.text)}</span>
      <button class="ghost" data-del="${esc(x.id)}" title="Remove">✕</button>
    </div>`).join('') : '<p class="mute">Nothing on the list.</p>';
  list.querySelectorAll('[data-done]').forEach(el => el.onchange = () => {
    const it = items.find(x => x.id === el.dataset.done); if (it) { it.done = el.checked; save(); }
  });
  list.querySelectorAll('[data-del]').forEach(el => el.onclick = () => {
    items = items.filter(x => x.id !== el.dataset.del); save();
  });
  label();
}

async function save() {
  draw();
  const want = JSON.stringify(items.map(x => [x.id, x.text, !!x.done]));
  try {
    await doAndProve('/w/todo', { method: 'PUT', body: { items } }, '/w/todo',
      back => JSON.stringify((back || []).map(x => [x.id, x.text, !!x.done])) === want, 'To-do saved');
  } catch (e) { fail(e); }
}
