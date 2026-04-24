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

def send_to_dingtalk(webhook_url, secret, content, use_html=False):
    """
    发送消息到钉钉群

    Args:
        webhook_url: 钉钉机器人webhook地址
        secret: 钉钉机器人加签密钥（可选，如果未设置则传None）
        content: 要发送的文本内容（Markdown或HTML）
        use_html: 是否使用HTML格式（ActionCard类型）
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
    if use_html:
        message = {
            "msgtype": "actionCard",
            "actionCard": {
                "title": "品牌分析 - 销量报告",
                "text": content,
                "hideAvatar": "0",
                "btnOrientation": "0"
            }
        }
    else:
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
    将分析报告格式化为钉钉HTML格式（ActionCard）
    """
    from datetime import timedelta

    latest_date = df['Date'].max()
    date_14d_ago = latest_date - timedelta(days=13)
    date_7d_ago = latest_date - timedelta(days=6)

    # HTML样式
    html = f"""
    <div style="padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 10px; color: white; margin-bottom: 20px;">
            <h1 style="margin: 0; font-size: 24px;">📊 品牌销量分析报告</h1>
            <p style="margin: 10px 0 0 0; opacity: 0.9;">数据时间: {date_14d_ago.strftime('%Y-%m-%d')} 至 {latest_date.strftime('%Y-%m-%d')}</p>
        </div>
    """

    # SKINTIFIC品牌
    if skt_analysis is not None and len(skt_analysis) > 0:
        html += """
        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #667eea;">
            <h2 style="margin: 0 0 15px 0; color: #667eea; font-size: 20px;">🔷 SKINTIFIC 品牌</h2>
        """

        # 渠道表现
        df_skt = df[df['BRAND'] == 'SKT']
        df_14d = df_skt[df_skt['Date'] >= date_14d_ago]
        df_7d = df_skt[df_skt['Date'] >= date_7d_ago]

        channel_daily = df_14d.groupby(['Date', 'Channels'])['UNIT'].sum().reset_index()
        channels = sorted(channel_daily['Channels'].unique())

        # 近7天各渠道日销量明细
        html += """
            <h3 style="color: #495057; font-size: 16px; margin: 15px 0 10px 0;">📅 近7天各渠道日销量</h3>
            <table style="width: 100%; border-collapse: collapse; background: white; border-radius: 6px; overflow: hidden;">
                <thead>
                    <tr style="background: #667eea; color: white;">
                        <th style="padding: 10px; text-align: left; border: 1px solid #dee2e6;">日期</th>
        """
        for ch in channels:
            html += f'<th style="padding: 10px; text-align: right; border: 1px solid #dee2e6;">{ch}</th>'
        html += "</tr></thead><tbody>"

        channel_7d = df_7d.groupby(['Date', 'Channels'])['UNIT'].sum().reset_index()
        channel_7d_pivot = channel_7d.pivot(index='Date', columns='Channels', values='UNIT').fillna(0)

        for idx, (date, row) in enumerate(channel_7d_pivot.iterrows()):
            bg_color = "#f8f9fa" if idx % 2 == 0 else "white"
            date_str = date.strftime('%m-%d')
            html += f'<tr style="background: {bg_color};"><td style="padding: 8px; border: 1px solid #dee2e6;">{date_str}</td>'
            for ch in channels:
                val = int(row.get(ch, 0))
                html += f'<td style="padding: 8px; text-align: right; border: 1px solid #dee2e6;">{val:,}</td>'
            html += "</tr>"
        html += "</tbody></table>"

        # 渠道增长分析
        html += '<h3 style="color: #495057; font-size: 16px; margin: 20px 0 10px 0;">📈 渠道增长分析</h3><div style="background: white; padding: 15px; border-radius: 6px;">'
        for channel in channels:
            channel_data = channel_daily[channel_daily['Channels'] == channel].sort_values('Date')
            if len(channel_data) >= 2:
                mid_point = len(channel_data) // 2
                first_half_avg = channel_data.head(mid_point)['UNIT'].mean() if mid_point > 0 else channel_data['UNIT'].mean()
                last_half_avg = channel_data.tail(mid_point)['UNIT'].mean() if mid_point > 0 else channel_data['UNIT'].mean()
                growth_rate = ((last_half_avg - first_half_avg) / first_half_avg * 100) if first_half_avg > 0 else 0

                color = "#28a745" if growth_rate > 0 else "#dc3545"
                emoji = "📈" if growth_rate > 0 else "📉"
                html += f'<div style="padding: 8px 0; border-bottom: 1px solid #e9ecef;"><strong style="color: {color};">{channel}</strong>: 前7天日均 {first_half_avg:,.0f} → 后7天日均 {last_half_avg:,.0f}，{emoji} <span style="color: {color}; font-weight: bold;">{growth_rate:+.1f}%</span></div>'
        html += "</div>"

        # 主要市场
        country_total = df_14d.groupby('地区')['UNIT'].sum().sort_values(ascending=False)
        html += '<h3 style="color: #495057; font-size: 16px; margin: 20px 0 10px 0;">🌍 国家销量排名</h3><div style="background: white; padding: 15px; border-radius: 6px;">'
        for idx, (country, sales) in enumerate(country_total.head(5).items(), 1):
            medal = "🥇" if idx == 1 else "🥈" if idx == 2 else "🥉" if idx == 3 else f"{idx}."
            html += f'<div style="padding: 8px 0; border-bottom: 1px solid #e9ecef;"><span style="font-size: 18px;">{medal}</span> <strong>{country}</strong>: {sales:,.0f} 件</div>'
        html += "</div>"

        # Top SKU
        html += '<h3 style="color: #495057; font-size: 16px; margin: 20px 0 10px 0;">🏆 Top 10 SKU</h3><div style="background: white; padding: 15px; border-radius: 6px;">'
        top10 = skt_analysis.nlargest(10, '近14天总销量')
        for idx, (_, row) in enumerate(top10.iterrows(), 1):
            growth_color = "#28a745" if row['增长率'] > 0 else "#dc3545"
            growth_emoji = "📈" if row['增长率'] > 10 else "↗️" if row['增长率'] > 0 else "↘️" if row['增长率'] > -10 else "📉"
            html += f'<div style="padding: 8px 0; border-bottom: 1px solid #e9ecef;"><strong>{idx}. {row["SKU(ZH)"]}</strong> <span style="color: #6c757d; font-size: 12px;">({row["SKU Code"]})</span><br/><span style="color: #495057;">{row["近14天总销量"]:,.0f}件</span> {growth_emoji} <span style="color: {growth_color}; font-weight: bold;">{row["增长率"]:+.1f}%</span></div>'
        html += "</div>"

        # 异常增长
        growth_skus = skt_analysis[skt_analysis['分类'] == '异常增长'].nlargest(5, '增长率')
        if len(growth_skus) < 5:
            normal_growth = skt_analysis[(skt_analysis['分类'] == '正常') & (skt_analysis['增长率'] > 20)].nlargest(10, '增长率')
            growth_skus = pd.concat([growth_skus, normal_growth]).drop_duplicates().nlargest(5, '增长率')

        if len(growth_skus) > 0:
            html += '<h3 style="color: #28a745; font-size: 16px; margin: 20px 0 10px 0;">🚀 异常增长 SKU (Top 5)</h3><div style="background: #d4edda; padding: 15px; border-radius: 6px; border-left: 4px solid #28a745;">'
            for _, row in growth_skus.head(5).iterrows():
                html += f'<div style="padding: 8px 0; border-bottom: 1px solid #c3e6cb;"><strong>{row["SKU(ZH)"]}</strong> <span style="color: #155724; font-size: 12px;">({row["SKU Code"]})</span><br/>{int(row["前7天日均"])}→{int(row["后7天日均"])}件/天，<span style="color: #28a745; font-weight: bold;">{row["增长率"]:+.1f}%</span></div>'
            html += "</div>"

        # 异常下降
        decline_skus = skt_analysis[skt_analysis['分类'] == '异常下降'].nsmallest(5, '增长率')
        if len(decline_skus) < 5:
            normal_decline = skt_analysis[(skt_analysis['分类'] == '正常') & (skt_analysis['增长率'] < -10)].nsmallest(10, '增长率')
            decline_skus = pd.concat([decline_skus, normal_decline]).drop_duplicates().nsmallest(5, '增长率')

        if len(decline_skus) > 0:
            html += '<h3 style="color: #dc3545; font-size: 16px; margin: 20px 0 10px 0;">📉 异常下降 SKU (Top 5)</h3><div style="background: #f8d7da; padding: 15px; border-radius: 6px; border-left: 4px solid #dc3545;">'
            for _, row in decline_skus.head(5).iterrows():
                html += f'<div style="padding: 8px 0; border-bottom: 1px solid #f5c6cb;"><strong>{row["SKU(ZH)"]}</strong> <span style="color: #721c24; font-size: 12px;">({row["SKU Code"]})</span><br/>{int(row["前7天日均"])}→{int(row["后7天日均"])}件/天，<span style="color: #dc3545; font-weight: bold;">{row["增长率"]:.1f}%</span></div>'
            html += "</div>"

        html += "</div>"  # 关闭 SKINTIFIC 区块

    # Timephoria品牌（类似结构）
    if tp_analysis is not None and len(tp_analysis) > 0:
        html += """
        <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #ffc107;">
            <h2 style="margin: 0 0 15px 0; color: #856404; font-size: 20px;">🔶 Timephoria 品牌</h2>
        """

        df_tp = df[df['BRAND'] == 'TP']
        df_14d = df_tp[df_tp['Date'] >= date_14d_ago]
        df_7d = df_tp[df_tp['Date'] >= date_7d_ago]

        channel_daily = df_14d.groupby(['Date', 'Channels'])['UNIT'].sum().reset_index()
        channels = sorted(channel_daily['Channels'].unique())

        # 渠道增长分析
        html += '<h3 style="color: #856404; font-size: 16px; margin: 15px 0 10px 0;">📈 渠道增长分析</h3><div style="background: white; padding: 15px; border-radius: 6px;">'
        for channel in channels:
            channel_data = channel_daily[channel_daily['Channels'] == channel].sort_values('Date')
            if len(channel_data) >= 2:
                mid_point = len(channel_data) // 2
                first_half_avg = channel_data.head(mid_point)['UNIT'].mean() if mid_point > 0 else channel_data['UNIT'].mean()
                last_half_avg = channel_data.tail(mid_point)['UNIT'].mean() if mid_point > 0 else channel_data['UNIT'].mean()
                growth_rate = ((last_half_avg - first_half_avg) / first_half_avg * 100) if first_half_avg > 0 else 0

                color = "#28a745" if growth_rate > 0 else "#dc3545"
                emoji = "📈" if growth_rate > 0 else "📉"
                html += f'<div style="padding: 8px 0; border-bottom: 1px solid #e9ecef;"><strong style="color: {color};">{channel}</strong>: 前7天日均 {first_half_avg:,.0f} → 后7天日均 {last_half_avg:,.0f}，{emoji} <span style="color: {color}; font-weight: bold;">{growth_rate:+.1f}%</span></div>'
        html += "</div>"

        # Top SKU
        html += '<h3 style="color: #856404; font-size: 16px; margin: 20px 0 10px 0;">🏆 Top 10 SKU</h3><div style="background: white; padding: 15px; border-radius: 6px;">'
        top10 = tp_analysis.nlargest(10, '近14天总销量')
        for idx, (_, row) in enumerate(top10.iterrows(), 1):
            growth_color = "#28a745" if row['增长率'] > 0 else "#dc3545"
            growth_emoji = "📈" if row['增长率'] > 10 else "↗️" if row['增长率'] > 0 else "↘️" if row['增长率'] > -10 else "📉"
            html += f'<div style="padding: 8px 0; border-bottom: 1px solid #e9ecef;"><strong>{idx}. {row["SKU(ZH)"]}</strong> <span style="color: #6c757d; font-size: 12px;">({row["SKU Code"]})</span><br/><span style="color: #495057;">{row["近14天总销量"]:,.0f}件</span> {growth_emoji} <span style="color: {growth_color}; font-weight: bold;">{row["增长率"]:+.1f}%</span></div>'
        html += "</div>"

        html += "</div>"  # 关闭 Timephoria 区块

    html += "</div>"  # 关闭主容器
    return html
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
