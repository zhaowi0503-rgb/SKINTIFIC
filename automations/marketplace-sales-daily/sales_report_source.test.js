const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assessPublication, MAIN_TABLE, MX_REPORT_SOURCE } = require('./sales_report_source');
const now = new Date('2026-10-06T11:40:00Z');
const period = { currentStart: '2026-10-05', currentEnd: '2026-10-05', baselineStart: '2026-10-04', baselineEnd: '2026-10-04' };
function statuses() {
  return Array.from({ length: 31 }, (_, i) => ({
    account: `store-${i}`, platform: 'test', target_date: '2026-10-05',
    checked_at: '2026-10-06 11:18:03', complete_for_target: true, ready: true,
    publication_run: 'test',
  }));
}
test('verified zero-sale accounts do not require positive sales rows', () => {
  assert.equal(assessPublication(statuses(), [], period, now).dataComplete, true);
  const cliRows = statuses().map(row => ({ ...row, ready: 'true', complete_for_target: 'true' }));
  assert.equal(assessPublication(cliRows, [], period, now).dataComplete, true);
});
test('pending SKU quantities are not reported as complete company units', () => {
  const result = assessPublication(statuses(), [{ raw_quantity: '9' }], period, now);
  assert.equal(result.sourceComplete, true);
  assert.equal(result.dataComplete, false);
  assert.equal(result.pendingRawQuantity, 9);
});
test('a later or stale certificate does not prove the requested date', () => {
  assert.equal(assessPublication(statuses(), [], { ...period, currentEnd: '2026-10-04' }, now).sourceComplete, false);
  assert.equal(assessPublication(statuses(), [], period, new Date('2026-10-07T12:00:00Z')).sourceComplete, false);
});
test('missing, duplicate, or retained accounts cannot pass completeness', () => {
  assert.equal(assessPublication(statuses().slice(1), [], period, now).dataComplete, false);
  const duplicate = statuses(); duplicate[1] = duplicate[0];
  assert.equal(assessPublication(duplicate, [], period, now).dataComplete, false);
  const retained = statuses(); retained[0].ready = false;
  assert.equal(assessPublication(retained, [], period, now).dataComplete, false);
});
test('a period is not fully certified by a single end-day certificate', () => {
  const result = assessPublication(statuses(), [], { ...period, currentStart: '2026-10-01' }, now);
  assert.equal(result.sourceComplete, true);
  assert.equal(result.dataComplete, false);
});
test('all report consumers use Mart, with Mexico Shopify only from main', () => {
  assert.ok(!MAIN_TABLE.includes('raw_google_sheets'));
  assert.match(MX_REPORT_SOURCE, /!= 'SHOPIFY'/);
  assert.match(MX_REPORT_SOURCE, /region\) = 'Mexico' AND UPPER\(TRIM\(channels\)\) = 'SHOPIFY'/);
});
