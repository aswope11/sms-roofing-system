import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the actual UI handlers with isolated controls and mocked HTTP.
const source = readFileSync(new URL('../public/whoswho.js', import.meta.url), 'utf8')
  .replace(/^import .*;$/m, '').replaceAll('export async function', 'async function');
function setup({ asks = [job()], rows = [], failAnswer = false, failAsk = false, notSent = [] } = {}) {
  const posts = [], storage = new Map(), notices = [], line = { innerHTML: '' }, app = { innerHTML: '', prepend: n => notices.push(n) };
  let box;
  const control = () => ({ value: '', disabled: false, textContent: '' });
  const document = {
    getElementById: id => id === 'ww-line' ? line : control(),
    querySelectorAll: () => [],
    body: { appendChild: el => { box = el; } },
    createElement: () => {
      const controls = Object.fromEntries(['#ww-pick', '#ww-save', '#ww-later', '#ww-err'].map(k => [k, control()]));
      controls['#ww-save'].disabled = true;
      const suggested = { ...control(), dataset: { qb: 'suggested' } };
      return { innerHTML: '', style: {}, removed: false, controls, suggested,
        setAttribute() {}, remove() { this.removed = true; },
        querySelector: s => controls[s],
        querySelectorAll: s => s === '[data-qb]' ? [suggested] : s === 'button,select' ? [...Object.values(controls), suggested] : [] };
    }
  };
  const context = vm.createContext({ document, location: { hash: '#/' },
    sessionStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    esc: s => String(s ?? '').replaceAll('<', '&lt;'), $app: () => app, crumbs() {}, toast() {},
    call: async (url, options) => {
      if (url === '/w/whoswho/answer') {
        posts.push(options.body);
        if (failAnswer) throw new Error('QuickBooks unavailable');
        asks = asks.filter(a => a.job_id !== options.body.job_id);
        return { matches: true, row: { qb_path: 'Confirmed customer' }, notSent };
      }
      if (url === '/w/whoswho/ask') { if (failAsk) throw new Error('Network error'); return { asks }; }
      if (url === '/w/whoswho') return { rows, companies: {} };
      throw new Error(`Unexpected URL: ${url}`);
    }
  });
  vm.runInContext(source, context);
  return { context, posts, storage, line, app, notices, get box() { return box; } };
}
function job(id = 42) {
  return { job_id: id, ticket: 'Barking Hound', address: '7610 Greenville Ave', city: 'Dallas', tenant: 'Barking Hound', customer: 'Four Corners',
    choices: [{ qb_customer_id: 'suggested', label: 'Four Corners › Barking Hound' }], tree: [{ id: 'other', path: 'Other customer' }] };
}

test('dropdown waits for explicit confirmation, then sends the selected job and customer', async () => {
  const h = setup(); await h.context.whosWhoPopup();
  const b = h.box;
  assert.match(b.innerHTML, /Confirm selection/);
  assert.equal(b.controls['#ww-save'].disabled, true);
  b.controls['#ww-pick'].value = 'other'; b.controls['#ww-pick'].onchange();
  assert.equal(h.posts.length, 0);
  assert.equal(b.controls['#ww-save'].disabled, false);
  await b.controls['#ww-save'].onclick();
  assert.equal(h.posts.length, 1); assert.equal(h.posts[0].job_id, 42); assert.equal(h.posts[0].qb_customer_id, 'other');
  assert.equal(b.removed, true);
});
test('Decide later keeps the pending count and allows reopening the chosen job', async () => {
  const h = setup({ asks: [job(42), job(43)] }); await h.context.whosWhoPopup();
  h.box.controls['#ww-later'].onclick(); await h.context.whosWhoLine();
  assert.equal(h.posts.length, 0); assert.match(h.line.innerHTML, /2 jobs need an answer/);
  await h.context.whosWhoPopup(); assert.equal(h.box.removed, true);
  await h.context.whosWhoPopup({ force: true, jobId: 43 });
  await h.box.suggested.onclick(); assert.equal(h.posts[0].job_id, 43);
});
test('failed save preserves selection and displays the error for retry', async () => {
  const h = setup({ failAnswer: true }); await h.context.whosWhoPopup();
  const b = h.box; b.controls['#ww-pick'].value = 'other'; b.controls['#ww-pick'].onchange();
  await b.controls['#ww-save'].onclick();
  assert.equal(b.removed, false); assert.equal(b.controls['#ww-pick'].value, 'other');
  assert.equal(b.controls['#ww-save'].disabled, false); assert.match(b.controls['#ww-err'].textContent, /QuickBooks unavailable/);
});
test('confirmed saved rows cannot hide a stopped job, and read failure cannot report success', async () => {
  const h = setup({ rows: [{ status: 'confirmed' }] }); await h.context.whosWhoLine();
  assert.match(h.line.innerHTML, /1 job need an answer/); assert.doesNotMatch(h.line.innerHTML, /no pending/);
  const failed = setup({ failAsk: true }); await failed.context.whosWhoLine();
  assert.match(failed.line.innerHTML, /unable to check/);
});
test('Customer setup lists stopped jobs even when there are no saved map rows', async () => {
  const h = setup(); await h.context.whosWhoPage();
  assert.match(h.app.innerHTML, /Jobs needing an answer \(1\)/); assert.match(h.app.innerHTML, /data-review="42"/);
});
test('partial QuickBooks failures remain visible after the customer match saves', async () => {
  const h = setup({ notSent: ['10/27: not priced'] }); await h.context.whosWhoPopup(); await h.box.suggested.onclick();
  assert.equal(h.notices.length, 1); assert.match(h.notices[0].textContent, /Still waiting for QuickBooks: 10\/27: not priced/);
});
