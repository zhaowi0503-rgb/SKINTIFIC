#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成HTML格式的销量日报
"""

import sys
import os
sys.path.append('/Users/skintific')

from brand_sales_analysis import connect_and_load_data
import pandas as pd
from datetime import datetime, timedelta
import numpy as np

def calculate_trend_slope(values):
    """计算销量曲线斜率（线性回归）"""
    if len(values) < 2:
        return 0
    x = np.arange(len(values))
    y = np.array(values)
    slope = np.polyfit(x, y, 1)[0]
    return slope

def analyze_channel_trend(df_14d, channel):
    """分析单个渠道的7天趋势（需要14天数据来计算环比）"""
    channel_data = df_14d[df_14d['Channels'] == channel].groupby('Date')['UNIT'].sum().sort_index()

    if len(channel_data) < 7:
        return None

    # 取最近7天
    daily_sales = channel_data.tail(7).values
    dates = channel_data.tail(7).index

    # 计算斜率
    slope = calculate_trend_slope(daily_sales)

    # 近7日日均
    avg_7d = daily_sales.mean()

    # 上周日均（如果有14天数据）
    if len(channel_data) >= 14:
        prev_7d_sales = channel_data.head(7).values
        prev_avg_7d = prev_7d_sales.mean()
        change_rate = ((avg_7d - prev_avg_7d) / prev_avg_7d * 100) if prev_avg_7d > 0 else 0
    else:
        # 如果不足14天，用前3天和后3天对比
        first_3_avg = daily_sales[:3].mean() if len(daily_sales) >= 3 else daily_sales[0]
        last_3_avg = daily_sales[-3:].mean() if len(daily_sales) >= 3 else daily_sales[-1]
        change_rate = ((last_3_avg - first_3_avg) / first_3_avg * 100) if first_3_avg > 0 else 0

    # 趋势判断
    if slope > avg_7d * 0.05:
        trend = "显著上升"
        trend_icon = "📈"
        trend_color = "#28a745"
    elif slope > 0:
        trend = "小幅上升"
        trend_icon = "↗️"
        trend_color = "#20c997"
    elif slope > -avg_7d * 0.05:
        trend = "小幅下降"
        trend_icon = "↘️"
        trend_color = "#ffc107"
    else:
        trend = "显著下降"
        trend_icon = "📉"
        trend_color = "#dc3545"

    return {
        'channel': channel,
        'daily_sales': daily_sales.tolist(),
        'dates': [d.strftime('%m-%d') for d in dates],
        'avg_7d': avg_7d,
        'change_rate': change_rate,
        'trend': trend,
        'trend_icon': trend_icon,
        'trend_color': trend_color
    }

def analyze_country_trend(df_14d, country):
    """分析单个国家的7天趋势（需要14天数据来计算环比）"""
    country_data = df_14d[df_14d['地区'] == country].groupby('Date')['UNIT'].sum().sort_index()

    if len(country_data) < 7:
        return None

    # 取最近7天
    daily_sales = country_data.tail(7).values
    dates = country_data.tail(7).index

    slope = calculate_trend_slope(daily_sales)

    # 近7日日均
    avg_7d = daily_sales.mean()

    # 上周日均（如果有14天数据）
    if len(country_data) >= 14:
        prev_7d_sales = country_data.head(7).values
        prev_avg_7d = prev_7d_sales.mean()
        change_rate = ((avg_7d - prev_avg_7d) / prev_avg_7d * 100) if prev_avg_7d > 0 else 0
    else:
        first_3_avg = daily_sales[:3].mean() if len(daily_sales) >= 3 else daily_sales[0]
        last_3_avg = daily_sales[-3:].mean() if len(daily_sales) >= 3 else daily_sales[-1]
        change_rate = ((last_3_avg - first_3_avg) / first_3_avg * 100) if first_3_avg > 0 else 0

    if slope > avg_7d * 0.05:
        trend = "显著上升"
        trend_icon = "📈"
        trend_color = "#28a745"
    elif slope > 0:
        trend = "小幅上升"
        trend_icon = "↗️"
        trend_color = "#20c997"
    elif slope > -avg_7d * 0.05:
        trend = "小幅下降"
        trend_icon = "↘️"
        trend_color = "#ffc107"
    else:
        trend = "显著下降"
        trend_icon = "📉"
        trend_color = "#dc3545"

    return {
        'country': country,
        'daily_sales': daily_sales.tolist(),
        'dates': [d.strftime('%m-%d') for d in dates],
        'avg_7d': avg_7d,
        'change_rate': change_rate,
        'trend': trend,
        'trend_icon': trend_icon,
        'trend_color': trend_color
    }

def analyze_sku_trend(df_7d, sku_code):
    """分析单个SKU的7天趋势"""
    sku_data = df_7d[df_7d['SKU Code'] == sku_code].groupby('Date')['UNIT'].sum().sort_index()

    if len(sku_data) == 0:
        return None

    daily_sales = sku_data.values
    slope = calculate_trend_slope(daily_sales)

    first_3_avg = daily_sales[:3].mean() if len(daily_sales) >= 3 else daily_sales[0]
    last_3_avg = daily_sales[-3:].mean() if len(daily_sales) >= 3 else daily_sales[-1]

    avg_7d = daily_sales.mean()
    change_rate = ((last_3_avg - first_3_avg) / first_3_avg * 100) if first_3_avg > 0 else 0

    if slope > avg_7d * 0.05:
        trend = "上升"
        trend_icon = "📈"
    elif slope > 0:
        trend = "微涨"
        trend_icon = "↗️"
    elif slope > -avg_7d * 0.05:
        trend = "微降"
        trend_icon = "↘️"
    else:
        trend = "下降"
        trend_icon = "📉"

    return {
        'avg_7d': avg_7d,
        'first_3_avg': first_3_avg,
        'last_3_avg': last_3_avg,
        'change_rate': change_rate,
        'trend': trend,
        'trend_icon': trend_icon,
        'slope': slope
    }

def generate_brand_html(df, brand_code, brand_name, brand_color):
    """生成单个品牌的HTML报告"""

    df_brand = df[df['BRAND'] == brand_code].copy()

    if len(df_brand) == 0:
        return f"<p>未找到 {brand_name} 品牌数据</p>"

    latest_date = df_brand['Date'].max()
    date_14d_ago = latest_date - timedelta(days=13)
    date_7d_ago = latest_date - timedelta(days=6)

    df_14d = df_brand[df_brand['Date'] >= date_14d_ago].copy()
    df_7d = df_brand[df_brand['Date'] >= date_7d_ago].copy()

    html = f"""
    <div style="margin-bottom: 40px; border: 2px solid {brand_color}; border-radius: 12px; overflow: hidden;">
        <div style="background: {brand_color}; padding: 20px; color: white;">
            <h2 style="margin: 0; font-size: 22px;">🏷️ {brand_name}</h2>
            <p style="margin: 8px 0 0 0; opacity: 0.9; font-size: 14px;">数据周期: {date_7d_ago.strftime('%Y-%m-%d')} 至 {latest_date.strftime('%Y-%m-%d')}</p>
        </div>

        <div style="padding: 20px; background: #f8f9fa;">
    """

    # 1. 渠道维度分析
    channels = sorted(df_7d['Channels'].unique())
    channel_analyses = []

    for channel in channels:
        channel_analysis = analyze_channel_trend(df_14d, channel)
        if channel_analysis:
            channel_analyses.append(channel_analysis)

    # 按日均销量降序排列
    channel_analyses = sorted(channel_analyses, key=lambda x: x['avg_7d'], reverse=True)

    if channel_analyses:
        dates = channel_analyses[0]['dates']

        html += """
            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <h3 style="margin: 0 0 15px 0; color: #495057; font-size: 18px; border-bottom: 2px solid #e9ecef; padding-bottom: 10px;">
                    📊 渠道维度分析
                </h3>

                <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 15px;">
                    <thead>
                        <tr style="background: #e9ecef;">
                            <th style="padding: 10px; text-align: left; border: 1px solid #dee2e6; width: 100px;">渠道</th>
                            <th style="padding: 10px; text-align: center; border: 1px solid #dee2e6; width: 100px;">趋势</th>
        """

        for date in dates:
            html += f'<th style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">{date}</th>'

        html += """
                            <th style="padding: 10px; text-align: center; border: 1px solid #dee2e6; width: 90px;">7日日均</th>
                            <th style="padding: 10px; text-align: center; border: 1px solid #dee2e6; width: 80px;">环比</th>
                        </tr>
                    </thead>
                    <tbody>
        """

        for idx, ch_analysis in enumerate(channel_analyses):
            bg_color = "#f8f9fa" if idx % 2 == 0 else "white"
            html += f"""
                        <tr style="background: {bg_color};">
                            <td style="padding: 10px; border: 1px solid #dee2e6; font-weight: bold;">{ch_analysis['channel']}</td>
                            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6; color: {ch_analysis['trend_color']};">{ch_analysis['trend_icon']} {ch_analysis['trend']}</td>
            """

            for sales in ch_analysis['daily_sales']:
                html += f'<td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">{int(sales):,}</td>'

            change_color = ch_analysis['trend_color']
            html += f"""
                            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6; font-weight: bold;">{ch_analysis['avg_7d']:,.0f}</td>
                            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6; color: {change_color}; font-weight: bold;">{ch_analysis['change_rate']:+.1f}%</td>
                        </tr>
            """

        html += """
                    </tbody>
                </table>

                <div style="font-size: 12px; color: #6c757d; padding: 10px; background: #f8f9fa; border-radius: 4px;">
                    <strong>说明:</strong> 环比 = (近7日日均 - 上周日均) / 上周日均
                </div>
            </div>
        """

    # 2. 国家维度分析
    countries = sorted(df_7d['地区'].unique())
    country_analyses = []

    for country in countries:
        country_analysis = analyze_country_trend(df_14d, country)
        if country_analysis:
            country_analyses.append(country_analysis)

    # 按日均销量降序排列
    country_analyses = sorted(country_analyses, key=lambda x: x['avg_7d'], reverse=True)

    if country_analyses:
        dates = country_analyses[0]['dates']

        html += """
            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <h3 style="margin: 0 0 15px 0; color: #495057; font-size: 18px; border-bottom: 2px solid #e9ecef; padding-bottom: 10px;">
                    🌍 国家维度分析
                </h3>

                <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 15px;">
                    <thead>
                        <tr style="background: #e9ecef;">
                            <th style="padding: 10px; text-align: left; border: 1px solid #dee2e6; width: 100px;">国家</th>
                            <th style="padding: 10px; text-align: center; border: 1px solid #dee2e6; width: 100px;">趋势</th>
        """

        for date in dates:
            html += f'<th style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">{date}</th>'

        html += """
                            <th style="padding: 10px; text-align: center; border: 1px solid #dee2e6; width: 90px;">7日日均</th>
                            <th style="padding: 10px; text-align: center; border: 1px solid #dee2e6; width: 80px;">环比</th>
                        </tr>
                    </thead>
                    <tbody>
        """

        for idx, ct_analysis in enumerate(country_analyses):
            bg_color = "#f8f9fa" if idx % 2 == 0 else "white"
            html += f"""
                        <tr style="background: {bg_color};">
                            <td style="padding: 10px; border: 1px solid #dee2e6; font-weight: bold;">{ct_analysis['country']}</td>
                            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6; color: {ct_analysis['trend_color']};">{ct_analysis['trend_icon']} {ct_analysis['trend']}</td>
            """

            for sales in ct_analysis['daily_sales']:
                html += f'<td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">{int(sales):,}</td>'

            change_color = ct_analysis['trend_color']
            html += f"""
                            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6; font-weight: bold;">{ct_analysis['avg_7d']:,.0f}</td>
                            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6; color: {change_color}; font-weight: bold;">{ct_analysis['change_rate']:+.1f}%</td>
                        </tr>
            """

        html += """
                    </tbody>
                </table>

                <div style="font-size: 12px; color: #6c757d; padding: 10px; background: #f8f9fa; border-radius: 4px;">
                    <strong>说明:</strong> 环比 = (近7日日均 - 上周日均) / 上周日均
                </div>
            </div>
        """

    # 3. TOP 10 SKU分析
    sku_7d_total = df_7d.groupby(['SKU Code', 'SKU(ZH)'])['UNIT'].sum().reset_index()
    sku_7d_total = sku_7d_total.sort_values('UNIT', ascending=False).head(10)

    html += """
            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <h3 style="margin: 0 0 15px 0; color: #495057; font-size: 18px; border-bottom: 2px solid #e9ecef; padding-bottom: 10px;">
                    🏆 TOP 10 SKU 销量波动
                </h3>

                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="background: #e9ecef;">
                            <th style="padding: 10px; text-align: left; border: 1px solid #dee2e6;">排名</th>
                            <th style="padding: 10px; text-align: left; border: 1px solid #dee2e6;">SKU名称</th>
                            <th style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">SKU Code</th>
                            <th style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">近7日日均</th>
                            <th style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">环比</th>
                            <th style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">趋势</th>
                        </tr>
                    </thead>
                    <tbody>
    """

    for idx, row in sku_7d_total.iterrows():
        rank = sku_7d_total.index.get_loc(idx) + 1
        sku_analysis = analyze_sku_trend(df_7d, row['SKU Code'])

        if not sku_analysis:
            continue

        change_color = "#28a745" if sku_analysis['change_rate'] > 0 else "#dc3545" if sku_analysis['change_rate'] < 0 else "#6c757d"

        html += f"""
                        <tr style="background: {'#f8f9fa' if rank % 2 == 0 else 'white'};">
                            <td style="padding: 10px; border: 1px solid #dee2e6; font-weight: bold;">#{rank}</td>
                            <td style="padding: 10px; border: 1px solid #dee2e6;">{row['SKU(ZH)']}</td>
                            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6; font-family: monospace; color: #6c757d;">{row['SKU Code']}</td>
                            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6; font-weight: bold;">{sku_analysis['avg_7d']:,.0f}</td>
                            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6; color: {change_color}; font-weight: bold;">{sku_analysis['change_rate']:+.1f}%</td>
                            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">{sku_analysis['trend_icon']} {sku_analysis['trend']}</td>
                        </tr>
        """

    html += """
                    </tbody>
                </table>
            </div>
    """

    # 4. 增长SKU 和 5. 下降SKU（左右布局）
    all_skus = df_7d.groupby(['SKU Code', 'SKU(ZH)']).size().reset_index()[['SKU Code', 'SKU(ZH)']]
    growth_skus = []
    decline_skus = []

    for _, sku_row in all_skus.iterrows():
        sku_analysis = analyze_sku_trend(df_7d, sku_row['SKU Code'])
        if sku_analysis:
            if sku_analysis['slope'] > 0 and sku_analysis['change_rate'] > 10:
                growth_skus.append({
                    'sku_code': sku_row['SKU Code'],
                    'sku_name': sku_row['SKU(ZH)'],
                    'first_3_avg': sku_analysis['first_3_avg'],
                    'last_3_avg': sku_analysis['last_3_avg'],
                    'change_rate': sku_analysis['change_rate'],
                    'trend_icon': sku_analysis['trend_icon']
                })
            elif sku_analysis['slope'] < 0 and sku_analysis['change_rate'] < -10:
                decline_skus.append({
                    'sku_code': sku_row['SKU Code'],
                    'sku_name': sku_row['SKU(ZH)'],
                    'first_3_avg': sku_analysis['first_3_avg'],
                    'last_3_avg': sku_analysis['last_3_avg'],
                    'change_rate': sku_analysis['change_rate'],
                    'trend_icon': sku_analysis['trend_icon']
                })

    growth_skus = sorted(growth_skus, key=lambda x: x['change_rate'], reverse=True)[:10]
    decline_skus = sorted(decline_skus, key=lambda x: x['change_rate'])[:10]

    if growth_skus or decline_skus:
        html += """
            <div style="display: flex; gap: 20px; margin-bottom: 20px;">
        """

        # 左侧：增长SKU
        html += """
                <div style="flex: 1; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <h3 style="margin: 0 0 15px 0; color: #28a745; font-size: 18px; border-bottom: 2px solid #28a745; padding-bottom: 10px;">
                        🚀 增长 SKU
                    </h3>
        """

        if growth_skus:
            for sku in growth_skus:
                html += f"""
                    <div style="padding: 12px; margin-bottom: 10px; background: #d4edda; border-left: 4px solid #28a745; border-radius: 4px;">
                        <div style="font-size: 14px; color: #155724; margin-bottom: 5px;">
                            <strong>{sku['sku_name']}</strong>
                            <span style="font-family: monospace; color: #6c757d; font-size: 12px;">({sku['sku_code']})</span>
                        </div>
                        <div style="font-size: 13px; color: #155724;">
                            {sku['trend_icon']} 日均从 <strong>{sku['first_3_avg']:,.0f}</strong> 增长到 <strong>{sku['last_3_avg']:,.0f}</strong>，
                            增幅 <strong style="color: #28a745;">{sku['change_rate']:+.1f}%</strong>
                        </div>
                    </div>
                """
        else:
            html += """
                    <p style="color: #6c757d; text-align: center; padding: 20px;">暂无显著增长的SKU</p>
            """

        html += """
                </div>
        """

        # 右侧：下降SKU
        html += """
                <div style="flex: 1; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <h3 style="margin: 0 0 15px 0; color: #dc3545; font-size: 18px; border-bottom: 2px solid #dc3545; padding-bottom: 10px;">
                        📉 下降 SKU
                    </h3>
        """

        if decline_skus:
            for sku in decline_skus:
                html += f"""
                    <div style="padding: 12px; margin-bottom: 10px; background: #f8d7da; border-left: 4px solid #dc3545; border-radius: 4px;">
                        <div style="font-size: 14px; color: #721c24; margin-bottom: 5px;">
                            <strong>{sku['sku_name']}</strong>
                            <span style="font-family: monospace; color: #6c757d; font-size: 12px;">({sku['sku_code']})</span>
                        </div>
                        <div style="font-size: 13px; color: #721c24;">
                            {sku['trend_icon']} 日均从 <strong>{sku['first_3_avg']:,.0f}</strong> 下降到 <strong>{sku['last_3_avg']:,.0f}</strong>，
                            降幅 <strong style="color: #dc3545;">{sku['change_rate']:.1f}%</strong>
                        </div>
                    </div>
                """
        else:
            html += """
                    <p style="color: #6c757d; text-align: center; padding: 20px;">暂无显著下降的SKU</p>
            """

        html += """
                </div>
            </div>
        """

    html += """
        </div>
    </div>
    """

    return html

def generate_full_report(df):
    """生成完整的HTML报告"""

    latest_date = df['Date'].max()
    date_7d_ago = latest_date - timedelta(days=6)

    html = f"""
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>品牌销量日报 - {latest_date.strftime('%Y-%m-%d')}</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
        }}
        .container {{
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            overflow: hidden;
        }}
        .header {{
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 30px;
            color: white;
            text-align: center;
        }}
        .header h1 {{
            margin: 0;
            font-size: 32px;
            font-weight: 700;
        }}
        .header p {{
            margin: 10px 0 0 0;
            font-size: 16px;
            opacity: 0.9;
        }}
        .content {{
            padding: 30px;
        }}
        .summary {{
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 30px;
            border-left: 4px solid #667eea;
        }}
        .summary h3 {{
            margin: 0 0 15px 0;
            color: #495057;
            font-size: 20px;
        }}
        .summary p {{
            margin: 8px 0;
            color: #6c757d;
            line-height: 1.6;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 品牌销量日报</h1>
            <p>数据周期: {date_7d_ago.strftime('%Y-%m-%d')} 至 {latest_date.strftime('%Y-%m-%d')}</p>
            <p style="font-size: 14px; margin-top: 5px;">生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
        </div>

        <div class="content">
    """

    # SKINTIFIC品牌
    html += generate_brand_html(df, 'SKT', 'SKINTIFIC', '#667eea')

    # Timephoria品牌
    html += generate_brand_html(df, 'TP', 'Timephoria', '#f39c12')

    # 总结
    html += """
            <div class="summary">
                <h3>📝 报告总结</h3>
                <p>本报告基于近7天的销量数据，从渠道、国家、SKU三个维度进行分析。</p>
                <p><strong>趋势判断标准:</strong> 通过线性回归计算近7天销量曲线斜率，判断整体趋势方向。</p>
                <p><strong>环比计算:</strong> 近7日日均 vs 上周日均（需14天数据）。</p>
                <p><strong>增长/下降SKU筛选:</strong> 斜率方向一致且环比变化超过10%的SKU。</p>
            </div>
        </div>
    </div>
</body>
</html>
    """

    return html

def main():
    """主函数"""
    print("正在加载数据...")
    df = connect_and_load_data()

    print("正在生成HTML报告...")
    html_content = generate_full_report(df)

    # 保存到文件
    output_file = '/Users/skintific/daily_report.html'
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(html_content)

    print(f"✅ HTML报告已生成: {output_file}")
    print(f"请在浏览器中打开查看")

if __name__ == '__main__':
    main()
