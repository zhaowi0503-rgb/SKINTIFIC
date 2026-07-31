#!/usr/bin/env node

const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const REPORT_DIR = path.join(ROOT, "generated", "web", "marketplace-sales-daily");
const GENERATOR = path.join(
  ROOT,
  "automations",
  "marketplace-sales-daily",
  "generate_marketplace_period_comparison_from_bq.js",
);
const BQ = process.env.BQ_BIN || "bq";
const GCLOUD = process.env.GCLOUD_BIN || "gcloud";
const CURL = process.env.CURL_BIN || "curl";
const PROJECT_ID = process.env.GCP_PROJECT_ID || "feimei";
const BUCKET = process.env.MARKETPLACE_REPORT_BUCKET || "feimei-marketplace-sales-reports";
const CREDENTIALS =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  "/Users/skintific/private/secrets/shopify-bigquery-sync/feimei-shopify-bigquery-sync.json";
const CLOUDSDK_CONFIG =
  process.env.MARKETPLACE_REPORT_CLOUDSDK_CONFIG ||
  path.join(os.homedir(), ".config", "gcloud-marketplace-report-publisher");
const STATE_FILE =
  process.env.MARKETPLACE_PERIOD_REPORT_STATE_FILE ||
  "/Users/skintific/private/runtime/marketplace-period-publisher/state.json";
const REMOTE_STATE_OBJECT = process.env.MARKETPLACE_PERIOD_REMOTE_STATE_OBJECT || "";
const MAIN_TABLE = "`feimei.raw_google_sheets.ec_sales_allin_sales_summary`";
const MX_TABLE = "`feimei.raw_google_sheets.ec_sales_mexico_allin_sales_summary`";
const TIME_ZONE = "Asia/Shanghai";
let cachedAccessToken = null;
let cloudAuthenticated = false;

const args = process.argv.slice(2);
const flags = new Set(args);
const force = flags.has("--force");
const dryRun = flags.has("--dry-run");
const cloudOnly = flags.has("--cloud-only");
const scheduled = flags.has("--scheduled");

function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function run(file, commandArgs, options = {}) {
  return execFileSync(file, commandArgs, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 96 * 1024 * 1024,
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...options.env },
  });
}

function query(sql) {
  return JSON.parse(
    run(BQ, [
      "query",
      `--project_id=${PROJECT_ID}`,
      "--use_legacy_sql=false",
      "--format=json",
      "--max_rows=30000",
      sql,
    ]) || "[]",
  );
}

function dateParts(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return { year, month, day };
}

function formatDate(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateAdd(dateString, days) {
  const { year, month, day } = dateParts(dateString);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return formatDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
}

function startOfMonth(dateString) {
  const { year, month } = dateParts(dateString);
  return formatDate(year, month, 1);
}

function previousMonthStart(dateString) {
  const { year, month } = dateParts(dateString);
  const value = new Date(Date.UTC(year, month - 2, 1));
  return formatDate(value.getUTCFullYear(), value.getUTCMonth() + 1, 1);
}

function daysInMonth(dateString) {
  const { year, month } = dateParts(dateString);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function todayInShanghai() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function weekdayInShanghai(dateString) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "short",
  }).format(new Date(`${dateString}T12:00:00+08:00`));
}

function resolveSchedule() {
  const today = argValue("--as-of-date") || todayInShanghai();
  const reportEnd = argValue("--report-end") || dateAdd(today, -1);
  let mode = argValue("--mode");

  if (scheduled) {
    const weekday = weekdayInShanghai(today);
    if (weekday === "Mon") mode = "mtd";
    else if (["Tue", "Wed", "Thu", "Fri"].includes(weekday)) mode = "dod";
    else return { skip: true, reason: `${weekday} is not a scheduled push day`, today };
  }

  if (!["mtd", "dod"].includes(mode)) {
    throw new Error("Use --scheduled or provide --mode mtd|dod");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportEnd)) {
    throw new Error("--report-end must use YYYY-MM-DD");
  }

  if (mode === "dod") {
    return {
      skip: false,
      mode,
      reportEnd,
      currentStart: reportEnd,
      currentEnd: reportEnd,
      baselineStart: dateAdd(reportEnd, -1),
      baselineEnd: dateAdd(reportEnd, -1),
    };
  }

  const baselineStart = previousMonthStart(reportEnd);
  const baselineDay = Math.min(dateParts(reportEnd).day, daysInMonth(baselineStart));
  return {
    skip: false,
    mode,
    reportEnd,
    currentStart: startOfMonth(reportEnd),
    currentEnd: reportEnd,
    baselineStart,
    baselineEnd: formatDate(
      dateParts(baselineStart).year,
      dateParts(baselineStart).month,
      baselineDay,
    ),
  };
}

