# 品牌销量分析自动化报告

自动分析SKINTIFIC和Timephoria品牌销量数据，每天定时推送到钉钉群。

## 功能特性

- 📊 **三维度分析**：渠道、国家、SKU
- 📅 **近7天明细**：每日销量数据表格
- 📈 **趋势分析**：前7天 vs 后7天对比
- 🚀 **异常检测**：自动识别异常增长/下降SKU
- 🔔 **钉钉推送**：每天18:00自动推送报告

## 文件说明

- `brand_sales_analysis.py` - 核心分析脚本
- `dingtalk_push.py` - 钉钉推送模块
- `scheduled_report.py` - 定时任务入口
- `.github/workflows/daily_report.yml` - GitHub Actions配置

## 快速开始

详细部署指南请查看：[README_GITHUB_ACTIONS.md](README_GITHUB_ACTIONS.md)

## 本地测试

```bash
python3 scheduled_report.py
```

## 数据源

Google Sheets: [US EC-data allin1](https://docs.google.com/spreadsheets/d/1oqww7Wlojq0FwdjCOeKoKR2MLjJcd2IDTgZvpkF5wE8/)
