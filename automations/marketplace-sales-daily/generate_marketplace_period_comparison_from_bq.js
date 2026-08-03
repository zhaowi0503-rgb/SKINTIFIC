const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const BQ = process.env.BQ_BIN || "bq";
const QUARTO_BIN = [
  process.env.QUARTO_BIN,
  "/Users/skintific/private/runtime/quarto/1.10.18/bin/quarto",
  "/Applications/quarto/bin/quarto",
  "/opt/homebrew/bin/quarto",
  "/usr/local/bin/quarto",
].find((candidate) => candidate && fs.existsSync(candidate));
const QUARTO_TEMPLATE_DIR = path.join(
  ROOT_DIR,
  "automations",
  "marketplace-sales-daily",
  "quarto",
);
const PROJECT_ID = process.env.GCP_PROJECT_ID || "feimei";
const currentStart = process.argv[2] || "2026-07-01";
const currentEnd = process.argv[3] || "2026-07-05";
const baselineStart = process.argv[4] || "2026-06-01";
const baselineEnd = process.argv[5] || "2026-06-05";
const requestedScope = process.argv[6];
const MAIN_TABLE = "`feimei.raw_google_sheets.ec_sales_allin_sales_summary`";
const MX_TABLE = "`feimei.raw_google_sheets.ec_sales_mexico_allin_sales_summary`";
const SALES_COLUMNS = [
  "date",
  "id",
  "sku_code",
  "unit",
  "gmv",
  "sku_zh",
  "sku_en",
  "product_name",
  "spu_en",
  "brand",
  "channels",
  "region",
  "source_spreadsheet_id",
  "source_sheet_gid",
  "synced_at",
].join(", ");
const MX_REPORT_SOURCE = `(
  SELECT ${SALES_COLUMNS}
  FROM ${MX_TABLE}
  WHERE UPPER(TRIM(COALESCE(channels, ''))) != 'SHOPIFY'
  UNION ALL
  SELECT ${SALES_COLUMNS}
  FROM ${MAIN_TABLE}
  WHERE TRIM(region) = 'Mexico'
    AND UPPER(TRIM(COALESCE(channels, ''))) = 'SHOPIFY'
)`;

const scopes = {
  all: {
    title: "Marketplace",
    file: "all",
    table: MAIN_TABLE,
    filter: "TRUE",
  },
  us: {
    title: "美国",
    file: "us",
    table: MAIN_TABLE,
    filter: "TRIM(region) = 'United States'",
  },
  other: {
    title: "其他国家",
    file: "other_countries",
    table: MAIN_TABLE,
    filter: "TRIM(region) NOT IN ('United States', 'Mexico')",
  },
  mx: {
    title: "墨西哥",
    file: "mexico",
    table: MX_REPORT_SOURCE,
    filter: "TRUE",
  },
};

for (const value of [currentStart, currentEnd, baselineStart, baselineEnd]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(
      "Usage: node automations/marketplace-sales-daily/generate_marketplace_period_comparison_from_bq.js CURRENT_START CURRENT_END BASELINE_START BASELINE_END",
    );
  }
}

if (!requestedScope) {
  for (const regionalScope of ["us", "other", "mx"]) {
    execFileSync(
      process.execPath,
      [
        __filename,
        currentStart,
        currentEnd,
        baselineStart,
        baselineEnd,
        regionalScope,
      ],
      { stdio: "inherit" },
    );
  }
  process.exit(0);
}

const scope = requestedScope;
if (!scopes[scope]) {
  throw new Error("Scope must be one of: all, us, other, mx");
}

const scopeConfig = scopes[scope];
const TABLE = scopeConfig.table;

const out = path.join(
  ROOT_DIR,
  "generated",
  "web",
  "marketplace-sales-daily",
  `marketplace_sales_${scopeConfig.file}_${currentStart}_${currentEnd}_vs_${baselineStart}_${baselineEnd}.html`,
);

function query(sql) {
  const raw = execFileSync(
    BQ,
    [
      "query",
      `--project_id=${PROJECT_ID}`,
      "--use_legacy_sql=false",
      "--format=json",
      "--max_rows=30000",
      sql,
    ],
    { encoding: "utf8", maxBuffer: 1024 * 1024 * 96 },
  );
  return JSON.parse(raw || "[]");
}

const metricsSql = `
WITH params AS (
  SELECT
    DATE '${currentStart}' AS current_start,
    DATE '${currentEnd}' AS current_end,
    DATE '${baselineStart}' AS baseline_start,
    DATE '${baselineEnd}' AS baseline_end
),
base AS (
  SELECT
    UPPER(COALESCE(NULLIF(brand, ''), 'UNKNOWN')) AS brand,
    channels AS channel,
    COALESCE(NULLIF(TRIM(region), ''), 'UNKNOWN') AS region,
    date,
    SUM(unit) AS units
  FROM ${TABLE}, params
  WHERE date BETWEEN params.baseline_start AND params.current_end
    AND (
      date BETWEEN params.current_start AND params.current_end
      OR date BETWEEN params.baseline_start AND params.baseline_end
    )
    AND (${scopeConfig.filter})
    AND UPPER(COALESCE(NULLIF(brand, ''), 'UNKNOWN')) != '#N/A'
    AND UPPER(COALESCE(NULLIF(brand, ''), 'UNKNOWN')) != '#REF!'
  GROUP BY brand, channel, region, date
),
dims AS (
  SELECT 'overall' AS level, 'ALL' AS brand, CAST(NULL AS STRING) AS channel, CAST(NULL AS STRING) AS region
  UNION ALL
  SELECT 'brand', brand, CAST(NULL AS STRING), CAST(NULL AS STRING)
  FROM base
  GROUP BY brand
  UNION ALL
  SELECT 'channel', brand, channel, CAST(NULL AS STRING)
  FROM base
  WHERE channel IS NOT NULL
  GROUP BY brand, channel
  UNION ALL
  SELECT 'region', brand, CAST(NULL AS STRING), region
  FROM base
  GROUP BY brand, region
),
metrics AS (
  SELECT
    dims.level,
    dims.brand,
    dims.channel,
    dims.region,
    SUM(
      IF(
        base.date BETWEEN params.current_start AND params.current_end
        AND (
          dims.level = 'overall'
          OR (dims.level = 'brand' AND base.brand = dims.brand)
          OR (dims.level = 'channel' AND base.brand = dims.brand AND base.channel = dims.channel)
          OR (dims.level = 'region' AND base.brand = dims.brand AND base.region = dims.region)
        ),
        base.units,
        0
      )
    ) AS current_pcs,
    SUM(
      IF(
        base.date BETWEEN params.baseline_start AND params.baseline_end
        AND (
          dims.level = 'overall'
          OR (dims.level = 'brand' AND base.brand = dims.brand)
          OR (dims.level = 'channel' AND base.brand = dims.brand AND base.channel = dims.channel)
          OR (dims.level = 'region' AND base.brand = dims.brand AND base.region = dims.region)
        ),
        base.units,
        0
      )
    ) AS baseline_pcs,
    COUNT(DISTINCT IF(base.date BETWEEN params.current_start AND params.current_end, base.date, NULL)) AS current_days,
    COUNT(DISTINCT IF(base.date BETWEEN params.baseline_start AND params.baseline_end, base.date, NULL)) AS baseline_days
  FROM dims
  CROSS JOIN params
  LEFT JOIN base
    ON dims.level = 'overall'
    OR (dims.level = 'brand' AND base.brand = dims.brand)
    OR (dims.level = 'channel' AND base.brand = dims.brand AND base.channel = dims.channel)
    OR (dims.level = 'region' AND base.brand = dims.brand AND base.region = dims.region)
  GROUP BY dims.level, dims.brand, dims.channel, dims.region
)
SELECT
  level,
  brand,
  channel,
  region,
  CAST(current_pcs AS FLOAT64) AS current_pcs,
  CAST(baseline_pcs AS FLOAT64) AS baseline_pcs,
  CAST(current_pcs - baseline_pcs AS FLOAT64) AS diff_pcs,
  SAFE_DIVIDE(current_pcs - baseline_pcs, baseline_pcs) AS diff_rate,
  current_days,
  baseline_days
FROM metrics
WHERE current_pcs != 0 OR baseline_pcs != 0
ORDER BY
  CASE level WHEN 'overall' THEN 0 WHEN 'brand' THEN 1 ELSE 2 END,
  current_pcs DESC,
  brand,
  channel
`;