function completeness(reportEnd) {
  const rows = query(`
    WITH params AS (SELECT DATE '${reportEnd}' AS report_date),
    source AS (
      SELECT
        CASE
          WHEN TRIM(region) = 'United States' THEN 'us'
          WHEN TRIM(region) = 'Mexico'
            AND UPPER(TRIM(channels)) = 'SHOPIFY' THEN 'mexico'
          WHEN TRIM(region) NOT IN ('United States', 'Mexico') THEN 'other_countries'
        END AS scope,
        date AS day,
        UPPER(TRIM(brand)) AS brand,
        UPPER(TRIM(channels)) AS channel,
        SUM(COALESCE(unit, 0)) AS units
      FROM ${MAIN_TABLE}
      CROSS JOIN params
      WHERE date BETWEEN DATE_SUB(params.report_date, INTERVAL 7 DAY)
                     AND params.report_date
        AND UPPER(TRIM(COALESCE(brand, ''))) IN ('SKT', 'TP', 'G2G')
        AND TRIM(COALESCE(channels, '')) != ''
      GROUP BY 1, 2, 3, 4

      UNION ALL

      SELECT
        'mexico',
        date,
        UPPER(TRIM(brand)),
        UPPER(TRIM(channels)),
        SUM(COALESCE(unit, 0))
      FROM ${MX_TABLE}
      CROSS JOIN params
      WHERE date BETWEEN DATE_SUB(params.report_date, INTERVAL 7 DAY)
                     AND params.report_date
        AND UPPER(TRIM(COALESCE(brand, ''))) IN ('SKT', 'TP', 'G2G')
        AND UPPER(TRIM(COALESCE(channels, ''))) != 'SHOPIFY'
        AND TRIM(COALESCE(channels, '')) != ''
      GROUP BY 1, 2, 3, 4
    ),
    pairs AS (
      SELECT DISTINCT scope, brand, channel
      FROM source
      CROSS JOIN params
      WHERE scope IS NOT NULL
        AND day BETWEEN DATE_SUB(params.report_date, INTERVAL 7 DAY)
                    AND DATE_SUB(params.report_date, INTERVAL 1 DAY)
    ),
    profile AS (
      SELECT
        pairs.scope,
        pairs.brand,
        pairs.channel,
        COALESCE(SUM(IF(source.day = params.report_date, source.units, 0)), 0) AS current_units,
        COALESCE(SUM(IF(
          source.day BETWEEN DATE_SUB(params.report_date, INTERVAL 3 DAY)
                         AND DATE_SUB(params.report_date, INTERVAL 1 DAY),
          source.units,
          0
        )), 0) / 3.0 AS avg3_units,
        COALESCE(SUM(IF(
          source.day BETWEEN DATE_SUB(params.report_date, INTERVAL 7 DAY)
                         AND DATE_SUB(params.report_date, INTERVAL 1 DAY),
          source.units,
          0
        )), 0) / 7.0 AS avg7_units
      FROM pairs
      CROSS JOIN params
      LEFT JOIN source USING (scope, brand, channel)
      GROUP BY pairs.scope, pairs.brand, pairs.channel
    )
    SELECT scope, brand, channel, current_units, avg3_units, avg7_units
    FROM profile
    WHERE current_units = 0
      AND GREATEST(avg3_units, avg7_units) >= 10
      AND NOT (
        scope = 'mexico'
        AND channel = 'SHOPIFY'
        AND EXISTS (
          SELECT 1 FROM profile AS shopify
          WHERE shopify.scope = 'mexico'
            AND shopify.channel = 'SHOPIFY'
            AND shopify.current_units > 0
        )
      )
    ORDER BY scope, brand, channel
  `);
  return {
    dataComplete: rows.length === 0,
    missingSources: rows.map(({ scope, brand, channel }) => ({ scope, brand, channel })),
  };
}

