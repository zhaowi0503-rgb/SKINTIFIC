// Shared contract for the scheduled message and its linked HTML reports.
// The Mart owns the 2026-09-25 API cutover and preserves earlier manual history.
const CUTOVER_DATE = "2026-09-25";
const SOURCE_VERSION = "order-api-mart-v4-publication-states";
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

const REPORT_SCOPES = Object.freeze([
  {
    key: "us",
    title: "美国",
    file: "us",
    object: "us.html",
    table: "main",
    filter: "TRIM(region) = 'United States'",
  },
  {
    key: "mexico",
    title: "墨西哥",
    file: "mexico",
    object: "mexico.html",
    table: "mx",
    filter: "TRUE",
  },
  {
    key: "uk",
    title: "英国",
    file: "uk",
    object: "uk.html",
    table: "main",
    filter: "TRIM(region) = 'United Kingdom'",
  },
  {
    key: "japan",
    title: "日本",
    file: "japan",
    object: "japan.html",
    table: "main",
    filter: "TRIM(region) = 'Japan'",
  },
  {
    key: "other_countries",
    title: "其他国家",
    file: "other_countries",
    object: "other-countries.html",
    table: "main",
    filter: "TRIM(region) NOT IN ('United States', 'Mexico', 'United Kingdom', 'Japan')",
  },
]);

function assessPublication(statusRows, exceptionRows, period, now = new Date()) {
  const warnings = [];
  const notes = [];
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
  const paused = statusRows.filter(row => isTrue(row.user_paused) || row.publication_state === 'USER_PAUSED');
  const active = statusRows.filter(row => !paused.includes(row));
  const incomplete = active.filter(row => !isTrue(row.complete_for_target) || !isTrue(row.ready));
  const retained = active.filter(row => !isTrue(row.ready) || row.publication_state === 'CARRIED_FORWARD');
  const coveragePending = active.filter(row => isTrue(row.ready) && !isTrue(row.complete_for_target));
  const describe = rows => rows.map(row => `${row.platform}/${row.account}`).join('、');
  const sourceComplete = exactTarget && fresh && incomplete.length === 0;
  if (!exactTarget) {
    warnings.push(`未取得报告截止日 ${period.currentEnd} 对应的正式发布完整性状态；销量为已入库公司件数，不能据有销量或最新日期判定齐全。`);
  } else if (!fresh) {
    warnings.push("正式发布完整性状态已过期，需核验采集和发布进度。");
  } else {
    if (retained.length) warnings.push(`${retained.length}个活动账户正式销量沿用旧版：${describe(retained)}；本轮未更新，须核查来源或发布执行。`);
    if (coveragePending.length) warnings.push(`${coveragePending.length}个活动账户已有销量发布，但截止日 ${period.currentEnd} 完整覆盖尚未随该正式版本验收；不等同这些账户全部采集失败。`);
  }
  if (paused.length) notes.push(`${paused.length}个账户按用户确认暂停：${describe(paused)}；保留旧数据、不当零，恢复需用户确认。全${accountCount}账户覆盖仍未完整。`);
  const pendingAftersales = active.reduce((sum,row) => sum + Number(row.pending_target_aftersales_lines || 0),0);
  const quarantined = active.reduce((sum,row) => sum + Number(row.quarantined_target_orders || 0),0);
  if (pendingAftersales || quarantined) warnings.push(`截止日另有${pendingAftersales}条售后待核对、${quarantined}个隔离订单；正常订单继续发布，公司件数尚未最终核清。`);
  if (pending > 0) {
    warnings.push(`全部地区当前期或对比期合计 ${pending} 个原始商品数量待 SKU 匹配，尚未计入公司件数；该数量不是可直接补加的 pcs。`);
  }
  if (period.currentStart !== period.currentEnd && sourceComplete) {
    warnings.push("截止日采集已核验；本检查未逐日核验整个历史对比区间，期间销量仍可能随晚到订单回补。");
  }
  return {
    dataComplete: sourceComplete && pending === 0 && active.every(row => isTrue(row.company_units_complete_for_target)) && period.currentStart === period.currentEnd,
    sourceComplete,
    allAccountsComplete: sourceComplete && paused.length === 0,
    activeAccountCount: active.length,
    pausedAccountCount: paused.length,
    updatedAccounts: active.length - retained.length,
    retainedAccounts: retained.length,
    accountCount: statusRows.length,
    verifiedAccounts: exactTarget && fresh ? active.length - incomplete.length : 0,
    pendingRawQuantity: pending,
    missingSources: incomplete.map(row => ({ scope: 'account', brand: row.account, channel: row.platform })),
    warnings,
    notes,
    sourceVersion: SOURCE_VERSION,
    publicationRuns: [...new Set(statusRows.map(row => row.publication_run))],
  };
}

function apiCompleteness(query, period) {
  for (const date of [period.currentStart, period.currentEnd, period.baselineStart, period.baselineEnd]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid report date');
  }
  const statusRows = query(`SELECT account, platform, target_date, checked_at,
    complete_for_target, ready, publication_run, publication_state, reason,
    user_paused, source_ready, company_units_complete_for_target,
    pending_target_aftersales_lines, quarantined_target_orders
    FROM \`feimei.mart_marketplace.order_sales_publication_status\``);
  const exceptionRows = query(`SELECT decision, SUM(raw_quantity) AS raw_quantity
    FROM \`feimei.mart_marketplace.order_sales_accepted_exceptions\`
    WHERE decision IN ('DEFERRED', 'BLOCKED') AND (
      sales_date BETWEEN DATE '${period.currentStart}' AND DATE '${period.currentEnd}'
      OR sales_date BETWEEN DATE '${period.baselineStart}' AND DATE '${period.baselineEnd}')
    GROUP BY decision`);
  const result=assessPublication(statusRows, exceptionRows, period);
  const completion=query(`SELECT MIN(finished_at) AS first_complete_at
    FROM \`feimei.mart_marketplace.order_sales_refresh_audit\`
    WHERE JSON_VALUE(manifest_json,'$.target_date')='${period.currentEnd}'
      AND JSON_VALUE(manifest_json,'$.all_active_target_dates_complete')='true'
      AND SAFE_CAST(JSON_VALUE(manifest_json,'$.active_accounts') AS INT64)=${result.activeAccountCount}
      AND SAFE_CAST(JSON_VALUE(manifest_json,'$.paused_accounts') AS INT64)=${result.pausedAccountCount}`)[0]?.first_complete_at;
  const deadline=new Date(`${period.currentEnd}T00:00:00Z`).getTime()+36*60*60*1000;
  result.firstCompleteAt=completion || null;
  if (completion) {
    const first=new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(completion)?completion:completion.replace(' ','T')+'Z');
    result.completedBeforeDeadline=first.getTime()<=deadline;
    if (!result.completedBeforeDeadline) result.warnings.push('截止日活动范围正式更新为迟到完成，未达到次日北京时间20:00目标；首次完成时间：'+first.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+'（北京时间）。');
  } else {
    result.completedBeforeDeadline=false;
    if (Date.now()>=deadline) result.warnings.push('截止日活动范围正式发布尚无完整验收，已超过次日北京时间20:00目标。');
  }
  return result;
}

module.exports = {
  MAIN_TABLE, MX_TABLE, MX_REPORT_SOURCE, MART_MAIN, MART_MX,
  CUTOVER_DATE, SOURCE_VERSION, REPORT_SCOPES, assessPublication, apiCompleteness,
};
