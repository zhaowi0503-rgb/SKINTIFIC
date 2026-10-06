// Shared contract for the scheduled message and its linked HTML reports.
// The Mart owns the 2026-09-25 API cutover and preserves earlier manual history.
const CUTOVER_DATE = "2026-09-25";
const SOURCE_VERSION = "order-api-mart-v1";
const MART_MAIN = "feimei.mart_marketplace.fact_channel_sales_daily";
const MART_MX = "feimei.mart_marketplace.fact_channel_sales_daily_mx";
const EXPECTED_ACCOUNTS = 31; // 2026-10-04 approved publication contract.

function reportSource(table) {
  return `(SELECT date, marketplace_product_id AS id, sku_code,
    units AS unit, revenue AS gmv,
    CAST(NULL AS STRING) AS sku_zh, sku_en, product_name, spu_en,
    brand, channel AS channels, region,
    CAST(NULL AS STRING) AS source_spreadsheet_id,
    CAST(NULL AS INT64) AS source_sheet_gid,
    CAST(NULL AS TIMESTAMP) AS synced_at
    FROM \`${table}\`
    WHERE UPPER(TRIM(COALESCE(brand, ''))) NOT IN ('', '#N/A', '#REF!', 'UNKNOWN'))`;
}

const MAIN_TABLE = reportSource(MART_MAIN);
const MX_TABLE = reportSource(MART_MX);
// Preserve the existing regional contract across historical and API dates.
// Shopify Mexico occurs in both Mart interfaces; use the main interface once.
const MX_REPORT_SOURCE = `(SELECT * FROM ${MX_TABLE}
  WHERE UPPER(TRIM(COALESCE(channels, ''))) != 'SHOPIFY'
  UNION ALL SELECT * FROM ${MAIN_TABLE}
  WHERE TRIM(region) = 'Mexico' AND UPPER(TRIM(channels)) = 'SHOPIFY')`;

function assessPublication(statusRows, exceptionRows, period, now = new Date()) {
  const warnings = [];
  const pending = exceptionRows.reduce((sum, row) => sum + Number(row.raw_quantity || 0), 0);
  const accountCount = new Set(statusRows.map(row => `${row.platform}/${row.account}`)).size;
  const inventoryComplete = statusRows.length === EXPECTED_ACCOUNTS && accountCount === EXPECTED_ACCOUNTS;
  const exactTarget = inventoryComplete && statusRows.every(row => row.target_date === period.currentEnd);
  const fresh = statusRows.length > 0 && statusRows.every(row => {
    const timestamp = /(?:Z|[+-]\d\d:\d\d)$/.test(row.checked_at)
      ? row.checked_at : `${row.checked_at.replace(' ', 'T')}Z`;
    const age = now.getTime() - new Date(timestamp).getTime();
    return Number.isFinite(age) && age >= 0 && age <= 24 * 60 * 60 * 1000;
  });
  // bq CLI JSON serializes BOOLEAN values as strings; the Python client does not.
  const isTrue = value => value === true || value === 'true';
  const incomplete = statusRows.filter(row => !isTrue(row.complete_for_target) || !isTrue(row.ready));
  const sourceComplete = exactTarget && fresh && incomplete.length === 0;
  if (!exactTarget) {
    warnings.push(`未取得报告截止日 ${period.currentEnd} 对应的正式发布完整性状态；销量为已入库公司件数，不能据有销量或最新日期判定齐全。`);
  } else if (!fresh) {
    warnings.push("正式发布完整性状态已过期，需核验采集和发布进度。");
  } else if (incomplete.length) {
    warnings.push(`以下账户采集或发布未完成：${incomplete.map(row => `${row.platform}/${row.account}`).join('、')}；销量可能包含上次保留的数据。`);
  }
  if (pending > 0) {
    warnings.push(`全部地区当前期或对比期合计 ${pending} 个原始商品数量待 SKU 匹配，尚未计入公司件数；该数量不是可直接补加的 pcs。`);
  }
  if (period.currentStart !== period.currentEnd && sourceComplete) {
    warnings.push("截止日采集已核验；本检查未逐日核验整个历史对比区间，期间销量仍可能随晚到订单回补。");
  }
  return {
    dataComplete: sourceComplete && pending === 0 && period.currentStart === period.currentEnd,
    sourceComplete,
    accountCount: statusRows.length,
    verifiedAccounts: exactTarget && fresh ? statusRows.length - incomplete.length : 0,
    pendingRawQuantity: pending,
    missingSources: incomplete.map(row => ({ scope: 'account', brand: row.account, channel: row.platform })),
    warnings,
    sourceVersion: SOURCE_VERSION,
    publicationRuns: [...new Set(statusRows.map(row => row.publication_run))],
  };
}

function apiCompleteness(query, period) {
  for (const date of [period.currentStart, period.currentEnd, period.baselineStart, period.baselineEnd]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid report date');
  }
  const statusRows = query(`SELECT account, platform, target_date, checked_at,
    complete_for_target, ready, publication_run
    FROM \`feimei.mart_marketplace.order_sales_publication_status\``);
  const exceptionRows = query(`SELECT decision, SUM(raw_quantity) AS raw_quantity
    FROM \`feimei.mart_marketplace.order_sales_accepted_exceptions\`
    WHERE decision IN ('DEFERRED', 'BLOCKED') AND (
      sales_date BETWEEN DATE '${period.currentStart}' AND DATE '${period.currentEnd}'
      OR sales_date BETWEEN DATE '${period.baselineStart}' AND DATE '${period.baselineEnd}')
    GROUP BY decision`);
  return assessPublication(statusRows, exceptionRows, period);
}

module.exports = {
  MAIN_TABLE, MX_TABLE, MX_REPORT_SOURCE, MART_MAIN, MART_MX,
  CUTOVER_DATE, SOURCE_VERSION, assessPublication, apiCompleteness,
};