function reportMetrics(period) {
  const rows = query(`
    WITH params AS (
      SELECT
        DATE '${period.currentStart}' AS current_start,
        DATE '${period.currentEnd}' AS current_end,
        DATE '${period.baselineStart}' AS baseline_start,
        DATE '${period.baselineEnd}' AS baseline_end
    ),
    sales AS (
      SELECT
        CASE
          WHEN TRIM(region) = 'United States' THEN 'us'
          WHEN TRIM(region) = 'Mexico'
            AND UPPER(TRIM(channels)) = 'SHOPIFY' THEN 'mexico'
          WHEN TRIM(region) NOT IN ('United States', 'Mexico') THEN 'other_countries'
        END AS scope,
        date,
        unit
      FROM ${MAIN_TABLE}, params
      WHERE (
          date BETWEEN params.current_start AND params.current_end
          OR date BETWEEN params.baseline_start AND params.baseline_end
        )
        AND UPPER(TRIM(COALESCE(brand, ''))) NOT IN ('', '#N/A', '#REF!', 'UNKNOWN')

      UNION ALL

      SELECT 'mexico', date, unit
      FROM ${MX_TABLE}, params
      WHERE (
          date BETWEEN params.current_start AND params.current_end
          OR date BETWEEN params.baseline_start AND params.baseline_end
        )
        AND UPPER(TRIM(COALESCE(brand, ''))) NOT IN ('', '#N/A', '#REF!', 'UNKNOWN')
        AND UPPER(TRIM(COALESCE(channels, ''))) != 'SHOPIFY'
    )
    SELECT
      scope,
      CAST(SUM(IF(date BETWEEN params.current_start AND params.current_end,
                  COALESCE(unit, 0), 0)) AS FLOAT64) AS current_pcs,
      CAST(SUM(IF(date BETWEEN params.baseline_start AND params.baseline_end,
                  COALESCE(unit, 0), 0)) AS FLOAT64) AS baseline_pcs
    FROM sales
    CROSS JOIN params
    WHERE scope IS NOT NULL
    GROUP BY scope
    ORDER BY scope
  `);
  const metrics = Object.fromEntries(
    ["us", "other_countries", "mexico"].map((scope) => [
      scope,
      { current_pcs: 0, baseline_pcs: 0, diff_pcs: 0, change_pct: null },
    ]),
  );
  for (const row of rows) {
    const current = Math.round(Number(row.current_pcs || 0));
    const baseline = Math.round(Number(row.baseline_pcs || 0));
    metrics[row.scope] = {
      current_pcs: current,
      baseline_pcs: baseline,
      diff_pcs: current - baseline,
      change_pct: baseline ? Number((((current - baseline) / baseline) * 100).toFixed(1)) : null,
    };
  }
  return metrics;
}

function reportPaths(period) {
  const suffix =
    `${period.currentStart}_${period.currentEnd}_vs_` +
    `${period.baselineStart}_${period.baselineEnd}`;
  return {
    us: path.join(REPORT_DIR, `marketplace_sales_us_${suffix}.html`),
    other_countries: path.join(REPORT_DIR, `marketplace_sales_other_countries_${suffix}.html`),
    mexico: path.join(REPORT_DIR, `marketplace_sales_mexico_${suffix}.html`),
  };
}

