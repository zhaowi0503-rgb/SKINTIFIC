const test = require("node:test");
const assert = require("node:assert/strict");

const { buildDingTalkMessage } = require("./publish_marketplace_period_to_gcs");

test("period DingTalk summary hides validation detail but keeps metrics and report links", () => {
  const reports = Object.fromEntries(
    [
      ["us", 10528, 4644, 78.9],
      ["mexico", 817, -11, -1.3],
      ["uk", 627, 399, 175.0],
      ["japan", 52, -83, -61.5],
      ["other_countries", 1925, 918, 91.2],
    ].map(([key, current_pcs, diff_pcs, change_pct]) => [
      key,
      { current_pcs, diff_pcs, change_pct, url: `https://example.test/${key}.html` },
    ]),
  );
  const message = buildDingTalkMessage({
    report_type: "mtd",
    current_period: { start: "2026-11-01", end: "2026-11-01" },
    baseline_period: { start: "2026-10-01", end: "2026-10-01" },
    data_complete: true,
    missing_sources: [],
    validation: {
      sourceVersion: "test",
      sourceComplete: true,
      verifiedAccounts: 30,
      activeAccountCount: 30,
      warnings: ["152条售后待核对、13个隔离订单"],
      notes: ["1个账户按用户确认暂停"],
    },
    reports,
  });

  assert.equal(message.title, "Marketplace MTD销量对比");
  assert.match(message.text, /Marketplace MTD销量对比｜2026-11-01/);
  assert.match(message.text, /美国：10,528 pcs，\+4,644 \/ \+78\.9%/);
  assert.match(message.text, /\[查看日本报告\]\(https:\/\/example\.test\/japan\.html\)/);
  assert.doesNotMatch(message.text, /对比周期|数据源|售后待核对|隔离订单|SKU 匹配|用户确认暂停/);
});
