import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../lib/rules.js';

test('same address written two ways = same property', () => {
  assert.equal(R.addressKey('2409 Eastlake Hill Dr.'), R.addressKey('2409 eastlake  hill DRIVE'));
  assert.notEqual(R.addressKey('2409 Eastlake Hill Dr'), R.addressKey('2411 Eastlake Hill Dr'));
});
test('tags are exactly BID R CO UC JC', () => {
  assert.deepEqual(R.TAGS, ['BID', 'R', 'CO', 'UC', 'JC']);
});
test('files over 4 MB are cut into pieces', () => {
  assert.equal(R.chunkCount(0), 1);
  assert.equal(R.chunkCount(4 * 1024 * 1024), 1);
  assert.equal(R.chunkCount(4 * 1024 * 1024 + 1), 2);
  assert.equal(R.chunkCount(60 * 1024 * 1024), 15);
});
test('nothing saves with a missing required field', () => {
  assert.deepEqual(R.missingOnCustomer({ name: ' ' }), ['Customer name']);
  assert.deepEqual(R.missingOnProperty({ customer_id: 1, address: '' }), ['Address']);
  assert.deepEqual(R.missingOnJob({ property_id: 1, tag: 'X', title: 'a' }), ['Tag (BID, R, CO, UC or JC)']);
  assert.deepEqual(R.missingOnJob({ property_id: 1, tag: 'JC', title: 'Roof' }), []);
});
test('browser copy of the rules matches the server copy', () => {
  assert.equal(readFileSync('public/rules.js', 'utf8'), readFileSync('lib/rules.js', 'utf8'));
});
test('the app starts empty: no import, no seed data', () => {
  const sql = readFileSync('netlify/database/migrations/001_job-file/migration.sql', 'utf8');
  assert.ok(!/INSERT/i.test(sql));
});
test('nothing in the job file can be deleted from the API', () => {
  const api = readFileSync('netlify/functions/api.mts', 'utf8');
  assert.ok(!/DELETE\s+FROM/i.test(api));
});