const skuSql = `
WITH params AS (
  SELECT
    DATE '${currentStart}' AS current_start,
    DATE '${currentEnd}' AS current_end,
    DATE '${baselineStart}' AS baseline_start,
    DATE '${baselineEnd}' AS baseline_end
),
normalized_source AS (
  SELECT
    date,
    brand,
    CASE
      WHEN UPPER(COALESCE(NULLIF(brand, ''), 'UNKNOWN')) = 'SKT'
       AND STARTS_WITH(UPPER(TRIM(sku_code)), 'SKINTIFIC-')
      THEN REGEXP_REPLACE(UPPER(TRIM(sku_code)), r'U$', '')
      ELSE TRIM(sku_code)
    END AS sku_code,
    product_name,
    spu_en,
    sku_zh,
    sku_en,
    unit
  FROM ${TABLE}, params
  WHERE date BETWEEN params.baseline_start AND params.current_end
    AND (
      date BETWEEN params.current_start AND params.current_end
      OR date BETWEEN params.baseline_start AND params.baseline_end
    )
    AND UPPER(COALESCE(NULLIF(brand, ''), 'UNKNOWN')) != '#N/A'
    AND UPPER(COALESCE(NULLIF(brand, ''), 'UNKNOWN')) != '#REF!'
    AND (${scopeConfig.filter})
    AND sku_code IS NOT NULL
),
source AS (
  SELECT
    UPPER(COALESCE(NULLIF(brand, ''), 'UNKNOWN')) AS brand,
    COALESCE(
      CASE WHEN UPPER(TRIM(COALESCE(product_name, ''))) NOT IN ('', '未命名', 'UNKNOWN', '#N/A', '#REF!') THEN TRIM(product_name) END,
      CASE WHEN UPPER(TRIM(COALESCE(spu_en, ''))) NOT IN ('', '未命名', 'UNKNOWN', '#N/A', '#REF!') THEN TRIM(spu_en) END,
      CASE WHEN UPPER(TRIM(COALESCE(sku_zh, ''))) NOT IN ('', '未命名', 'UNKNOWN', '#N/A', '#REF!') THEN TRIM(sku_zh) END,
      CASE WHEN UPPER(TRIM(COALESCE(sku_en, ''))) NOT IN ('', '未命名', 'UNKNOWN', '#N/A', '#REF!') THEN TRIM(sku_en) END,
      NULLIF(TRIM(sku_code), ''),
      'UNKNOWN'
    ) AS product_key,
    COALESCE(
      CASE WHEN UPPER(TRIM(COALESCE(product_name, ''))) NOT IN ('', '未命名', 'UNKNOWN', '#N/A', '#REF!') THEN TRIM(product_name) END,
      CASE WHEN UPPER(TRIM(COALESCE(sku_zh, ''))) NOT IN ('', '未命名', 'UNKNOWN', '#N/A', '#REF!') THEN TRIM(sku_zh) END,
      CASE WHEN UPPER(TRIM(COALESCE(spu_en, ''))) NOT IN ('', '未命名', 'UNKNOWN', '#N/A', '#REF!') THEN TRIM(spu_en) END,
      CASE WHEN UPPER(TRIM(COALESCE(sku_en, ''))) NOT IN ('', '未命名', 'UNKNOWN', '#N/A', '#REF!') THEN TRIM(sku_en) END,
      NULLIF(TRIM(sku_code), ''),
      'UNKNOWN'
    ) AS product_name,
    COALESCE(
      CASE WHEN UPPER(TRIM(COALESCE(spu_en, ''))) NOT IN ('', '未命名', 'UNKNOWN', '#N/A', '#REF!') THEN TRIM(spu_en) END,
      CASE WHEN UPPER(TRIM(COALESCE(product_name, ''))) NOT IN ('', '未命名', 'UNKNOWN', '#N/A', '#REF!') THEN TRIM(product_name) END,
      CASE WHEN UPPER(TRIM(COALESCE(sku_en, ''))) NOT IN ('', '未命名', 'UNKNOWN', '#N/A', '#REF!') THEN TRIM(sku_en) END,
      NULLIF(TRIM(sku_code), ''),
      'UNKNOWN'
    ) AS product_code,
    sku_code,
    COALESCE(
      CASE WHEN UPPER(TRIM(COALESCE(sku_zh, ''))) NOT IN ('', '未命名', 'UNKNOWN', '#N/A', '#REF!') THEN TRIM(sku_zh) END,
      CASE WHEN UPPER(TRIM(COALESCE(sku_en, ''))) NOT IN ('', '未命名', 'UNKNOWN', '#N/A', '#REF!') THEN TRIM(sku_en) END,
      NULLIF(TRIM(sku_code), ''),
      'UNKNOWN'
    ) AS sku_name,
    date,
    unit
  FROM normalized_source
),
product_rows AS (
  SELECT
    brand,
    product_key,
    ARRAY_AGG(product_name IGNORE NULLS ORDER BY IF(date BETWEEN params.current_start AND params.current_end, unit, 0) DESC, date DESC LIMIT 1)[OFFSET(0)] AS product_name,
    ARRAY_AGG(product_code IGNORE NULLS ORDER BY IF(date BETWEEN params.current_start AND params.current_end, unit, 0) DESC, date DESC LIMIT 1)[OFFSET(0)] AS product_code,
    SUM(IF(date BETWEEN params.current_start AND params.current_end, unit, 0)) AS current_pcs,
    SUM(IF(date BETWEEN params.baseline_start AND params.baseline_end, unit, 0)) AS baseline_pcs
  FROM source
  CROSS JOIN params
  GROUP BY brand, product_key
),
product_metrics AS (
  SELECT
    *,
    current_pcs - baseline_pcs AS diff_pcs,
    SAFE_DIVIDE(current_pcs - baseline_pcs, baseline_pcs) AS diff_rate,
    SUM(ABS(current_pcs - baseline_pcs)) OVER (PARTITION BY brand) AS brand_abs_movement,
    SUM(current_pcs - baseline_pcs) OVER (PARTITION BY brand) AS brand_net_movement
  FROM product_rows
),
product_ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (PARTITION BY brand ORDER BY current_pcs DESC, ABS(diff_pcs) DESC, product_name) AS current_rank,
    ROW_NUMBER() OVER (PARTITION BY brand ORDER BY diff_pcs DESC, current_pcs DESC, product_name) AS driver_rank,
    ROW_NUMBER() OVER (PARTITION BY brand ORDER BY diff_pcs ASC, current_pcs DESC, product_name) AS drag_rank
  FROM product_metrics
  WHERE current_pcs != 0 OR baseline_pcs != 0
),
selected_products AS (
  SELECT *
  FROM product_ranked
  WHERE current_rank <= 10
     OR driver_rank <= 10
     OR drag_rank <= 10
     OR ABS(SAFE_DIVIDE(diff_pcs, brand_abs_movement)) >= 0.01
),
sku_rows AS (
  SELECT
    brand,
    product_key,
    sku_code,
    ARRAY_AGG(sku_name IGNORE NULLS ORDER BY IF(date BETWEEN params.current_start AND params.current_end, unit, 0) DESC, date DESC LIMIT 1)[OFFSET(0)] AS sku_name,
    SUM(IF(date BETWEEN params.current_start AND params.current_end, unit, 0)) AS current_pcs,
    SUM(IF(date BETWEEN params.baseline_start AND params.baseline_end, unit, 0)) AS baseline_pcs
  FROM source
  CROSS JOIN params
  GROUP BY brand, product_key, sku_code
),
sku_metrics AS (
  SELECT
    *,
    current_pcs - baseline_pcs AS diff_pcs,
    SAFE_DIVIDE(current_pcs - baseline_pcs, baseline_pcs) AS diff_rate,
    SUM(ABS(current_pcs - baseline_pcs)) OVER (PARTITION BY brand, product_key) AS product_abs_movement,
    SUM(current_pcs - baseline_pcs) OVER (PARTITION BY brand, product_key) AS product_net_movement
  FROM sku_rows
  WHERE current_pcs != 0 OR baseline_pcs != 0
)
SELECT
  'product' AS row_type,
  brand,
  product_key,
  product_name,
  product_code,
  CAST(NULL AS STRING) AS sku_code,
  CAST(NULL AS STRING) AS sku_name,
  CAST(current_pcs AS FLOAT64) AS current_pcs,
  CAST(baseline_pcs AS FLOAT64) AS baseline_pcs,
  CAST(diff_pcs AS FLOAT64) AS diff_pcs,
  diff_rate,
  SAFE_DIVIDE(diff_pcs, brand_abs_movement) AS impact_share,
  SAFE_DIVIDE(diff_pcs, ABS(brand_net_movement)) AS net_impact_share,
  current_rank,
  driver_rank,
  drag_rank
FROM selected_products
UNION ALL
SELECT
  'sku' AS row_type,
  sku_metrics.brand,
  sku_metrics.product_key,
  CAST(NULL AS STRING) AS product_name,
  CAST(NULL AS STRING) AS product_code,
  sku_metrics.sku_code,
  sku_metrics.sku_name,
  CAST(sku_metrics.current_pcs AS FLOAT64) AS current_pcs,
  CAST(sku_metrics.baseline_pcs AS FLOAT64) AS baseline_pcs,
  CAST(sku_metrics.diff_pcs AS FLOAT64) AS diff_pcs,
  sku_metrics.diff_rate,
  SAFE_DIVIDE(sku_metrics.diff_pcs, sku_metrics.product_abs_movement) AS impact_share,
  SAFE_DIVIDE(sku_metrics.diff_pcs, ABS(sku_metrics.product_net_movement)) AS net_impact_share,
  CAST(NULL AS INT64) AS current_rank,
  CAST(NULL AS INT64) AS driver_rank,
  CAST(NULL AS INT64) AS drag_rank
FROM sku_metrics
JOIN selected_products USING (brand, product_key)
ORDER BY brand, product_key, row_type, current_pcs DESC, ABS(diff_pcs) DESC
`;

const channelTrendSql = `
WITH params AS (
  SELECT
    DATE '${currentEnd}' AS current_end,
    DATE_SUB(DATE '${currentEnd}', INTERVAL 14 DAY) AS trend_start
)
SELECT
  FORMAT_DATE('%F', date) AS day,
  UPPER(TRIM(brand)) AS brand,
  UPPER(TRIM(channels)) AS channel,
  CAST(SUM(COALESCE(unit, 0)) AS FLOAT64) AS pcs
FROM ${TABLE}, params
WHERE date BETWEEN params.trend_start AND params.current_end
  AND UPPER(COALESCE(NULLIF(TRIM(brand), ''), 'UNKNOWN')) NOT IN ('#N/A', '#REF!', 'UNKNOWN')
  AND TRIM(COALESCE(channels, '')) != ''
  AND (${scopeConfig.filter})
GROUP BY day, brand, channel
ORDER BY brand, channel, day
`;

