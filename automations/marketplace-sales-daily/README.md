# Scheduled Marketplace sales report

The deployed `marketplace-sales-report.yml` calls
`publish/publish_marketplace_period_to_gcs.js`. Its DingTalk summary and linked
regional HTML reports share `sales_report_source.js`.

## Sales source (2026-10-06)

- Main: `feimei.mart_marketplace.fact_channel_sales_daily`.
- Mexico: `feimei.mart_marketplace.fact_channel_sales_daily_mx`.
- The Mart retains manual sales through 2026-09-24 and uses accepted API company
  units from 2026-09-25. Reports do not reimplement order eligibility or BOM rules.
- US and other countries come from main; other countries exclude US and Mexico.
- Mexico excludes Shopify from the MX interface, then includes Shopify Mexico
  from main once. This preserves the report's historical comparison baseline.
- `units` / `channel` are adapted to the renderer's `unit` / `channels` names.
  Missing `sku_zh` falls back through the existing product name / English SKU /
  company SKU display rules. No extra name join can multiply sales rows.
- GMV is not used. Source changes across a comparison window are disclosed.

## Completeness

For API dates, use `order_sales_publication_status` for the exact report-end
date, with a complete 31-account inventory and a fresh status (at most 24h).
Zero sales are not classified as failed collection. Missing, stale, retained,
or wrong-date publication status cannot pass the check.
`order_sales_accepted_exceptions` supplies outstanding raw quantities for both
comparison windows; they are never relabeled or added as company units.
A single end-day certificate does not certify every date in an MTD window.
Historical reports therefore show the scope of the evidence explicitly.

## Validation and operation

```sh
node --test automations/marketplace-sales-daily/sales_report_source.test.js
node automations/marketplace-sales-daily/publish/publish_marketplace_period_to_gcs.js --mode mtd --report-end 2026-10-04 --dry-run
node automations/marketplace-sales-daily/generate_marketplace_period_comparison_from_bq.js 2026-10-01 2026-10-04 2026-09-01 2026-09-04
```

`--dry-run` reads BigQuery and prints a message preview. It neither uploads nor
sends nor downloads/modifies remote publication state. HTML generation writes
local generated outputs only. `BQ_BIN` and `QUARTO_BIN` can select installed CLIs.

The deployment keeps schedule, recipients, and notification deduplication.
`source_version` invalidates previously uploaded old-source HTML without
resetting notification receipts. No `--force` is needed for the source change;
using it deliberately resends and must be separately requested.

The legacy standalone `generate_marketplace_daily_html_from_bq.js` is not the
scheduled pipeline and is not covered by this migration.
