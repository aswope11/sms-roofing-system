import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as money from '../public/money.js';

const source = readFileSync(new URL('../public/schedule.js', import.meta.url), 'utf8')
  .replace(/^import .*;$/gm, '').replace('export async function', 'async function');
const base = () => ({ start: '2026-11-07', today: '2026-11-09', dates: money.weekDates('2026-11-07'),
  crew: [{ id: 1, name: 'Charlie', kind: 'employee', active: true, day_rate: 250 },
    { id: 2, name: 'Martin', kind: 'employee', active: true, day_rate: 200 }],
  jobs: [{ id: 10, tag: 'JC', address: 'Eastlake', title: 'Main contract', stage: 'ready' },
    { id: 11, tag: 'CO', address: 'Eastlake', title: 'Posts', stage: 'hold' }],
  stops: [{ id: 40, crew_id: 1, job_id: 10, work_date: '2026-11-09', day_scope: 'Run Panels · Drip Edge' }],
  crewDays: [], scopes: [], green: [], board_add: [], board_hidden: [] });
async function setup(w = base()) {
  const els = new Map(), requests = [];
  const el = id => { if (!els.has(id)) els.set(id, { innerHTML: '', textContent: '', value: '', style: {}, dataset: {},
    classList: { remove() {}, add() {} }, focus() {}, scrollIntoView() {}, querySelectorAll: () => [], addEventListener() {} }); return els.get(id); };
  const card = { dataset: { stop: '40', row: '1', day: '2026-11-09', peek: '10' }, addEventListener() {} };
  const app = el('app'); app.querySelectorAll = s => s === '.jobcard' ? [card] : [];
  const document = { getElementById: el, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {}, body: { contains: () => true } };
  const context = vm.createContext({ ...money, document, window: { addEventListener() {} },
    location: { hash: '#/schedule' }, localStorage: { getItem: () => null },
    $app: () => app, esc: x => String(x ?? '').replaceAll('<', '&lt;'), setTab() {}, crumbs() {}, toast() {}, fail: e => { throw e; },
    confirm: () => true, clearTimeout, setTimeout,
    call: async () => structuredClone(w),
    doAndProve: async (url, opts, readUrl, check) => {
      requests.push({ url, ...opts });
      assert.equal(url, '/w/board-add');
      w.board_hidden = opts.body.on ? [] : [opts.body.crew_id];
      w.board_add = opts.body.on ? [opts.body.crew_id] : [];
      assert.ok(check(w));
    } });
  vm.runInContext(source, context); await context.schedulePage();
  return { app, el, card, context, requests, w };
}
test('logged scopes render on assignment; tapping opens the saved daily entry without leaving Schedule', async () => {
  const h = await setup();
  assert.match(h.app.innerHTML, /day-scope">Run Panels · Drip Edge/);
  h.card.onclick({ target: { closest: () => null } });
  assert.equal(h.context.location.hash, '#/schedule');
  assert.equal(h.el('logBack').style.display, 'flex');
  assert.match(h.el('logTitle').textContent, /Charlie.*11\/9/);
  assert.match(h.el('lfScopes').innerHTML, /cchip on.*Run Panels/);
  assert.equal(h.requests.length, 0);
});
test('removing Martin changes this week only, preserves crew/history, and offers Add on Schedule', async () => {
  const h = await setup();
  h.el('acRemove').onclick();
  assert.match(h.el('acPick').innerHTML, /Martin/);
  h.el('acPick').value = '2'; await h.el('acRemove').onclick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.requests[0].body.week_start, '2026-11-07');
  assert.equal(h.requests[0].body.on, false);
  assert.equal(h.w.crew.find(c => c.id === 2).active, true);
  assert.equal(h.w.stops.length, 1);
  assert.match(h.el('acPick').innerHTML, /value="2">Martin/);
  h.el('acPick').value = '2'; await h.el('acAdd').onclick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.requests.at(-1).body.on, true);
});
test('an explicit weekly hide wins over existing assignments without dropping those assignments', async () => {
  const w = base(); w.board_hidden = [1];
  const h = await setup(w);
  assert.doesNotMatch(h.app.innerHTML, /data-ledger="1"/);
  assert.equal(w.stops.length, 1);
  assert.match(h.el('app').innerHTML, /value="1">Charlie/);
});
test('Active filters assigned tickets from waiting lists as well as ready list; ticket identities stay separate', async () => {
  const w = base(); w.stops.push({ id: 41, crew_id: 1, job_id: 11, work_date: '2026-11-09' });
  const h = await setup(w);
  assert.match(h.app.innerHTML, /Waiting on the customer <span class="n">0/);
  assert.match(h.app.innerHTML, /data-peek="10"/);
  assert.match(h.app.innerHTML, /data-peek="11"/);
});