const coverageSql = `
WITH params AS (
  SELECT
    DATE '${currentStart}' AS current_start,
    DATE '${currentEnd}' AS current_end,
    DATE '${baselineStart}' AS baseline_start,
    DATE '${baselineEnd}' AS baseline_end
)
SELECT
  UPPER(TRIM(brand)) AS brand,
  UPPER(TRIM(channels)) AS channel,
  FORMAT_DATE(
    '%F',
    MAX(IF(date BETWEEN params.current_start AND params.current_end, date, NULL))
  ) AS latest_current_date,
  COUNT(DISTINCT IF(date BETWEEN params.current_start AND params.current_end, date, NULL)) AS current_days,
  COUNT(DISTINCT IF(date BETWEEN params.baseline_start AND params.baseline_end, date, NULL)) AS baseline_days,
  SUM(IF(date BETWEEN params.current_start AND params.current_end, COALESCE(unit, 0), 0)) AS current_units,
  SUM(IF(date BETWEEN params.baseline_start AND params.baseline_end, COALESCE(unit, 0), 0)) AS baseline_units
FROM ${TABLE}, params
WHERE (
    date BETWEEN params.current_start AND params.current_end
    OR date BETWEEN params.baseline_start AND params.baseline_end
  )
  AND UPPER(COALESCE(NULLIF(TRIM(brand), ''), 'UNKNOWN')) NOT IN ('#N/A', '#REF!', 'UNKNOWN')
  AND TRIM(COALESCE(channels, '')) != ''
  AND (${scopeConfig.filter})
GROUP BY brand, channel
ORDER BY brand, channel
`;

const productChannelSql = `
WITH params AS (
  SELECT
    DATE '${currentStart}' AS current_start,
    DATE '${currentEnd}' AS current_end,
    DATE '${baselineStart}' AS baseline_start,
    DATE '${baselineEnd}' AS baseline_end
),
normalized_source AS (
  SELECT
    date,
    UPPER(COALESCE(NULLIF(brand, ''), 'UNKNOWN')) AS brand,
    UPPER(TRIM(channels)) AS channel,
    CASE
      WHEN UPPER(COALESCE(NULLIF(brand, ''), 'UNKNOWN')) = 'SKT'
       AND STARTS_WITH(UPPER(TRIM(sku_code)), 'SKINTIFIC-')
      THEN REGEXP_REPLACE(UPPER(TRIM(sku_code)), r'U$', '')
      ELSE TRIM(sku_code)
    END AS sku_code,
    COALESCE(
      CASE WHEN UPPER(TRIM(COALESCE(product_name, ''))) NOT IN ('', '未命名', 'UNKNOWN', '#N/A', '#REF!') THEN TRIM(product_name) END,
      CASE WHEN UPPER(TRIM(COALESCE(spu_en, ''))) NOT IN ('', '未命名', 'UNKNOWN', '#N/A', '#REF!') THEN TRIM(spu_en) END,
      CASE WHEN UPPER(TRIM(COALESCE(sku_zh, ''))) NOT IN ('', '未命名', 'UNKNOWN', '#N/A', '#REF!') THEN TRIM(sku_zh) END,
      CASE WHEN UPPER(TRIM(COALESCE(sku_en, ''))) NOT IN ('', '未命名', 'UNKNOWN', '#N/A', '#REF!') THEN TRIM(sku_en) END,
      NULLIF(TRIM(sku_code), ''),
      'UNKNOWN'
    ) AS product_key,
    COALESCE(unit, 0) AS unit
  FROM ${TABLE}, params
  WHERE date BETWEEN params.baseline_start AND params.current_end
    AND (
      date BETWEEN params.current_start AND params.current_end
      OR date BETWEEN params.baseline_start AND params.baseline_end
    )
    AND UPPER(COALESCE(NULLIF(TRIM(brand), ''), 'UNKNOWN')) NOT IN ('#N/A', '#REF!', 'UNKNOWN')
    AND TRIM(COALESCE(channels, '')) != ''
    AND (${scopeConfig.filter})
    AND sku_code IS NOT NULL
),
base AS (
  SELECT
    date,
    brand,
    channel,
    product_key,
    sku_code,
    SUM(unit) AS pcs
  FROM normalized_source
  GROUP BY date, brand, channel, product_key, sku_code
),
product_channel_metrics AS (
  SELECT
    brand,
    product_key,
    channel,
    CAST(SUM(IF(date BETWEEN params.current_start AND params.current_end, pcs, 0)) AS FLOAT64) AS current_pcs,
    CAST(SUM(IF(date BETWEEN params.baseline_start AND params.baseline_end, pcs, 0)) AS FLOAT64) AS baseline_pcs
  FROM base
  CROSS JOIN params
  GROUP BY brand, product_key, channel
),
sku_channel_metrics AS (
  SELECT
    brand,
    product_key,
    sku_code,
    channel,
    CAST(SUM(IF(date BETWEEN params.current_start AND params.current_end, pcs, 0)) AS FLOAT64) AS current_pcs,
    CAST(SUM(IF(date BETWEEN params.baseline_start AND params.baseline_end, pcs, 0)) AS FLOAT64) AS baseline_pcs
  FROM base
  CROSS JOIN params
  GROUP BY brand, product_key, sku_code, channel
)
SELECT
  'product' AS row_type,
  brand,
  product_key,
  CAST(NULL AS STRING) AS sku_code,
  channel,
  current_pcs,
  baseline_pcs,
  current_pcs - baseline_pcs AS diff_pcs
FROM product_channel_metrics
WHERE current_pcs != 0 OR baseline_pcs != 0
UNION ALL
SELECT
  'sku' AS row_type,
  brand,
  product_key,
  sku_code,
  channel,
  current_pcs,
  baseline_pcs,
  current_pcs - baseline_pcs AS diff_pcs
FROM sku_channel_metrics
WHERE current_pcs != 0 OR baseline_pcs != 0
ORDER BY brand, product_key, row_type, ABS(diff_pcs) DESC
`;

const metricRows = query(metricsSql).map(parseMetricRow);
const analysisRows = query(skuSql).map(parseProductRow);
const productRows = analysisRows.filter((row) => row.rowType === "product");
const skuRows = analysisRows.filter((row) => row.rowType === "sku");
const channelTrendRows = query(channelTrendSql).map((row) => ({
  day: row.day,
  brand: row.brand,
  channel: row.channel,
  pcs: num(row.pcs),
}));
const coverageRows = query(coverageSql).map((row) => ({
  brand: row.brand,
  channel: row.channel,
  latestCurrentDate: row.latest_current_date || null,
  currentDays: Number(row.current_days || 0),
  baselineDays: Number(row.baseline_days || 0),
  currentUnits: num(row.current_units),
  baselineUnits: num(row.baseline_units),
}));
const channelInsightRows = query(productChannelSql).map((row) => ({
  rowType: row.row_type,
  brand: row.brand,
  productKey: row.product_key,
  sku: row.sku_code,
  channel: row.channel,
  current: num(row.current_pcs),
  baseline: num(row.baseline_pcs),
  diff: num(row.diff_pcs),
}));
const productChannelRows = channelInsightRows.filter((row) => row.rowType === "product");
const skuChannelRows = channelInsightRows.filter((row) => row.rowType === "sku");

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseMetricRow(row) {
  const current = num(row.current_pcs);
  const baseline = num(row.baseline_pcs);
  return {
    level: row.level,
    brand: row.brand,
    channel: row.channel,
    region: row.region,
    current,
    baseline,
    diff: num(row.diff_pcs),
    rate: num(row.diff_rate),
    currentDays: Number(row.current_days || 0),
    baselineDays: Number(row.baseline_days || 0),
  };
}

function parseProductRow(row) {
  return {
    rowType: row.row_type,
    brand: row.brand,
    productKey: row.product_key,
    code: row.product_code,
    name: row.product_name,
    sku: row.sku_code,
    skuName: row.sku_name,
    current: num(row.current_pcs),
    baseline: num(row.baseline_pcs),
    diff: num(row.diff_pcs),
    rate: num(row.diff_rate),
    impact: num(row.impact_share),
    netImpact: num(row.net_impact_share),
    currentRank: Number(row.current_rank || 0),
    driverRank: Number(row.driver_rank || 0),
    dragRank: Number(row.drag_rank || 0),
  };
}

function fmtInt(value) {
  return Math.round(value).toLocaleString("en-US");
}

function fmtDelta(value, digits = 0) {
  const rounded = Number(value.toFixed(digits));
  const abs = Math.abs(rounded).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  if (rounded > 0) return `+${abs}`;
  if (rounded < 0) return `-${abs}`;
  return digits ? "0.0" : "0";
}

function fmtPct(rate, digits = 1) {
  if (!Number.isFinite(rate) || rate === 0) return rate === 0 ? "0.0%" : "-";
  return `${fmtDelta(rate * 100, digits)}%`;
}

function fmtProductPct(rate) {
  if (!Number.isFinite(rate)) return "-";
  if (rate === 0) return "0%";
  const signedPct = rate * 100;
  const pct = Math.abs(signedPct);
  if (pct >= 10000) {
    const sign = signedPct > 0 ? "+" : "-";
    const compact = (pct / 1000).toFixed(1).replace(/\.0$/, "");
    return `${sign}${compact}k%`;
  }
  return `${fmtDelta(signedPct, pct >= 1000 ? 0 : 1)}%`;
}