function generate(period) {
  run(
    process.execPath,
    [
      GENERATOR,
      period.currentStart,
      period.currentEnd,
      period.baselineStart,
      period.baselineEnd,
    ],
    { stdio: "inherit" },
  );
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(STATE_FILE, 0o600);
  if (REMOTE_STATE_OBJECT) {
    upload(STATE_FILE, REMOTE_STATE_OBJECT, "application/json; charset=utf-8");
  }
}

function cloudEnv() {
  return { CLOUDSDK_CONFIG };
}

function activateServiceAccount() {
  if (cloudAuthenticated) return;
  fs.mkdirSync(CLOUDSDK_CONFIG, { recursive: true, mode: 0o700 });
  run(
    GCLOUD,
    ["auth", "activate-service-account", `--key-file=${CREDENTIALS}`, `--project=${PROJECT_ID}`, "--quiet"],
    { env: cloudEnv() },
  );
  cloudAuthenticated = true;
}

function loadRemoteState() {
  if (!REMOTE_STATE_OBJECT) return;
  activateServiceAccount();
  const encodedObjectName = REMOTE_STATE_OBJECT.split("/").map(encodeURIComponent).join("/");
  try {
    const body = run(
      CURL,
      [
        "--fail",
        "--silent",
        "--show-error",
        "--max-time",
        "60",
        "-H",
        `Authorization: Bearer ${accessToken()}`,
        `https://storage.googleapis.com/${BUCKET}/${encodedObjectName}`,
      ],
    );
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true, mode: 0o700 });
    fs.writeFileSync(STATE_FILE, body, { mode: 0o600 });
  } catch (error) {
    const stderr = error.stderr || "";
    if (!String(stderr).includes("404")) throw error;
  }
}

function accessToken() {
  if (!cachedAccessToken) {
    cachedAccessToken = run(GCLOUD, ["auth", "print-access-token", "--quiet"], {
      env: cloudEnv(),
    }).trim();
  }
  return cachedAccessToken;
}

function upload(source, objectName, contentType) {
  const encodedObjectName = objectName.split("/").map(encodeURIComponent).join("/");
  execFileSync(
    CURL,
    [
      "--config",
      "-",
      "--fail",
      "--silent",
      "--show-error",
      "--max-time",
      "120",
      "--retry",
      "3",
      "--retry-all-errors",
      "-X",
      "PUT",
      "--upload-file",
      source,
      `https://storage.googleapis.com/${BUCKET}/${encodedObjectName}`,
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      input: [
        `header = "Authorization: Bearer ${accessToken()}"`,
        `header = "Content-Type: ${contentType}"`,
        'header = "Cache-Control: no-cache,max-age=0"',
        "",
      ].join("\n"),
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    },
  );
}

function publicUrl(objectName) {
  return `https://storage.googleapis.com/${BUCKET}/${objectName}`;
}

function objectPrefix(period) {
  const folder = period.mode === "mtd" ? "mtd" : "daily";
  return `${folder}/${period.reportEnd.replaceAll("-", "/")}`;
}

function buildManifest(period, metrics, validation) {
  const prefix = objectPrefix(period);
  return {
    report_key: `${period.mode}:${period.reportEnd}`,
    report_type: period.mode,
    generated_at: new Date().toISOString(),
    current_period: { start: period.currentStart, end: period.currentEnd },
    baseline_period: { start: period.baselineStart, end: period.baselineEnd },
    data_complete: validation.dataComplete,
    missing_sources: validation.missingSources,
    reports: {
      us: { ...metrics.us, url: publicUrl(`${prefix}/us.html`) },
      other_countries: {
        ...metrics.other_countries,
        url: publicUrl(`${prefix}/other-countries.html`),
      },
      mexico: { ...metrics.mexico, url: publicUrl(`${prefix}/mexico.html`) },
    },
  };
}

async function verifyUrl(url, expectedType) {
  const response = await fetch(url, { method: "HEAD", redirect: "follow" });
  const type = response.headers.get("content-type") || "";
  if (!response.ok || !type.toLowerCase().startsWith(expectedType)) {
    throw new Error(`Published URL verification failed: ${url} (${response.status}, ${type})`);
  }
}

