import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBid, readDue, readSystems, readAddress } from '../lib/bidtalk.js';

const TODAY = '2026-09-17';   // a Thursday

test('LAW: he types the job, the app picks the templates — he never picks one', () => {
  const r = readBid('2409 Eastlake, TPO tear-off and 40 squares of standing seam, due next Friday', TODAY);
  assert.equal(r.address, '2409 Eastlake');
  assert.deepEqual(r.systems, [{ cat: 'tpo-tearoff', system: '', size: '' }, { cat: 'ss', system: '', size: '40 squares' }]);
  assert.equal(r.due, '2026-09-25');                                   // next Friday, not this one
});

test('three systems on one job pull three templates into one bid', () => {
  const s = readSystems('Rhinobond on the back, cee-lok on the canopy, and gutters');
  assert.deepEqual(s.map(x => x.cat + '/' + x.system), ['tpo-tearoff/rhino', 'ss/ceelok', 'trades/']);
});

test('TPO with a tear off is the tear-off template; TPO on its own is new construction', () => {
  assert.equal(readSystems('tpo tear off')[0].cat, 'tpo-tearoff');
  assert.equal(readSystems('new tpo roof')[0].cat, 'tpo');
});

test('due dates in his words', () => {
  assert.equal(readDue('due 9/26', TODAY), '2026-09-26');
  assert.equal(readDue('due 9/1', TODAY), '2027-09-01');               // already gone this year
  assert.equal(readDue('by tomorrow', TODAY), '2026-09-18');
  assert.equal(readDue('due friday', TODAY), '2026-09-18');
  assert.equal(readDue('due next friday', TODAY), '2026-09-25');
  assert.equal(readDue('due 2026-10-01', TODAY), '2026-10-01');
  assert.equal(readDue('no date on it', TODAY), null);
});

test('the address is the part that starts with a number', () => {
  assert.equal(readAddress('Wortham — 1721 John McCain, Colleyville, tpo'), '1721 John McCain');
  assert.equal(readAddress('5415 Westgrove due friday'), '5415 Westgrove');
});