function fmtDiff(diff, baseline) {
  const rate = baseline ? diff / baseline : null;
  return `${fmtDelta(diff, 0)} / ${rate === null ? "-" : fmtPct(rate)}`;
}

function fmtImpact(value) {
  return `${fmtDelta(value * 100, 1)}%`;
}

function signClass(value) {
  const s = String(value || "").trim();
  if (s.startsWith("-")) return "negative";
  if (s.startsWith("+")) return "positive";
  return "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function groupBy(rows, key) {
  return rows.reduce((acc, row) => {
    const value = row[key];
    acc[value] = acc[value] || [];
    acc[value].push(row);
    return acc;
  }, {});
}

function metric(label, value, sub) {
  return `<div class="metric ${signClass(value)}"><span>${label}</span><strong>${escapeHtml(value)}</strong><em>${escapeHtml(sub)}</em></div>`;
}

function conclusionBlock(title, items) {
  return `<section class="conclusion"><h2>${escapeHtml(title)}</h2><ol>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol></section>`;
}

function warningBlock(items) {
  if (!items.length) return "";
  return `<section class="warning"><h2>数据完整性提醒</h2><ol>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol></section>`;
}

function simpleTable(headers, rows) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell, i) => `<td class="${i >= 3 ? signClass(cell) : ""}">${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;
}

const CHANNEL_STYLES = Object.freeze({
  AMAZON: { color: "#2463a6", dash: "" },
  TK: { color: "#07825d", dash: "8 5" },
  SHOPIFY: { color: "#c55345", dash: "2 4" },
  "MERCADO LIBRE": { color: "#8a5c12", dash: "10 4 2 4" },
});
const FALLBACK_CHANNEL_COLORS = ["#7156a5", "#2f7f8c", "#a15b7d", "#66713d"];

function channelStyle(channel) {
  if (CHANNEL_STYLES[channel]) return CHANNEL_STYLES[channel];
  const hash = [...channel].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return { color: FALLBACK_CHANNEL_COLORS[hash % FALLBACK_CHANNEL_COLORS.length], dash: "6 4" };
}

function niceAxisStep(maxValue) {
  if (maxValue <= 0) return 1;
  const rough = maxValue / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}

function compactNumber(value) {
  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1).replace(/\.0$/, "")}k`;
  }
  return String(Math.round(value));
}