function dingTalkTargets() {
  const targets = [
    {
      name: process.env.DINGTALK_NAME || "钉钉群1",
      webhook: process.env.DINGTALK_WEBHOOK,
      secret: process.env.DINGTALK_SECRET || "",
    },
  ];
  for (let index = 2; index <= 10; index += 1) {
    targets.push({
      name: process.env[`DINGTALK_NAME_${index}`] || `钉钉群${index}`,
      webhook: process.env[`DINGTALK_WEBHOOK_${index}`],
      secret: process.env[`DINGTALK_SECRET_${index}`] || "",
    });
  }
  return targets
    .filter((target) => target.webhook)
    .map((target) => ({
      ...target,
      id: crypto.createHash("sha256").update(target.webhook).digest("hex").slice(0, 16),
    }));
}

function dingTalkUrl(webhook, secret) {
  if (!secret) return webhook;
  const timestamp = Date.now();
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}\n${secret}`)
    .digest("base64");
  return `${webhook}${webhook.includes("?") ? "&" : "?"}timestamp=${timestamp}&sign=${encodeURIComponent(signature)}`;
}

function signed(number) {
  return `${number > 0 ? "+" : ""}${Number(number || 0).toLocaleString("en-US")}`;
}

function signedPercent(number) {
  return number === null ? "—" : `${number > 0 ? "+" : ""}${number.toFixed(1)}%`;
}

function periodLabel(period) {
  if (period.mode === "dod") {
    return `${period.currentEnd} vs ${period.baselineEnd}`;
  }
  return `${period.currentStart} 至 ${period.currentEnd} vs ${period.baselineStart} 至 ${period.baselineEnd}`;
}

function buildDingTalkMessage(manifest) {
  const typeName = manifest.report_type === "mtd" ? "MTD销量对比" : "日销量环比";
  const lines = [
    `# Marketplace ${typeName}｜${manifest.current_period.end}`,
    "",
    `> 对比周期：${
      manifest.report_type === "dod"
        ? `${manifest.current_period.end} vs ${manifest.baseline_period.end}`
        : `${manifest.current_period.start} 至 ${manifest.current_period.end} vs ${manifest.baseline_period.start} 至 ${manifest.baseline_period.end}`
    }`,
    manifest.data_complete
      ? "> 数据完整性：通过"
      : `> ⚠️ 数据完整性警告：${manifest.missing_sources
          .map(({ scope, brand, channel }) => `${scope} / ${brand} / ${channel}`)
          .join("、")}`,
    "",
  ];
  const labels = [
    ["美国", manifest.reports.us],
    ["其他国家", manifest.reports.other_countries],
    ["墨西哥", manifest.reports.mexico],
  ];
  for (const [label, metric] of labels) {
    lines.push(
      `- ${label}：${metric.current_pcs.toLocaleString("en-US")} pcs，` +
        `${signed(metric.diff_pcs)} / ${signedPercent(metric.change_pct)}`,
    );
  }
  lines.push(
    "",
    `[查看美国报告](${manifest.reports.us.url})  |  ` +
      `[查看其他国家报告](${manifest.reports.other_countries.url})  |  ` +
      `[查看墨西哥报告](${manifest.reports.mexico.url})`,
  );
  return {
    title: `${manifest.data_complete ? "" : "【数据警告】"}Marketplace ${typeName}`,
    text: lines.join("\n"),
  };
}

async function sendDingTalk(manifest, target) {
  const message = buildDingTalkMessage(manifest);
  const response = await fetch(dingTalkUrl(target.webhook, target.secret), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ msgtype: "markdown", markdown: message }),
  });
  const result = await response.json();
  if (!response.ok || result.errcode !== 0) {
    throw new Error(`DingTalk push failed for ${target.name}: ${response.status} ${result.errmsg}`);
  }
  console.log(`[dingtalk] sent to ${target.name}`);
}

