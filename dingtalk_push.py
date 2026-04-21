#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
钉钉推送模块 - 将分析报告推送到钉钉群
"""

import requests
import json
import time
import hmac
import hashlib
import base64
import urllib.parse
import pandas as pd
import hashlib
import base64
import urllib.parse

def send_to_dingtalk(webhook_url, secret, content):
    """
    发送消息到钉钉群

    Args:
        webhook_url: 钉钉机器人webhook地址
        secret: 钉钉机器人加签密钥（可选，如果未设置则传None）
        content: 要发送的文本内容
    """
    # 如果有加签密钥，计算签名
    if secret:
        timestamp = str(round(time.time() * 1000))
        secret_enc = secret.encode('utf-8')
        string_to_sign = '{}\n{}'.format(timestamp, secret)
        string_to_sign_enc = string_to_sign.encode('utf-8')
        hmac_code = hmac.new(secret_enc, string_to_sign_enc, digestmod=hashlib.sha256).digest()
        sign = urllib.parse.quote_plus(base64.b64encode(hmac_code))
        url = f"{webhook_url}&timestamp={timestamp}&sign={sign}"
    else:
        # 没有加签密钥，直接使用webhook地址
        url = webhook_url

    # 构建消息体
    message = {
        "msgtype": "markdown",
        "markdown": {
            "title": "品牌销量分析报告",
            "text": content
        }
    }

    # 发送请求
    headers = {'Content-Type': 'application/json'}
    response = requests.post(url, headers=headers, data=json.dumps(message))

    if response.status_code == 200:
        result = response.json()
        if result.get('errcode') == 0:
            print("✅ 钉钉推送成功")
            return True
        else:
            print(f"❌ 钉钉推送失败: {result.get('errmsg')}")
            return False
    else:
        print(f"❌ 请求失败: {response.status_code}")
        return False

def format_report_for_dingtalk(skt_analysis, tp_analysis, df):
    """
    将分析报告格式化为钉钉Markdown格式
    """
    from datetime import timedelta

    latest_date = df['Date'].max()
    date_14d_ago = latest_date - timedelta(days=13)
    date_7d_ago = latest_date - timedelta(days=6)

    content = f"# 📊 品牌分析 - 销量报告\n\n"
    content += f"> 数据时间: {date_14d_ago.strftime('%Y-%m-%d')} 至 {latest_date.strftime('%Y-%m-%d')}\n\n"
    content += "---\n\n"

    # SKINTIFIC品牌
    if skt_analysis is not None and len(skt_analysis) > 0:
        content += "## 🔷 SKINTIFIC 品牌\n\n"

        # 渠道表现
        df_skt = df[df['BRAND'] == 'SKT']
        df_14d = df_skt[df_skt['Date'] >= date_14d_ago]
        df_7d = df_skt[df_skt['Date'] >= date_7d_ago]

        channel_daily = df_14d.groupby(['Date', 'Channels'])['UNIT'].sum().reset_index()
        channels = sorted(channel_daily['Channels'].unique())

        # 近7天各渠道日销量明细
        content += "### 📅 近7天各渠道日销量\n\n"
        channel_7d = df_7d.groupby(['Date', 'Channels'])['UNIT'].sum().reset_index()
        channel_7d_pivot = channel_7d.pivot(index='Date', columns='Channels', values='UNIT').fillna(0)

        # 表头
        content += "| 日期 | " + " | ".join(channels) + " |\n"
        content += "|" + "---|" * (len(channels) + 1) + "\n"

        # 数据行
        for date, row in channel_7d_pivot.iterrows():
            date_str = date.strftime('%m-%d')
            content += f"| {date_str} |"
            for ch in channels:
                val = int(row.get(ch, 0))
                content += f" {val:,} |"
            content += "\n"

        # 渠道增长分析
        content += "\n### 📈 渠道增长分析\n\n"
        for channel in channels:
            channel_data = channel_daily[channel_daily['Channels'] == channel].sort_values('Date')
            if len(channel_data) >= 2:
                mid_point = len(channel_data) // 2
                first_half_avg = channel_data.head(mid_point)['UNIT'].mean() if mid_point > 0 else channel_data['UNIT'].mean()
                last_half_avg = channel_data.tail(mid_point)['UNIT'].mean() if mid_point > 0 else channel_data['UNIT'].mean()
                growth_rate = ((last_half_avg - first_half_avg) / first_half_avg * 100) if first_half_avg > 0 else 0
                emoji = "📈" if growth_rate > 0 else "📉"
                content += f"- **{channel}**: 前7天日均 {first_half_avg:,.0f} → 后7天日均 {last_half_avg:,.0f}，{emoji} {growth_rate:+.1f}%\n"

        # 主要市场
        country_total = df_14d.groupby('地区')['UNIT'].sum().sort_values(ascending=False)
        content += f"\n### 🌍 国家销量排名\n\n"
        for idx, (country, sales) in enumerate(country_total.head(5).items(), 1):
            content += f"{idx}. **{country}**: {sales:,.0f} 件\n"

        # Top SKU
        content += f"\n### 🏆 Top 10 SKU\n\n"
        top10 = skt_analysis.nlargest(10, '近14天总销量')
        for idx, (_, row) in enumerate(top10.iterrows(), 1):
            growth_emoji = "📈" if row['增长率'] > 10 else "↗️" if row['增长率'] > 0 else "↘️" if row['增长率'] > -10 else "📉"
            content += f"{idx}. **{row['SKU(ZH)']}** ({row['SKU Code']}): {row['近14天总销量']:,.0f}件，{growth_emoji} {row['增长率']:+.1f}%\n"

        # 异常增长
        growth_skus = skt_analysis[skt_analysis['分类'] == '异常增长'].nlargest(5, '增长率')
        if len(growth_skus) < 5:
            # 补充正常增长的SKU
            normal_growth = skt_analysis[
                (skt_analysis['分类'] == '正常') & (skt_analysis['增长率'] > 20)
            ].nlargest(10, '增长率')
            growth_skus = pd.concat([growth_skus, normal_growth]).drop_duplicates().nlargest(5, '增长率')

        if len(growth_skus) > 0:
            content += f"\n### 🚀 异常增长 SKU (Top 5)\n\n"
            for _, row in growth_skus.head(5).iterrows():
                content += f"- **{row['SKU(ZH)']}** ({row['SKU Code']}): {int(row['前7天日均'])}→{int(row['后7天日均'])}件/天，{row['增长率']:+.1f}%\n"

        # 异常下降
        decline_skus = skt_analysis[skt_analysis['分类'] == '异常下降'].nsmallest(5, '增长率')
        if len(decline_skus) < 5:
            # 补充正常下降的SKU
            normal_decline = skt_analysis[
                (skt_analysis['分类'] == '正常') & (skt_analysis['增长率'] < -10)
            ].nsmallest(10, '增长率')
            decline_skus = pd.concat([decline_skus, normal_decline]).drop_duplicates().nsmallest(5, '增长率')

        if len(decline_skus) > 0:
            content += f"\n### 📉 异常下降 SKU (Top 5)\n\n"
            for _, row in decline_skus.head(5).iterrows():
                content += f"- **{row['SKU(ZH)']}** ({row['SKU Code']}): {int(row['前7天日均'])}→{int(row['后7天日均'])}件/天，{row['增长率']:.1f}%\n"

        content += "\n---\n\n"

    # Timephoria品牌
    if tp_analysis is not None and len(tp_analysis) > 0:
        content += "## 🔶 Timephoria 品牌\n\n"

        # 渠道表现
        df_tp = df[df['BRAND'] == 'TP']
        df_14d = df_tp[df_tp['Date'] >= date_14d_ago]
        df_7d = df_tp[df_tp['Date'] >= date_7d_ago]

        channel_daily = df_14d.groupby(['Date', 'Channels'])['UNIT'].sum().reset_index()
        channels = sorted(channel_daily['Channels'].unique())

        # 近7天各渠道日销量明细
        content += "### 📅 近7天各渠道日销量\n\n"
        channel_7d = df_7d.groupby(['Date', 'Channels'])['UNIT'].sum().reset_index()
        channel_7d_pivot = channel_7d.pivot(index='Date', columns='Channels', values='UNIT').fillna(0)

        # 表头
        content += "| 日期 | " + " | ".join(channels) + " |\n"
        content += "|" + "---|" * (len(channels) + 1) + "\n"

        # 数据行
        for date, row in channel_7d_pivot.iterrows():
            date_str = date.strftime('%m-%d')
            content += f"| {date_str} |"
            for ch in channels:
                val = int(row.get(ch, 0))
                content += f" {val:,} |"
            content += "\n"

        # 渠道增长分析
        content += "\n### 📈 渠道增长分析\n\n"
        for channel in channels:
            channel_data = channel_daily[channel_daily['Channels'] == channel].sort_values('Date')
            if len(channel_data) >= 2:
                mid_point = len(channel_data) // 2
                first_half_avg = channel_data.head(mid_point)['UNIT'].mean() if mid_point > 0 else channel_data['UNIT'].mean()
                last_half_avg = channel_data.tail(mid_point)['UNIT'].mean() if mid_point > 0 else channel_data['UNIT'].mean()
                growth_rate = ((last_half_avg - first_half_avg) / first_half_avg * 100) if first_half_avg > 0 else 0
                emoji = "📈" if growth_rate > 0 else "📉"
                content += f"- **{channel}**: 前7天日均 {first_half_avg:,.0f} → 后7天日均 {last_half_avg:,.0f}，{emoji} {growth_rate:+.1f}%\n"

        # 主要市场
        country_total = df_14d.groupby('地区')['UNIT'].sum().sort_values(ascending=False)
        content += f"\n### 🌍 国家销量排名\n\n"
        for idx, (country, sales) in enumerate(country_total.head(5).items(), 1):
            content += f"{idx}. **{country}**: {sales:,.0f} 件\n"

        # Top SKU
        content += f"\n### 🏆 Top 10 SKU\n\n"
        top10 = tp_analysis.nlargest(10, '近14天总销量')
        for idx, (_, row) in enumerate(top10.iterrows(), 1):
            growth_emoji = "📈" if row['增长率'] > 10 else "↗️" if row['增长率'] > 0 else "↘️" if row['增长率'] > -10 else "📉"
            content += f"{idx}. **{row['SKU(ZH)']}** ({row['SKU Code']}): {row['近14天总销量']:,.0f}件，{growth_emoji} {row['增长率']:+.1f}%\n"

        # 异常增长
        growth_skus = tp_analysis[tp_analysis['分类'] == '异常增长'].nlargest(5, '增长率')
        if len(growth_skus) < 5:
            # 补充正常增长的SKU
            normal_growth = tp_analysis[
                (tp_analysis['分类'] == '正常') & (tp_analysis['增长率'] > 20)
            ].nlargest(10, '增长率')
            growth_skus = pd.concat([growth_skus, normal_growth]).drop_duplicates().nlargest(5, '增长率')

        if len(growth_skus) > 0:
            content += f"\n### 🚀 异常增长 SKU (Top 5)\n\n"
            for _, row in growth_skus.head(5).iterrows():
                content += f"- **{row['SKU(ZH)']}** ({row['SKU Code']}): {int(row['前7天日均'])}→{int(row['后7天日均'])}件/天，{row['增长率']:+.1f}%\n"

        # 异常下降
        decline_skus = tp_analysis[tp_analysis['分类'] == '异常下降'].nsmallest(5, '增长率')
        if len(decline_skus) < 5:
            # 补充正常下降的SKU
            normal_decline = tp_analysis[
                (tp_analysis['分类'] == '正常') & (tp_analysis['增长率'] < -10)
            ].nsmallest(10, '增长率')
            decline_skus = pd.concat([decline_skus, normal_decline]).drop_duplicates().nsmallest(5, '增长率')

        if len(decline_skus) > 0:
            content += f"\n### 📉 异常下降 SKU (Top 5)\n\n"
            for _, row in decline_skus.head(5).iterrows():
                content += f"- **{row['SKU(ZH)']}** ({row['SKU Code']}): {int(row['前7天日均'])}→{int(row['后7天日均'])}件/天，{row['增长率']:.1f}%\n"

    return content
