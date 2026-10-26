const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assessPublication, MAIN_TABLE, MX_REPORT_SOURCE, REPORT_SCOPES } = require('./sales_report_source');
const now = new Date('2026-10-06T11:40:00Z');
const period = { currentStart: '2026-10-05', currentEnd: '2026-10-05', baselineStart: '2026-10-04', baselineEnd: '2026-10-04' };
function statuses() {
  return Array.from({ length: 31 }, (_, i) => ({
    account: `store-${i}`, platform: 'test', target_date: '2026-10-05',
    checked_at: '2026-10-06 11:18:03', complete_for_target: true, ready: true,
    publication_state: 'UPDATED', company_units_complete_for_target: true,
    publication_run: 'test',
  }));
}
test('verified zero-sale accounts do not require positive sales rows', () => {
  assert.equal(assessPublication(statuses(), [], period, now).dataComplete, true);
  const cliRows = statuses().map(row => ({ ...row, ready: 'true', complete_for_target: 'true' }));
  assert.equal(assessPublication(cliRows, [], period, now).dataComplete, true);
});
test('paused accounts are explicit notes and excluded only from active completion', () => {
  const rows=statuses(); rows[0]={...rows[0],user_paused:'true',publication_state:'USER_PAUSED',ready:'false',complete_for_target:'false'};
  const result=assessPublication(rows,[],period,now);
  assert.equal(result.sourceComplete,true);assert.equal(result.verifiedAccounts,30);
  assert.equal(result.activeAccountCount,30);assert.equal(result.allAccountsComplete,false);
  assert.equal(result.warnings.length,0);assert.match(result.notes[0],/按用户确认暂停/);
});
test('unverified updated accounts and retained sales are not conflated', () => {
  const rows=statuses();rows[0].complete_for_target=false;
  rows[1]={...rows[1],ready:false,complete_for_target:false,publication_state:'CARRIED_FORWARD'};
  const result=assessPublication(rows,[],period,now);
  assert.equal(result.retainedAccounts,1);assert.equal(result.sourceComplete,false);
  assert.ok(result.warnings.some(s=>s.includes('1个活动账户正式销量沿用旧版')));
  assert.ok(result.warnings.some(s=>s.includes('1个活动账户已有销量发布')));
});
test('aftersales uncertainty does not masquerade as a collection failure', () => {
  const rows=statuses();rows[0].company_units_complete_for_target=false;rows[0].pending_target_aftersales_lines=2;
  const result=assessPublication(rows,[],period,now);
  assert.equal(result.sourceComplete,true);assert.equal(result.dataComplete,false);
  assert.match(result.warnings[0],/2条售后待核对/);
});
test('pending SKU quantities are not reported as complete company units', () => {
  const result = assessPublication(statuses(), [{ decision: 'DEFERRED', reason: 'mapping_pending:missing_internal_bundle', raw_quantity: '9', lines: '2' }], period, now);
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
test('scheduled report contract has five non-overlapping regional outputs', () => {
  assert.deepEqual(
    REPORT_SCOPES.map(({ key }) => key),
    ['us', 'mexico', 'uk', 'japan', 'other_countries'],
  );
  assert.deepEqual(
    REPORT_SCOPES.map(({ object }) => object),
    ['us.html', 'mexico.html', 'uk.html', 'japan.html', 'other-countries.html'],
  );
  assert.match(REPORT_SCOPES.find(({ key }) => key === 'uk').filter, /United Kingdom/);
  assert.match(REPORT_SCOPES.find(({ key }) => key === 'japan').filter, /Japan/);
  assert.match(
    REPORT_SCOPES.find(({ key }) => key === 'other_countries').filter,
    /United Kingdom.*Japan/,
  );
});

test('aftersales and unavailable Pending details are separated from mapping quantities', () => {
  const rows=statuses();rows[0].company_units_complete_for_target=false;
  const result=assessPublication(rows,[
    {decision:'DEFERRED',reason:'mapping_pending:unknown_company_sku',raw_quantity:'3',lines:'2'},
    {decision:'BLOCKED',reason:'early_aftersales:refund_quantity_exceeds_gross',raw_quantity:'8',lines:'1'},
    {decision:'DEFERRED',reason:'pending_line_details_unavailable',raw_quantity:'0',lines:'4'},
  ],period,now);
  assert.equal(result.pendingRawQuantity,3);assert.equal(result.periodAftersalesLines,1);
  assert.equal(result.pendingDetailLines,4);assert.equal(result.sourceComplete,true);
  assert.equal(result.dataComplete,false);assert.ok(result.warnings.some(s=>s.includes('4 条 Amazon Pending')));
});
