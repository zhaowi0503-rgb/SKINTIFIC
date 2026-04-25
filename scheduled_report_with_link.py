#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
定时任务脚本 - 生成HTML报告并推送链接到钉钉
"""

import sys
import os
sys.path.append('/Users/skintific')

from generate_html_report import generate_full_report
from brand_sales_analysis import connect_and_load_data
from dingtalk_push import send_to_dingtalk
from datetime import datetime
import subprocess

# 钉钉配置
DINGTALK_WEBHOOK = os.getenv('DINGTALK_WEBHOOK', "https://oapi.dingtalk.com/robot/send?access_token=1cb6336bc58ab0740987d90bf7808549c35be0d77edd5a4398052cb6d6f06103")
DINGTALK_SECRET = os.getenv('DINGTALK_SECRET', None)

# GitHub Pages 链接
REPORT_URL = "https://zhaowi0503-rgb.github.io/SKINTIFIC/"

def push_to_github():
    """推送更新到 GitHub"""
    try:
        # 复制报告到 docs 目录
        subprocess.run(['cp', 'daily_report.html', 'docs/index.html'], check=True)

        # Git 操作
        subprocess.run(['git', 'add', 'docs/index.html'], check=True)

        commit_msg = f"Update: Daily sales report {datetime.now().strftime('%Y-%m-%d %H:%M')}"
        subprocess.run(['git', 'commit', '-m', commit_msg], check=True)

        subprocess.run(['git', 'push', 'origin', 'main'], check=True)

        print("✅ 报告已推送到 GitHub Pages")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ Git 操作失败: {e}")
        return False

def send_link_to_dingtalk():
    """发送链接到钉钉"""
    current_time = datetime.now().strftime('%Y-%m-%d %H:%M')

    # 使用 ActionCard 格式
    content = f"""
    <div style="padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 10px; color: white; margin-bottom: 20px; text-align: center;">
            <h1 style="margin: 0; font-size: 24px;">📊 品牌销量日报</h1>
            <p style="margin: 10px 0 0 0; opacity: 0.9; font-size: 14px;">生成时间: {current_time}</p>
        </div>

        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center;">
            <p style="font-size: 16px; color: #495057; margin-bottom: 15px;">
                📈 SKINTIFIC & Timephoria 品牌销量分析
            </p>
            <p style="font-size: 14px; color: #6c757d;">
                包含渠道、国家、SKU三个维度的详细分析
            </p>
        </div>
    </div>
    """

    # 构建消息
    message = {
        "msgtype": "actionCard",
        "actionCard": {
            "title": "品牌分析 - 销量日报",
            "text": content,
            "hideAvatar": "0",
            "btnOrientation": "0",
            "singleTitle": "查看完整报告",
            "singleURL": REPORT_URL
        }
    }

    # 如果有加签密钥，需要计算签名
    if DINGTALK_SECRET:
        import time
        import hmac
        import hashlib
        import base64
        import urllib.parse

        timestamp = str(round(time.time() * 1000))
        secret_enc = DINGTALK_SECRET.encode('utf-8')
        string_to_sign = f'{timestamp}\n{DINGTALK_SECRET}'
        string_to_sign_enc = string_to_sign.encode('utf-8')
        hmac_code = hmac.new(secret_enc, string_to_sign_enc, digestmod=hashlib.sha256).digest()
        sign = urllib.parse.quote_plus(base64.b64encode(hmac_code))
        webhook_url = f"{DINGTALK_WEBHOOK}&timestamp={timestamp}&sign={sign}"
    else:
        webhook_url = DINGTALK_WEBHOOK

    # 发送请求
    import requests
    try:
        response = requests.post(webhook_url, json=message, timeout=10)
        result = response.json()

        if result.get('errcode') == 0:
            print("✅ 钉钉推送成功")
            return True
        else:
            print(f"❌ 钉钉推送失败: {result}")
            return False
    except Exception as e:
        print(f"❌ 钉钉推送异常: {e}")
        return False

def main():
    """主函数"""
    print("开始执行定时任务...")

    try:
        # 1. 加载数据
        print("正在加载数据...")
        df = connect_and_load_data()

        # 2. 生成 HTML 报告
        print("正在生成HTML报告...")
        html_content = generate_full_report(df)

        # 3. 保存到本地
        with open('/Users/skintific/daily_report.html', 'w', encoding='utf-8') as f:
            f.write(html_content)
        print("✅ HTML报告已生成")

        # 4. 推送到 GitHub Pages
        print("正在推送到 GitHub...")
        if not push_to_github():
            print("⚠️  GitHub 推送失败，但继续发送钉钉通知")

        # 5. 发送链接到钉钉
        print("正在发送钉钉通知...")
        success = send_link_to_dingtalk()

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