async function main() {
  const period = resolveSchedule();
  if (period.skip) {
    console.log(`[schedule] skipped: ${period.reason}`);
    return;
  }

  loadRemoteState();
  const reportKey = `${period.mode}:${period.reportEnd}`;
  const validation = completeness(period.reportEnd);
  const metrics = reportMetrics(period);
  const manifest = buildManifest(period, metrics, validation);
  const paths = reportPaths(period);
  const state = readState();
  state.reports = state.reports || {};
  state.notifications = state.notifications || {};
  state.notifications[reportKey] = state.notifications[reportKey] || {};
  const targets = dingTalkTargets();
  const needsUpload = force || !state.reports[reportKey]?.uploaded_at;
  const pendingTargets = cloudOnly
    ? []
    : targets.filter((target) => force || !state.notifications[reportKey][target.id]);

  console.log(
    `[period-report] key=${reportKey}, period=${periodLabel(period)}, ` +
      `complete=${validation.dataComplete}, upload=${needsUpload}, ` +
      `notify=${pendingTargets.length}, targets=${targets.length}, cloud_only=${cloudOnly}`,
  );

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          period,
          validation,
          metrics,
          needsUpload,
          pendingNotifications: pendingTargets.length,
          dingtalkPreview: cloudOnly ? null : buildDingTalkMessage(manifest),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (needsUpload) {
    generate(period);
    for (const file of Object.values(paths)) {
      if (!fs.existsSync(file)) throw new Error(`Generated report missing: ${file}`);
    }
    const manifestPath = path.join(
      REPORT_DIR,
      `manifest_${period.mode}_${period.reportEnd}.json`,
    );
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    activateServiceAccount();
    const prefix = objectPrefix(period);
    const latestPrefix = period.mode === "mtd" ? "latest-mtd" : "latest-daily";
    const uploads = [
      [paths.us, `${prefix}/us.html`, "text/html; charset=utf-8"],
      [paths.other_countries, `${prefix}/other-countries.html`, "text/html; charset=utf-8"],
      [paths.mexico, `${prefix}/mexico.html`, "text/html; charset=utf-8"],
      [manifestPath, `${prefix}/manifest.json`, "application/json; charset=utf-8"],
      [paths.us, `${latestPrefix}/us.html`, "text/html; charset=utf-8"],
      [paths.other_countries, `${latestPrefix}/other-countries.html`, "text/html; charset=utf-8"],
      [paths.mexico, `${latestPrefix}/mexico.html`, "text/html; charset=utf-8"],
      [manifestPath, `${latestPrefix}/manifest.json`, "application/json; charset=utf-8"],
      [paths.us, "latest/us.html", "text/html; charset=utf-8"],
      [paths.other_countries, "latest/other-countries.html", "text/html; charset=utf-8"],
      [paths.mexico, "latest/mexico.html", "text/html; charset=utf-8"],
      [manifestPath, "latest/manifest.json", "application/json; charset=utf-8"],
    ];
    for (const [source, objectName, type] of uploads) upload(source, objectName, type);
    await Promise.all([
      verifyUrl(manifest.reports.us.url, "text/html"),
      verifyUrl(manifest.reports.other_countries.url, "text/html"),
      verifyUrl(manifest.reports.mexico.url, "text/html"),
      verifyUrl(publicUrl(`${latestPrefix}/manifest.json`), "application/json"),
    ]);
    state.reports[reportKey] = { uploaded_at: new Date().toISOString() };
    writeState(state);
  }

  const notificationErrors = [];
  for (const target of pendingTargets) {
    try {
      await sendDingTalk(manifest, target);
      state.notifications[reportKey][target.id] = {
        name: target.name,
        notified_at: new Date().toISOString(),
      };
      writeState(state);
    } catch (error) {
      notificationErrors.push(`${target.name}: ${error.message}`);
      console.error(`[dingtalk] failed for ${target.name}: ${error.message}`);
    }
  }

  if (!targets.length) {
    console.log("[dingtalk] no webhook is configured");
  }
  if (notificationErrors.length) {
    throw new Error(`DingTalk push failed for ${notificationErrors.length} target(s)`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
