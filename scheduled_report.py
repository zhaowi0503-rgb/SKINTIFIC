#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
定时任务脚本 - 每天18点执行分析并推送到钉钉
"""

import sys
import os

# 获取当前脚本所在目录
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.append(current_dir)

from brand_sales_analysis import connect_and_load_data
from dingtalk_push import send_to_dingtalk
from generate_html_report import generate_full_report
from datetime import datetime

# 钉钉配置（优先使用环境变量，否则使用默认值）
DINGTALK_WEBHOOK = os.getenv('DINGTALK_WEBHOOK', "https://oapi.dingtalk.com/robot/send?access_token=1cb6336bc58ab0740987d90bf7808549c35be0d77edd5a4398052cb6d6f06103")
DINGTALK_SECRET = os.getenv('DINGTALK_SECRET', None)  # 未设置加签密钥

# Google凭证文件路径（优先使用环境变量指定的路径）
CREDENTIALS_FILE = os.getenv('GOOGLE_CREDENTIALS_FILE', '/Users/weizhao/Downloads/skintific-492616-339ab13aea8e.json')

def main():
    """主函数"""
    print("开始执行定时分析任务...")

    try:
        # 1. 加载数据
        df = connect_and_load_data()

        # 2. 生成HTML报告
        html_content = generate_full_report(df)

        # 保存到文件（使用相对路径，适配GitHub Actions）
        output_file = os.path.join(current_dir, 'daily_report.html')
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(html_content)

        print(f"✅ HTML报告已生成: {output_file}")

        # 3. 推送到钉钉（使用Markdown格式，仅推送链接）
        latest_date = df['Date'].max()
        report_date = latest_date.strftime('%Y-%m-%d')

        # 构建简洁的Markdown消息
        markdown_content = f"""## 📊 品牌分析 - 销量日报

**数据日期:** {report_date}

**报告内容:**
- 📊 渠道维度分析（近7天每日销量）
- 🌍 国家维度分析（近7天每日销量）
- 🏆 TOP 10 SKU 销量波动
- 🚀 增长 SKU / 📉 下降 SKU

👉 [点击查看完整报告](https://zhaowi0503-rgb.github.io/SKINTIFIC/daily_report.html)

---
*生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*
"""

        print(f"准备推送到钉钉...")
        print(f"Webhook URL: {DINGTALK_WEBHOOK[:50]}...")
        print(f"Secret configured: {'Yes' if DINGTALK_SECRET else 'No'}")

        success = send_to_dingtalk(DINGTALK_WEBHOOK, DINGTALK_SECRET, markdown_content, use_html=False)

        if success:
            print("✅ 定时任务执行成功")
        else:
            print("❌ 钉钉推送失败")
            sys.exit(1)

    except Exception as e:
        print(f"❌ 任务执行失败: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == '__main__':
    main()