function dateAdd(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function channelTrendChart(brandName, rows) {
  if (!rows.length) return "";
  const dates = Array.from({ length: 15 }, (_, index) => dateAdd(currentEnd, index - 14));
  const dateIndex = new Map(dates.map((date, index) => [date, index]));
  const grouped = groupBy(rows, "channel");
  const preferredOrder = ["AMAZON", "TK", "SHOPIFY", "MERCADO LIBRE"];
  const channels = Object.keys(grouped).sort((a, b) => {
    const ai = preferredOrder.indexOf(a);
    const bi = preferredOrder.indexOf(b);
    if (ai >= 0 || bi >= 0) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    return a.localeCompare(b);
  });
  const series = channels.map((channel) => {
    const values = Array(15).fill(0);
    for (const row of grouped[channel]) {
      const index = dateIndex.get(row.day);
      if (index !== undefined) values[index] = row.pcs;
    }
    return { channel, values, style: channelStyle(channel) };
  });
  const maxValue = Math.max(0, ...series.flatMap(({ values }) => values));
  const step = niceAxisStep(maxValue);
  const yMax = step * 4;
  const width = 1120;
  const height = 244;
  const margin = { top: 18, right: 22, bottom: 32, left: 52 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const x = (index) => margin.left + (index / 14) * plotWidth;
  const y = (value) => margin.top + plotHeight - (value / yMax) * plotHeight;
  const yGrid = Array.from({ length: 5 }, (_, index) => {
    const value = step * index;
    const yy = y(value);
    return `<g><line x1="${margin.left}" y1="${yy}" x2="${width - margin.right}" y2="${yy}" class="trend-grid-line"/><text x="${margin.left - 10}" y="${yy + 4}" text-anchor="end" class="trend-axis-label">${compactNumber(value)}</text></g>`;
  }).join("");
  const xLabelIndexes = [0, 3, 6, 9, 12, 14];
  const xLabels = xLabelIndexes
    .map(
      (index) =>
        `<text x="${x(index)}" y="${height - 8}" text-anchor="middle" class="trend-axis-label">${dates[index].slice(5)}</text>`,
    )
    .join("");
  const paths = series
    .map(({ channel, values, style }) => {
      const pathData = values
        .map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`)
        .join(" ");
      const points = values
        .map(
          (value, index) =>
            `<circle cx="${x(index).toFixed(1)}" cy="${y(value).toFixed(1)}" r="2.5" fill="${style.color}" class="trend-point"><title>${escapeHtml(`${brandName} / ${channel} / ${dates[index]}：${fmtInt(value)} pcs`)}</title></circle>`,
        )
        .join("");
      return `<path d="${pathData}" fill="none" stroke="${style.color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"${style.dash ? ` stroke-dasharray="${style.dash}"` : ""} vector-effect="non-scaling-stroke"/>${points}`;
    })
    .join("");
  const legend = series
    .map(({ channel, values, style }) => {
      const current = values[values.length - 1];
      return `<span class="trend-legend-item"><i style="--series-color:${style.color}"></i><b>${escapeHtml(channel)}</b><strong>${fmtInt(current)}</strong></span>`;
    })
    .join("");
  return `<section class="channel-trend-section">
    <div class="trend-section-head">
      <div><h3>近15天渠道销量趋势</h3><p>${escapeHtml(dates[0])} 至 ${escapeHtml(currentEnd)} · 日销量 pcs</p></div>
      <div class="trend-legend">${legend}</div>
    </div>
    <div class="trend-plot" role="img" aria-label="${escapeHtml(`${brandName}近15天分渠道销量趋势图`)}">
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">${yGrid}${xLabels}${paths}</svg>
    </div>
  </section>`;
}

function productChannelOverview(channels, extraClass = "") {
  const visible = [...channels]
    .filter((channel) => Math.abs(channel.diff) >= 0.05)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    .slice(0, 3);
  if (!visible.length) {
    return `<div class="product-channel-overview ${extraClass}"><span class="channel-overview-label">渠道影响</span><span class="channel-overview-empty">暂无明显渠道波动</span></div>`;
  }
  const totalMovement = visible.reduce((sum, channel) => sum + Math.abs(channel.diff), 0);
  const items = visible
    .map((channel) => {
      const share = totalMovement ? (Math.abs(channel.diff) / totalMovement) * 100 : 0;
      const direction = channel.diff > 0 ? "positive" : channel.diff < 0 ? "negative" : "";
      return `<span class="channel-contribution ${direction}" title="${escapeHtml(`${channel.channel}：本期 ${fmtInt(channel.current)} pcs，对比期 ${fmtInt(channel.baseline)} pcs`)}">
        <span><b>${escapeHtml(channel.channel)}</b><strong>${fmtDelta(channel.diff)}</strong><em>${share.toFixed(0)}%</em></span>
        <i><u style="width:${Math.max(4, share).toFixed(0)}%"></u></i>
      </span>`;
    })
    .join("");
  return `<div class="product-channel-overview ${extraClass}"><span class="channel-overview-label">渠道影响</span><div class="channel-contribution-list">${items}</div></div>`;
}

function productMetricRow(item, detail = false) {
  const code = detail ? item.sku : item.code;
  const name = detail ? item.skuName : item.name;
  return `<div class="sku-row${detail ? " sku-detail-row" : ""}">
    <div class="sku-main" title="${escapeHtml(`${code || "-"} / ${name || "未命名"}`)}"><b>${escapeHtml(code || "-")}</b><span>${escapeHtml(name || "未命名")}</span></div>
    <div class="sku-metrics">
      <div><small>本期</small><strong>${fmtInt(item.current)}</strong></div>
      <div><small>上期</small><strong>${fmtInt(item.baseline)}</strong></div>
      <div class="${signClass(fmtDelta(item.diff))}"><small>增减</small><strong>${fmtDelta(item.diff)}</strong></div>
      <div class="${signClass(fmtProductPct(item.rate))}"><small>增幅</small><strong>${fmtProductPct(item.rate)}</strong></div>
      <div class="${signClass(fmtImpact(item.impact))}"><small>${detail ? "SKU影响" : "影响"}</small><strong>${fmtImpact(item.impact)}</strong></div>
    </div>
  </div>`;
}

function productTable(rows) {
  if (!rows.length) return `<p class="empty">无达到阈值的产品。</p>`;
  return `<div class="product-table-head">
    <span>产品</span><span>本期</span><span>上期</span><span>增减</span><span>增幅</span><span>影响</span>
  </div><div class="sku-list">${rows.map((item) => {
    const searchText = [
      item.code,
      item.name,
      ...item.skus.flatMap((sku) => [sku.sku, sku.skuName]),
    ]
      .filter(Boolean)
      .join(" ");
    return `
    <div class="product-item" data-search="${escapeHtml(searchText)}">
      ${productMetricRow(item)}
      ${productChannelOverview(item.channels || [])}
      <details class="sku-details">
        <summary>SKU 明细 · ${item.skus.length} 个</summary>
        <div class="sku-detail-table">
          <div class="sku-detail-head"><span>SKU / 产品</span><span>本期</span><span>上期</span><span>增减</span><span>增幅</span><span>影响</span></div>
          <div class="sku-detail-list">${item.skus
            .map(
              (sku) => `<div class="sku-detail-entry">
                ${productMetricRow(sku, true)}
                ${productChannelOverview(sku.channels || [], "sku-channel-overview")}
              </div>`,
            )
            .join("")}</div>
        </div>
      </details>
    </div>`;
  }).join("")}</div>`;
}

function dateLabel(start, end) {
  return `${start.slice(5).replace("-", "/")}-${end.slice(5).replace("-", "/")}`;
}

function zhPeriod(start, end) {
  const startMonth = Number(start.slice(5, 7));
  const startDay = Number(start.slice(8, 10));
  const endMonth = Number(end.slice(5, 7));
  const endDay = Number(end.slice(8, 10));
  return startMonth === endMonth
    ? `${startMonth}月${startDay}-${endDay}日`
    : `${startMonth}月${startDay}日-${endMonth}月${endDay}日`;
}

function inclusiveDays(start, end) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
}

const currentPeriodLabel = zhPeriod(currentStart, currentEnd);
const baselinePeriodLabel = zhPeriod(baselineStart, baselineEnd);
const currentDays = inclusiveDays(currentStart, currentEnd);
const isMonthEnd = (dateString) => {
  const value = new Date(`${dateString}T00:00:00Z`);
  const nextDay = new Date(value.getTime() + 86400000);
  return nextDay.getUTCMonth() !== value.getUTCMonth();
};
const isFullMonthComparison =
  currentStart.slice(8) === "01" &&
  baselineStart.slice(8) === "01" &&
  isMonthEnd(currentEnd) &&
  isMonthEnd(baselineEnd);
const isMonthlySamePeriod =
  currentStart.slice(8) === "01" &&
  baselineStart.slice(8) === "01" &&
  currentEnd.slice(8) === baselineEnd.slice(8) &&
  currentDays > 7;
const reportTypeLabel =
  currentDays === 7
    ? "销量周报"
    : isFullMonthComparison
      ? "销量月度对比报告"
      : isMonthlySamePeriod
        ? "销量月度同期报告"
        : "销量周期报告";
const attentionTitle = currentDays === 7 ? "本周需关注" : "本期需关注";
const movementLabel = currentDays === 7 ? "周环比" : isFullMonthComparison ? "月环比" : "同期变化";

const overall = metricRows.find((row) => row.level === "overall");
const brandMetrics = metricRows
  .filter((row) => row.level === "brand")
  .sort((a, b) => b.current - a.current);
const channelMetrics = metricRows.filter((row) => row.level === "channel");
const regionMetrics = metricRows
  .filter((row) => row.level === "region")
  .sort((a, b) => b.current - a.current);
const incompleteCoverageRows = coverageRows.filter(
  (row) =>
    row.baselineDays > 0 &&
    row.latestCurrentDate !== currentEnd &&
    (row.currentUnits > 0 || row.baselineUnits >= 10),
);
const incompleteChannelKeys = new Set(
  incompleteCoverageRows.map((row) => `${row.brand}\u0000${row.channel}`),
);
const byBrandProduct = groupBy(productRows, "brand");
const skuByProduct = skuRows.reduce((acc, row) => {
  const key = `${row.brand}\u0000${row.productKey}`;
  acc[key] = acc[key] || [];
  acc[key].push(row);
  return acc;
}, {});

function channelsForProduct(brand, productKey) {
  return productChannelRows.filter(
    (row) => row.brand === brand && row.productKey === productKey,
  );
}

function channelsForSku(brand, productKey, sku) {
  return skuChannelRows.filter(
    (row) =>
      row.brand === brand &&
      row.productKey === productKey &&
      row.sku === sku,
  );
}

function withSkuDetails(product) {
  const key = `${product.brand}\u0000${product.productKey}`;
  return {
    ...product,
    channels: channelsForProduct(product.brand, product.productKey),
    skus: [...(skuByProduct[key] || [])]
      .sort((a, b) => b.current - a.current || Math.abs(b.diff) - Math.abs(a.diff))
      .map((sku) => ({
        ...sku,
        channels: channelsForSku(sku.brand, sku.productKey, sku.sku),
      })),
  };
}

function buildOverallConclusion() {
  const sortedBrands = [...brandMetrics].sort((a, b) => b.diff - a.diff);
  const best = sortedBrands[0];
  const worst = sortedBrands[sortedBrands.length - 1];
  const sortedChannels = [...channelMetrics].sort((a, b) => b.diff - a.diff);
  const channelDrivers = sortedChannels
    .filter((row) => row.diff > 0)
    .slice(0, 3)
    .map((row) => `${row.brand}/${row.channel} ${fmtDelta(row.diff)} pcs`)
    .join("，");
  return [
    `${currentPeriodLabel}总销量 ${fmtInt(overall.current)} pcs，较${baselinePeriodLabel} ${fmtDelta(overall.diff)} pcs（${fmtPct(overall.rate)}）。`,
    `品牌层面，${best.brand} 是最大增长贡献（${fmtDelta(best.diff)} pcs），${worst.brand} 增长最弱或拖累最大（${fmtDelta(worst.diff)} pcs）。`,
    `渠道层面主要增长来自 ${channelDrivers || "暂无正增长渠道"}；产品影响占比按品牌内 SPU / PRODUCT NAME 绝对波动计算。`,
  ];
}

function buildBrandConclusion(brand, channels, growth, drag) {
  const topChannel = [...channels].sort((a, b) => b.raw.diff - a.raw.diff)[0];
  const lowChannel = [...channels].sort((a, b) => a.raw.diff - b.raw.diff)[0];
  const items = [
    `${brand.name} ${currentPeriodLabel} ${fmtInt(brand.raw.current)} pcs，较${baselinePeriodLabel} ${fmtDelta(brand.raw.diff)} pcs（${fmtPct(brand.raw.rate)}）。`,
  ];
  if (topChannel && lowChannel) {
    items.push(
      `渠道上，${topChannel.name} 是最大增长渠道（${fmtDelta(topChannel.raw.diff)} pcs），${lowChannel.name} 是增长最弱或拖累渠道（${fmtDelta(lowChannel.raw.diff)} pcs）。`,
    );
  }
  if (growth[0] || drag[0]) {
    const growthText = growth[0]
      ? `${growth[0].name}（${growth[0].code}，${fmtDelta(growth[0].diff)} pcs，影响 ${fmtImpact(growth[0].impact)}）`
      : "暂无显著增长产品";
    const dragText = drag[0]
      ? `${drag[0].name}（${drag[0].code}，${fmtDelta(drag[0].diff)} pcs，影响 ${fmtImpact(drag[0].impact)}）`
      : "暂无显著拖累产品";
    items.push(`产品上，主要增长来自 ${growthText}；主要拖累来自 ${dragText}。`);
  }
  return items;
}

const brands = brandMetrics.map((raw) => {
  const brandProducts = byBrandProduct[raw.brand] || [];
  const top10Raw = [...brandProducts].sort((a, b) => b.current - a.current).slice(0, 10);
  const growthRaw = brandProducts
    .filter((product) => product.diff > 0 && Math.abs(product.impact) >= 0.01)
    .sort((a, b) => b.diff - a.diff)
    .slice(0, 12);
  const dragRaw = brandProducts
    .filter((product) => product.diff < 0 && Math.abs(product.impact) >= 0.01)
    .sort((a, b) => a.diff - b.diff)
    .slice(0, 12);
  const trendRaw = brandProducts
    .filter((product) => product.diff > 0 && product.current >= 20 && product.baseline >= 5 && product.rate >= 0.5)
    .sort((a, b) => b.rate - a.rate || b.diff - a.diff)
    .slice(0, 10);
  const channelsRaw = channelMetrics
    .filter((row) => row.brand === raw.brand)
    .sort((a, b) => b.current - a.current)
    .map((row) => ({
      name: row.channel,
      raw: row,
      cells: [
        incompleteChannelKeys.has(`${row.brand}\u0000${String(row.channel).toUpperCase()}`)
          ? `${row.channel}（数据不完整）`
          : row.channel,
        fmtInt(row.current),
        fmtInt(row.baseline),
        fmtDiff(row.diff, row.baseline),
      ],
    }));
  return {
    name: raw.brand,
    raw,
    channelsRaw,
    channelTrend: channelTrendRows.filter((row) => row.brand === raw.brand),
    countries: regionMetrics.filter((row) => row.brand === raw.brand),
    conclusions: buildBrandConclusion({ name: raw.brand, raw }, channelsRaw, growthRaw, dragRaw),
    channels: channelsRaw.map((row) => row.cells),
    top10: top10Raw.map(withSkuDetails),
    growth: growthRaw.map(withSkuDetails),
    drag: dragRaw.map(withSkuDetails),
    trend: trendRaw.map(withSkuDetails),
  };
});

const warnings = incompleteCoverageRows.map((row) => {
  const latest = row.latestCurrentDate || "无当前期记录";
  return `${row.brand} / ${row.channel} 当前期数据仅到 ${latest}，未覆盖周期截止日 ${currentEnd}；该渠道及相关汇总可能偏低。`;
});

function countrySection(rows) {
  if (scope !== "other" || !rows.length) return "";
  return `<section class="brand-country-section">
    <div class="country-section-head">
      <div><h3>国家表现</h3><p>仅统计当前品牌，比较本期与前一周期销量变化。</p></div>
      <strong>${rows.length} 个国家</strong>
    </div>
    ${simpleTable(
      ["国家", `${currentPeriodLabel} pcs`, `${baselinePeriodLabel} pcs`, "增减 / 增幅"],
      rows.map((row) => [
        row.region,
        fmtInt(row.current),
        fmtInt(row.baseline),
        fmtDiff(row.diff, row.baseline),
      ]),
    )}
  </section>`;
}

function brandCard(brand) {
  return `<section class="brand-card" id="brand-${escapeHtml(brand.name.toLowerCase())}" data-brand="${escapeHtml(brand.name)}">
    <div class="brand-head"><h2>${escapeHtml(brand.name)}</h2><strong>${fmtInt(brand.raw.current)} pcs</strong></div>
    <div class="metrics">
      ${metric(currentPeriodLabel, fmtInt(brand.raw.current), "本期 pcs")}
      ${metric(baselinePeriodLabel, fmtInt(brand.raw.baseline), "对比期 pcs")}
      ${metric("增减", fmtDiff(brand.raw.diff, brand.raw.baseline), "本期 - 对比期")}
      ${metric("日均变化", fmtDelta(brand.raw.diff / currentDays, 1), `${currentDays}日平均`)}
    </div>
    ${conclusionBlock("分析结论", brand.conclusions)}
    <div data-report-view="channel">
      ${channelTrendChart(brand.name, brand.channelTrend)}
      <h3>渠道表现</h3>
      ${simpleTable(["渠道", `${currentPeriodLabel} pcs`, `${baselinePeriodLabel} pcs`, "增减 / 增幅"], brand.channels)}
      ${countrySection(brand.countries)}
    </div>
    <div class="product-analysis-grid" data-report-view="product">
      <section class="analysis-column top-column">
        <h3>TOP10 产品</h3>
        ${productTable(brand.top10)}
      </section>
      <section class="analysis-column growth-column">
        <h3>增长驱动产品</h3>
        ${productTable(brand.growth)}
      </section>
      <section class="analysis-column drag-column">
        <h3>拖累产品</h3>
        ${productTable(brand.drag)}
      </section>
    </div>
  </section>`;
}

function attentionPanel() {
  const allChannels = brands
    .flatMap((brand) =>
      brand.channelsRaw.map((channel) => ({
        brand: brand.name,
        name: channel.name,
        raw: channel.raw,
      })),
    )
    .sort((a, b) => a.raw.diff - b.raw.diff);
  const allDragProducts = brands
    .flatMap((brand) => brand.drag.map((product) => ({ brand: brand.name, ...product })))
    .sort((a, b) => a.diff - b.diff);
  const weakestBrand = [...brands].sort((a, b) => a.raw.diff - b.raw.diff)[0];
  const weakestChannel = allChannels[0];
  const weakestProduct = allDragProducts[0];
  const warningLabel = warnings.length ? `${warnings.length} 个渠道数据不完整` : "数据完整";

  return `<section class="attention-strip" aria-labelledby="attention-title">
    <div class="attention-head">
      <h2 id="attention-title">${attentionTitle}</h2>
      <p>按${movementLabel}拖累优先排序</p>
    </div>
    <div class="attention-item">
      <span>数据状态</span>
      <strong>${escapeHtml(warningLabel)}</strong>
      <small>${warnings.length ? "相关汇总可能偏低" : "已覆盖周期截止日"}</small>
    </div>
    <div class="attention-item">
      <span>主要下行</span>
      <strong>${escapeHtml(
        weakestChannel
          ? `${weakestChannel.brand} / ${weakestChannel.name}`
          : weakestBrand?.name || "暂无",
      )}</strong>
      <small>${escapeHtml(
        weakestChannel
          ? `${movementLabel} ${fmtDelta(weakestChannel.raw.diff)} pcs`
          : weakestBrand
            ? `${movementLabel} ${fmtDelta(weakestBrand.raw.diff)} pcs`
            : "无可用数据",
      )}</small>
    </div>
    <div class="attention-item">
      <span>主要拖累产品</span>
      <strong>${escapeHtml(
        weakestProduct
          ? `${weakestProduct.brand} / ${weakestProduct.name}`
          : "暂无显著拖累",
      )}</strong>
      <small>${escapeHtml(
        weakestProduct
          ? `${movementLabel} ${fmtDelta(weakestProduct.diff)} pcs · 影响 ${fmtImpact(weakestProduct.impact)}`
          : "未达到影响阈值",
      )}</small>
    </div>
  </section>`;
}

function reportToolbar() {
  const brandButtons = brands
    .map(
      (brand) =>
        `<button type="button" data-brand-filter="${escapeHtml(brand.name)}" aria-pressed="false">${escapeHtml(brand.name)}</button>`,
    )
    .join("");
  return `<nav class="report-toolbar" aria-label="${reportTypeLabel}筛选与视图">
    <div class="toolbar-group brand-controls" aria-label="品牌筛选">
      <button type="button" data-brand-filter="all" aria-pressed="true">全部品牌</button>
      ${brandButtons}
    </div>
    <div class="toolbar-group view-controls" aria-label="视图切换">
      <button type="button" data-view-filter="all" aria-pressed="true">完整</button>
      <button type="button" data-view-filter="channel" aria-pressed="false">渠道</button>
      <button type="button" data-view-filter="product" aria-pressed="false">产品</button>
    </div>
    <label class="report-search">
      <span class="sr-only">搜索产品或 SKU</span>
      <input type="search" data-product-search placeholder="搜索产品名、SPU 或 SKU" autocomplete="off" />
    </label>
    <button type="button" class="toolbar-action" data-expand-details aria-pressed="false">展开明细</button>
  </nav>
  <div class="report-status" role="status" aria-live="polite">
    <span data-result-status></span>
    <button type="button" data-clear-filters>重置筛选并返回顶部</button>
  </div>`;
}

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${scopeConfig.title} Marketplace ${reportTypeLabel} ${currentStart} 至 ${currentEnd}</title>
  <style>
    :root {
      --bg: #f2f4f7;
      --card: #fff;
      --surface: #f8fafb;
      --ink: #171a20;
      --muted: #596473;
      --line: #d8dee6;
      --green: #087a55;
      --green-bg: #edf7f2;
      --red: #bd363b;
      --red-bg: #fbeff0;
      --blue: #245f91;
      --blue-bg: #edf4fa;
      --amber: #8b5a17;
      --amber-bg: #fff8ec;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      line-height: 1.5;
      overflow-x: hidden;
    }
    main {
      width: min(1440px, 100%);
      margin: 0 auto;
      padding: 24px 22px 48px;
    }
    header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 6px;
    }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 32px; line-height: 1.2; letter-spacing: 0; text-wrap: balance; }
    .date {
      color: var(--blue);
      font-size: 13px;
      font-weight: 800;
      padding: 7px 9px;
      border: 1px solid #bfd1e2;
      border-radius: 6px;
      background: var(--blue-bg);
      white-space: nowrap;
    }
    .subhead {
      color: var(--muted);
      font-size: 12.5px;
      font-weight: 650;
      line-height: 1.55;
      margin-bottom: 12px;
    }
    .overview {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 0;
      margin: 12px 0 14px;
      overflow: hidden;
      min-width: 0;
      max-width: 100%;
    }
    .brand-card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
      margin: 16px 0;
      min-width: 0;
      max-width: 100%;
      overflow: hidden;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }
    .overview .metrics {
      grid-template-columns: 1.08fr repeat(3, minmax(0, 1fr));
      gap: 0;
    }
    .metric {
      background: var(--surface);
      border-radius: 6px;
      padding: 11px 12px 10px;
      min-width: 0;
    }
    .overview .metric {
      border-radius: 0;
      border-right: 1px solid var(--line);
      background: #fff;
      padding: 13px 16px 12px;
    }
    .overview .metric:last-child { border-right: 0; }
    .metric.positive { background: var(--red-bg); }
    .metric.negative { background: var(--green-bg); }
    .overview .metric.positive,
    .overview .metric.negative { background: #fff; }
    .metric span, .metric em {
      display: block;
      color: var(--muted);
      font-size: 11px;
      font-style: normal;
      font-weight: 700;
    }
    .metric strong {
      display: block;
      margin: 3px 0 2px;
      max-width: 100%;
      color: var(--blue);
      font-size: 18px;
      line-height: 1.12;
      white-space: normal;
      overflow-wrap: break-word;
      font-variant-numeric: tabular-nums;
    }
    .metric.positive strong { color: var(--red); }
    .metric.negative strong { color: var(--green); }
    .conclusion {
      margin-top: 14px;
      background: var(--amber-bg);
      border: 1px solid #ead9bc;
      border-radius: 8px;
      padding: 12px 14px;
      display: grid;
      grid-template-columns: 96px minmax(0, 1fr);
      gap: 14px;
      align-items: start;
    }
    .warning {
      margin-top: 14px;
      background: var(--red-bg);
      border: 1px solid #f0cac6;
      border-radius: 8px;
      padding: 12px 14px;
    }
    .conclusion h2 { color: var(--amber); font-size: 15px; margin: 1px 0 0; }
    .warning h2 { color: var(--red); font-size: 16px; margin-bottom: 8px; }
    .conclusion ol, .warning ol {
      margin: 0;
      padding-left: 22px;
      font-weight: 650;
      font-size: 13px;
      line-height: 1.6;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .conclusion li + li, .warning li + li { margin-top: 6px; }
    .brand-card .conclusion {
      margin: 12px -2px 0;
      border: 0;
      border-top: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
      border-radius: 0;
      background: var(--surface);
      padding: 11px 2px;
    }
    .channel-trend-section {
      margin: 14px -2px 0;
      padding: 12px 2px 11px;
      border-bottom: 1px solid var(--line);
    }
    .trend-section-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 7px;
    }
    .trend-section-head h3 {
      margin: 0;
      font-size: 15px;
      line-height: 1.25;
    }
    .trend-section-head p {
      margin-top: 2px;
      color: var(--muted);
      font-size: 10.5px;
      font-weight: 650;
    }
    .trend-legend {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 6px 14px;
    }
    .trend-legend-item {
      display: grid;
      grid-template-columns: 18px auto auto;
      align-items: center;
      gap: 5px;
      color: var(--muted);
      font-size: 10px;
      font-variant-numeric: tabular-nums;
    }
    .trend-legend-item i {
      display: block;
      width: 18px;
      height: 2px;
      background: var(--series-color);
    }
    .trend-legend-item b { color: #34404d; font-size: 10px; }
    .trend-legend-item strong { color: var(--ink); font-size: 11px; }
    .trend-plot {
      width: 100%;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }
    .trend-plot svg {
      display: block;
      width: 100%;
      min-width: 760px;
      height: auto;
    }
    .trend-grid-line { stroke: #e3e8ee; stroke-width: 1; }
    .trend-axis-label {
      fill: #687482;
      font-size: 10px;
      font-weight: 650;
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
    }
    .trend-point { stroke: #fff; stroke-width: 1; }
    .brand-country-section {
      margin: 18px 0 0;
      overflow: hidden;
      border-top: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
    }
    .country-section-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
      padding: 14px 0 11px;
      border-bottom: 1px solid var(--line);
    }
    .country-section-head h3 { margin: 0; font-size: 18px; line-height: 1.2; }
    .country-section-head p {
      margin-top: 3px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
    }
    .country-section-head > strong {
      color: var(--blue);
      font-size: 13px;
      white-space: nowrap;
    }
    .brand-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 12px;
      margin-bottom: 10px;
      padding-bottom: 9px;
      border-bottom: 1px solid var(--line);
    }
    .brand-head h2 { font-size: 24px; line-height: 1.2; }
    .brand-head strong {
      font-size: 18px;
      color: var(--blue);
      white-space: nowrap;
    }
    h3 {
      margin: 16px 0 7px;
      font-size: 16px;
    }
    .growth-title { color: var(--red); }
    .drag-title { color: var(--green); }
    .product-analysis-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      margin-top: 16px;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
    }
    .analysis-column { min-width: 0; }
    .analysis-column + .analysis-column { border-left: 1px solid var(--line); }
    .analysis-column > h3 {
      margin: 0;
      padding: 11px 12px 10px;
      border-top: 2px solid var(--blue);
      border-bottom: 1px solid var(--line);
      background: #f7f9fb;
      font-size: 15px;
      line-height: 1.25;
    }
    .analysis-column.growth-column > h3 {
      border-top-color: var(--red);
      background: var(--red-bg);
      color: var(--red);
    }
    .analysis-column.drag-column > h3 {
      border-top-color: var(--green);
      background: var(--green-bg);
      color: var(--green);
    }
    .analysis-column .sku-list { gap: 0; }
    .analysis-column .product-table-head {
      display: grid;
      grid-template-columns: minmax(138px, 1.4fr) repeat(5, minmax(44px, .72fr));
      align-items: center;
      gap: 4px;
      padding: 7px 10px;
      border-bottom: 1px solid var(--line);
      background: #fbfbfa;
      color: var(--muted);
      font-size: 10px;
      font-weight: 750;
      line-height: 1;
    }
    .analysis-column .product-table-head span:not(:first-child) { text-align: right; }
    .analysis-column .product-item {
      padding: 8px 10px 6px;
      border-bottom: 1px solid #ece7df;
    }
    .analysis-column .product-item:last-child { border-bottom: 0; }
    .analysis-column .product-item > .sku-row {
      display: grid;
      grid-template-columns: minmax(138px, 1.4fr) minmax(0, 3.6fr);
      align-items: center;
      gap: 6px;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
    }
    .analysis-column .product-item > .sku-row .sku-main {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      min-width: 0;
      gap: 1px 5px;
      white-space: normal;
    }
    .analysis-column .sku-main b {
      font-size: 11.5px;
      line-height: 1.25;
      overflow-wrap: anywhere;
      white-space: normal;
    }
    .analysis-column .sku-main span {
      margin: 0;
      color: var(--muted);
      font-size: 10.5px;
      line-height: 1.25;
      overflow-wrap: anywhere;
      white-space: normal;
    }
    .analysis-column .product-item > .sku-row .sku-metrics {
      display: grid;
      grid-template-columns: repeat(5, minmax(40px, 1fr));
      align-items: center;
      gap: 6px;
      margin: 0;
    }
    .analysis-column .product-item > .sku-row .sku-metrics > div {
      min-width: 0;
      text-align: right;
    }
    .analysis-column .product-item > .sku-row .sku-metrics small { display: none; }
    .analysis-column .sku-row small { font-size: 10px; }
    .analysis-column .product-item > .sku-row strong {
      display: block;
      font-size: 10.5px;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0;
      line-height: 1.2;
      white-space: nowrap;
    }
    .analysis-column .sku-metrics > div:nth-child(4) strong { font-size: 10px; }
    .product-channel-overview {
      display: grid;
      grid-template-columns: 58px minmax(0, 1fr);
      gap: 6px;
      align-items: center;
      margin-top: 5px;
      padding-top: 5px;
      border-top: 1px solid #edf0f3;
    }
    .channel-overview-label {
      color: var(--muted);
      font-size: 9px;
      font-weight: 800;
      white-space: nowrap;
    }
    .channel-overview-empty {
      color: var(--muted);
      font-size: 9px;
      font-weight: 650;
    }
    .channel-contribution-list {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 5px;
      min-width: 0;
    }
    .channel-contribution {
      display: block;
      min-width: 0;
      padding: 3px 5px 4px;
      background: #f5f7f9;
      border-radius: 4px;
      color: #3f4a56;
    }
    .channel-contribution > span {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      align-items: baseline;
      gap: 3px;
      min-width: 0;
      font-variant-numeric: tabular-nums;
    }
    .channel-contribution b {
      overflow: hidden;
      color: #34404d;
      font-size: 8.5px;
      line-height: 1.2;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .channel-contribution strong { font-size: 9.5px; line-height: 1.2; }
    .channel-contribution em {
      color: var(--muted);
      font-size: 8px;
      font-style: normal;
      font-weight: 700;
    }
    .channel-contribution > i {
      display: block;
      height: 2px;
      margin-top: 3px;
      overflow: hidden;
      background: #dfe4e9;
      border-radius: 2px;
    }
    .channel-contribution > i > u {
      display: block;
      height: 100%;
      background: #66717e;
      text-decoration: none;
    }
    .channel-contribution.positive { background: var(--red-bg); color: var(--red); }
    .channel-contribution.positive > i > u { background: var(--red); }
    .channel-contribution.negative { background: var(--green-bg); color: var(--green); }
    .channel-contribution.negative > i > u { background: var(--green); }
    .analysis-column .sku-details { margin: 3px 0 0; }
    .analysis-column .sku-details summary {
      display: inline-block;
      width: auto;
      padding: 4px 20px 4px 0;
      background: transparent;
      font-size: 10px;
    }
    .analysis-column .sku-details summary:hover { color: #164a76; }
    .analysis-column .sku-details summary:focus-visible {
      outline: 2px solid var(--blue);
      outline-offset: 2px;
    }
    .analysis-column .sku-details summary::after { right: 2px; font-size: 12px; }
    .analysis-column .sku-detail-table {
      margin-top: 5px;
      border-top: 1px solid var(--line);
      background: #faf9f7;
    }
    .analysis-column .sku-detail-head {
      display: grid;
      grid-template-columns: minmax(138px, 1.4fr) repeat(5, minmax(44px, .72fr));
      gap: 4px;
      align-items: center;
      padding: 5px 6px;
      color: var(--muted);
      font-size: 9px;
      font-weight: 750;
      line-height: 1.1;
    }
    .analysis-column .sku-detail-head span:not(:first-child) { text-align: right; }
    .analysis-column .sku-detail-list { padding: 0; }
    .analysis-column .sku-detail-entry {
      padding: 6px;
      border-bottom: 1px solid #ece7df;
    }
    .analysis-column .sku-detail-entry:last-child { border-bottom: 0; }
    .analysis-column .sku-detail-row {
      display: grid;
      grid-template-columns: minmax(138px, 1.4fr) minmax(0, 3.6fr);
      gap: 6px;
      align-items: center;
      padding: 0;
      border-bottom: 0;
      background: transparent;
    }
    .analysis-column .sku-detail-row .sku-main {
      display: flex;
      flex-wrap: wrap;
      gap: 1px 5px;
      align-items: flex-start;
    }
    .analysis-column .sku-detail-row .sku-metrics {
      display: grid;
      grid-template-columns: repeat(5, minmax(40px, 1fr));
      gap: 6px;
      align-items: center;
      margin: 0;
    }
    .analysis-column .sku-detail-row .sku-metrics > div { min-width: 0; text-align: right; }
    .analysis-column .sku-detail-row .sku-metrics small { display: none; }
    .analysis-column .sku-detail-row strong {
      display: block;
      font-size: 10.5px;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0;
      line-height: 1.2;
      white-space: nowrap;
    }
    .analysis-column .sku-channel-overview {
      grid-template-columns: 54px minmax(0, 1fr);
      margin: 4px 0 0;
      padding-top: 4px;
      border-top-style: dashed;
    }
    .analysis-column .sku-channel-overview .channel-overview-label,
    .analysis-column .sku-channel-overview .channel-overview-empty {
      font-size: 8.5px;
    }
    .analysis-column .sku-channel-overview .channel-contribution {
      padding: 3px 4px;
    }
    .analysis-column .empty { padding: 14px; }
    .table-wrap {
      overflow-x: auto;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: white;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 620px;
      font-size: 14px;
    }
    th, td {
      padding: 11px 12px;
      border-bottom: 1px solid var(--line);
      text-align: right;
      white-space: nowrap;
    }
    th:first-child, td:first-child { text-align: left; }
    tr:last-child td { border-bottom: 0; }
    th {
      background: #faf8f5;
      color: var(--muted);
      font-size: 12px;
      letter-spacing: 0;
    }
    .sku-list {
      display: grid;
      gap: 9px;
    }
    .product-item {
      display: grid;
      gap: 6px;
    }
    .sku-row {
      display: grid;
      grid-template-columns: minmax(200px, .85fr) minmax(0, 2.15fr);
      gap: 24px;
      align-items: center;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: #fff;
    }
    .sku-row > div { min-width: 0; }
    .sku-metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(78px, 1fr));
      gap: 12px;
      align-items: center;
    }
    .sku-metrics > div { min-width: 0; text-align: right; }
    .sku-details { margin: 0 6px; }
    .sku-details summary {
      position: relative;
      cursor: pointer;
      list-style: none;
      color: var(--blue);
      font-size: 13px;
      font-weight: 800;
      padding: 8px 28px 8px 10px;
      border-radius: 8px;
      background: var(--blue-bg);
    }
    .sku-details summary::-webkit-details-marker { display: none; }
    .sku-details summary::after {
      content: "⌄";
      position: absolute;
      right: 10px;
      top: 50%;
      transform: translateY(-55%);
      font-size: 18px;
      line-height: 1;
    }
    .sku-details[open] summary::after { transform: translateY(-45%) rotate(180deg); }
    .sku-detail-list {
      display: grid;
      gap: 6px;
      padding: 6px 0 0 18px;
    }
    .sku-detail-row { background: #faf8f5; }
    .sku-main b, .sku-main span { display: block; }
    .sku-main span {
      color: var(--muted);
      font-size: 13px;
      margin-top: 2px;
    }
    .sku-row small {
      color: var(--muted);
      display: block;
      font-size: 11px;
      font-weight: 700;
    }
    .sku-row strong { font-size: 15px; }
    .positive { color: var(--red); }
    .negative { color: var(--green); }
    .empty {
      color: var(--muted);
      padding: 12px;
      border: 1px dashed var(--line);
      border-radius: 8px;
      background: #fff;
    }
    .footnote {
      margin-top: 14px;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.6;
    }
    @media (max-width: 760px) {
      main { padding: 16px 10px 32px; }
      h1 {
        max-width: 100%;
        font-size: 24px;
        overflow-wrap: anywhere;
        word-break: break-word;
        text-wrap: wrap;
      }
      header { display: block; }
      .date { display: inline-block; margin-top: 7px; }
      .overview .metrics,
      .metrics { grid-template-columns: 1fr 1fr; }
      .overview .metric:nth-child(2) { border-right: 0; }
      .overview .metric:nth-child(-n + 2) { border-bottom: 1px solid var(--line); }
      .metric strong { font-size: 16px; }
      .conclusion { grid-template-columns: 1fr; gap: 6px; }
      .brand-head { display: block; }
      .brand-card { padding: 13px; border-radius: 8px; }
      .brand-head h2 { font-size: 22px; }
      .brand-head strong { font-size: 17px; }
      .trend-section-head { display: block; }
      .trend-legend { justify-content: flex-start; margin-top: 8px; }
      .trend-plot svg { min-width: 700px; }
      .country-section-head { display: block; }
      .country-section-head > strong { display: block; margin-top: 5px; }
      .product-analysis-grid { grid-template-columns: 1fr; }
      .analysis-column + .analysis-column {
        border-left: 0;
        border-top: 1px solid var(--line);
      }
      .analysis-column .product-table-head { display: none; }
      .analysis-column .product-item > .sku-row,
      .analysis-column .sku-detail-row {
        grid-template-columns: 1fr;
        gap: 7px;
      }
      .analysis-column .product-item > .sku-row .sku-metrics,
      .analysis-column .sku-detail-row .sku-metrics {
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 4px;
        width: 100%;
      }
      .analysis-column .product-item > .sku-row .sku-metrics > div,
      .analysis-column .sku-detail-row .sku-metrics > div { text-align: left; }
      .analysis-column .product-item > .sku-row .sku-metrics small,
      .analysis-column .sku-detail-row .sku-metrics small {
        display: block;
        margin-bottom: 2px;
        font-size: 8px;
      }
      .analysis-column .sku-details summary {
        min-height: 44px;
        display: flex;
        align-items: center;
        padding-right: 24px;
      }
      .analysis-column .sku-detail-entry { padding: 8px 6px; }
      .analysis-column .sku-main b { font-size: 13px; }
      .analysis-column .sku-main span { font-size: 12px; }
      .analysis-column .product-item > .sku-row strong,
      .analysis-column .sku-detail-row strong { font-size: 11px; }
      .product-channel-overview,
      .analysis-column .sku-channel-overview {
        grid-template-columns: 1fr;
        gap: 4px;
      }
      .channel-contribution b { font-size: 9px; }
      .channel-contribution strong { font-size: 10px; }
      .sku-row {
        grid-template-columns: 1fr;
        gap: 8px;
      }
      .sku-metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
      .sku-metrics > div { text-align: left; }
      .sku-row strong { white-space: normal; overflow-wrap: anywhere; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>${scopeConfig.title} Marketplace ${reportTypeLabel}</h1>
      <div class="date">${escapeHtml(dateLabel(currentStart, currentEnd))} vs ${escapeHtml(dateLabel(baselineStart, baselineEnd))}</div>
    </header>
    <p class="subhead">口径：pcs / 产品默认按 SPU / PRODUCT NAME 聚合 / SKU明细默认收起 / 当前期 ${escapeHtml(currentStart)} 至 ${escapeHtml(currentEnd)} / 对比期 ${escapeHtml(baselineStart)} 至 ${escapeHtml(baselineEnd)} / 产品影响占比按品牌内绝对波动计算 / 产品及SKU均展示渠道贡献 / 每个品牌展示近15天渠道趋势 / GMV不参与判断</p>
    ${reportToolbar()}
    <section class="overview">
      <div class="metrics">
        ${metric(`${currentPeriodLabel}总销量`, fmtInt(overall.current), "当前期 pcs")}
        ${metric(`${baselinePeriodLabel}总销量`, fmtInt(overall.baseline), "对比期 pcs")}
        ${metric("增减", fmtDiff(overall.diff, overall.baseline), "当前期 - 对比期")}
        ${metric("日均变化", fmtDelta(overall.diff / currentDays, 1), `${currentDays}日平均`)}
      </div>
    </section>
    ${warningBlock(warnings)}
    ${attentionPanel()}
    ${conclusionBlock("核心结论", buildOverallConclusion())}
    ${brands.map(brandCard).join("\n")}
    <p class="footnote">说明：产品影响占比 = 产品（SPU / PRODUCT NAME）本期较对比期变化 / 品牌产品绝对波动总量；SKU影响按该产品内部SKU绝对波动计算；渠道影响展示该产品或SKU在各渠道的周期销量变化贡献；增长为正，拖累为负；GMV不参与本报告判断。</p>
  </main>
</body>
</html>
`;

if (!QUARTO_BIN) {
  throw new Error(
    "Quarto CLI not found. Set QUARTO_BIN or install the quarto-dev/quarto-cli GitHub release.",
  );
}

const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/);
if (!styleMatch || !bodyMatch) {
  throw new Error("Unable to extract the generated report body for Quarto rendering");
}

const sourceDir = path.join(
  ROOT_DIR,
  "generated",
  "quarto-source",
  "marketplace-sales-period",
  `${scopeConfig.file}_${currentStart}_${currentEnd}_vs_${baselineStart}_${baselineEnd}`,
);
const qmdPath = path.join(sourceDir, "report.qmd");
const baseCssPath = path.join(sourceDir, "report-base.css");
const enhancementCssPath = path.join(sourceDir, "report-enhancements.css");
const interactionsPath = path.join(sourceDir, "report-interactions.html");
const qmd = `---
lang: zh-CN
pagetitle: ${JSON.stringify(`${scopeConfig.title} Marketplace ${reportTypeLabel} ${currentStart} 至 ${currentEnd}`)}
format:
  html:
    minimal: true
    embed-resources: true
    page-layout: full
    toc: false
    css:
      - report-base.css
      - report-enhancements.css
    include-after-body: report-interactions.html
---

\`\`\`{=html}
${bodyMatch[1].trim()}
\`\`\`
`;

fs.mkdirSync(sourceDir, { recursive: true });
fs.writeFileSync(qmdPath, qmd);
fs.writeFileSync(baseCssPath, styleMatch[1].trim());
fs.copyFileSync(
  path.join(QUARTO_TEMPLATE_DIR, "report-enhancements.css"),
  enhancementCssPath,
);
fs.copyFileSync(
  path.join(QUARTO_TEMPLATE_DIR, "report-interactions.html"),
  interactionsPath,
);
fs.mkdirSync(path.dirname(out), { recursive: true });
const renderedPath = path.join(sourceDir, "report.html");
execFileSync(
  QUARTO_BIN,
  ["render", path.basename(qmdPath), "--output", path.basename(renderedPath)],
  { cwd: sourceDir, stdio: "inherit" },
);
fs.copyFileSync(renderedPath, out);
console.log(out);
