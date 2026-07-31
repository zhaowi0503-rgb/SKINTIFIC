# Marketplace 日报发布器

默认以北京时间昨日为日报日期，生成美国、其他国家、墨西哥三份 HTML，上传到 Cloud Storage，并在配置钉钉机器人后发送群消息。即使部分品牌/渠道缺数也会按时发布，但会在钉钉简报和 HTML 中明确警告，并将缺失渠道排除出汇总和变化分析。

墨西哥报告的数据源为互斥组合：墨西哥独立表排除 `SHOPIFY`，再合并主销量表中 `region = 'Mexico' AND channel = 'SHOPIFY'` 的数据。完整性校验和钉钉汇总使用同一组合口径。

墨西哥 Shopify 按共享渠道源判断完整性：当日只要任一品牌有 Shopify 数据，其他品牌无订单按真实 0 处理；只有整个墨西哥 Shopify 渠道当日都无数据时才预警。

## Quarto 渲染

日报数据与指标仍由 Node.js + BigQuery 生成，最终页面使用 GitHub 开源项目
`quarto-dev/quarto-cli` 渲染为单文件 HTML。模板资源位于：

- `automations/marketplace-sales-daily/quarto/report-enhancements.css`
- `automations/marketplace-sales-daily/quarto/report-interactions.html`

生成时会在 `generated/quarto-source/marketplace-sales-daily/` 保留对应 `.qmd`
及渲染资源，便于复查页面结构。最终 HTML 文件名和 GCS 发布路径保持不变。

生成器依次查找 `QUARTO_BIN`、项目私有运行目录和 macOS 常见安装路径。
当前固定验证版本为 Quarto `1.10.18`。

页面数值颜色采用中国业务报表口径：红色表示增长/正向，绿色表示下降/负向；
数据完整性状态仍使用绿色表示可用、红色表示缺失警告。

## 手工检查

```bash
node automations/marketplace-sales-daily/publish/publish_marketplace_daily_to_gcs.js --dry-run
```

## 强制发布指定日期

```bash
automations/marketplace-sales-daily/publish/run_marketplace_daily_publish.sh \
  --date 2026-07-18 --force
```

仅覆盖 Cloud Storage、不推送钉钉：

```bash
automations/marketplace-sales-daily/publish/run_marketplace_daily_publish.sh \
  --date 2026-07-22 --force --cloud-only
```

手动生成日报时默认使用上述发布入口：生成后会同时保留本地 HTML，并上传 Cloud Storage 的 dated 与 `latest` 路径。不要直接把底层 HTML 生成器作为日常入口。

`--allow-incomplete` 参数为兼容旧命令而保留，现在无需额外指定；默认发布逻辑已经允许缺数：

```bash
automations/marketplace-sales-daily/publish/run_marketplace_daily_publish.sh \
  --date 2026-07-19 --allow-incomplete --force
```

发布状态只向更新日期推进，定时检查不会把 `latest` 回退到旧日报。同一天的缺失渠道补齐后，完整性签名发生变化，发布器会重新上传并再次推送更正版。

## 私密配置

文件位置：`/Users/skintific/private/secrets/marketplace-daily-publisher.env`

```bash
DINGTALK_NAME='群名称1'
DINGTALK_WEBHOOK='https://oapi.dingtalk.com/robot/send?access_token=...'
DINGTALK_SECRET='SEC...'
DINGTALK_NAME_2='群名称2'
DINGTALK_WEBHOOK_2='https://oapi.dingtalk.com/robot/send?access_token=...'
DINGTALK_SECRET_2='SEC...'
```

该文件必须使用 `chmod 600`，不得提交到 Git。

发布器最多支持 10 个群，后续按 `_3`、`_4` 递增配置。每个群独立记录最后成功日期；某个群失败时只重试该群，不会让其他群重复收到同一日报。

## 定时任务

GitHub Actions 工作流 `.github/workflows/marketplace-sales-report.yml` 在北京时间工作日
20:00 运行，电脑关机不影响。实际推送规则为：

- 周一：推送截至 T-1 的 MTD 销量，对比上月相同日期区间。
- 周二至周五：推送 T-1 单日销量，对比 T-2。
- 周六、周日：不生成、不上传、不推送。

GitHub Actions 使用 `0 12 * * 1-5`（UTC）对应北京时间 20:00，并通过
`publisher-state/marketplace-period-state.json` 在 Cloud Storage 保存通知状态，避免手动重跑或
Actions 重试时重复通知已经成功的群。工作流支持手动指定 `mtd` / `dod`、报告截止日期、
强制重推和 dry-run。

仓库需要配置 `GOOGLE_CREDENTIALS`，以及每个群对应的 `DINGTALK_NAME[_N]`、
`DINGTALK_WEBHOOK[_N]`、`DINGTALK_SECRET[_N]` GitHub Actions Secrets。所有凭证只保存在
GitHub Secrets，不写入仓库、报告或 Actions 命令输出。

本机 `com.skintific.marketplace-daily-publish.plist` 仅保留为故障切换配置，云端工作流启用后
应保持卸载状态，避免重复推送。

周期调度入口：

```bash
automations/marketplace-sales-daily/publish/run_marketplace_scheduled_publish.sh
```

手工发布指定 MTD：

```bash
automations/marketplace-sales-daily/publish/run_marketplace_scheduled_publish.sh \
  --mode mtd --report-end 2026-07-26 --force
```

手工发布指定日环比：

```bash
automations/marketplace-sales-daily/publish/run_marketplace_scheduled_publish.sh \
  --mode dod --report-end 2026-07-28 --force
```

Cloud 路径分别保留在 `mtd/YYYY/MM/DD/`、`daily/YYYY/MM/DD/`，
并维护 `latest-mtd/`、`latest-daily/` 与统一的 `latest/`。每个报告周期和钉钉群独立记录状态，避免 20:00 定时任务重复推送已手工发布的报告。

启动脚本显式使用本机 `127.0.0.1:7890` 代理访问 Google API；本机代理端口变化时，需要同步更新两个 `run_marketplace_*_publish.sh`。
