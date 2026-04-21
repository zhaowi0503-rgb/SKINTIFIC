#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
定时任务脚本 - 每天18点执行分析并推送到钉钉
"""

import sys
import os
sys.path.append('/Users/skintific')

from brand_sales_analysis import connect_and_load_data, analyze_brand
from dingtalk_push import send_to_dingtalk, format_report_for_dingtalk

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

        # 2. 分析SKINTIFIC品牌
        skt_analysis = analyze_brand(df, 'SKT', 'SKINTIFIC')

        # 3. 分析Timephoria品牌
        tp_analysis = analyze_brand(df, 'TP', 'Timephoria')

        # 4. 格式化报告
        content = format_report_for_dingtalk(skt_analysis, tp_analysis, df)

        # 5. 推送到钉钉
        success = send_to_dingtalk(DINGTALK_WEBHOOK, DINGTALK_SECRET, content)

        if success:
            print("✅ 定时任务执行成功")
        else:
            print("❌ 钉钉推送失败")

    except Exception as e:
        print(f"❌ 任务执行失败: {str(e)}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    main()
